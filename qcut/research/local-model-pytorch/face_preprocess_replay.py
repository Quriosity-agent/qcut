"""Independent pixels from actual algorithm RGBA and observed caller parameters.

Recorded source/crop/resize/tensors are comparison oracles, never producer inputs.
The detector's Rect and branch selection remain native; this is not a live backend.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image

from face_alignment_replay import LockedFiles, valid_hash
from face_alignment_input_verify import difference, resize_candidates
from face_geometry import crop_region, crop_pixels
from face_host_geometry_contract import validate_sequence
import face_preprocess_probe as capture
import face_render_sequence_probe as sequence
from face_render_stability_probe import digest

SOURCE_NAMES = ("face_preprocess_replay.py", "face_geometry.py", "face_alignment_input_verify.py",
                "espresso_preprocess_probe.py", "face_alignment_replay.py")


def prepare(*, frame, call):
    if (not isinstance(frame, np.ndarray) or frame.dtype != np.uint8 or frame.ndim != 3 or
            frame.shape[2] != 4 or not all(1 <= side <= 4096 for side in frame.shape[:2]) or
            frame.nbytes > 16 * 1024**2 or not isinstance(call, dict)):
        raise ValueError("bounded uint8 algorithm RGBA and observed call required")
    if (type(call.get("format")) is not int or call["format"] != 0 or
            type(call.get("orientation")) is not int or call["orientation"] != 0 or
            not isinstance(call.get("target"), list) or call["target"] != [160, 160] or
            any(type(value) is not int for value in call["target"])):
        raise ValueError("only observed format-0/orientation-0/160 profile is accepted")
    flags = call.get("flags")
    if (not isinstance(flags, list) or len(flags) != 3 or
            any(type(value) is not int or value not in (0, 1) for value in flags) or flags[2] != 0):
        raise ValueError("typed observed flags required; allocator-flag-1 profile unverified")
    rect = call.get("rect")
    if not isinstance(rect, dict) or not isinstance(rect.get("values"), list) or len(rect["values"]) != 4:
        raise ValueError("observed pre-crop Rect required, not an inverse-derived Rect")
    if any(type(value) not in (int, float) or not np.isfinite(value) for value in rect["values"]):
        raise ValueError("finite typed pre-crop Rect required")
    expansion = call.get("expansion")
    if type(expansion) not in (int, float) or not np.isfinite(expansion) or not 0 < expansion <= 4:
        raise ValueError("finite bounded actual expansion required")
    source = np.ascontiguousarray(frame[:, :, :3][:, :, ::-1])
    region = crop_region(rect=rect["values"], frame_size=(frame.shape[1], frame.shape[0]),
                         expansion=expansion, legacy_anchor=bool(flags[1]))
    if region.size * region.size * 3 > 16 * 1024**2:
        raise ValueError("generated crop exceeds blob budget")
    crop = crop_pixels(frame=source, region=region)
    nearest, linear = resize_candidates(crop=crop, network_size=(160, 160))
    use_linear = flags[0] == 1 and crop.shape[0] < 160
    resized = np.ascontiguousarray(linear if use_linear else nearest)
    tensor = (resized.astype(np.int16) - 128).astype(np.int8)[None]
    return dict(source=source, crop=crop, resized=resized, tensor=tensor,
                post_crop_rect=list(region.rect), resize="linear" if use_linear else "nearest")


def oracle_blob(*, capture_dir, prediction, stage, row, locked):
    name = f"prediction-{prediction:02d}-{stage}.bgr"
    if row.get("file") != name:
        raise ValueError("oracle blob name does not match prediction/stage")
    if not valid_hash(value=row.get("sha256")):
        raise ValueError("explicit oracle blob hash required")
    data = locked.read(path=capture_dir / "trace" / name, maximum=16 * 1024**2, expected=row["sha256"])
    if len(data) != row["rows"] * row["cols"] * 3:
        raise ValueError("oracle blob dimensions mismatch")
    return np.frombuffer(data, np.uint8).reshape(row["rows"], row["cols"], 3)


def run(*, args):
    out, locked = sequence.fresh_output(path=args.out), LockedFiles()
    report = dict(passed=False, diagnostic_only=True, captured_pixel_input_used=False,
                  native_caller_parameters_required=True, native_algorithm_rgba_required=True,
                  independent_full_frame_preprocessing=False, arbitrary_frame_backend_connected=False,
                  product_parity_verified=False, cases=[], failures=[])
    try:
        root = args.capture.resolve(strict=True)
        evidence = locked.json(path=root / "report.json")
        if (evidence.get("passed") is not True or evidence.get("observer_pixel_parity_verified") is not True or
                evidence.get("diagnostic_only") is not True):
            raise ValueError("passed neutral actual preprocessing capture required")
        for name, expected in evidence["fixture_sha256"].items():
            locked.read(path=Path(name), maximum=128 * 1024**2, expected=expected)
        records = validate_sequence(records=evidence["geometry_snapshots"], temporal=True)
        cases = capture.validate_trace(trace=evidence["trace"], records=records,
                                       associations=evidence["prediction_inferences"])
        if not isinstance(cases, list) or len(cases) != 2:
            raise ValueError("exact two nonempty lifecycle cases required")
        descriptors = evidence.get("algorithm_frames")
        if not isinstance(descriptors, list) or len(descriptors) != 26:
            raise ValueError("all actual algorithm RGBA hashes required")
        report["capture_report_sha256"] = digest(data=locked.read(path=root / "report.json"))
        for name in SOURCE_NAMES:
            locked.read(path=Path(__file__).with_name(name), maximum=1024**2)
        for case in cases:
            prediction, event = case["prediction"], case["event"]
            snapshot, descriptor = records[prediction], descriptors[prediction]
            if descriptor["prediction"] != prediction or descriptor["file"] != f"frame-{prediction}.rgba":
                raise ValueError("algorithm RGBA descriptor association mismatch")
            _, width, height, stride, orientation = snapshot["request"]
            if stride != width * 4 or orientation != 0:
                raise ValueError("algorithm RGBA layout/profile unverified")
            pixels = locked.read(path=root / "geometry" / descriptor["file"], maximum=16 * 1024**2,
                                 expected=descriptor["sha256"])
            frame = np.frombuffer(pixels, np.uint8).reshape(height, width, 4)
            produced = prepare(frame=frame, call=event["call"])
            checks = {}
            for stage in ("source", "crop", "resized"):
                reference = oracle_blob(capture_dir=root, prediction=prediction, stage=stage,
                                        row=event[stage], locked=locked)
                checks[stage] = difference(actual=produced[stage], expected=reference)
                Image.fromarray(produced[stage][:, :, ::-1]).save(out / f"prediction-{prediction:02d}-{stage}.png")
            checks["post_crop_rect"] = dict(exact=produced["post_crop_rect"] == event["post_crop_rect"]["values"])
            network = evidence["captures"]["networks"][str(event["network"])]
            rows = [row for row in network["inputs"] if row["inference"] == case["inference"] and row["name"] == "data"]
            if len(rows) != 1 or rows[0]["raw"] != [1, 6] or rows[0]["dims_nwhc"] != [1, 160, 160, 3]:
                raise ValueError("one actual int8 160 comparison tensor required")
            actual = np.frombuffer(locked.read(path=Path(rows[0]["path"]), maximum=76800,
                                              expected=rows[0]["sha256"]), np.int8).reshape(1, 160, 160, 3)
            checks["tensor"] = difference(actual=produced["tensor"], expected=actual)
            result = dict(prediction=prediction, face_id=case["face_id"], checks=checks,
                          resize=produced["resize"], input_rect=event["call"]["rect"]["values"],
                          generated_rect=produced["post_crop_rect"],
                          generated_tensor_sha256=digest(data=produced["tensor"].tobytes()))
            result["passed"] = all(row["exact"] for row in checks.values())
            report["cases"].append(result)
        if not all(row["passed"] for row in report["cases"]):
            raise ValueError("independent preprocessing differs; no replacement returned")
        report["passed"] = True
    except Exception as error:
        report["failures"].append(f"{type(error).__name__}: {error}")
        raise
    finally:
        active_error = sys.exc_info()[1]
        try:
            locked.verify()
        except Exception as error:
            report["passed"] = False
            report["failures"].append(f"guard {type(error).__name__}: {error}")
            if active_error is None:
                raise
        finally:
            report["fixture_sha256"] = dict(locked.files)
            (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("capture", "out"):
        parser.add_argument(f"--{name}", required=True, type=Path)
    report = run(args=parser.parse_args())
    print(json.dumps(dict(passed=report["passed"], cases=report["cases"])))


if __name__ == "__main__":
    main()
