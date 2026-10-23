"""Run a declared photo matrix against the local standalone body editor.

Manifest v1: {"version": 1, "entries": [{"id": "front", "image": "/absolute/a.png",
"expectations": {"long-leg-100": "applied", "combined-extreme": {
"status": "partial", "appliedControls": ["SlimWaist", "SmallHead"]}}}]}.
Nonzero cases without an expectation run as observations, never as passes.
"""
from __future__ import annotations

import argparse
from collections import Counter
import json
import mimetypes
from pathlib import Path
import re
import time
from urllib.error import HTTPError
from urllib.parse import urlsplit

import numpy as np
from PIL import Image

if __package__:
    from .backend import CONTROL_PARTS, MAX_EDGE, MAX_FILE_BYTES, MAX_PIXELS, verify_native_inventory, write_json
    from .cli_console import configure_console
    from .control_contract import CONTROL_RANGES, LEG_CONTROLS
    from .import_engine import ASSETS, verify_source
    from .onnx_mask import MODEL_SHA256, MODEL_SIZE
    from .photo_controls import EXTRA_RANGES
    from .portable_models import MODEL_MANIFEST, VERIFIED_ORT_VERSION, load_manifest as load_portable_manifest
    from .server import parse_json
    from .verify_photo import digest, json_request, pixels, request
    from .verify_matrix_report import write_gallery
else:
    from backend import CONTROL_PARTS, MAX_EDGE, MAX_FILE_BYTES, MAX_PIXELS, verify_native_inventory, write_json
    from cli_console import configure_console
    from control_contract import CONTROL_RANGES, LEG_CONTROLS
    from import_engine import ASSETS, verify_source
    from onnx_mask import MODEL_SHA256, MODEL_SIZE
    from photo_controls import EXTRA_RANGES
    from portable_models import MODEL_MANIFEST, VERIFIED_ORT_VERSION, load_manifest as load_portable_manifest
    from server import parse_json
    from verify_photo import digest, json_request, pixels, request
    from verify_matrix_report import write_gallery


