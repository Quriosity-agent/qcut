#!/usr/bin/env python3
"""Compare independent Fog with immutable references from the unchanged-package Swing runner."""

import argparse
import json
import math
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "independent-soft-glow"))
from verify_reference import digest, measurements

LUT_SHA256 = "6fbe77f1043a2f1e221e97bebdf1c569d3658c5bc30c3c98719a72e4c50ff295"
PACKAGE_SHA256 = "d2557b6359b86a8305e8da48f01f84af69827009a3b4ade94d79262b54168345"
CORE_SHA256 = "0c39324edc0d8997d7c998c6a0867803b667fd40969e231a90ea502cc1e815b9"
CORE_UUID = "D6342ECD-5432-33F0-A2AD-0C28F5699994"
STRENGTHS = {0.0, 0.37, 0.5, 1.0}


def cases(manifest):
    required = ("all_fixed_time_order_process_equal", "all_changing_strength_matches_fresh_child",
                "zero_intensity_identity", "all_alpha_opaque", "all_fixed_strengths_distinct")
    if not all(manifest.get("results", {}).get(key) is True for key in required):
        raise ValueError("Native references have not passed stability and identity checks")
    if manifest["package_identity"]["sha256"] != PACKAGE_SHA256:
        raise ValueError("Native package differs from the specified Fog resource version")
    if manifest.get("core_sha256") != CORE_SHA256 or manifest.get("core_uuid") != CORE_UUID:
        raise ValueError("Native core differs from the verified D634 runtime")
    output, seen = [], set()
    for fixture in manifest["fixtures"]:
        name = fixture["name"]
        if not name or Path(name).name != name or name in {".", ".."}:
            raise ValueError("Invalid fixture name")
        width, height = fixture["width"], fixture["height"]
        if type(width) is not int or type(height) is not int or not (1 <= width <= 16384 and 1 <= height <= 16384):
            raise ValueError("Invalid fixture dimensions")
        source = Path(fixture["input"])
        if source.stat().st_size != width * height * 4 or digest(source) != fixture["input_sha256"]:
            raise ValueError("Native fixture input differs")
        source_bytes = source.read_bytes()
        strengths, hashes = set(), set()
        for reference in fixture["references"]:
            intensity = reference["intensity"]
            if type(intensity) not in (int, float) or not math.isfinite(intensity) or not 0 <= intensity <= 1:
                raise ValueError("Invalid native intensity")
            key = (name, intensity)
            if key in seen:
                raise ValueError("Duplicate native fixture/intensity")
            seen.add(key)
            raw = Path(reference["path"])
            if raw.stat().st_size != width * height * 4 or digest(raw) != reference["sha256"]:
                raise ValueError("Native reference bytes differ")
            reference_bytes = raw.read_bytes()
            if any(alpha != 255 for alpha in reference_bytes[3::4]) or any(alpha != 255 for alpha in source_bytes[3::4]):
                raise ValueError("Native input or output is not opaque")
            if intensity == 0 and reference_bytes != source_bytes:
                raise ValueError("Native zero intensity is not exact identity")
            strengths.add(intensity)
            hashes.add(reference["sha256"])
            output.append((fixture, reference))
        if strengths != STRENGTHS or len(hashes) != len(STRENGTHS):
            raise ValueError("Native fixture lacks four distinct verified strengths")
    if not output:
        raise ValueError("Native reference set is empty")
    return output


def passes(metrics, stable, intensity, exact_input):
    if intensity == 0 and not exact_input:
        return False
    return stable and metrics["rgb_mae"] <= 0.25 and metrics["rgb_max"] <= 4 and metrics["alpha_max"] == 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--executable", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--lut", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    options = parser.parse_args()
    if options.output.exists():
        raise ValueError("Use a new output directory to preserve earlier evidence")
    if digest(options.lut) != LUT_SHA256:
        raise ValueError("Supplied LUT differs from the verified top-down RGBA atlas")
    manifest = json.loads(options.manifest.read_text())
    inputs = cases(manifest)
    options.output.mkdir(parents=True)
    results = []
    for fixture, reference in inputs:
        runs = []
        for repeat in range(2):
            path = options.output / f"{fixture['name']}-{reference['intensity']}-{repeat}.rgba"
            command = [str(options.executable.resolve()), "--input", fixture["input"],
                       "--width", str(fixture["width"]), "--height", str(fixture["height"]),
                       "--intensity", str(reference["intensity"]), "--lut", str(options.lut.resolve()),
                       "--output", str(path)]
            subprocess.run(command, check=True, capture_output=True, text=True)
            runs.append({"path": str(path), "sha256": digest(path), "command": command})
        output_bytes = Path(runs[0]["path"]).read_bytes()
        metrics = measurements(output_bytes, Path(reference["path"]).read_bytes())
        stable = runs[0]["sha256"] == runs[1]["sha256"]
        exact_input = output_bytes == Path(fixture["input"]).read_bytes()
        passed = passes(metrics, stable, reference["intensity"], exact_input)
        results.append({"fixture": fixture["name"], "intensity": reference["intensity"], "metrics": metrics,
                        "stable": stable, "exact_input": exact_input, "passed": passed,
                        "runs": runs, "reference_sha256": reference["sha256"]})
        print(f"{fixture['name']} t={reference['intensity']} MAE={metrics['rgb_mae']:.6f} max={metrics['rgb_max']} passed={passed}")
    report = {"bit_exact_claim": False, "tolerance": {"rgb_mae": 0.25, "rgb_max": 4, "alpha_max": 0, "zero_exact_input": True},
              "native_manifest_sha256": digest(options.manifest), "executable_sha256": digest(options.executable),
              "lut_sha256": digest(options.lut), "results": results, "all_passed": all(row["passed"] for row in results)}
    (options.output / "metrics.json").write_text(json.dumps(report, indent=2) + "\n")
    return 0 if report["all_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
