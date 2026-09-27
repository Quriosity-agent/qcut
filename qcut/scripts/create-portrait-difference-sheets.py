"""Render measured grayscale beauty difference maps from existing local evidence.

Requires Pillow and NumPy. Nothing in this script generates or retouches a face.
"""

import argparse
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

NORMALIZED_SIZE = (600, 900)
PLAYER_RECT = (731, 79, 1127, 671)
FACE_RECT = (70, 195, 535, 750)
DISPLAY_GAIN = 6.0
BLUR_SIGMA = 0.6


@dataclass(frozen=True)
class Case:
    name: str
    title: str
    jianying: str
    qcut: str
    qcut_key: str
    value: int
    exported: bool = False


CASES = [
    Case("eye50", "大眼 50", "01-eye-size-50", "01-eye-size-50", "face_adjust_EnlargeEye", 50),
    Case("eye100", "大眼 100", "02-eye-size-100", "02-eye-size-100", "face_adjust_EnlargeEye", 100),
    Case("corner99", "开眼角 99", "corner99", "30-inner-corner-99", "face_adjust_inner_corner", 99, True),
    Case("nose-position-minus48", "鼻高低 −48", "08-nose-position-minus48", "22-alt-nose-position-minus48", "face_adjust_nose_position", -48),
    Case("nose-position-plus50", "鼻高低 +50", "09-nose-position-plus50", "23-alt-nose-position-plus50", "face_adjust_nose_position", 50),
    Case("nose-size-minus48", "鼻大小 −48", "nose-minus48", "11-nose-size-minus48", "face_adjust_nose", -48, True),
    Case("nose-size-plus50", "鼻大小 +50", "nose-plus50", "12-nose-size-plus50", "face_adjust_nose", 50, True),
]


def difference_map(*, baseline, adjusted, gain=DISPLAY_GAIN, sigma=BLUR_SIGMA):
    if baseline.size != adjusted.size:
        raise ValueError("Difference inputs must have equal dimensions")
    if not np.isfinite(gain) or gain <= 0 or not np.isfinite(sigma) or sigma < 0:
        raise ValueError("Gain must be positive and sigma nonnegative")
    original = np.asarray(baseline.convert("RGB").filter(ImageFilter.GaussianBlur(sigma)), dtype=np.float32)
    result = np.asarray(adjusted.convert("RGB").filter(ImageFilter.GaussianBlur(sigma)), dtype=np.float32)
    magnitude = np.abs(result - original).mean(axis=2)
    displayed = np.rint(np.clip(magnitude * gain, 0, 255)).astype(np.uint8)
    return Image.fromarray(displayed), magnitude


def evidence_paths(*, root, case):
    if case.exported:
        reference = root / "qcut-comparison/jianying-export-4k"
        native = root / "qcut-comparison/native-4k-calibration"
        return [reference / "jy-face-neutral-4k-20260927.png",
                reference / f"jy-face-{case.jianying}-4k-20260927.png",
                native / "00-neutral.png", native / f"{case.qcut}.png"]
    reference = root / "slider-comparison/screenshots"
    native = root / "qcut-comparison/native-cold"
    return [reference / "00-neutral.jpg", reference / f"{case.jianying}.jpg",
            native / "00-neutral.png", native / f"{case.qcut}.png"]


def load_evidence(*, filename, screenshot, expected_size):
    with Image.open(filename) as image:
        if image.size != expected_size:
            raise ValueError(f"Unexpected evidence dimensions: {filename}: {image.size}")
        frame = image.convert("RGB")
        if screenshot:
            frame = frame.crop(PLAYER_RECT)
        return frame.resize(NORMALIZED_SIZE, Image.Resampling.LANCZOS)


def draw_label(*, draw, xy, text, size, font_path, fill="#222222", max_width=None):
    font = ImageFont.truetype(str(font_path), size)
    if max_width is not None and draw.textlength(text, font=font) > max_width:
        raise ValueError(f"Label does not fit: {text}")
    draw.text(xy, text, font=font, fill=fill)


