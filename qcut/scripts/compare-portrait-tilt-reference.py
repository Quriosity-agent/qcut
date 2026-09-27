"""Compare genuine Jianying UI references with QCut portrait routes."""

import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
from PIL import ImageFilter

SPEC = importlib.util.spec_from_file_location("portrait_nose_reference", Path(__file__).with_name("compare-portrait-nose-reference.py"))
REFERENCE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = REFERENCE
SPEC.loader.exec_module(REFERENCE)
DIFF = REFERENCE.DIFF


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("--region", choices=["tilt", "mouth", "eyes"], default="tilt")
    parser.add_argument("--font", type=Path, default=Path("/System/Library/Fonts/STHeiti Medium.ttc"))
    args = parser.parse_args()
    shots = args.root / ("full-face-audit/jianying" if args.region == "tilt" else f"{args.region}-fix/jianying")
    native = args.root / f"{args.region}-fix/native"
    output = args.root / f"{args.region}-fix/comparison"
    output.mkdir(parents=True, exist_ok=True)
    sources, rendered, records = {}, {}, []

    def load(*, filename, screenshot):
        sources[str(filename)] = hashlib.sha256(filename.read_bytes()).hexdigest()
        return DIFF.load_evidence(filename=filename, screenshot=screenshot,
                                  expected_size=(1751, 1114) if screenshot else (600, 900))

    def samples(frame):
        return np.asarray(frame.filter(ImageFilter.GaussianBlur(DIFF.BLUR_SIGMA)).crop(DIFF.FACE_RECT), dtype=float)

    base_q = load(filename=native / "00-neutral.png", screenshot=False)
    groups = [
        ("mouth", "嘴倾斜", "face_adjust_MouthTilted", "tilt-mouth-zero", [
            (-100, "mouth-tilt-minus100", "34-mouth-tilt-minus100"),
            (100, "mouth-tilt-plus100", "37-mouth-tilt-plus100"),
        ]),
        ("eyes", "眼倾斜", "face_adjust_EyeTilted", "tilt-eye-zero", [
            (-100, "eye-tilt-min", "38-eye-tilt-minus100"),
            (100, "eye-tilt-max", "41-eye-tilt-plus100"),
        ]),
    ]
    if args.region == "mouth":
        baseline = "00-mouth-zero"
        groups = [
            ("smile-lips", "微笑唇", "face_adjust_mouse_corner", baseline, [
                (-50, "smile-lips-minus50", "43-mouth-smile-lips-minus50"),
                (50, "smile-lips-plus50", "44-mouth-smile-lips-plus50"),
            ]),
            ("smile", "笑容", "face_adjust_Smile", baseline, [
                (-100, "smile-minus100", "45-mouth-smile-minus100"),
                (100, "smile-plus100", "46-mouth-smile-plus100"),
            ]),
            ("size", "嘴大小", "face_adjust_ZoomMouth", baseline, [
                (-50, "mouth-size-minus50", "47-mouth-size-minus50"),
                (50, "mouth-size-plus50", "16-mouth-size-plus50"),
            ]),
            ("position", "嘴高低", "face_adjust_MoveMouth", baseline, [
                (-50, "mouth-position-minus50", "48-mouth-position-minus50"),
                (50, "mouth-position-plus50", "49-mouth-position-plus50"),
            ]),
            ("teeth", "白牙", "face_adjust_WhiteTeeth", baseline, [
                (100, "white-teeth-100", "50-mouth-teeth-100"),
            ]),
        ]
    if args.region == "eyes":
        baseline = "00-eyes-zero"
        groups = [
            ("enlarge", "大眼", "face_adjust_EnlargeEye", baseline, [
                (50, "enlarge-50", "01-eye-size-50"),
                (100, "enlarge-100", "02-eye-size-100"),
            ]),
            ("bright", "亮眼", "face_adjust_BrightEye", baseline, [
                (50, "bright-50", "54-eye-bright-50"),
                (100, "bright-100", "55-eye-bright-100"),
            ]),
            ("spacing", "眼距", "face_adjust_EyeSpacing", baseline, [
                (-50, "spacing-minus50", "56-eye-spacing-minus50"),
                (50, "spacing-plus50", "06-eye-spacing-plus50"),
            ]),
            ("corner", "开眼角", "face_adjust_inner_corner", baseline, [
                (50, "corner-50", "26-inner-corner-50"),
                (100, "corner-100", "59-inner-corner-100"),
            ]),
            ("position", "眼高低", "face_adjust_MoveEye", baseline, [
                (-50, "position-minus50", "57-eye-position-minus50"),
                (50, "position-plus50", "58-eye-position-plus50"),
            ]),
            ("tilt", "眼倾斜", "face_adjust_EyeTilted", baseline, [
                (-100, "tilt-minus100", "38-eye-tilt-minus100"),
                (50, "tilt-plus50", "40-eye-tilt-plus50"),
                (100, "tilt-plus100", "41-eye-tilt-plus100"),
            ]),
        ]
    for group, title, key, baseline, cases in groups:
        base_j = load(filename=shots / f"{baseline}.png", screenshot=True)
        sheet_cases = []
        for value, reference_name, candidate_name in cases:
            name = f"{group}-{value}"
            case = DIFF.Case(name, f"{title} {value:+d}", reference_name, candidate_name, key, value)
            sheet_cases.append(case)
            result_j = load(filename=shots / f"{reference_name}.png", screenshot=True)
            result_q = load(filename=native / f"{candidate_name}.png", screenshot=False)
            diff_j, magnitude_j = DIFF.difference_map(baseline=base_j, adjusted=result_j)
            diff_q, magnitude_q = DIFF.difference_map(baseline=base_q, adjusted=result_q)
            rendered[name] = [base_j, result_j, diff_j, result_q, diff_q]
            case_dir = output / name
            case_dir.mkdir(exist_ok=True)
            for filename, frame in [("jianying-zero", base_j), ("jianying-result", result_j), ("qcut-zero", base_q), ("qcut-result", result_q), ("jianying-difference-x6", diff_j), ("qcut-difference-x6", diff_q)]:
                frame.save(case_dir / f"{filename}.png")
            np.save(case_dir / "jianying-difference-raw.npy", magnitude_j)
            np.save(case_dir / "qcut-difference-raw.npy", magnitude_q)
            delta_j = samples(result_j) - samples(base_j)
            records.append({"name": name, "key": key, "value": value,
                            **REFERENCE.delta_metrics(reference=delta_j, candidate=samples(result_q) - samples(base_q)),
                            "missingRouteDeltaMae": float(np.abs(delta_j).mean()),
                            "clippedFraction": {"jianying": float((magnitude_j * DIFF.DISPLAY_GAIN >= 255).mean()),
                                                "qcut": float((magnitude_q * DIFF.DISPLAY_GAIN >= 255).mean())}})
        DIFF.create_sheet(cases=sheet_cases, rendered=rendered, output=output / f"{group}.png", font_path=args.font,
                          title=f"{title}｜独立参数逐项对照",
                          provenance="QCut 列为正式 provider 输出；剪映列为界面截图，非同规格导出。只验证这张静态单人照片。")
    report = {"region": args.region, "gain": DIFF.DISPLAY_GAIN, "sigma": DIFF.BLUR_SIGMA, "sources": sources,
              "geometricRegistration": False, "perMapNormalization": False,
              "normalizedSize": DIFF.NORMALIZED_SIZE, "faceCrop": DIFF.FACE_RECT,
              "screenshotPlayerCrop": DIFF.PLAYER_RECT, "cases": records,
              "limitation": "UI screenshot versus native output, not equal-resolution export parity; no multi-face or moving-video acceptance."}
    (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "cases": records}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
