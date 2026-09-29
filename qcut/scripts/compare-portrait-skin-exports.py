"""Decode and compare matched skin exports without treating encoding as effect parity."""

import argparse
from fractions import Fraction
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys

import numpy as np
from PIL import Image

SPEC = importlib.util.spec_from_file_location(
    "skin_reference", Path(__file__).with_name("compare-portrait-skin-reference.py")
)
SKIN = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = SKIN
SPEC.loader.exec_module(SKIN)
CONTROLS = [row for row in SKIN.CONTROLS if row[0] in ("smooth", "blemish", "clarity")]
EXPECTED = {"neutral": {}, "neutral-after": {}}
EXPECTED.update({f"{key}-{value}": {key: value} for _, _, key in CONTROLS for value in (50, 100)})


def validate_samples(*, manifest, source_hash):
    if manifest["sourceSha256"] != source_hash:
        raise ValueError("Source hash mismatch")
    if manifest.get("errors"):
        raise ValueError("Export report contains errors")
    samples = {}
    for sample in manifest["samples"]:
        name = sample["name"]
        if name not in EXPECTED or sample["values"] != EXPECTED[name]:
            raise ValueError("Expected isolated skin parameters or neutral")
        if name in samples:
            raise ValueError("Duplicate export")
        samples[name] = sample
    if set(samples) != set(EXPECTED):
        raise ValueError("Expected six effects and two neutral exports")
    return samples


def validate_stream(*, stream):
    if (stream["width"], stream["height"]) != (1080, 1620):
        raise ValueError("Expected 1080x1620")
    if Fraction(stream["avg_frame_rate"]) != 30:
        raise ValueError("Expected 30 fps")
    if abs(float(stream["duration"]) - 5) > 0.001:
        raise ValueError("Expected five seconds")
    if stream["codec_name"] != "h264":
        raise ValueError("Expected H.264")


def validate_frame(*, image):
    pixels = np.asarray(image.convert("RGB"), dtype=np.float32)
    if image.size != (1080, 1620) or pixels.mean() < 5 or pixels.std() < 2:
        raise ValueError("Unexpected dimensions or blank portrait frame")


def color_contract(*, stream):
    return {key: stream.get(key) for key in (
        "pix_fmt", "color_range", "color_space", "color_transfer", "color_primaries"
    )}


def run(*, command):
    return subprocess.run(command, check=True, capture_output=True, timeout=90).stdout


def decode(*, source, output):
    stream = json.loads(run(command=[
        "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_streams", "-of", "json", str(source)
    ]))["streams"][0]
    validate_stream(stream=stream)
    frame_hashes = run(command=[
        "ffmpeg", "-v", "error", "-xerror", "-i", str(source), "-map", "0:v:0",
        "-an", "-f", "framemd5", "-"
    ]).decode()
    frames = [line for line in frame_hashes.splitlines() if line and not line.startswith("#")]
    if len(frames) != 150:
        raise ValueError("Expected 150 fully decoded frames")
    output.mkdir(parents=True, exist_ok=True)
    (output / "decoded-frames.md5").write_text(frame_hashes)
    for index in (0, 60, 149):
        run(command=[
            "ffmpeg", "-y", "-v", "error", "-xerror", "-i", str(source),
            "-vf", f"select=eq(n\\,{index})", "-frames:v", "1", str(output / f"frame-{index}.png")
        ])
        with Image.open(output / f"frame-{index}.png") as image:
            validate_frame(image=image)
    return {"source": SKIN.fingerprint(path=source), "stream": stream, "decodedFrames": len(frames)}


def frame(*, directory, index):
    return SKIN.load_frame(path=directory / f"frame-{index}.png", expected_size=(1080, 1620))


def mean_difference(*, left, right):
    return float(np.abs(np.asarray(left, dtype=np.float32) - np.asarray(right, dtype=np.float32)).mean())