CASES = (
    ("zero-before", "归零 · 处理前", {}),
    ("long-leg-100", "长腿 100", {"StretchLeg": 100}),
    ("waist-100", "瘦腰 100", {"SlimWaist": 100}),
    ("head-100", "小头 100", {"SmallHead": 100}),
    ("body-100", "整体瘦身 100", {"SlimBody": 100}),
    ("arm-100", "瘦手臂 100", {"SlimArm": 100}),
    ("combined-moderate", "中等组合 · 长腿40 / 瘦腰40 / 小头30", {"StretchLeg": 40, "SlimWaist": 40, "SmallHead": 30}),
    ("combined-extreme", "极值组合 · 原三项100", {"StretchLeg": 100, "SlimWaist": 100, "SmallHead": 100}),
    ("combined-five-moderate", "五项组合 · 40 / 40 / 30 / 45 / 50", {"StretchLeg": 40, "SlimWaist": 40, "SmallHead": 30, "SlimBody": 45, "SlimArm": 50}),
    ("combined-five-extreme", "极值组合 · 原五项100", {"StretchLeg": 100, "SlimWaist": 100, "SmallHead": 100, "SlimBody": 100, "SlimArm": 100}),
    ("shoulder-narrow-50", "肩宽 -50 · 收窄", {"ShoulderWidth": -50}),
    ("shoulder-wide-50", "肩宽 +50 · 加宽", {"ShoulderWidth": 50}),
    ("ortho-100", "直角肩 100", {"OrthoShoulder": 100}),
    ("neck-100", "天鹅颈 100", {"SwanNeck": 100}),
    ("hip-narrow-50", "胯宽 -50 · 收窄", {"HipWidth": -50}),
    ("hip-wide-50", "胯宽 +50 · 加宽", {"HipWidth": 50}),
    ("bust-small-50", "胸围 -50 · 缩小", {"BustSize": -50}),
    ("bust-full-50", "胸围 +50 · 增大", {"BustSize": 50}),
    ("combined-ten-moderate", "十项中等组合 · 含三项正向调节", {
        "StretchLeg": 40, "SlimWaist": 40, "SmallHead": 30, "SlimBody": 45, "SlimArm": 50,
        "ShoulderWidth": 10, "OrthoShoulder": 35, "SwanNeck": 40, "HipWidth": 10, "BustSize": 10}),
    ("combined-ten-negative", "负向组合 · 肩胯胸-25 / 直角肩50 / 颈50 / 瘦身30", {
        "SlimBody": 30, "ShoulderWidth": -25, "OrthoShoulder": 50, "SwanNeck": 50, "HipWidth": -25, "BustSize": -25}),
    ("combined-ten-extreme", "极值组合 · 原十项单向100 / 双向+50", {
        name: bounds[1] for name, bounds in CONTROL_RANGES.items() if name not in LEG_CONTROLS}),
    ("thigh-narrow-50", "大腿粗细 -50 · 收窄", {"ThighWidth": -50}),
    ("thigh-wide-50", "大腿粗细 +50 · 加宽", {"ThighWidth": 50}),
    ("calf-narrow-50", "小腿粗细 -50 · 收窄", {"CalfWidth": -50}),
    ("calf-wide-50", "小腿粗细 +50 · 加宽", {"CalfWidth": 50}),
    ("combined-legs-narrow", "腿部组合 · 大腿-50 / 小腿-50", {"ThighWidth": -50, "CalfWidth": -50}),
    ("combined-twelve-moderate", "十二项中等组合 · 大腿小腿-25", {
        "StretchLeg": 40, "SlimWaist": 40, "SmallHead": 30, "SlimBody": 45, "SlimArm": 50,
        "ShoulderWidth": 10, "OrthoShoulder": 35, "SwanNeck": 40, "HipWidth": 10, "BustSize": 10,
        "ThighWidth": -25, "CalfWidth": -25}),
    ("zero-after", "归零 · 处理后", {}),
)
CASE_VALUES = {name: {key: values.get(key, 0) for key in CONTROL_PARTS} for name, _, values in CASES}
STATUSES = {"applied", "partial", "unavailable", "identity"}
ACCEPTED = {"passed", "expected-partial", "expected-unavailable"}
SAFE_ID = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\Z")
ASSET = re.compile(r"/api/(photos|renders|download|receipts)/[0-9a-f]{32}\.(png|json)\Z")


def require(*, condition, message):
    if not condition:
        raise ValueError(message)


def require_legacy_catalog(*, catalog):
    controls = catalog.get("controls")
    require(condition=isinstance(controls, list) and all(isinstance(item, dict) for item in controls),
            message="美体目录缺少参数列表。")
    names = [item.get("name") for item in controls]
    require(condition=all(isinstance(name, str) for name in names), message="美体目录参数名称不合法。")
    legacy_names = set(CONTROL_RANGES)
    expanded_names = legacy_names | EXTRA_RANGES.keys()
    require(condition=len(names) == len(set(names)) and set(names) in (legacy_names, expanded_names)
        and catalog.get("platform", {}).get("supported") is True,
        message="目录或平台不支持本轮十二项美体实际验收。")
    ranges = {**CONTROL_RANGES, **EXTRA_RANGES}
    require(condition=all(type(item.get("min")) is int and type(item.get("max")) is int
        and (item["min"], item["max"]) == ranges[item["name"]] for item in controls),
        message="美体目录参数范围与当前契约不一致。")


def canonical_values(*, values):
    return {name: values.get(name, 0) for name in CONTROL_PARTS}


def validate_base(*, base):
    value = urlsplit(base)
    require(condition=(value.scheme == "http" and value.hostname == "127.0.0.1"
        and value.username is None and value.password is None and value.path in ("", "/")
        and not value.query and not value.fragment and value.port is not None and 1 <= value.port <= 65535),
        message="--base 必须是 http://127.0.0.1:端口，不接受其他主机或路径。")
    return f"http://127.0.0.1:{value.port}"


