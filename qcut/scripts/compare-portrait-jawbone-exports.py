"""Verify jawbone improvements against matched, fully decoded reference exports."""

import argparse
import importlib.util
import json
import math
from pathlib import Path
import shutil
import sys

import numpy as np


def module(*, name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    sys.modules[name] = result
    spec.loader.exec_module(result)
    return result


EXPORT = module(name="jawbone_exports", filename="compare-portrait-skin-exports.py")
SHAPE = module(name="jawbone_shape", filename="compare-portrait-face-shape-reference.py")
KEY = "face_adjust_ZoomJawbone"
EXPECTED = {"neutral": {}, "jawbone-50": {KEY: 50}, "jawbone-100": {KEY: 100}, "neutral-after": {}}


def validate_manifest(*, manifest, source_hash):
    if manifest["sourceSha256"] != source_hash or manifest.get("errors"):
        raise ValueError("Source mismatch or failed export run")
    samples = {}
    for sample in manifest["samples"]:
        name = sample["name"]
        if name in samples or name not in EXPECTED or sample["values"] != EXPECTED[name]:
            raise ValueError("Expected distinct isolated jawbone cases")
        samples[name] = sample
    if set(samples) != set(EXPECTED):
        raise ValueError("Require 50/100 and both neutral exports")
    return samples


def validate_diagnostics(*, diagnostics):
    if set(diagnostics) != {"before", "after", "jianying"}:
        raise ValueError("Require all three export sets")
    for side in diagnostics.values():
        if side["neutralDriftMeanRGB"] != 0 or not side["consistentColorContract"]:
            raise ValueError("Neutral drift or mismatched color contract")


def validate_improvement(*, records):
    if [record["value"] for record in records] != [50, 100]:
        raise ValueError("Require both jawbone strengths")
    for record in records:
        old, new = record["before"], record["after"]
        numbers = [old["deltaMae"], new["deltaMae"], old["deltaCosine"], new["deltaCosine"]]
        if any(value is None or not math.isfinite(value) for value in numbers):
            raise ValueError("Require finite nonzero effect comparisons")
        if new["deltaMae"] >= old["deltaMae"] or new["deltaCosine"] <= old["deltaCosine"]:
            raise ValueError("Jawbone reference agreement did not improve at both strengths")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before", type=Path, help="Old QCut report.json")
    parser.add_argument("after", type=Path, help="New QCut report.json")
    parser.add_argument("jianying", type=Path, help="Jianying manifest.json")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    paths = {side: getattr(args, side) for side in ("before", "after", "jianying")}
    manifests = {side: json.loads(path.read_text()) for side, path in paths.items()}
    source = Path(manifests["after"]["source"])
    source_record = EXPORT.SKIN.fingerprint(path=source)
    cases = {side: validate_manifest(manifest=manifest, source_hash=source_record["sha256"])
             for side, manifest in manifests.items()}
    args.output.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, args.output / f"source-original{source.suffix}")
    decoded, diagnostics = {}, {}
    for side, samples in cases.items():
        decoded[side] = {}
        for name, sample in samples.items():
            path = Path(sample["exportPath"])
            if not path.is_absolute():
                path = paths[side].parent / path
            directory = args.output / side / name
            decoded[side][name] = EXPORT.decode(source=path, output=directory)
        base = EXPORT.frame(directory=args.output / side / "neutral", index=60)
        final = EXPORT.frame(directory=args.output / side / "neutral-after", index=60)
        contract = EXPORT.color_contract(stream=decoded[side]["neutral"]["stream"])
        diagnostics[side] = {
            "neutralDriftMeanRGB": EXPORT.mean_difference(left=base, right=final),
            "consistentColorContract": all(EXPORT.color_contract(stream=item["stream"]) == contract
                                           for item in decoded[side].values()),
        }
    validate_diagnostics(diagnostics=diagnostics)
    contracts = [EXPORT.color_contract(stream=decoded[side]["neutral"]["stream"]) for side in cases]
    if any(contract != contracts[0] for contract in contracts[1:]):
        raise ValueError("Color contracts differ between applications")
    old_zero = EXPORT.frame(directory=args.output / "before/neutral", index=60)
    new_zero = EXPORT.frame(directory=args.output / "after/neutral", index=60)
    if not np.array_equal(old_zero, new_zero):
        raise ValueError("QCut neutral pixels changed across the fix")
    records = []
    for value in (50, 100):
        frames, record = {}, {"value": value}
        directory = args.output / f"jawbone-{value}"
        directory.mkdir(exist_ok=True)
        for side in cases:
            baseline = EXPORT.frame(directory=args.output / side / "neutral", index=60)
            adjusted = EXPORT.frame(directory=args.output / side / f"jawbone-{value}", index=60)
            diff, measured = EXPORT.SKIN.save_side(baseline=baseline, adjusted=adjusted, output=directory, prefix=side)
            frames[side] = (baseline, adjusted, diff)
            record[f"{side}Magnitude"] = measured
        reference = SHAPE.delta(result=frames["jianying"][1], baseline=frames["jianying"][0])
        for side in ("before", "after"):
            record[side] = SHAPE.METRICS.delta_metrics(reference=reference,
                candidate=SHAPE.delta(result=frames[side][1], baseline=frames[side][0]))
        record["deltaMaeReductionFraction"] = (
            1 - record["after"]["deltaMae"] / record["before"]["deltaMae"]
            if record["before"]["deltaMae"] else None
        )
        records.append(record)
        rows = [(f"下颌骨 {value} / QCut{label}", [*frames["jianying"], frames[side][1], frames[side][2]])
                for side, label in (("before", "修复前"), ("after", "修复后"))]
        EXPORT.SKIN.render_sheet(title=f"下颌骨 {value}：开关修复前后", rows=rows,
            output=args.output / f"jawbone-{value}-before-after.png", font=SHAPE.FONT, paired=True,
            evidence_label="双端真实导出第60帧；仅改变下颌骨策略，保留滑杆与分辨率；单照片诊断。")
    report = {"source": source_record, "manifests": {side: EXPORT.SKIN.fingerprint(path=path) for side, path in paths.items()},
              "method": {"frame": 60, "gain": 6, "sigma": 0.6, "normalizedSize": [600, 900],
                         "roi": list(SHAPE.SKIN.DIFF.FACE_RECT), "losslessParity": False},
              "decoded": decoded, "diagnostics": diagnostics, "metrics": records}
    (args.output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    validate_improvement(records=records)
    print(json.dumps({"metrics": records, "diagnostics": diagnostics}, indent=2))


if __name__ == "__main__":
    main()
