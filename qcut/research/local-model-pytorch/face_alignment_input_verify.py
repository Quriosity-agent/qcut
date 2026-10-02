"""Trace the original crop/resize/alignment-input chain with stage controls.

Reference pixels and inference come from the original SDK. Candidate formulas
only diagnose individual stages; there is no portable alignment replacement.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from espresso_oracle import private_path, sha256
from espresso_preprocess_probe import separable_bilinear_truncating
from face_alignment_input_native import NativeAlignmentInput
from face_geometry_native import LIBRARY_SHA256, MODEL_SHA256


def difference(*, actual, expected):
    if (actual.shape != expected.shape or actual.dtype != expected.dtype
            or not actual.size or not np.isfinite(actual).all() or not np.isfinite(expected).all()):
        return {"exact": False, "reason": "shape, type, empty or nonfinite result"}
    delta = np.abs(actual.astype(np.float64) - expected.astype(np.float64))
    return {"exact": bool(np.array_equal(actual, expected)), "elements": int(actual.size),
            "mismatches": int(np.count_nonzero(delta)), "max_abs": float(delta.max())}


def resize_candidates(*, crop, network_size):
    width, height = network_size
    # Reciprocal evaluation changes floor at exact-looking integer boundaries.
    rows = np.floor(np.arange(height) * (1 / (height / crop.shape[0]))).astype(int)
    columns = np.floor(np.arange(width) * (1 / (width / crop.shape[1]))).astype(int)
    nearest = crop[rows[:, None], columns]
    linear = separable_bilinear_truncating(crop.astype(np.float64), width, height).astype(np.uint8)
    return nearest, linear


def evidence_passed(*, report):
    checks = ("crop_box", "staged_original_resize", "resize_formula", "network_input",
              "repeat_input", "repeat_raw_landmarks")
    expected_raw = [2, 6] if report.get("size") == 120 else [1, 6]
    return (report.get("size") in (120, 160) and report.get("raw") == expected_raw
            and report.get("repeat_raw_equal") is True
            and all(report.get(check, {}).get("exact") is True for check in checks))


def visual(*, crop, resized, candidate, actual, output):
    resize_delta = np.max(np.abs(candidate.astype(np.int16) - resized.astype(np.int16)), axis=2)
    input_delta = np.max(np.abs(actual.astype(np.int16) - resized.astype(np.int16)), axis=2)
    resize_gray = np.clip(resize_delta * 8, 0, 255).astype(np.uint8)
    input_gray = np.clip(input_delta * 8, 0, 255).astype(np.uint8)
    canvas = Image.new("RGB", (1440, 350), "white")
    draw = ImageDraw.Draw(canvas)
    for index, (name, pixels) in enumerate((("Original SDK crop", crop), ("Original SDK resize", resized),
                                          ("Sampling formula", candidate), ("Resize abs difference x8", resize_gray),
                                          ("Actual network input +128", actual), ("Input abs difference x8", input_gray))):
        tile = Image.fromarray(pixels)
        tile.thumbnail((230, 285))
        canvas.paste(tile, (index * 240 + 5, 35))
        draw.text((index * 240 + 5, 8), name, fill="black")
    draw.text((5, 327), "SDK stage probe, not Jianying GUI/export or final beauty output", fill="black")
    canvas.save(output)


def case(*, native, frame, rect, size, expansion, allow_upscale, legacy_anchor, directory):
    directory.mkdir()
    request = dict(frame=frame, rect=rect, network_size=(size, size), expansion=expansion,
                   allow_upscale=allow_upscale, legacy_anchor=legacy_anchor)
    crop_box, crop = native.detector.geometry.crop(frame=frame, rect=rect, expansion=expansion,
                                                   legacy_anchor=legacy_anchor)
    full_box, pixels = native.prepare(**request)
    _, staged = native.prepare(frame=crop, rect=(0, 0, crop.shape[1], crop.shape[0]),
                               network_size=(size, size), expansion=1, allow_upscale=allow_upscale)
    inputs, raw, landmarks = native.infer(pixels=pixels)
    repeated_inputs, repeated_raw, repeated_landmarks = native.infer(pixels=pixels)
    nearest, linear = resize_candidates(crop=crop, network_size=(size, size))
    selected = linear if allow_upscale and crop.shape[0] < size else nearest
    tensor_formula = (pixels.astype(np.int16) - 128).astype(inputs.dtype)[None]
    report = {"size": size, "expansion": expansion, "allow_upscale": allow_upscale,
              "legacy_anchor": legacy_anchor, "rect": list(map(float, rect)), "crop": list(crop_box),
              "frame_sha256": hashlib.sha256(frame.tobytes()).hexdigest(), "raw": list(raw),
              "crop_box": difference(actual=np.array(full_box), expected=np.array(crop_box)),
              "staged_original_resize": difference(actual=staged, expected=pixels),
              "resize_formula": difference(actual=selected, expected=pixels),
              "network_input": difference(actual=tensor_formula, expected=inputs),
              "repeat_input": difference(actual=repeated_inputs, expected=inputs),
              "repeat_raw_landmarks": difference(actual=repeated_landmarks, expected=landmarks),
              "repeat_raw_equal": raw == repeated_raw,
              "observed_resize": "linear-7bit-two-truncations" if allow_upscale and crop.shape[0] < size else "nearest-floor",
              "nearest_candidate": difference(actual=nearest, expected=pixels),
              "linear_candidate": difference(actual=linear, expected=pixels)}
    report["passed"] = evidence_passed(report=report)
    Image.fromarray(crop).save(directory / "original-crop.png")
    Image.fromarray(pixels).save(directory / "original-resize.png")
    np.save(directory / "actual-network-input.npy", inputs)
    np.save(directory / "actual-raw-landmarks.npy", landmarks)
    report["input_sha256"] = sha256(path=directory / "actual-network-input.npy")
    report["landmarks_sha256"] = sha256(path=directory / "actual-raw-landmarks.npy")
    recovered = np.clip(inputs[0].astype(np.int16) + 128, 0, 255).astype(np.uint8)
    visual(crop=crop, resized=pixels, candidate=selected, actual=recovered, output=directory / "stages.png")
    (directory / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def requests():
    for seed in (17, 41, 509):
        frame = np.random.default_rng(seed).integers(0, 256, (257, 257, 3), dtype=np.uint8)
        for size in (120, 160):
            boxes = ((10, 10, 59, 59, 1), (10, 10, size - 1, size - 1, 1),
                     (10, 10, size, size, 1), (10, 10, size + 1, size + 1, 1),
                     (0, 0, 31, 40, 1.5), (-10, 10, 59, 60, 1.5),
                     (13.25, 12.75, 44.5, 55.25, 1.4), (10, 10, 220, 220, 1.5))
            for box in boxes:
                for allow_upscale in (False, True):
                    for legacy_anchor in (False, True):
                        yield {"name": f"seed-{seed}", "frame": frame, "rect": box[:4], "size": size,
                               "expansion": box[4], "allow_upscale": allow_upscale, "legacy_anchor": legacy_anchor}


def run(*, output, image):
    output = private_path(path=output)
    if output.exists():
        raise ValueError("refusing to overwrite prior alignment input evidence")
    if not Path(image).is_file():
        raise ValueError("an existing portrait fixture is required")
    portrait = np.asarray(Image.open(image).convert("RGB"))
    if not all(32 <= value <= 4096 for value in portrait.shape[:2]):
        raise ValueError("portrait dimensions exceed detector probe limits")
    output.mkdir(parents=True)
    reports = []
    with NativeAlignmentInput(output=output / "oracle") as native:
        controls = list(requests())
        boxes, _, _, detector_size, _ = native.detector.detect(frame=portrait)
        if not 1 <= len(boxes) <= 10:
            raise ValueError("portrait fixture must produce bounded nonempty original detector boxes")
        for box in boxes:
            for size in (120, 160):
                for allow_upscale in (False, True):
                    controls.append({"name": "portrait", "frame": portrait, "rect": box, "size": size,
                                     "expansion": 1.5, "allow_upscale": allow_upscale, "legacy_anchor": False})
        for index, request in enumerate(controls):
            name = request.pop("name")
            report = case(native=native, directory=output / f"case-{index:03d}", **request)
            report["fixture"] = name
            reports.append(report)
    summary = {"scope": "initialized original SDK submodule calls with explicit branch flags",
               "editor_changed": False, "independent_alignment_backend": False,
               "runtime_sha256": LIBRARY_SHA256, "model_sha256": MODEL_SHA256,
               "portrait_sha256": sha256(path=image), "portrait_detector_size": detector_size,
               "cases": reports, "passed": bool(reports) and all(item["passed"] for item in reports),
               "unverified": ["full host branch routing", "rotated/mean-face warp", "raw landmark units and Stage2",
                              "historical rendered frame reconstruction", "tracking and final beauty render"]}
    (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    args = parser.parse_args()
    report = run(output=args.out, image=args.image)
    print(json.dumps({"passed": report["passed"], "cases": len(report["cases"])}))
    raise SystemExit(0 if report["passed"] else 1)


if __name__ == "__main__":
    main()
