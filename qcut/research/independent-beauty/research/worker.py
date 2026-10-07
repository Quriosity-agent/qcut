"""research 链路 · 感知层 worker（独立版新写）。

只调用 vendor/ 里原样拷贝的研究代码和 ONNX Runtime，**不加载任何原生运行库**。
权重（runtime/research/*.onnx）是研究从原生 .model 转出来的，只能留在本机。

本 worker 只做感知层（独立二维瘦脸原型另见 slimface_run.py）：
人脸检测 → 160 初始化 → 独立变换 → 120 → Base106，以及皮肤、抠图蒙版。

协议：stdin 每行一个 JSON 请求，stdout 每行一个 JSON 响应。
  → {"id": "...", "cmd": "analyze", "rgba_path": "...", "width": W, "height": H}
  ← {"id": "...", "ok": true, "result": {...}}  或  {"id": "...", "ok": false, "error": "..."}
启动完成时先输出一行 {"ready": true, ...}。
"""
import base64
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "vendor"))

from face_detection import Detector  # noqa: E402
from alignment_assets import load_assets  # noqa: E402
from alignment_photo import predict_photo  # noqa: E402
from alignment_infer import Stage1  # noqa: E402

MODELS = Path(os.environ.get("BEAUTY_RESEARCH_MODELS", HERE.parent / "runtime" / "research"))
MAX_FACES = 5

ALIGN_EXPANSION = 1.0
ALIGN_FLAGS = [1, 0, 0]

ASSUMPTIONS = {
    "detection": "原图经 Q11 算法缩放；短边 320、长边先截断再对齐 32，动态整数检测；已对照本机照片，等分数排序仍未普遍验收",
    "landmarks": f"直接保留算法坐标检测框，expansion={ALIGN_EXPANSION}、flags={ALIGN_FLAGS}；"
                 "已对照普通新照片的原生初始化，旋转、特殊配置及视频身份生命周期未覆盖；"
                 "已接入 160→独立变换→120 预热→120 重置 Base106，复现普通新照片的原生消费端点；"
                 "给定裁剪框的初始化逆映射已独立复现原生 float32 路径。106 点经原生顺序归一化回映原图，保留 float32 精度；"
                 "原始姿态头另存，普通新照片的 TotalFace 姿态由独立单位转换提供；消费端 pitch 固定为零",
    "skin": "研究通用配置：整帧拉伸到 128×224、RGB/255；产品前处理与裁剪未还原",
    "matting": "整帧拉伸到 640×640、(x−128)/128（容器 JSON 记录）、按 RGB 输入（通道顺序未记录，推测）",
}


def session(name):
    options = ort.SessionOptions()
    options.intra_op_num_threads, options.inter_op_num_threads = 1, 1
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    path = MODELS / name
    return ort.InferenceSession(path.read_bytes(), sess_options=options,
                                providers=["CPUExecutionProvider"])


SESSIONS = {
    "skin": session("skin-seg-224x128.onnx"),
    "matting": session("saliency-matting-640.onnx"),
}
DETECTOR_ENGINE = Detector(model=MODELS / "face-detector-dynamic.onnx")
ALIGNMENT_MODELS = {size: Stage1(size=size, model=MODELS / f"face-align-{size}.onnx") for size in (120, 160)}
ALIGNMENT_ASSETS = load_assets(path=MODELS / "alignment-assets-v1.npz")


def run(name, feed):
    runner = SESSIONS[name]
    return dict(zip((o.name for o in runner.get_outputs()), runner.run(None, feed)))


def detect(rgb):
    height, width = rgb.shape[:2]
    rgba = np.full((height, width, 4), 255, np.uint8)
    rgba[:, :, :3] = rgb
    result = DETECTOR_ENGINE.detect(rgba=rgba)
    factors = np.array([width / result["algorithm_size"][0], height / result["algorithm_size"][1]] * 2, np.float32)
    faces = []
    for rect, score in zip(result["rects"][:MAX_FACES], result["scores"][:MAX_FACES], strict=True):
        faces.append({"box": (rect * factors).tolist(), "algorithm_box": rect.tolist(), "score": float(score)})
    return faces


def landmarks(rgba, face):
    return predict_photo(rgba=rgba, box=face["box"], model_root=MODELS, assets=ALIGNMENT_ASSETS,
                         models=ALIGNMENT_MODELS, expansion=ALIGN_EXPANSION, flags=list(ALIGN_FLAGS),
                         algorithm_box=face.get("algorithm_box"))


def mask_payload(values):
    plane = (np.clip(values, 0, 1) * 255 + 0.5).astype(np.uint8)
    return {"width": int(plane.shape[1]), "height": int(plane.shape[0]),
            "data": base64.b64encode(plane.tobytes()).decode("ascii"),
            "mean": round(float(values.mean()), 4)}


def skin_mask(rgb):
    resized = np.asarray(Image.fromarray(rgb).resize((128, 224), Image.BILINEAR), np.float32)
    outputs = run("skin", {"data": np.ascontiguousarray(resized.transpose(2, 0, 1)[None]) / 255})
    return mask_payload(outputs["prob"][0, -1])


def matting_mask(rgb):
    resized = np.asarray(Image.fromarray(rgb).resize((640, 640), Image.BILINEAR), np.float32)
    outputs = run("matting", {"data": np.ascontiguousarray(((resized - 128) / 128).transpose(2, 0, 1)[None])})
    return mask_payload(outputs["Sigmoid_316"][0, 0])


def timed(timings, name, function, *args):
    started = time.perf_counter()
    try:
        return function(*args), None
    except Exception as error:  # 单个组件失败不影响其他组件
        return None, f"{type(error).__name__}: {error}"
    finally:
        timings[name] = round((time.perf_counter() - started) * 1000, 1)


def analyze(request):
    width, height = int(request["width"]), int(request["height"])
    data = Path(request["rgba_path"]).read_bytes()
    if len(data) != width * height * 4:
        raise ValueError("RGBA 字节数与尺寸不符")
    rgba = np.frombuffer(data, np.uint8).reshape(height, width, 4).copy()
    rgb = np.ascontiguousarray(rgba[:, :, :3])
    timings, errors = {}, {}
    faces, errors["detection"] = timed(timings, "detection", detect, rgb)
    for index, face in enumerate(faces or []):
        face["landmarks"], error = timed(timings, f"landmarks-{index}", landmarks, rgba, face)
        if error:
            errors[f"landmarks-{index}"] = error
    skin, errors["skin"] = timed(timings, "skin", skin_mask, rgb)
    matting, errors["matting"] = timed(timings, "matting", matting_mask, rgb)
    return {"width": width, "height": height, "faces": faces or [], "skin": skin, "matting": matting,
            "timings": timings, "errors": {k: v for k, v in errors.items() if v},
            "assumptions": ASSUMPTIONS}


def main():
    print(json.dumps({"ready": True, "onnxruntime": ort.__version__, "numpy": np.__version__,
                      "models": sorted(p.name for p in MODELS.glob("*.onnx"))}), flush=True)
    for line in sys.stdin:
        if not line.strip():
            continue
        request = {}
        try:
            request = json.loads(line)
            if request.get("cmd") != "analyze":
                raise ValueError(f"未知命令: {request.get('cmd')}")
            response = {"id": request.get("id"), "ok": True, "result": analyze(request)}
        except Exception as error:
            response = {"id": request.get("id"), "ok": False, "error": f"{type(error).__name__}: {error}"}
        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