def validate_expectation(*, name, value):
    value = {"status": value} if isinstance(value, str) else value
    require(condition=isinstance(value, dict) and set(value) <= {"status", "appliedControls", "note"},
            message=f"{name} 的期望必须是状态字符串或 status/appliedControls/note 对象。")
    require(condition=value.get("status") in STATUSES, message=f"{name} 缺少有效的期望状态。")
    zero = not any(CASE_VALUES[name].values())
    require(condition=(value["status"] == "identity") == zero,
            message=f"{name} 的零参数必须期望 identity；非零参数不能期望 identity。")
    require(condition=value["status"] != "partial" or sum(bool(number) for number in CASE_VALUES[name].values()) > 1,
            message=f"{name} 仅启用一个项目，不能期望部分生效。")
    if "appliedControls" in value:
        applied = value["appliedControls"]
        require(condition=isinstance(applied, list) and all(isinstance(item, str) for item in applied)
            and len(applied) == len(set(applied)) and set(applied) <= {
                key for key, strength in CASE_VALUES[name].items() if strength},
            message=f"{name} 的 appliedControls 必须是本例启用项目的无重复列表。")
        active = {key for key, strength in CASE_VALUES[name].items() if strength}
        expected = set(applied)
        require(condition=(value["status"] == "applied" and expected == active)
            or (value["status"] == "partial" and bool(expected) and expected < active)
            or (value["status"] in ("identity", "unavailable") and not expected),
            message=f"{name} 的期望状态与 appliedControls 冲突。")
    require(condition=isinstance(value.get("note", ""), str), message=f"{name} 的 note 必须是文字。")
    return value


def load_manifest(*, path):
    require(condition=path.is_file() and path.stat().st_size <= 1024 * 1024,
            message="manifest 必须是小于1 MiB的本机JSON文件。")
    data = path.read_bytes()
    manifest = parse_json(data=data)
    require(condition=isinstance(manifest, dict) and set(manifest) <= {"version", "entries", "note"}
        and type(manifest.get("version")) is int and manifest["version"] == 1,
        message="manifest 须使用 version:1 和 entries 数组。")
    entries = manifest.get("entries")
    require(condition=isinstance(entries, list) and 1 <= len(entries) <= 64,
            message="entries 必须包含1至64张照片。")
    require(condition=isinstance(manifest.get("note", ""), str), message="manifest note 必须是文字。")
    seen = set()
    for entry in entries:
        require(condition=isinstance(entry, dict) and set(entry) <= {
            "id", "image", "label", "notes", "source", "sourceKind", "subjectId", "provenance", "expectations"},
                message="entry含未知字段；支持 id/image/label/notes/source/sourceKind/subjectId/provenance/expectations。")
        identifier = entry.get("id")
        require(condition=isinstance(identifier, str) and SAFE_ID.fullmatch(identifier) and identifier not in seen,
                message="entry id须为唯一的1至64位英数、连字符或下划线。")
        seen.add(identifier)
        for key in ("image", "label", "notes", "source", "sourceKind", "subjectId"):
            require(condition=isinstance(entry.get(key, ""), str), message=f"{identifier}.{key} 必须是文字。")
        require(condition=isinstance(entry.get("provenance", {}), (str, dict)), message=f"{identifier}.provenance须为文字或对象。")
        image = Path(entry.get("image", ""))
        require(condition=image.is_absolute() and image.is_file() and not image.is_symlink()
            and 0 < image.stat().st_size <= MAX_FILE_BYTES, message=f"{identifier} 需要有效的绝对图片路径，文件不超过20 MiB。")
        expectations = entry.get("expectations", {})
        require(condition=isinstance(expectations, dict) and set(expectations) <= set(CASE_VALUES),
                message=f"{identifier} 含未知的期望用例名。")
        entry["expectations"] = {name: validate_expectation(name=name, value=value) for name, value in expectations.items()}
        entry["image"] = str(image.resolve())
    return manifest, digest(data=data)


def checked_route(*, route, category):
    match = ASSET.fullmatch(route) if isinstance(route, str) else None
    require(condition=bool(match) and match[1] == category and route.endswith(".json" if category == "receipts" else ".png"),
            message="服务返回了不属于本机美体资产的地址。")
    return route


