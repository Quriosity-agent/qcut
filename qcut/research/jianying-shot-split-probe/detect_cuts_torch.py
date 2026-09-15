#!/usr/bin/env python3
"""纯 PyTorch 的镜头分割:不依赖剪映运行库,只要两个 .bytenn 模型文件和 params.tsv。

流程与引擎逐层对拍过,后处理照 libcccreator 的反汇编(0xcc7844)逐字实现:
    帧(RGB)-> 双线性缩放到 96x96(整帧拉伸、无抗锯齿、align_corners=False)-> x/127.5-1
    -> 主干 128 维特征 -> 最近 7 帧 [f-6, f] 喂预测头 -> 概率 P 归到中心帧 c = f-3(引擎从 f=7 起算)
    -> 在 P 上找局部极大值(上升后下降;平台算继续上升),且 P > 阈值(默认 0.35),切点 = 中心帧 c
    -> 若极值左侧概率差 < 0.1 且 Q[c-1] > 2·Q[c-2],切点左移一帧;
       否则若右侧概率差 < 0.1 且 Q[c] < 2·Q[c+1],切点右移一帧
       其中 Q[k] = 第 k 帧与第 k+1 帧 96x96 RGB uint8 图的逐字节平均绝对差
    在 3 份素材共 15 个切点上与剪映桥接 predict_result 完全一致。

输入可以是视频(用 ffmpeg 解成 --width x --height 的 RGB,默认 320x180,与 CLI 的桥接路径同一套采样)
或原始 RGBA 帧文件。`--json` 把结果按 QCut CLI 读得懂的形状打到 stdout;进度以 `[progress] ...` 行打到 stderr。

用法:
    ./detect_cuts_torch.py <backbone.bytenn> <backbone params.tsv> <predhead.bytenn> <predhead params.tsv> \
        (--video <文件> [--fps 24] [--width 320] [--height 180] [--ffmpeg <路径>] | --raw <rgba文件> <宽> <高>) \
        [--threshold 0.35] [--scores out.tsv] [--json]
"""
import argparse
import json
import pathlib
import shutil
import subprocess
import sys
import time

import numpy as np
import torch
import torch.nn.functional as F

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from torch_backbone import build as build_backbone  # noqa: E402
from torch_predhead import PredHead  # noqa: E402

HERE = pathlib.Path(__file__).resolve().parent
FFMPEG = HERE.parent.parent / "electron" / "resources" / "ffmpeg" / "darwin-arm64" / "ffmpeg"
WINDOW = 7
CENTER_OFFSET = 3


def progress(message):
    print(f"[progress] {message}", file=sys.stderr, flush=True)


def resolve_ffmpeg(ffmpeg=None):
    """优先用显式路径,其次 QCut 自带的(仓库里不跟踪,只靠构建阶段落到 electron/resources),最后 PATH 里的 ffmpeg。"""
    if ffmpeg:
        return ffmpeg
    if FFMPEG.exists():
        return str(FFMPEG)
    found = shutil.which("ffmpeg")
    if found:
        return found
    raise SystemExit(f"找不到 ffmpeg:QCut 自带的 {FFMPEG} 尚未落地(先跑一次 QCut 构建或 ffmpeg 暂存脚本),PATH 里也没有;可用 --ffmpeg 指定")


