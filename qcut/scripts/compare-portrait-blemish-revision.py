"""Compare blemish changes before/after a fix using validated skin export evidence."""

import argparse
import importlib.util
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


def load_module(*, name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


SKIN = load_module(name="blemish_skin_reference", filename="compare-portrait-skin-reference.py")
METRICS = load_module(name="blemish_delta_metrics", filename="compare-portrait-nose-reference.py")


def validate_reports(*, before, after):
    if before["source"]["sha256"] != after["source"]["sha256"]:
        raise ValueError("Source photos must match")
    method = {"frame": 60, "normalizedSize": [600, 900], "sigma": 0.6, "gain": 6, "losslessParity": False}
    if before["method"] != method or after["method"] != method:
        raise ValueError("Comparison methods must match the fixed-scale export contract")
    for report in (before, after):
        if set(report["diagnostics"]) != {"qcut", "jianying"}:
            raise ValueError("Both applications require baseline diagnostics")
        if any(not side["consistentColorContract"] or side["neutralDriftMeanRGB"] != 0
               for side in report["diagnostics"].values()):
            raise ValueError("Unstable neutral or color contract")


def signed_delta(*, result, baseline):
    def samples(image):
        return np.asarray(image.filter(ImageFilter.GaussianBlur(SKIN.DIFF.BLUR_SIGMA))
                          .crop(SKIN.DIFF.FACE_RECT), dtype=np.float64)
    return samples(result) - samples(baseline)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    reports = {phase: json.loads((directory / "report.json").read_text())
               for phase, directory in (("before", args.before), ("after", args.after))}
    validate_reports(**reports)
    args.output.mkdir(parents=True, exist_ok=True)
    font = Path("/System/Library/Fonts/STHeiti Medium.ttc")
    sheet = Image.new("RGB", (1812, 840), "#f5f6f7")
    draw = ImageDraw.Draw(sheet)

    def label(*, x, y, text, size=18):
        SKIN.DIFF.draw_label(draw=draw, xy=(x, y), text=text, size=size, font_path=font)

    label(x=24, y=18, text="祛斑祛痘：修复前 / 修复后 / 剪映", size=28)
    label(x=24, y=58, text="真实导出第60帧；每端减自身零值；所有灰度图固定 ×6，不逐图拉伸")
    columns = ["原图 / 剪映零值", "剪映效果", "剪映差分", "QCut 修复前", "修复前差分", "QCut 修复后", "修复后差分"]
    for column, text in enumerate(columns):
        label(x=24 + column * 254, y=100, text=text)
    sources, records = [], []
    for row, value in enumerate((50, 100)):
        frames = {}
        for phase, directory in (("before", args.before), ("after", args.after)):
            for side in ("jianying", "qcut"):
                for kind in ("zero", "result"):
                    path = directory / f"blemish-{value}" / f"{side}-{kind}.png"
                    sources.append(SKIN.fingerprint(path=path))
                    frames[phase, side, kind] = SKIN.load_frame(path=path, expected_size=(600, 900))
        for kind in ("zero", "result"):
            if not np.array_equal(frames["before", "jianying", kind], frames["after", "jianying", kind]):
                raise ValueError("Jianying reference pixels changed between revisions")
        reference = signed_delta(result=frames["after", "jianying", "result"],
                                 baseline=frames["after", "jianying", "zero"])
        record = {"value": value}
        tiles = [frames["after", "jianying", "zero"]]
        for phase, side in (("after", "jianying"), ("before", "qcut"), ("after", "qcut")):
            baseline, result = frames[phase, side, "zero"], frames[phase, side, "result"]
            difference, _ = SKIN.DIFF.difference_map(baseline=baseline, adjusted=result)
            tiles.extend((result, difference))
            if side == "qcut":
                record[phase] = METRICS.delta_metrics(reference=reference,
                                                     candidate=signed_delta(result=result, baseline=baseline))
        record["deltaMaeReductionFraction"] = 1 - record["after"]["deltaMae"] / record["before"]["deltaMae"] if record["before"]["deltaMae"] else None
        records.append(record)
        top = 132 + row * 320
        label(x=24, y=top, text=f"祛斑祛痘 {value}", size=21)
        for column, frame in enumerate(tiles):
            sheet.paste(frame.crop(SKIN.DIFF.FACE_RECT).resize((240, 286), Image.Resampling.LANCZOS),
                        (24 + column * 254, top + 29))
    label(x=24, y=786, text="保留原始滑杆强度；改变的是模型处理尺寸。眼周100档色边仍在，不代表美观或完整精度验收。")
    label(x=24, y=813, text="同一真人照片，H.264有损编码；不做几何配准、曝光补偿或局部增强。", size=16)
    sheet.save(args.output / "blemish-before-after.png")
    report = {"source": reports["after"]["source"], "method": reports["after"]["method"],
              "roi": list(SKIN.DIFF.FACE_RECT), "metrics": records, "sources": sources,
              "limitation": "Single-photo export comparison; no video-motion, multi-face or Windows parity claim."}
    (args.output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(records, indent=2))


if __name__ == "__main__":
    main()