def read_png(*, data):
    require(condition=data.startswith(b"\x89PNG\r\n\x1a\n"), message="下载文件不是PNG。")
    image = pixels(data=data)
    height, width = image.shape[:2]
    require(condition=32 <= min(width, height) and max(width, height) <= MAX_EDGE and width * height <= MAX_PIXELS,
            message="PNG尺寸超出当前图片版预算。")
    require(condition=bool(np.all(image[..., 3] == 255)), message="PNG含有透明像素。")
    return image


def verify_photo_identity(*, photo, png):
    image = read_png(data=png)
    require(condition=(photo.get("width"), photo.get("height")) == (image.shape[1], image.shape[0]),
            message="原图尺寸与上传记录不一致。")
    require(condition=photo.get("pngSha256") == digest(data=png)
        and photo.get("rgbaSha256") == digest(data=image.tobytes()), message="归一化原图哈希与上传记录不一致。")
    return image


def verify_model_evidence(*, receipt, source_commit):
    pin = receipt.get("verification")
    require(condition=isinstance(pin, dict) and receipt.get("sourceAndAssetsUnchanged") is True
        and pin.get("verified") is True and type(pin.get("sourceFiles")) is int and pin["sourceFiles"] == 107
        and pin.get("sourceCommit") == source_commit and receipt.get("nativeGeometryUsed") is False
        and receipt.get("fixedLandmarks") is False, message="缺少当前独立源码/模型/非捕获几何证据。")
    if receipt.get("backend") != "portable-CPU":
        require(condition=receipt.get("backend") in (None, "macOS-Metal")
            and pin.get("backend") in (None, "macOS-Metal")
            and type(pin.get("assets")) is int and pin["assets"] == 5
            and type(pin.get("assetBytes")) is int and pin["assetBytes"] == 7431877,
            message="缺少原 Metal 五项模型证据。")
        return
    source = verify_source()
    require(condition=all(pin.get(key) == expected for key, expected in source.items()),
            message="CPU 源码提交或清单哈希与固定引擎不一致。")
    manifest = load_portable_manifest()
    skeleton, mask = pin.get("skeleton"), pin.get("personMask")
    face_files = [name for name in ASSETS if not name.endswith("body-skeleton-v1.npz")]
    require(condition=pin.get("backend") == "portable-CPU" and pin.get("skeletonNpzRequired") is False
        and type(pin.get("faceFiles")) is int and pin["faceFiles"] == len(face_files)
        and isinstance(skeleton, dict) and isinstance(mask, dict),
        message="缺少 CPU 人脸/骨架/人物蒙版与无 NPZ 依赖证据。")
    require(condition=type(skeleton.get("files")) is int and skeleton["files"] == len(manifest["files"])
        and type(skeleton.get("bytes")) is int and skeleton["bytes"] == sum(item["bytes"] for item in manifest["files"].values())
        and skeleton.get("manifestSha256") == digest(data=MODEL_MANIFEST.read_bytes())
        and skeleton.get("onnxruntime") == VERIFIED_ORT_VERSION and skeleton.get("nativeRuntimeLoaded") is False
        and type(mask.get("bytes")) is int and mask["bytes"] == MODEL_SIZE and mask.get("sha256") == MODEL_SHA256,
        message="CPU 骨架或人物蒙版的模型清单、大小或哈希不匹配。")
    names = pin.get("publicControls")
    require(condition=isinstance(names, list) and all(isinstance(name, str) for name in names)
        and len(names) == len(set(names)) and set(names) in (set(CONTROL_RANGES), set(CONTROL_RANGES) | EXTRA_RANGES.keys()),
        message="CPU 回执的参数目录与已知契约不一致。")


