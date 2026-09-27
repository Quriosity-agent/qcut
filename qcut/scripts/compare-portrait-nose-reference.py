"""Compare measured nose deltas for existing local exports and native probes."""

import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SPEC = importlib.util.spec_from_file_location("portrait_difference_sheets", Path(__file__).with_name("create-portrait-difference-sheets.py"))
DIFF = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = DIFF
SPEC.loader.exec_module(DIFF)


def delta_metrics(*, reference, candidate):
    if reference.shape != candidate.shape:
        raise ValueError("Delta dimensions must match")
    if not reference.size or not np.isfinite(reference).all() or not np.isfinite(candidate).all():
        raise ValueError("Deltas must contain finite samples")
    reference = reference.astype(np.float64).ravel()
    candidate = candidate.astype(np.float64).ravel()
    norm = np.linalg.norm(reference) * np.linalg.norm(candidate)
    return {
        "deltaCosine": float(np.dot(reference, candidate) / norm) if norm else None,
        "deltaMae": float(np.abs(reference - candidate).mean()),
        "referenceMagnitude": float(np.abs(reference).mean()),
        "candidateMagnitude": float(np.abs(candidate).mean()),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path, help="qcut-comparison directory")
    parser.add_argument("--candidate", default="3d-nose")
    parser.add_argument("--provider-output", type=Path, help="Formal provider audit directory; replaces the selected candidate")
    parser.add_argument("--font", type=Path, default=Path("/System/Library/Fonts/STHeiti Medium.ttc"))
    args = parser.parse_args()
    root = args.root
    if args.provider_output:
        args.candidate = "3d-integrated"
    output = root / "nose-investigation"
    output.mkdir(exist_ok=True)
    sources, metrics = {}, []

    def load(filename):
        sources[str(filename)] = hashlib.sha256(filename.read_bytes()).hexdigest()
        return DIFF.load_evidence(filename=filename, screenshot=False, expected_size=(2160, 3240))

    def samples(frame):
        return np.asarray(frame.filter(ImageFilter.GaussianBlur(0.8)).crop(DIFF.FACE_RECT), dtype=float)

    def candidate_path(*, folder, filename, provider_name=None):
        if args.provider_output and folder == args.candidate:
            return args.provider_output / f"{provider_name or filename}.png"
        return output / folder / f"{filename}.png"

    baseline_j = load(root / "jianying-export-4k/jy-face-neutral-4k-20260927.png")
    folders = ["f662", "0746", "3d-nose"]
    if args.candidate not in folders:
        folders.append(args.candidate)
    baselines = {folder: load(candidate_path(folder=folder, filename="00-neutral")) for folder in folders}
    margin, gap, width, height = 22, 12, 250, 298
    sheet = Image.new("RGB", (margin * 2 + width * 7 + gap * 6, 1000), "#f5f6f7")
    draw = ImageDraw.Draw(sheet)

    def label(x, y, text, size=18, max_width=None):
        DIFF.draw_label(draw=draw, xy=(x, y), text=text, size=size, font_path=args.font, max_width=max_width)

    label(margin, 18, "鼻大小：2D 旧入口与 3D 正确入口对照", 30)
    label(margin, 65, "同一照片、同尺寸输入；黑色基本未变，越白改动越大。所有差分统一增强 ×6。", 21)
    columns = ["原图（剪映零值）", "剪映 · 改后", "剪映 · 改动区域", "QCut 旧入口 · 改后", "旧入口 · 改动区域", "3D 探针 · 改后", "3D 探针 · 改动区域"]
    if args.provider_output:
        columns[-2:] = ["QCut 新入口 · 改后", "新入口 · 改动区域"]
    for column, text in enumerate(columns):
        label(margin + column * (width + gap), 118, text, 20, width)

    cases = [("nose-minus48", "11-nose-size-minus48", "鼻大小 -48"), ("nose-plus50", "12-nose-size-plus50", "鼻大小 +50")]
    for row, (reference_name, filename, title) in enumerate(cases):
        reference = load(root / f"jianying-export-4k/jy-face-{reference_name}-4k-20260927.png")
        provider_name = "32-nose3d-minus48" if reference_name == "nose-minus48" else "33-nose3d-plus50"
        candidates = {
            folder: load(candidate_path(folder=folder, filename=filename, provider_name=provider_name))
            for folder in folders
        }
        for folder, candidate in candidates.items():
            metrics.append({
                "reference": reference_name, "candidate": folder,
                **delta_metrics(reference=samples(reference) - samples(baseline_j), candidate=samples(candidate) - samples(baselines[folder])),
            })
        diff_j, _ = DIFF.difference_map(baseline=baseline_j, adjusted=reference)
        diff_old, _ = DIFF.difference_map(baseline=baselines["f662"], adjusted=candidates["f662"])
        diff_new, _ = DIFF.difference_map(baseline=baselines[args.candidate], adjusted=candidates[args.candidate])
        tiles = [baseline_j, reference, diff_j, candidates["f662"], diff_old, candidates[args.candidate], diff_new]
        top = 155 + row * 380
        label(margin, top, title, 23)
        for column, tile in enumerate(tiles):
            sheet.paste(tile.crop(DIFF.FACE_RECT).resize((width, height), Image.Resampling.LANCZOS), (margin + column * (width + gap), top + 40))

    description = "右侧经 QCut 正式 provider / catalog / stage 渲染；是像素对照，不是编辑器截图。" if args.provider_output else "右侧是 QCut 原生宿主加载正确 3D 包的诊断输出，尚未接入编辑器；不是产品已修复的截图。"
    label(margin, 920, description, 19)
    label(margin, 950, "差分分别减去各自零值；显示 σ=0.6，指标 σ=0.8；H.264 与 PNG 有残差。单张脸不是完整精度验收。", 18)
    sheet_path = output / f"nose-routing-{args.candidate}.png"
    sheet.save(sheet_path)
    report = {
        "normalizedSize": [600, 900], "roi": list(DIFF.FACE_RECT),
        "metricSigma": 0.8, "displaySigma": DIFF.BLUR_SIGMA, "displayGain": DIFF.DISPLAY_GAIN,
        "metrics": metrics, "sources": sources,
        "sheet": str(sheet_path),
        "limitation": "Single-photo diagnostic. Formal provider output, not editor capture; no dynamic, multi-face or current-build parity claim." if args.provider_output else "Single-photo diagnostic. 3D native host only; not editor, dynamic, multi-face or current-build parity.",
    }
    (output / f"metrics-{args.candidate}.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
