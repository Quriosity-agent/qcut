"""Deterministic tensor and rendered bilingual holdouts, not a product preprocessor."""
from pathlib import Path

import numpy as np

from ocr_rec_torch import INPUT_SHAPE


def rendered_cases(*, out=None):
    from PIL import Image, ImageDraw, ImageFilter, ImageFont

    fonts = {
        "latin": Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
        "cjk": Path("/System/Library/Fonts/Hiragino Sans GB.ttc"),
    }
    specs = [
        ("english", "QCut subtitle recognition 2026", "latin", "black", "white", 23, 0),
        ("english-inverted", "The meeting starts at 3:30 pm.", "latin", "white", "black", 23, 0),
        ("english-low-contrast", "Keep the original video file.", "latin", 130, 190, 23, 0),
        ("english-blur", "Budget: 1,250.00 dollars", "latin", "black", "white", 23, 0.55),
        ("chinese", "\u5927\u5bb6\u597d\uff0c\u8fd9\u662f\u4e2d\u6587\u5b57\u5e55\u6d4b\u8bd5", "cjk", "black", "white", 24, 0),
        ("chinese-inverted", "\u8bf7\u4fdd\u5b58\u9879\u76ee\uff0c\u4e0d\u8981\u5220\u9664\u539f\u59cb\u6587\u4ef6", "cjk", "white", "black", 24, 0),
        ("mixed", "QCut \u9884\u7b97 1250 \u5143\uff0c\u4e0b\u5348 3:30", "cjk", "black", "white", 24, 0),
        ("chinese-small-blur", "\u8fd9\u6bb5\u7d20\u6750\u5305\u542b\u4e2d\u6587\u6570\u5b57\u548c\u82f1\u6587\u540d\u79f0", "cjk", "black", "white", 18, 0.35),
        ("fresh-english", "No raw weights in public builds.", "latin", 25, 230, 22, 0.2),
        ("fresh-chinese", "\u65b0\u7684\u7559\u51fa\u6837\u672c\uff1a\u753b\u9762\u4e0e\u5b57\u5e55\u5bf9\u9f50", "cjk", 210, 25, 23, 0),
        ("fresh-mixed", "TEST 789 \u4e2d\u6587\u8bc6\u522b ABC", "cjk", 65, 230, 20, 0.4),
    ]
    values, metadata = {}, {}
    for name, text, family, foreground, background, size, blur in specs:
        font = ImageFont.truetype(str(fonts[family]), size)
        page = Image.new("L", (512, 32), color=background)
        painter = ImageDraw.Draw(page)
        left, top, right, bottom = painter.textbbox((0, 0), text, font=font)
        if right - left > 504 or bottom - top > 30:
            raise ValueError("rendered recognizer fixture would clip text")
        painter.text((4 - left, (32 - bottom + top) // 2 - top), text, font=font, fill=foreground)
        if blur:
            page = page.filter(ImageFilter.GaussianBlur(blur))
        image = page.convert("RGB")
        pixels = np.asarray(image)
        if np.unique(pixels).size < 8:
            raise ValueError("empty or invalid text fixture")
        case_name = f"original-holdout-rendered-{name}"
        values[case_name] = (pixels.astype(np.float32) / 127.5 - 1).transpose(2, 0, 1)[None].copy()
        metadata[case_name] = {"text": text, "font": str(fonts[family]), "font_size": size,
                               "synthetic": True, "preprocessing": "fixture RGB /127.5 -1; not production-verified"}
        if out is not None:
            directory = Path(out) / "rendered-inputs"
            directory.mkdir(exist_ok=True)
            image.save(directory / f"{case_name}.png")
            metadata[case_name]["image"] = str(directory / f"{case_name}.png")
    return values, metadata


def build_cases(*, quick, out=None):
    cases = {"original-zeros": np.zeros(INPUT_SHAPE, dtype=np.float32),
             "original-random-17": np.random.default_rng(17).uniform(-1, 1, INPUT_SHAPE).astype(np.float32)}
    if quick:
        return cases, {}
    for seed in (509, 829, 7919, 20260919):
        cases[f"original-holdout-{seed}"] = np.random.default_rng(seed).uniform(-1, 1, INPUT_SHAPE).astype(np.float32)
    cases["original-holdout-ramp"] = np.linspace(-1, 1, np.prod(INPUT_SHAPE), dtype=np.float32).reshape(INPUT_SHAPE)
    cases["original-holdout-negative-ones"] = -np.ones(INPUT_SHAPE, dtype=np.float32)
    pulse = np.zeros(INPUT_SHAPE, dtype=np.float32)
    pulse[0, 0, 0, 0], pulse[0, 2, -1, -1] = 1, -1
    cases["original-holdout-edge-pulse"] = pulse
    images, metadata = rendered_cases(out=out)
    return {**cases, **images}, metadata