def verify_evidence(*, response, receipt, source_png, result_png, displayed_png, headers, photo, values, source_commit):
    original, output = pixels(data=source_png), read_png(data=result_png)
    require(condition=response.get("photoId") == photo["photoId"] and response.get("values") == values,
            message="响应的照片或参数与本次请求不一致。")
    require(condition=response.get("status") in STATUSES, message="服务没有报告有效的实际效果状态。")
    source, result = response.get("source", {}), response.get("result", {})
    require(condition=source.get("url") == photo["url"] and (source.get("width"), source.get("height")) == (photo["width"], photo["height"]),
            message="响应没有绑定同一张原图。")
    require(condition=output.shape == original.shape and (result.get("width"), result.get("height")) == (photo["width"], photo["height"]),
            message="输出尺寸与归一化原图不一致。")
    require(condition=result_png == displayed_png and "attachment" in {key.lower(): value for key, value in headers.items()}.get("content-disposition", ""),
            message="下载与页面结果文件不同，或下载头缺失。")
    before, after = digest(data=original.tobytes()), digest(data=output.tobytes())
    require(condition=result.get("pngSha256") == digest(data=result_png) and result.get("rgbaSha256") == after,
            message="结果PNG或RGBA哈希不匹配。")
    require(condition=receipt.get("inputPngSha256") == digest(data=source_png) and receipt.get("inputRgbaSha256") == before
        and receipt.get("outputPngSha256") == digest(data=result_png) and receipt.get("outputRgbaSha256") == after
        and receipt.get("controls") == values, message="收据未绑定本次原图、结果或参数。")
    verify_native_inventory(receipt=receipt)
    changed = int(np.count_nonzero(np.any(original != output, axis=-1)))
    controls = response.get("controls")
    require(condition=isinstance(controls, dict) and set(controls) == set(CONTROL_PARTS), message="缺少逐项效果状态。")
    applied, active = set(), {key for key, value in values.items() if value}
    for name, detail in controls.items():
        require(condition=isinstance(detail, dict) and detail.get("requested") == values[name]
            and type(detail.get("applied")) is bool, message=f"{name} 的逐项状态不合法。")
        moved = receipt.get("parts", {}).get(name, {}).get("moved") is True
        require(condition=detail["applied"] == bool(values[name] and moved and changed), message=f"{name} 的生效声明缺少对应网格及像素证据。")
        if detail["applied"]:
            applied.add(name)
    status = "identity" if not active else "applied" if applied == active else "partial" if applied else "unavailable"
    require(condition=response["status"] == status, message="整体状态与逐项实际生效状态冲突。")
    require(condition=(changed > 0) == bool(applied), message="输出变化与实际生效项目不一致。")
    if active:
        verify_model_evidence(receipt=receipt, source_commit=source_commit)
    else:
        require(condition=result_png == source_png, message="归零输出未逐字节保留来源PNG。")
    return output, {"changedPixels": changed, "appliedControls": sorted(applied), "dimensions": [output.shape[1], output.shape[0]],
        "pngSha256": digest(data=result_png), "rgbaSha256": after, "downloadMatchesDisplayedPng": True}


def expected_verdict(*, expectation, status, applied):
    if expectation is None:
        return "unverified", "未声明本图期望；已记录实际结果，等待人工确认，不能计为通过。"
    if expectation["status"] != status:
        return "failed", f"预期 {expectation['status']}，实际 {status}。"
    if "appliedControls" in expectation and set(expectation["appliedControls"]) != set(applied):
        return "failed", "实际生效项目与本图声明的期望不同。"
    verdict = {"partial": "expected-partial", "unavailable": "expected-unavailable"}.get(status, "passed")
    return verdict, "像素和交付检查通过，符合已声明的边界。" if status in ("partial", "unavailable") else "像素和交付检查通过，符合已声明期望。"


def error_details(*, error):
    result = {"type": type(error).__name__, "message": str(error)}
    if isinstance(error, HTTPError):
        result["httpStatus"] = error.code
        try:
            body = json.loads(error.read(64 * 1024))
            result["message"] = body.get("error", {}).get("message") or body.get("message") or str(error)
            result["code"] = body.get("error", {}).get("code")
        except (ValueError, AttributeError):
            pass
    return result


