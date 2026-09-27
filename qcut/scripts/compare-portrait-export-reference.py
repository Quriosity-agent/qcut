"""Compare baseline-subtracted portrait deltas, not encoded frame similarity.

Requires Pillow and NumPy. Inputs are genuine Jianying export frames and QCut
native-provider PNGs from audit-portrait-slider-reference.ts, all 2160x3240.
This single-photo diagnostic is not a perceptual quality or parity threshold.
"""

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

PAIRS = [
    ("corner99", "04-eye-corner-99"),
    ("corner99", "26-inner-corner-50"),
    ("corner99", "31-inner-corner-75"),
    ("corner99", "30-inner-corner-99"),
    ("nose-minus48", "11-nose-size-minus48"),
    ("nose-plus50", "12-nose-size-plus50"),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path, help="qcut-comparison directory")
    args = parser.parse_args()
    reference = args.root / "jianying-export-4k"
    native = args.root / "native-4k-calibration"
    sources = {}

    def load(filename):
        image = Image.open(filename).convert("RGB")
        if image.size != (2160, 3240):
            raise ValueError(f"Unexpected dimensions: {filename}: {image.size}")
        sources[str(filename)] = hashlib.sha256(filename.read_bytes()).hexdigest()
        return image.resize((600, 900), Image.Resampling.LANCZOS)

    def samples(filename):
        image = load(filename).filter(ImageFilter.GaussianBlur(0.8))
        return np.asarray(image, dtype=float)[195:750, 70:535]

    baseline_j = samples(reference / "jy-face-neutral-4k-20260927.png")
    baseline_q = samples(native / "00-neutral.png")
    metrics = []
    for name, candidate in PAIRS:
        delta_j = (samples(reference / f"jy-face-{name}-4k-20260927.png") - baseline_j).ravel()
        delta_q = (samples(native / f"{candidate}.png") - baseline_q).ravel()
        dot = np.dot(delta_j, delta_q)
        metrics.append({
            "reference": name, "candidate": candidate,
            "deltaCosine": float(dot / (np.linalg.norm(delta_j) * np.linalg.norm(delta_q))),
            "leastSquaresGain": float(dot / np.dot(delta_q, delta_q)),
            "deltaMae": float(np.abs(delta_j - delta_q).mean()),
        })

    frames = [
        ("Jianying neutral", reference / "jy-face-neutral-4k-20260927.png"),
        ("Jianying corner 99", reference / "jy-face-corner99-4k-20260927.png"),
        ("QCut classic corner 99", native / "04-eye-corner-99.png"),
        ("QCut corrected corner 99", native / "30-inner-corner-99.png"),
    ]
    sheet = Image.new("RGB", (1920, 650), "#f8f8f8")
    draw = ImageDraw.Draw(sheet)
    draw.text((15, 12), "Same-source 2160x3240 inputs. Fixed face crop; no geometric alignment or retouching.", fill="black", font_size=21)
    for index, (label, filename) in enumerate(frames):
        crop = load(filename).crop((70, 195, 535, 750))
        sheet.paste(crop, (index * 480 + 8, 70))
        draw.text((index * 480 + 8, 43), label, fill="black", font_size=20)
    draw.text((15, 630), "Jianying: H.264 export at t=2s. QCut: native-provider PNG. Not a multi-face/video parity claim.", fill="black", font_size=16)
    sheet.save(args.root / "eye-corner-export-before-after.png")
    report = {
        "normalizedSize": [600, 900], "roi": [70, 195, 535, 750],
        "gaussianSigma": 0.8,
        "baselineMae": float(np.abs(baseline_j - baseline_q).mean()),
        "metrics": metrics, "sources": sources,
        "limitation": "One still, H264 versus PNG, baseline-subtracted diagnostic, not a perceptual acceptance score.",
    }
    (args.root / "export-reference-metrics.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
