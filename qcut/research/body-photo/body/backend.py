"""Owned photo storage and verified execution for the standalone body app."""
from __future__ import annotations

import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import threading
import time
import uuid

from PIL import Image, ImageOps, UnidentifiedImageError

try:
    from .control_contract import CONTROL_PARTS, LEG_CONTROLS
    from .local_shape import validate_edits, validate_strokes_for_image
    from .edit_feedback import edit_feedback, verify_edit_evidence
    from .platform_backend import backend_label, select_backend
    from .photo_controls import control_parts, extended_catalog, validate_photo_controls, EXTRA_RANGES
    from . import process_group
except ImportError:
    from control_contract import CONTROL_PARTS, LEG_CONTROLS
    from local_shape import validate_edits, validate_strokes_for_image
    from edit_feedback import edit_feedback, verify_edit_evidence
    from platform_backend import backend_label, select_backend
    from photo_controls import control_parts, extended_catalog, validate_photo_controls, EXTRA_RANGES
    import process_group


MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_EDGE = 4096
MAX_PIXELS = 8_294_400
MAX_DECODE_PIXELS = 80_000_000
IDENTIFIER = re.compile(r"[0-9a-f]{32}\Z")
FORBIDDEN_NATIVE = ("libcccreator", "libbytenn", "liblens", "libagfx", "/jianyingpro.app/")


class AppError(Exception):
    def __init__(self, *, message, code="invalid_request", status=400):
        super().__init__(message)
        self.message, self.code, self.status = message, code, status


def sha256(*, data):
    return hashlib.sha256(data).hexdigest()


def image_identity(*, image):
    rgba = image.convert("RGBA")
    return {"width": rgba.width, "height": rgba.height,
            "rgbaSha256": sha256(data=rgba.tobytes())}


