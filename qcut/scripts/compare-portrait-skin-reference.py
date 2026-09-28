"""Create fixed-scale skin difference evidence from real editor PNGs and UI captures."""

import argparse
import hashlib
import importlib.util
import json
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

SPEC = importlib.util.spec_from_file_location(
    "portrait_skin_difference", Path(__file__).with_name("create-portrait-difference-sheets.py")
)
DIFF = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = DIFF
SPEC.loader.exec_module(DIFF)

CONTROLS = [
    ("smooth", "磨皮", "face_adjust_Smooth"),
    ("whiten", "美白", "face_adjust_Whiten"),
    ("even", "匀肤", "face_adjust_yunfu"),
    ("plump", "丰盈", "face_adjust_fuling"),
    ("blemish", "祛斑祛痘", "face_adjust_SpotAcne"),
    ("folds", "祛法令纹", "face_adjust_NasolabialFolds"),
    ("circles", "祛黑眼圈", "face_adjust_Pouch"),
    ("clarity", "清晰", "face_adjust_Clarity"),
]


def fingerprint(*, path):
    return {"path": str(path.resolve()), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def load_frame(*, path, expected_size, crop=None):
    with Image.open(path) as image:
        if list(image.size) != list(expected_size):
            raise ValueError(f"Unexpected dimensions: {path}: {image.size}")
        frame = image.convert("RGB")
        if crop is not None:
            left, top, right, bottom = crop
            if not (0 <= left < right <= image.width and 0 <= top < bottom <= image.height):
                raise ValueError(f"Invalid player crop: {crop}")
            frame = frame.crop(crop)
        return frame.resize(DIFF.NORMALIZED_SIZE, Image.Resampling.LANCZOS)


def validate_samples(*, report):
    samples = {}
    expected = {(key, value) for _, _, key in CONTROLS for value in (50, 100)}
    for sample in report["samples"]:
        values = sample["values"]
        if len(values) != 1:
            raise ValueError("Skin comparisons require isolated parameters")
        key, value = next(iter(values.items()))
        if (key, value) not in expected or sample["value"] != value:
            raise ValueError(f"Unexpected case: {key}={value}")
        if (key, value) in samples:
            raise ValueError(f"Duplicate case: {key}={value}")
        samples[key, value] = sample
    if set(samples) != expected:
        raise ValueError("Expected all eight skin controls at 50 and 100")
    if report.get("errors"):
        raise ValueError("Editor report contains page errors")
    return samples


def validate_references(*, manifest, source_hash):
    if manifest["sourceSha256"] != source_hash:
        raise ValueError("Jianying and QCut must use the same source file")
    references = {}
    for sample in manifest["samples"]:
        identity = (sample["key"], sample["value"])
        if identity in references:
            raise ValueError(f"Duplicate reference: {identity}")
        references[identity] = sample
    expected = {(key, value) for _, _, key in CONTROLS for value in (50, 100)}
    if set(references) != expected:
        raise ValueError("Reference manifest must contain all 16 isolated values")
    return references


def render_sheet(*, title, rows, output, font, paired, evidence_label=None):
    labels = (["原图 / 剪映零值", "剪映效果", "剪映灰度差分", "QCut 效果", "QCut 灰度差分"]
              if paired else ["原图 / QCut 零值", "QCut 效果", "QCut 灰度差分"])
    margin, gap, tile_width, tile_height = 24, 12, 288, 344
    width = margin * 2 + len(labels) * tile_width + (len(labels) - 1) * gap
    row_height, header, footer = tile_height + 60, 140, 84
    sheet = Image.new("RGB", (width, header + len(rows) * row_height + footer), "#f5f6f7")
    draw = ImageDraw.Draw(sheet)

    def text(*, x, y, content, size=18):
        DIFF.draw_label(draw=draw, xy=(x, y), text=content, size=size,
                        font_path=font, max_width=width - x - margin)

    text(x=margin, y=16, content=title, size=30)
    text(x=margin, y=61, content="黑：未改动  灰：变化小  白：变化大；统一增益 ×6，不逐图拉伸", size=19)
    for index, label in enumerate(labels):
        text(x=margin + index * (tile_width + gap), y=105, content=label, size=21)
    for row_index, (name, tiles) in enumerate(rows):
        top = header + row_index * row_height
        text(x=margin, y=top + 3, content=name, size=23)
        for column, frame in enumerate(tiles):
            tile = frame.crop(DIFF.FACE_RECT).resize((tile_width, tile_height), Image.Resampling.LANCZOS)
            sheet.paste(tile, (margin + column * (tile_width + gap), top + 43))
    bottom = sheet.height - footer
    text(x=margin, y=bottom + 8, content="各减各自零值图；RGB 绝对差均值，σ=0.6；不是内部蒙版或美观评分。", size=17)
    text(x=margin, y=bottom + 36,
         content=evidence_label or ("剪映为界面截图，QCut 为编辑器画布 PNG；不是同规格导出像素平价。"
                  if paired else "剪映同档参照尚待采集；本图仅显示 QCut 实际编辑器输出。"), size=17)
    sheet.save(output)


def save_side(*, baseline, adjusted, output, prefix):
    display, raw = DIFF.difference_map(baseline=baseline, adjusted=adjusted)
    baseline.save(output / f"{prefix}-zero.png")
    adjusted.save(output / f"{prefix}-result.png")
    display.save(output / f"{prefix}-difference-x6.png")
    np.save(output / f"{prefix}-difference-raw.npy", raw)
    roi = np.asarray(Image.fromarray(raw).crop(DIFF.FACE_RECT))
    return display, {
        "meanAbsoluteChange": float(raw.mean()),
        "faceMeanAbsoluteChange": float(roi.mean()),
        "displayClippedFraction": float((raw * DIFF.DISPLAY_GAIN >= 255).mean()),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("editor", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--references", type=Path)
    parser.add_argument("--font", type=Path, default=Path("/System/Library/Fonts/STHeiti Medium.ttc"))
    args = parser.parse_args()
    report_path = args.editor / "report.json"
    report = json.loads(report_path.read_text())
    samples = validate_samples(report=report)
    source = Path(report["source"])
    source_record = fingerprint(path=source)
    manifest = json.loads(args.references.read_text()) if args.references else None
    references = validate_references(manifest=manifest, source_hash=source_record["sha256"]) if manifest else {}
    args.output.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, args.output / f"source-original{source.suffix}")
    records, overview, sheet_names = [], [], []

    for slug, label, key in CONTROLS:
        rows = []
        for value in (50, 100):
            sample = samples[key, value]
            output = args.output / f"{slug}-{value}"
            output.mkdir(exist_ok=True)
            source_path = args.editor / f"{sample['name']}-input.png"
            result_path = args.editor / f"{sample['name']}-frame.png"
            if fingerprint(path=result_path)["sha256"] != sample["hash"]:
                raise ValueError(f"Editor result hash mismatch: {result_path}")
            options = {"expected_size": [sample["width"], sample["height"]]}
            base_q = load_frame(path=source_path, **options)
            result_q = load_frame(path=result_path, **options)
            diff_q, metrics_q = save_side(baseline=base_q, adjusted=result_q, output=output, prefix="qcut")
            record = {"key": key, "label": label, "value": value, "qcut": metrics_q,
                      "sources": [fingerprint(path=source_path), fingerprint(path=result_path)]}
            tiles = [base_q, result_q, diff_q]
            if manifest:
                reference = references[key, value]
                base_path = args.references.parent / reference["zero"]
                adjusted_path = args.references.parent / reference["result"]
                options = {"expected_size": manifest["screenshotSize"], "crop": manifest["playerCrop"]}
                base_j = load_frame(path=base_path, **options)
                result_j = load_frame(path=adjusted_path, **options)
                diff_j, metrics_j = save_side(baseline=base_j, adjusted=result_j, output=output, prefix="jianying")
                record["jianying"] = metrics_j
                record["sources"].extend([fingerprint(path=base_path), fingerprint(path=adjusted_path)])
                tiles = [base_j, result_j, diff_j, result_q, diff_q]
            rows.append((f"{label} {value}", tiles))
            records.append(record)
            if value == 100:
                overview.append(rows[-1])
        filename = f"{slug}.png"
        sheet_names.append(filename)
        render_sheet(title=f"{label}｜50 / 100 改动区域", rows=rows, output=args.output / filename,
                     font=args.font, paired=bool(manifest))
    for index in range(2):
        filename = f"overview-{index + 1}.png"
        sheet_names.append(filename)
        render_sheet(title=f"皮肤管理｜100 档对照 {index + 1}/2", rows=overview[index * 4:(index + 1) * 4],
                     output=args.output / filename, font=args.font, paired=bool(manifest))
    result = {"source": source_record, "editorReport": fingerprint(path=report_path),
              "referenceManifest": fingerprint(path=args.references) if manifest else None,
              "gain": DIFF.DISPLAY_GAIN, "sigma": DIFF.BLUR_SIGMA,
              "normalizedSize": DIFF.NORMALIZED_SIZE, "faceCrop": DIFF.FACE_RECT,
              "geometricRegistration": False, "perMapNormalization": False,
              "referenceKind": "UI screenshot" if manifest else "not captured",
              "qcutKind": "real Electron editor canvas", "cases": records, "sheets": sheet_names}
    (args.output / "report.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    index = ["# 皮肤管理灰度对照", "",
             "每项 50 / 100，黑色表示基本未改动，越亮表示 RGB 变化幅度越大。统一增益 ×6。", "",
             ("剪映为真实 UI 截图，QCut 为真实编辑器画布；不能当作同规格无损导出平价。"
              if manifest else "本目录只含 QCut；没有剪映参照，不作两端对比结论。"), "",
             "[100 档总览 1](overview-1.png) | [100 档总览 2](overview-2.png)", ""]
    index.extend(f"- [{label} 50 / 100]({slug}.png)" for slug, label, _ in CONTROLS)
    index.extend(["", f"[原始照片](source-original{source.suffix}) | [数据与来源哈希](report.json)", "",
                  "各案例子目录保留完整画面的零值、效果、灰度 PNG 和未放大的浮点差分 NPY。",
                  "剪映完整画面可能包含选脸框变化；对照表使用固定面部裁切避开框线。", ""])
    (args.output / "README.md").write_text("\n".join(index), encoding="utf-8")
    print(json.dumps({"output": str(args.output), "cases": len(records), "paired": bool(manifest)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