def create_sheet(*, cases, rendered, output, font_path, title,
                 provenance="QCut 列为真实 native-provider 输出；开眼角采用已修正的 inner_corner，鼻大小仍待校准。"):
    margin, gap, width, height = 24, 12, 288, 344
    page_width = margin * 2 + width * 5 + gap * 4
    row_height, header, footer = height + 72, 174, 92
    sheet = Image.new("RGB", (page_width, header + row_height * len(cases) + footer), "#f5f6f7")
    draw = ImageDraw.Draw(sheet)

    def label(x, y, text, size=19, color="#222222", max_width=None):
        draw_label(draw=draw, xy=(x, y), text=text, size=size, font_path=font_path, fill=color, max_width=max_width)

    label(margin, 19, title, 32)
    label(margin, 64, "黑色：基本未改动    灰色：改动较小    白色：改动较大    两边使用同一亮度尺度", 20)
    ramp = np.tile(np.arange(256, dtype=np.uint8), (16, 1))
    sheet.paste(Image.fromarray(ramp).resize((256, 16)), (margin, 103))
    label(margin + 270, 97, "0 → 大    差分统一增强 ×6；高值封顶", 17)
    columns = ["原图（零值参考）", "剪映 · 改后", "剪映 · 改动区域", "QCut · 改后", "QCut · 改动区域"]
    for index, text in enumerate(columns):
        label(margin + index * (width + gap), 140, text, 21, max_width=width)
    for row, case in enumerate(cases):
        top = header + row * row_height
        label(margin, top + 7, case.title, 25)
        source_label = "同尺寸导出 / 原生帧" if case.exported else "界面参照 / 原生帧，非同规格导出"
        label(margin + 310, top + 13, source_label, 17, "#555555")
        for column, tile in enumerate(rendered[case.name]):
            x = margin + column * (width + gap)
            resized = tile.crop(FACE_RECT).resize((width, height), Image.Resampling.LANCZOS)
            sheet.paste(resized, (x, top + 48))
        draw.line((margin, top + row_height - 3, page_width - margin, top + row_height - 3), fill="#dddddd")
    bottom = sheet.height - footer
    label(margin, bottom + 14, "差分 = 改后 − 各自零值输出的 RGB 绝对差均值；白色表示变化幅度，不表示变好或位移方向。", 17)
    label(margin, bottom + 42, "同一源照片、固定裁切；轻微高斯预滤波 σ=0.6；不做几何配准、不自动拉伸每张差分图。", 17)
    label(margin, bottom + 67, provenance, 16, "#555555")
    sheet.save(output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("--font", type=Path, default=Path("/System/Library/Fonts/STHeiti Medium.ttc"))
    args = parser.parse_args()
    output = args.root / "qcut-comparison/difference-maps"
    output.mkdir(parents=True, exist_ok=True)
    rendered, records = {}, []
    for case in CASES:
        paths = evidence_paths(root=args.root, case=case)
        frames = []
        for index, filename in enumerate(paths):
            screenshot = not case.exported and index < 2
            size = (2160, 3240) if case.exported else ((1751, 1114) if screenshot else (600, 900))
            frames.append(load_evidence(filename=filename, screenshot=screenshot, expected_size=size))
        base_j, result_j, base_q, result_q = frames
        diff_j, magnitude_j = difference_map(baseline=base_j, adjusted=result_j)
        diff_q, magnitude_q = difference_map(baseline=base_q, adjusted=result_q)
        rendered[case.name] = [base_j, result_j, diff_j, result_q, diff_q]
        case_dir = output / case.name
        case_dir.mkdir(exist_ok=True)
        for name, frame in [("jianying-zero", base_j), ("jianying-result", result_j), ("qcut-zero", base_q), ("qcut-result", result_q), ("jianying-difference-x6", diff_j), ("qcut-difference-x6", diff_q)]:
            frame.save(case_dir / f"{name}.png")
        np.save(case_dir / "jianying-difference-raw.npy", magnitude_j)
        np.save(case_dir / "qcut-difference-raw.npy", magnitude_q)
        records.append({
            "name": case.name, "title": case.title, "value": case.value, "qcutKey": case.qcut_key,
            "referenceKind": "export" if case.exported else "UI screenshot",
            "sources": [{"path": str(filename), "sha256": hashlib.sha256(filename.read_bytes()).hexdigest()} for filename in paths],
            "meanAbsoluteChange": {"jianying": float(magnitude_j.mean()), "qcut": float(magnitude_q.mean())},
            "displayClippedFraction": {"jianying": float((magnitude_j * DISPLAY_GAIN >= 255).mean()), "qcut": float((magnitude_q * DISPLAY_GAIN >= 255).mean())},
        })
    selected = [case for case in CASES if case.name in {"eye100", "corner99", "nose-position-minus48", "nose-size-minus48"}]
    for filename, cases, title in [
        ("01-overview.png", selected, "美颜改动区域对照｜眼睛与鼻子"),
        ("02-eyes.png", CASES[:3], "眼睛对照｜大眼 50 / 100 · 开眼角 99"),
        ("03-nose.png", CASES[3:], "鼻子对照｜鼻高低与鼻大小 · 正负参数"),
    ]:
        create_sheet(cases=cases, rendered=rendered, output=output / filename, font_path=args.font, title=title)
    manifest = {
        "method": "mean(abs(Gaussian(adjusted)-Gaussian(own zero baseline)), RGB), displayed with fixed linear gain and clipping",
        "gain": DISPLAY_GAIN, "sigma": BLUR_SIGMA, "normalizedSize": NORMALIZED_SIZE,
        "faceCrop": FACE_RECT, "screenshotPlayerCrop": PLAYER_RECT,
        "geometricRegistration": False, "perMapNormalization": False, "cases": records,
    }
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "cases": len(records), "sheets": 3}, ensure_ascii=False))


if __name__ == "__main__":
    main()