def write_json(*, path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def validate_values(*, value, extended=False):
    try:
        return validate_photo_controls(controls=value, extended=extended)
    except ValueError as error:
        raise AppError(message=str(error)) from error


def control_message(*, name, value, applied, detail, unavailable):
    if not value:
        return "未启用。"
    if name == "ButtLift" and detail.get("anchorSource") == "automatic-pose-silhouette-contour":
        return ("已使用自动估计的臀部轮廓，可在定位工具中校正。" if applied else
                "自动臀部轮廓置信度不足，本项未应用；请在定位工具中手动校正。")
    if name in EXTRA_RANGES:
        if not applied:
            if name.startswith("Body"):
                return "未获得可靠的身体皮肤区域，或本项未改变像素；请使用人脸清晰且有露肤的照片。"
            return {"Abdomen": "收腹需要双肩与双髋位置可靠，本项未应用。",
                    "ButtLift": "提臀需要可靠的躯干、胯部和膝部，本项未应用。",
                    "ButtShape": "臀型需要可靠的躯干、胯部和膝部，本项未应用。",
                    "LegStraighten": "腿型仅修饰近正立双腿；明显弯膝、交叉或缺少关节时不应用。",
                    "AnkleWidth": "脚踝调节需要双侧膝盖和脚踝完整可信，本项未应用。"}[name]
        if name.startswith("Body"):
            return "已处理识别到的身体皮肤区域；头脸与掩码外像素保留。"
        scale = detail.get("safetyScale", 1)
        if type(scale) in (int, float) and math.isfinite(scale) and 0 < scale < 1:
            return "已处理对应部位；为保持网格稳定，实际形变量已降低。"
        return "已处理对应部位的局部二维轮廓。"
    if name == "StretchLeg" and detail.get("portableSafety") is True:
        if not applied:
            return "长腿需要单个人物的双侧髋部、膝盖和脚踝完整可信；本项未应用。"
        return "已调整腿身比例并保留脚部，画布尺寸不变。"
    if name not in LEG_CONTROLS:
        return "已作用于对应部位。" if applied else unavailable
    if not applied:
        explanations = {
            "exactly one detected person is required": "腿部调节需要明确的单个人物，请换单人照片。",
            "combined mesh would fold; leg width was not applied": "此组合会使网格翻折，已跳过腿部调节。",
        }
        reason = detail.get("reason")
        return explanations.get(reason, "双腿相应关节需清晰且不交叉；本项未应用，请换全身正立照片。") if isinstance(reason, str) else unavailable
    scale = detail.get("safetyScale", 1)
    if type(scale) in (int, float) and math.isfinite(scale) and 0 < scale < 1:
        return "已调节双腿；为保持网格稳定，实际形变量已降低。"
    return "已作用于对应部位。"


def verify_native_inventory(*, receipt):
    inventory_found = False

    def visit(value):
        nonlocal inventory_found
        if isinstance(value, list):
            for item in value:
                visit(item)
        if not isinstance(value, dict):
            return
        for name, item in value.items():
            if name in ("nativeGeometryUsed", "fixedLandmarks") and item is not False:
                raise ValueError("foreign geometry or captured landmarks")
            if name in ("private_native_images", "privateNativeImages"):
                inventory_found = True
                if not isinstance(item, list) or item:
                    raise ValueError("foreign native library inventory")
            if name in ("loaded_images", "images") and isinstance(item, list):
                for path in item:
                    if isinstance(path, str) and any(token in path.lower() for token in FORBIDDEN_NATIVE):
                        raise ValueError("foreign native library loaded")
            visit(item)

    visit(receipt)
    if not inventory_found:
        raise ValueError("missing native library inventory")


class EngineRunner:
    def __init__(self, *, root, timeout=120):
        self.root, self.timeout = Path(root), timeout
        self._lifecycle_lock = threading.Lock()
        self._closed = False
        self._active = {}

    @staticmethod
    def _kill_group(*, process):
        process_group.kill(process=process)

    def close(self):
        with self._lifecycle_lock:
            self._closed = True
            for process in self._active.values():
                self._kill_group(process=process)

    def _require_open(self):
        if self._closed:
            raise AppError(message="服务正在关闭，已停止新的美体处理。", code="service_closing", status=503)

    def analyze_photo(self, *, source, photo):
        if not (self.root / "glute_analysis.py").is_file():
            raise ValueError("this installation does not provide automatic contour analysis")
        if __package__:
            from .glute_import import analyze_import
        else:
            from glute_import import analyze_import
        return analyze_import(runner=self, source=source, photo=photo)

    def __call__(self, *, source, values, output, report, edits=None):
        environment = {name: value for name, value in os.environ.items() if not name.startswith("DYLD_")}
        environment["BEAUTY_RENDER_RESOLUTION"] = "original"
        try:
            # The renderer protects its entire source tree, including the app's state directory.
            with tempfile.TemporaryDirectory(prefix="body-request-") as temporary:
                work = Path(temporary)
                command = [sys.executable, str(self.root / "render.py"), "--image", str(source),
                           "--controls", json.dumps(values, separators=(",", ":")),
                           "--output", str(work / "output.png"), "--report", str(work / "receipt.json")]
                if edits is not None:
                    command.extend(["--edits", json.dumps(edits, separators=(",", ":"))])
                with self._lifecycle_lock:
                    self._require_open()
                    process = process_group.spawn(command=command, cwd=self.root, environment=environment)
                    self._active[process.pid] = process
                try:
                    stdout, stderr = process.communicate(timeout=self.timeout)
                    if process.returncode:
                        raise subprocess.CalledProcessError(process.returncode, command, stdout, stderr)
                    with self._lifecycle_lock:
                        self._require_open()
                        output.write_bytes((work / "output.png").read_bytes())
                        report.write_bytes((work / "receipt.json").read_bytes())
                except BaseException:
                    # The isolated group can outlive its Python leader while a child holds a pipe.
                    self._kill_group(process=process)
                    process.communicate(timeout=5)
                    raise
                finally:
                    process_group.release(process=process)
                    with self._lifecycle_lock:
                        self._active.pop(process.pid, None)
        except subprocess.TimeoutExpired as error:
            raise AppError(message="本次处理超时，请缩小照片或降低组合强度后重试。", code="render_timeout", status=504) from error
        except (OSError, subprocess.CalledProcessError) as error:
            with self._lifecycle_lock:
                self._require_open()
            if isinstance(error, subprocess.CalledProcessError) and b"background protection:" in (error.stderr or b""):
                raise AppError(message="背景保护未获得可靠的人物蒙版，本次未交付结果。请换图，或关闭背景保护后重试。",
                               code="background_unavailable", status=422) from error
            raise AppError(message="美体引擎未能完成处理，请运行环境检查并确认模型已安装。", code="engine_failed", status=503) from error


class BodyBackend:
    def __init__(self, *, root, runner=None, platform=None, state=None):
        self.root = Path(root).resolve()
        self.state = Path(state).absolute() if state is not None else self.root / ".state"
        self.platform_name = sys.platform if platform is None else platform
        self.runner = EngineRunner(root=self.root) if runner is None else runner
        self.render_lock = threading.Lock()
        self._lifecycle_lock = threading.Lock()
        self._closed = False
        for name in ("photos", "renders", "receipts"):
            directory = self.state / name
            directory.mkdir(parents=True, exist_ok=True)
            if directory.is_symlink() or self.state.is_symlink():
                raise ValueError("state storage must use owned directories")

    def _require_open(self):
        if self._closed:
            raise AppError(message="服务正在关闭，已停止新的美体处理。", code="service_closing", status=503)

    def close(self):
        with self._lifecycle_lock:
            self._closed = True
        stop_runner = getattr(self.runner, "close", None)
        if callable(stop_runner):
            stop_runner()
        if not self.render_lock.acquire(timeout=5):
            raise RuntimeError("body shutdown timed out while waiting for the active request to roll back")
        self.render_lock.release()

    def catalog(self):
        value = json.loads((self.root / "catalog.json").read_text(encoding="utf-8"))
        backend = self._backend()
        if backend == "cpu":
            value = extended_catalog(catalog=value)
        message = ("当前可使用 macOS Metal 美体引擎。" if backend == "metal"
                   else "当前使用 ONNX 模型与 CPU 美体引擎，可处理静态图片。")
        return {**value, "platform": {"supported": backend is not None,
                "backend": backend_label(backend=backend) if backend else "unavailable",
                "message": message if backend else "当前平台或引擎配置不受支持，只能导入与查看照片。"}}

    def _backend(self):
        try:
            return select_backend(backend=os.environ.get("BODY_RENDER_BACKEND", "auto"), platform=self.platform_name)
        except ValueError:
            return None

    def _path(self, *, folder, identifier, suffix):
        if not isinstance(identifier, str) or not IDENTIFIER.fullmatch(identifier):
            raise AppError(message="图片编号无效或已过期，请重新导入。", code="not_found", status=404)
        path = self.state / folder / f"{identifier}{suffix}"
        if path.is_symlink() or not path.is_file():
            raise AppError(message="图片或处理记录不存在，请重新导入后重试。", code="not_found", status=404)
        return path

    def photo(self, *, identifier):
        path = self._path(folder="photos", identifier=identifier, suffix=".png")
        metadata = self._path(folder="photos", identifier=identifier, suffix=".json")
        try:
            value = json.loads(metadata.read_text(encoding="utf-8"))
            if value["photoId"] != identifier or sha256(data=path.read_bytes()) != value["pngSha256"]:
                raise ValueError("changed original")
        except (OSError, ValueError, KeyError) as error:
            raise AppError(message="原图记录已损坏，请重新导入。", code="source_changed", status=409) from error
        return path, value

    def import_photo(self, *, data):
        if not data or len(data) > MAX_FILE_BYTES:
            raise AppError(message="请选择不超过 20 MiB 的静态图片。", code="file_size", status=413)
        try:
            with Image.open(io.BytesIO(data)) as source:
                if getattr(source, "n_frames", 1) != 1 or getattr(source, "is_animated", False):
                    raise AppError(message="此版只接受静态照片，请先导出单张图片。", code="animated_image", status=422)
                if source.width * source.height > MAX_DECODE_PIXELS:
                    raise AppError(message="原图超过 8000 万像素，请先缩小再导入。", code="image_size", status=413)
                image = ImageOps.exif_transpose(source).convert("RGBA")
                if min(image.size) < 32:
                    raise AppError(message="照片的宽和高都需要至少 32 像素。", code="image_size", status=422)
                alpha = image.getchannel("A").getextrema() != (255, 255)
                if alpha:
                    background = Image.new("RGBA", image.size, "white")
                    background.alpha_composite(image)
                    image = background
                image = image.convert("RGB")
                scale = min(1, MAX_EDGE / max(image.size), math.sqrt(MAX_PIXELS / (image.width * image.height)))
                if scale < 1:
                    size = (max(1, int(image.width * scale)), max(1, int(image.height * scale)))
                    image = image.resize(size, Image.Resampling.LANCZOS)
                if min(image.size) < 32:
                    raise AppError(message="照片比例过于狭长，等比缩放后短边不足 32 像素，请先裁剪画面。", code="image_size", status=422)
                output = io.BytesIO()
                image.save(output, format="PNG")
        except AppError:
            raise
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as error:
            raise AppError(message="无法读取这张图片，请使用有效的 PNG、JPEG 或 WebP 静态照片。", code="invalid_image", status=422) from error
        identifier = uuid.uuid4().hex
        png = output.getvalue()
        message = "已导入；每次处理都会从这张原图重新计算。"
        if alpha:
            message += "透明区域已合成白色背景。"
        if scale < 1:
            message += f"已等比缩小至 {image.width} × {image.height}。"
        result = {"photoId": identifier, **image_identity(image=image),
                  "url": f"/api/photos/{identifier}.png", "pngSha256": sha256(data=png), "message": message}
        (self.state / "photos" / f"{identifier}.png").write_bytes(png)
        if self._backend() == "cpu":
            if __package__:
                from .glute_analysis import unavailable_detection, validate_detection
            else:
                from glute_analysis import unavailable_detection, validate_detection
            analyze = getattr(self.runner, "analyze_photo", None)
            try:
                if not callable(analyze):
                    raise ValueError("automatic analysis is not supported by this runner")
                detection = analyze(source=self.state / "photos" / f"{identifier}.png", photo=result)
                result["buttocksDetection"] = validate_detection(detection=detection, source_hash=result["rgbaSha256"])
            except (AppError, OSError, ValueError, RuntimeError, TypeError, OverflowError):
                result["buttocksDetection"] = unavailable_detection(source_hash=result["rgbaSha256"],
                    reason="自动定位暂不可用，可在臀部工具中手动校正。")
            with self._lifecycle_lock:
                self._require_open()
        write_json(path=self.state / "photos" / f"{identifier}.json", value=result)
        return result

    def render(self, *, request):
        with self._lifecycle_lock:
            self._require_open()
        if (not isinstance(request, dict) or not {"photoId", "values"} <= set(request)
                or set(request) - {"photoId", "values", "edits"}):
            raise AppError(message="处理请求必须包含 photoId 与 values。")
        values = validate_values(value=request["values"], extended=self._backend() == "cpu")
        try:
            edits = validate_edits(edits=request.get("edits"))
        except ValueError as error:
            raise AppError(message=str(error)) from error
        if ("buttocks" in edits or "autoButtocks" in edits) and self._backend() != "cpu":
            raise AppError(message="臀部轮廓定位仅支持 CPU 图片版。")
        source, photo = self.photo(identifier=request["photoId"])
        try:
            validate_strokes_for_image(strokes=edits["strokes"], width=photo["width"], height=photo["height"])
        except ValueError as error:
            raise AppError(message=str(error)) from error
        with self._lifecycle_lock:
            self._require_open()
            if not self.render_lock.acquire(blocking=False):
                raise AppError(message="正在处理上一张照片，请稍后重试。", code="render_busy", status=409)
        try:
            result = self._render(source=source, photo=photo, values=values,
                                  edits=edits if "edits" in request else None)
            with self._lifecycle_lock:
                if self._closed:
                    (self.state / "renders" / f"{result['renderId']}.png").unlink(missing_ok=True)
                    (self.state / "receipts" / f"{result['renderId']}.json").unlink(missing_ok=True)
                    self._require_open()
                return result
        finally:
            self.render_lock.release()

    def _render(self, *, source, photo, values, edits=None):
        identifier, started = uuid.uuid4().hex, time.monotonic()
        output = self.state / "renders" / f"{identifier}.png"
        report = self.state / "receipts" / f"{identifier}.json"
        has_manual = bool(edits and edits["strokes"])
        try:
            if not any(values.values()) and not has_manual:
                output.write_bytes(source.read_bytes())
                receipt = {"identity": True, "reason": "zero", "controls": values,
                           "inputRgbaSha256": photo["rgbaSha256"], "outputRgbaSha256": photo["rgbaSha256"],
                           "inputPngSha256": photo["pngSha256"], "outputPngSha256": photo["pngSha256"],
                           "independence": {"private_native_images": []}}
                if edits is not None:
                    receipt["edits"] = edits
                    if edits.get("autoButtocks") and "buttocks" not in edits and photo.get("buttocksDetection"):
                        receipt["photoEdits"] = {"buttocksDetection": photo["buttocksDetection"],
                                                 "automaticDetectionFromImport": True}
                write_json(path=report, value=receipt)
            elif self._backend() is None:
                output.write_bytes(source.read_bytes())
                receipt = {"identity": True, "reason": "unsupported-platform", "controls": values,
                           "inputRgbaSha256": photo["rgbaSha256"], "outputRgbaSha256": photo["rgbaSha256"],
                           "inputPngSha256": photo["pngSha256"], "outputPngSha256": photo["pngSha256"],
                           "independence": {"private_native_images": []}}
                if edits is not None:
                    receipt["edits"] = edits
                write_json(path=report, value=receipt)
            else:
                arguments = {"source": source, "values": values, "output": output, "report": report}
                if edits is not None:
                    arguments["edits"] = edits
                self.runner(**arguments)
            with self._lifecycle_lock:
                self._require_open()
            if output.is_symlink() or report.is_symlink():
                raise ValueError("unexpected symlink output")
            receipt = json.loads(report.read_text(encoding="utf-8"))
            if not isinstance(receipt, dict):
                raise ValueError("receipt must be a JSON object")
            with Image.open(output) as image:
                if image.format != "PNG" or getattr(image, "n_frames", 1) != 1:
                    raise ValueError("expected one PNG frame")
                image.load()
                identity = image_identity(image=image)
                if image.convert("RGBA").getchannel("A").getextrema() != (255, 255):
                    raise ValueError("transparent output")
            if (identity["width"], identity["height"]) != (photo["width"], photo["height"]):
                raise ValueError("output size differs from source")
            if receipt.get("inputRgbaSha256") != photo["rgbaSha256"] or receipt.get("outputRgbaSha256") != identity["rgbaSha256"]:
                raise ValueError("receipt image identity mismatch")
            if receipt.get("inputPngSha256") != photo["pngSha256"] or receipt.get("outputPngSha256") != sha256(data=output.read_bytes()):
                raise ValueError("receipt PNG identity mismatch")
            if receipt.get("controls") != values:
                raise ValueError("receipt controls mismatch")
            if sha256(data=source.read_bytes()) != photo["pngSha256"]:
                raise ValueError("source changed during rendering")
            parts = receipt.get("parts", {})
            if not isinstance(parts, dict) or any(not isinstance(item, dict) for item in parts.values()):
                raise ValueError("invalid body-part evidence")
            changed = identity["rgbaSha256"] != photo["rgbaSha256"]
            manual_count, edit_evidence = (0, {})
            if edits is not None:
                manual_count, edit_evidence = verify_edit_evidence(receipt=receipt, edits=edits,
                    changed=changed, unsupported=self._backend() is None)
            requested_moved = any(values[name] and parts.get(name, parts.get(part, {})).get("moved") is True
                                  for name, part in control_parts(values=values).items())
            if changed and not requested_moved and not manual_count:
                raise ValueError("changed output lacks requested body-part evidence")
            verify_native_inventory(receipt=receipt)
        except BaseException as error:
            output.unlink(missing_ok=True)
            report.unlink(missing_ok=True)
            if isinstance(error, (OSError, ValueError, KeyError, TypeError)):
                raise AppError(message="处理结果校验失败，已停止交付；请重新导入并运行环境检查。", code="invalid_render", status=502) from error
            raise
        controls = {}
        body_not_detected = receipt.get("reason") == "no person detected"
        unavailable_message = ("本图缺少可用的人体关键点，当前美体项目均依赖人体识别。"
                               if body_not_detected else "本图未检测到可应用的对应部位。")
        for name, part in control_parts(values=values).items():
            detail = parts.get(name, parts.get(part, {}))
            moved = detail.get("moved") is True
            applied = bool(values[name] and moved and changed)
            controls[name] = {"requested": values[name], "applied": applied,
                              "message": control_message(name=name, value=values[name], applied=applied,
                                  detail=detail, unavailable=unavailable_message)}
        requested = [item for item in controls.values() if item["requested"]]
        requested.extend([{"requested": 1, "applied": index < manual_count}
                          for index in range(len(edits["strokes"]) if edits is not None else 0)])
        count = sum(item["applied"] for item in requested)
        status = "identity" if not requested else "applied" if count == len(requested) else "partial" if count else "unavailable"
        message = {"identity": "参数为零，输出与原图一致。", "applied": "已从原图完成本次美体处理。",
                   "partial": "部分项目已生效；请查看各项状态，姿态或遮挡可能限制其他项目。",
                   "unavailable": "本图未检测到适用的身体部位，输出保留原图；可换一张正立全身照。"}[status]
        if status == "unavailable" and body_not_detected:
            message = "本图未获得可用的人体关键点，本次请求均未应用，正在显示原图。近景、半身或遮挡可能影响识别，请换关节清晰的正立全身照。"
        if status == "unavailable" and has_manual:
            message = "本次调整未改变实际像素。请检查笔刷位置、背景保护和网格限制，当前保留原图。"
        if requested and self._backend() is None:
            message = "当前平台或引擎配置不受支持，输出保留原图。请检查 BODY_RENDER_BACKEND 和系统支持。"
            for item in requested:
                item["message"] = "当前平台不支持美体出图。"
        result = {"renderId": identifier, "photoId": photo["photoId"], "values": values,
                  "source": {"url": photo["url"], "width": photo["width"], "height": photo["height"]},
                  "result": {"url": f"/api/renders/{identifier}.png", "downloadUrl": f"/api/download/{identifier}.png",
                             **identity, "pngSha256": sha256(data=output.read_bytes())},
                  "status": status, "message": message, "controls": controls,
                  "milliseconds": round((time.monotonic() - started) * 1000),
                  "receiptUrl": f"/api/receipts/{identifier}.json"}
        if edits is not None:
            result.update(edits=edits, editFeedback=edit_feedback(edits=edits, evidence=edit_evidence, count=manual_count))
        return result

    def stored_file(self, *, category, identifier):
        mapping = {"photos": ("photos", ".png"), "renders": ("renders", ".png"),
                   "download": ("renders", ".png"), "receipts": ("receipts", ".json")}
        if category not in mapping:
            raise AppError(message="找不到这个地址。", code="not_found", status=404)
        folder, suffix = mapping[category]
        if category == "photos":
            return self.photo(identifier=identifier)[0]
        return self._path(folder=folder, identifier=identifier, suffix=suffix)