def run_case(*, base, photo, source_png, values, directory, name, title, expectation, source_commit):
    item = {"id": name, "title": title, "values": values, "expectation": expectation,
            "status": "error", "verdict": "failed", "evidenceChecksPassed": False, "renderRequestAttempted": True,
            "visualReview": "not-reviewed", "nativeParityVerified": False}
    write_json(path=directory / f"{name}-request.json", value={"photoId": photo["photoId"], "values": values})
    try:
        response = json_request(base=base, route="/api/render", value={"photoId": photo["photoId"], "values": values})
        write_json(path=directory / f"{name}-response.json", value=response)
        item.update(status=response.get("status", "error"), controls=response.get("controls", {}), milliseconds=response.get("milliseconds"))
        output, headers = request(base=base, route=checked_route(route=response["result"]["downloadUrl"], category="download"))
        displayed, _ = request(base=base, route=checked_route(route=response["result"]["url"], category="renders"))
        receipt = json_request(base=base, route=checked_route(route=response["receiptUrl"], category="receipts"))
        write_json(path=directory / f"{name}-receipt.json", value=receipt)
        (directory / f"{name}-observed.png").write_bytes(output)
        image, evidence = verify_evidence(response=response, receipt=receipt, source_png=source_png, result_png=output,
            displayed_png=displayed, headers=headers, photo=photo, values=values, source_commit=source_commit)
        fresh_source, _ = request(base=base, route=checked_route(route=photo["url"], category="photos"))
        require(condition=fresh_source == source_png, message="服务中的原图在处理后改变。")
        half = pixels(data=source_png)
        half[:, image.shape[1] // 2:] = image[:, image.shape[1] // 2:]
        Image.fromarray(half).save(directory / f"{name}-half.png")
        verdict, note = expected_verdict(expectation=expectation, status=response["status"], applied=evidence["appliedControls"])
        item.update(**evidence, verdict=verdict, message=response.get("message", ""), assessment=note,
                    evidenceChecksPassed=True, sourceUnchanged=True, resultFile=f"{name}-observed.png", halfFile=f"{name}-half.png")
    except Exception as error:
        item.update(reportedStatus=item["status"], status="error", verdict="failed",
                    error=error_details(error=error), assessment="本项验收失败，不能计为通过。")
    write_json(path=directory / f"{name}-check.json", value=item)
    return item


def run_entry(*, entry, base, output, source_commit):
    directory = output / entry["id"]
    directory.mkdir()
    item = {"id": entry["id"], "label": entry.get("label", entry["id"]), "sourceImage": entry["image"],
            "notes": entry.get("notes", ""), "source": entry.get("source", ""), "sourceKind": entry.get("sourceKind", "unknown"),
            "subjectId": entry.get("subjectId", ""), "provenance": entry.get("provenance", {}), "cases": [], "errors": []}
    try:
        encoded = Path(entry["image"]).read_bytes()
        item["sourceFileSha256"] = digest(data=encoded)
        provenance = entry.get("provenance")
        if isinstance(provenance, dict) and "sha256" in provenance:
            require(condition=provenance["sha256"] == item["sourceFileSha256"], message="源文件与来源记录声明的SHA-256不一致。")
        photo_bytes, _ = request(base=base, route="/api/photos", body=encoded,
            content_type=mimetypes.guess_type(entry["image"])[0] or "application/octet-stream")
        photo = json.loads(photo_bytes)
        original, _ = request(base=base, route=checked_route(route=photo["url"], category="photos"))
        verify_photo_identity(photo=photo, png=original)
        (directory / "source.png").write_bytes(original)
        write_json(path=directory / "source-record.json", value=photo)
        item.update(normalizedSource=photo, sourceFile="source.png")
        for name, title, raw_values in CASES:
            values = canonical_values(values=raw_values)
            expectation = entry["expectations"].get(name, {"status": "identity"} if not any(values.values()) else None)
            case = run_case(base=base, photo=photo, source_png=original, values=values, directory=directory,
                            name=name, title=title, expectation=expectation, source_commit=source_commit)
            item["cases"].append(case)
            print(json.dumps({"entry": entry["id"], "case": name, "status": case["status"], "verdict": case["verdict"]}, ensure_ascii=False), flush=True)
        unchanged = digest(data=Path(entry["image"]).read_bytes()) == item["sourceFileSha256"]
        item["sourceFileUnchanged"] = unchanged
        require(condition=unchanged, message="用户原始文件在矩阵运行期间改变。")
    except Exception as error:
        item["errors"].append(error_details(error=error))
    item["allChecksPassed"] = not item["errors"] and len(item["cases"]) == len(CASES) and all(case["verdict"] in ACCEPTED for case in item["cases"])
    write_json(path=directory / "entry-check.json", value=item)
    return item


def run_matrix(*, manifest_path, output, base):
    base = validate_base(base=base)
    manifest, manifest_hash = load_manifest(path=manifest_path)
    require(condition=not output.exists(), message="--output 必须是尚不存在的新目录。")
    output.mkdir(parents=True)
    manifest_bytes = manifest_path.read_bytes()
    require(condition=digest(data=manifest_bytes) == manifest_hash, message="manifest在初始化期间改变。")
    (output / "manifest.json").write_bytes(manifest_bytes)
    write_json(path=output / "manifest-normalized.json", value=manifest)
    started = time.monotonic()
    report = {"schemaVersion": 1, "base": base, "manifestSha256": manifest_hash, "entries": [], "errors": [],
        "scope": "本机独立静态图片矩阵；自动检查不代表自然度、其他照片或原生像素一致。", "nativeParityVerified": False}
    try:
        catalog = json_request(base=base, route="/api/catalog")
        require_legacy_catalog(catalog=catalog)
        report.update(catalog=catalog, sourceCommit=catalog["sourceCommit"])
        for entry in manifest["entries"]:
            report["entries"].append(run_entry(entry=entry, base=base, output=output, source_commit=catalog["sourceCommit"]))
        report["manifestUnchanged"] = digest(data=manifest_path.read_bytes()) == manifest_hash
        require(condition=report["manifestUnchanged"], message="原始manifest在运行期间改变。")
    except Exception as error:
        report["errors"].append(error_details(error=error))
    cases = [case for entry in report["entries"] for case in entry["cases"]]
    report.update(summary={"photosRequested": len(manifest["entries"]), "photosProcessed": len(report["entries"]),
        "renderRequestAttempts": sum(case["renderRequestAttempted"] for case in cases), "actualStatuses": dict(Counter(case["status"] for case in cases)),
        "verdicts": dict(Counter(case["verdict"] for case in cases)), "evidenceChecksPassed": sum(case["evidenceChecksPassed"] for case in cases),
        "missingExpectations": sum(case["expectation"] is None for case in cases),
        "sourceKinds": dict(Counter(entry["sourceKind"] for entry in report["entries"])),
        "declaredSubjectIds": sorted({entry["subjectId"] for entry in report["entries"] if entry["subjectId"]})},
        milliseconds=round((time.monotonic() - started) * 1000))
    report["allChecksPassed"] = not report["errors"] and len(report["entries"]) == len(manifest["entries"]) and all(entry["allChecksPassed"] for entry in report["entries"])
    report["exitCode"] = 0 if report["allChecksPassed"] else 2 if not report["errors"] and all(not entry["errors"] for entry in report["entries"]) and all(case["verdict"] in ACCEPTED | {"unverified"} for case in cases) else 1
    write_json(path=output / "acceptance.json", value=report)
    write_gallery(report=report, output=output)
    return report


def main():
    configure_console()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--base", default="http://127.0.0.1:5270")
    args = parser.parse_args()
    try:
        result = run_matrix(manifest_path=args.manifest, output=args.output, base=args.base)
    except Exception as error:
        parser.error(str(error))
    print(json.dumps({"allChecksPassed": result["allChecksPassed"], "exitCode": result["exitCode"],
                      "report": str(args.output / "acceptance.json"), "gallery": str(args.output / "index.html")}, ensure_ascii=False))
    return result["exitCode"]


if __name__ == "__main__":
    raise SystemExit(main())