def frames_from_video(path, fps, width=320, height=180, ffmpeg=None):
    """与 CLI 桥接路径同一套 ffmpeg 采样:fps 过滤 + 双线性缩放到 width x height。"""
    cmd = [resolve_ffmpeg(ffmpeg), "-hide_banner", "-loglevel", "error", "-nostdin", "-i", str(path), "-map", "0:v:0", "-an", "-sn",
           "-vf", f"fps={fps:g},scale={width}:{height}:flags=bilinear", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"]
    run = subprocess.run(cmd, capture_output=True)
    if run.returncode != 0:
        raise SystemExit(f"ffmpeg 解码失败: {run.stderr.decode('utf-8', 'replace').strip().splitlines()[-1:] or run.returncode}")
    frames = np.frombuffer(run.stdout, dtype=np.uint8).reshape(-1, height, width, 3)
    progress(f"decoded {len(frames)} frames")
    return frames


def frames_from_raw(path, width, height):
    raw = np.frombuffer(pathlib.Path(path).read_bytes(), dtype=np.uint8)
    return raw.reshape(-1, height, width, 4)[:, :, :, :3]


def preprocess(frames_uint8):
    """(N,H,W,3) uint8 -> (N,3,96,96) float,与引擎 blit 节点一致。"""
    x = torch.from_numpy(np.ascontiguousarray(frames_uint8)).float().permute(0, 3, 1, 2)
    x = F.interpolate(x, size=(96, 96), mode="bilinear", align_corners=False, antialias=False)
    return x / 127.5 - 1.0


FIRST_SCORED_FRAME = 7          # 引擎从喂入第 7 帧起才开始产出概率
FLAT_EPS = 0.1                  # 反汇编里 0x2c46c40 处的 double 常数


def resized_uint8(frames_uint8):
    """引擎 blit 节点的输出:96x96 RGB uint8(双线性、整帧拉伸)。"""
    x = torch.from_numpy(np.array(frames_uint8, dtype=np.uint8, copy=True)).float().permute(0, 3, 1, 2)
    return torch.round(F.interpolate(x, size=(96, 96), mode="bilinear", align_corners=False, antialias=False)).clamp(0, 255)


@torch.no_grad()
def frame_scores(backbone, head, frames_uint8, batch=64):
    """返回 (P, Q):P[c] 是中心帧 c 的切点概率,Q[k] 是第 k 帧与第 k+1 帧的平均绝对像素差。"""
    small = torch.cat([resized_uint8(frames_uint8[i:i + batch]) for i in range(0, len(frames_uint8), batch)])
    feats = []
    for i in range(0, len(small), batch):
        feats.append(backbone(small[i:i + batch] / 127.5 - 1.0))
        progress(f"features {min(i + batch, len(small))}/{len(small)}")
    feats = torch.cat(feats)
    scores = {}
    for f in range(FIRST_SCORED_FRAME, len(feats)):
        scores[f - CENTER_OFFSET] = head(feats[f - WINDOW + 1:f + 1]).item()
        if (f - FIRST_SCORED_FRAME) % 200 == 199:
            progress(f"windows {f - FIRST_SCORED_FRAME + 1}/{max(0, len(feats) - FIRST_SCORED_FRAME)}")
    diffs = (small[1:] - small[:-1]).abs().mean(dim=(1, 2, 3))
    return scores, diffs.tolist()


def cut_points(scores, diffs, threshold):
    """照 libcccreator 后处理逐字实现:P 上的局部极大值 + 用像素差 Q 微调一帧。"""
    centers = sorted(scores)
    P = [scores[c] for c in centers]
    Q = lambda k: diffs[k] if 0 <= k < len(diffs) else 0.0
    cuts, carry = [], 0
    for i in range(1, len(P) - 1):
        rising = int(P[i - 1] < P[i]) | carry
        carry = int(P[i] <= P[i + 1]) & rising
        if P[i] <= P[i + 1] or not rising:
            continue
        if not P[i] > threshold:
            carry = 0
            continue
        c = centers[i]
        if abs(P[i] - P[i - 1]) < FLAT_EPS and Q(c - 1) > 2 * Q(c - 2):
            c -= 1
        elif abs(P[i] - P[i + 1]) < FLAT_EPS and Q(c) < 2 * Q(c + 1):
            c += 1
        cuts.append(c)
    return cuts


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("backbone"); ap.add_argument("backbone_params"); ap.add_argument("predhead"); ap.add_argument("predhead_params")
    ap.add_argument("--video"); ap.add_argument("--fps", type=float, default=24.0)
    ap.add_argument("--width", type=int, default=320); ap.add_argument("--height", type=int, default=180)
    ap.add_argument("--ffmpeg", help="ffmpeg 可执行文件;默认用 QCut 自带的")
    ap.add_argument("--raw", nargs=3, metavar=("FILE", "W", "H"))
    ap.add_argument("--threshold", type=float, default=0.35); ap.add_argument("--scores")
    ap.add_argument("--json", action="store_true", help="结果按 JSON 打到 stdout(给 QCut CLI 用)")
    a = ap.parse_args()
    if not a.raw and not a.video:
        ap.error("需要 --video 或 --raw")
    started = time.time()
    frames = (frames_from_raw(a.raw[0], int(a.raw[1]), int(a.raw[2])) if a.raw
              else frames_from_video(a.video, a.fps, a.width, a.height, a.ffmpeg))
    progress("loading models")
    backbone = build_backbone(a.backbone, a.backbone_params)
    head = PredHead(a.predhead, a.predhead_params).eval()
    scores, diffs = frame_scores(backbone, head, frames)
    cuts = cut_points(scores, diffs, a.threshold)
    if a.scores:
        with open(a.scores, "w") as out:
            for frame in sorted(scores):
                out.write(f"{frame}\t{scores[frame]:.8f}\n")
    if a.json:
        print(json.dumps({
            "engine": "torch", "frame_count": len(frames), "fps": a.fps, "threshold": a.threshold,
            "cut_frames": cuts, "cut_points": [round((c + 1) / a.fps, 6) for c in cuts],
            "scores": [[frame, round(scores[frame], 6)] for frame in sorted(scores)],
            "torch_version": torch.__version__, "elapsed_ms": int((time.time() - started) * 1000),
        }))
        return
    print(f"{len(frames)} 帧;切点(帧序号,与剪映 predict_result 同约定):{cuts}")
    if not a.raw:
        print("切点(秒):" + " ".join(f"{(c + 1) / a.fps:.3f}" for c in cuts))


if __name__ == "__main__":
    main()
