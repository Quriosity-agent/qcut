"""Original Stage1 tensor -> point ordering -> baseline addition evidence.

Original mean tables and tensor dumps remain private. Public tests use only
synthetic tables; this does not claim automatic host alignment or beauty parity.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from espresso_oracle import private_path, sha256
from face_alignment_decode_native import NativeAlignmentDecode
from face_alignment_input_native import NativeAlignmentInput
from face_alignment_input_verify import difference
from face_geometry import reorder_landmarks
from face_geometry_native import LIBRARY_SHA256, MODEL_SHA256


CHECKS = ("input", "raw_decoder", "baseline", "direct_input", "direct_raw", "repeat_input",
          "repeat_raw", "repeat_decoder", "repeat_phase")


def stage1_witness(*, raw_pairs, mean, order, size):
    reference = np.asarray(mean, np.float32)
    if (type(size) is not int or size not in (120, 160) or reference.shape != (106, 2)
            or not np.isfinite(reference).all() or (reference < 0).any() or (reference > 256).any()):
        raise ValueError("bounded Stage1 mean and profile required")
    decoded = reorder_landmarks(raw_pairs=raw_pairs, destinations=order)
    if size == 160:
        return decoded, decoded.copy()
    # Preserve the measured double-precision addition before rounding to float32.
    points = (decoded.astype(np.float64) + reference.astype(np.float64) / 256 * size).astype(np.float32)
    return decoded, points


def evidence_passed(*, report):
    size = report.get("size")
    return (type(size) is int and size in (120, 160) and type(report.get("optimized")) is bool
            and report.get("branch") == ("base-residual" if size == 120 else "detection-coordinate")
            and report.get("threshold") == 0.0 and type(report.get("threshold")) is float
            and type(report.get("confidence")) is float and np.isfinite(report["confidence"])
            and report.get("repeat_confidence") == report["confidence"]
            and all(report.get(key, {}).get("exact") is True for key in CHECKS))


def visual(*, pixels, actual, expected, output, size):
    background = Image.fromarray(pixels[:, :, ::-1]).resize((320, 320), Image.Resampling.NEAREST)
    overlays = []
    for points, color in ((actual, "lime"), (expected, "lime")):
        overlay = background.copy()
        draw = ImageDraw.Draw(overlay)
        for x, y in points * np.float32(320 / size):
            draw.ellipse((float(x - 2), float(y - 2), float(x + 2), float(y + 2)), fill=color)
        overlays.append(overlay)
    delta = np.max(np.abs(np.asarray(overlays[0]).astype(np.int16) - np.asarray(overlays[1]).astype(np.int16)), axis=2)
    tiles = (background, *overlays, Image.fromarray(np.clip(delta * 8, 0, 255).astype(np.uint8)))
    labels = ("Prepared BGR shown as RGB", "Original SDK Stage1", "Diagnostic reconstruction", "Overlay difference x8")
    canvas = Image.new("RGB", (1320, 385), "white")
    draw = ImageDraw.Draw(canvas)
    for index, (tile, label) in enumerate(zip(tiles, labels, strict=True)):
        canvas.paste(tile, (330 * index + 5, 30))
        draw.text((330 * index + 5, 8), label, fill="black")
    draw.text((5, 363), "Explicit SDK controls; quality threshold=0; no Stage2, host routing or final beauty parity", fill="black")
    canvas.save(output)


def alternative_diagnostics(*, raw, decoded, expected, oracle, size):
    baseline = oracle.means["base"].astype(np.float64) / 256
    controls = {"gather_instead_scatter": raw[oracle.order]}
    if size == 120:
        controls.update({"missing_mean": decoded,
                         "wrong_size_minus_one": (decoded.astype(np.float64) + baseline * (size - 1)).astype(np.float32),
                         "wrong_tracking_mean": (decoded.astype(np.float64) + oracle.means["tracking"].astype(np.float64) / 256 * size).astype(np.float32),
                         "mean_before_order": reorder_landmarks(raw_pairs=(raw.astype(np.float64) + baseline * size).astype(np.float32), destinations=oracle.order)})
    else:
        controls["unnecessary_mean"] = (decoded.astype(np.float64) + baseline * size).astype(np.float32)
    return {name: difference(actual=values, expected=decoded if name == "gather_instead_scatter" else expected)
            for name, values in controls.items()}


def case(*, native, oracle, pixels, size, optimized, fixture, directory):
    directory.mkdir()
    direct_input, _, direct_raw = native.infer(pixels=pixels)
    inputs, raw, decoded, points, confidence = oracle.run_phase(pixels=pixels, optimized=optimized)
    repeat_input, repeat_raw, repeat_decoded, repeat_points, repeat_confidence = oracle.run_phase(pixels=pixels, optimized=optimized)
    expected_decode, expected_points = stage1_witness(raw_pairs=raw, mean=oracle.means["base"], order=oracle.order, size=size)
    expected_input = (pixels.astype(np.int16) - 128).astype(inputs.dtype)[None]
    comparisons = (("input", inputs, expected_input), ("raw_decoder", decoded, expected_decode),
                   ("baseline", points, expected_points), ("direct_input", inputs, direct_input),
                   ("direct_raw", raw, direct_raw.reshape(106, 2)), ("repeat_input", repeat_input, inputs),
                   ("repeat_raw", repeat_raw, raw), ("repeat_decoder", repeat_decoded, decoded),
                   ("repeat_phase", repeat_points, points))
    report = {"fixture": fixture, "size": size, "optimized": optimized, "threshold": 0.0,
              "branch": "base-residual" if size == 120 else "detection-coordinate",
              "confidence": confidence, "repeat_confidence": repeat_confidence,
              **{name: difference(actual=actual, expected=expected) for name, actual, expected in comparisons},
              "alternative_diagnostics": alternative_diagnostics(raw=raw, decoded=decoded, expected=expected_points, oracle=oracle, size=size)}
    arrays = {"prepared-bgr": pixels, "actual-network-input": inputs, "actual-raw-landmarks": raw,
              "original-decoded": decoded, "original-phase": points, "witness-phase": expected_points}
    for name, values in arrays.items():
        path = directory / f"{name}.npy"
        np.save(path, values)
        report[name + "_sha256"] = sha256(path=path)
    report["passed"] = evidence_passed(report=report)
    visual(pixels=pixels, actual=points, expected=expected_points, output=directory / "stages.png", size=size)
    (directory / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def synthetic_controls():
    rng = np.random.default_rng(749)
    for size in (120, 160):
        rows, columns = np.indices((size, size))
        for name, pixels in (("black", np.zeros((size, size, 3), np.uint8)),
                             ("neutral", np.full((size, size, 3), 128, np.uint8)),
                             ("white", np.full((size, size, 3), 255, np.uint8)),
                             ("ramp", np.stack((columns % 256, rows % 256, (columns + rows) % 256), axis=2).astype(np.uint8)),
                             ("noise", rng.integers(0, 256, (size, size, 3), dtype=np.uint8))):
            for optimized in (False, True):
                yield {"pixels": pixels, "size": size, "optimized": optimized, "fixture": name}


def run(*, output, image):
    output = private_path(path=output)
    if output.exists():
        raise ValueError("refusing to overwrite prior decode evidence")
    if not Path(image).is_file():
        raise ValueError("existing portrait fixture required")
    with Image.open(image) as picture:
        if not all(32 <= value <= 4096 for value in picture.size):
            raise ValueError("portrait dimensions exceed probe limits")
        portrait = np.asarray(picture.convert("RGB"))
    output.mkdir(parents=True)
    reports = []
    with NativeAlignmentInput(output=output / "oracle") as native:
        oracle = NativeAlignmentDecode(native=native, output=output / "decode")
        boxes, _, _, _, _ = native.detector.detect(frame=portrait)
        if len(boxes) != 1:
            raise ValueError("portrait decode probe requires one detected face")
        controls = list(synthetic_controls())
        for size in (120, 160):
            for expansion in (1.2, 1.5, 1.8):
                _, pixels = native.prepare(frame=portrait[:, :, ::-1].copy(), rect=boxes[0],
                                           network_size=(size, size), expansion=expansion)
                for optimized in (False, True):
                    controls.append({"pixels": pixels, "size": size, "optimized": optimized,
                                     "fixture": f"portrait-crop-{expansion}"})
        for name, values in (*oracle.means.items(), ("order", oracle.order)):
            np.save(output / f"original-{name}.npy", values)
        for index, request in enumerate(controls):
            reports.append(case(native=native, oracle=oracle, directory=output / f"case-{index:03d}", **request))
        pixels = controls[-1]["pixels"]
        rejection = False
        try:
            oracle.run_phase(pixels=pixels, optimized=False, threshold=0.5)
        except ValueError as error:
            if "rejected the input" not in str(error):
                raise
            rejection = True
    summary = {"scope": "original Stage1 decode, explicit detection/base controls; not host routing",
               "editor_changed": False, "independent_backend": False,
               "runtime_sha256": LIBRARY_SHA256, "model_sha256": MODEL_SHA256,
               "loaded_bytenn": oracle.runtime, "portrait_sha256": sha256(path=image),
               "means": {name: sha256(path=output / f"original-{name}.npy") for name in oracle.means},
               "order_is_identity": bool(np.array_equal(oracle.order, np.arange(106))),
               "quality_gate_rejection_control": rejection, "cases": reports,
               "passed": len(reports) == 32 and all(item["passed"] for item in reports) and rejection,
               "unverified": ["actual automatic selected mean/points/angle", "enhanced tracking and part-face",
                              "nonidentity original order direction", "Stage2 and iris refinement",
                              "actual host quality acceptance", "final beauty render"]}
    (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    args = parser.parse_args()
    summary = run(output=args.out, image=args.image)
    print(json.dumps({"passed": summary["passed"], "cases": len(summary["cases"]), "output": str(args.out)}))
    return 0 if summary["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