def comparison_fingerprints(*, directory, prefix):
    return {kind: SKIN.fingerprint(path=directory / f"{prefix}-{kind}.png")
            for kind in ("zero", "result")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("qcut", type=Path)
    parser.add_argument("jianying", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--font", type=Path, default=Path("/System/Library/Fonts/STHeiti Medium.ttc"))
    args = parser.parse_args()
    reports = {"qcut": args.qcut, "jianying": args.jianying}
    manifests = {side: json.loads(path.read_text()) for side, path in reports.items()}
    source = Path(manifests["qcut"]["source"])
    source_record = SKIN.fingerprint(path=source)
    samples = {side: validate_samples(manifest=manifest, source_hash=source_record["sha256"])
               for side, manifest in manifests.items()}
    args.output.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, args.output / f"source-original{source.suffix}")
    decoded, diagnostics = {}, {}
    for side, cases in samples.items():
        decoded[side] = {}
        for name, sample in cases.items():
            video = Path(sample["exportPath"])
            if not video.is_absolute():
                video = reports[side].parent / video
            directory = args.output / side / name
            decoded[side][name] = decode(source=video, output=directory)
        directory = args.output / side
        baseline = frame(directory=directory / "neutral", index=60)
        final = frame(directory=directory / "neutral-after", index=60)
        baseline_contract = color_contract(stream=decoded[side]["neutral"]["stream"])
        diagnostics[side] = {
            "neutralDriftMeanRGB": mean_difference(left=baseline, right=final),
            "consistentColorContract": all(color_contract(stream=item["stream"]) == baseline_contract
                                           for item in decoded[side].values()),
        }
    records, overview = [], []
    for slug, label, key in CONTROLS:
        rows = []
        for value in (50, 100):
            name = f"{key}-{value}"
            sides, record = {}, {"key": key, "value": value}
            directory = args.output / f"{slug}-{value}"
            directory.mkdir(exist_ok=True)
            for side in samples:
                case = args.output / side / name
                baseline = frame(directory=args.output / side / "neutral", index=60)
                result = frame(directory=case, index=60)
                difference, metrics = SKIN.save_side(
                    baseline=baseline, adjusted=result, output=directory, prefix=side
                )
                metrics["frames"] = comparison_fingerprints(directory=directory, prefix=side)
                metrics["firstToMiddleMeanRGB"] = mean_difference(left=frame(directory=case, index=0), right=result)
                metrics["middleToLastMeanRGB"] = mean_difference(left=result, right=frame(directory=case, index=149))
                sides[side] = (baseline, result, difference)
                record[side] = metrics
            tiles = [*sides["jianying"], sides["qcut"][1], sides["qcut"][2]]
            rows.append((f"{label} {value}", tiles))
            records.append(record)
            if value == 100:
                overview.append(rows[-1])
        SKIN.render_sheet(title=f"{label} / 同尺寸真实导出", rows=rows,
                          output=args.output / f"{slug}.png", font=args.font, paired=True,
                          evidence_label="双端 H.264 1080×1620 / 30 fps / 第60帧；有损编码，不是像素平价验收。")
    SKIN.render_sheet(title="皮肤三项100 / 同尺寸真实导出", rows=overview,
                      output=args.output / "overview.png", font=args.font, paired=True,
                      evidence_label="双端 H.264 1080×1620 / 30 fps / 第60帧；有损编码，不是像素平价验收。")
    report = {"source": source_record, "decoded": decoded, "diagnostics": diagnostics, "samples": records,
              "method": {"frame": 60, "normalizedSize": SKIN.DIFF.NORMALIZED_SIZE,
                         "sigma": 0.6, "gain": 6, "losslessParity": False}}
    (args.output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    (args.output / "README.md").write_text(
        "# 同尺寸导出对照\n\n原照片保持不变。五列：剪映零值、剪映结果、剪映差分、QCut结果、QCut差分。\n\n"
        "各减各自零值；固定增益6，不做单图归一化。H.264有损编码，不是无损平价验收。色彩契约见报告。\n\n"
        + "\n".join(f"- [{label}]({slug}.png)" for slug, label, _ in CONTROLS)
        + "\n- [100档总览](overview.png)\n- [数据与编码信息](report.json)\n"
    )
    print(json.dumps({"diagnostics": diagnostics, "samples": records}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
