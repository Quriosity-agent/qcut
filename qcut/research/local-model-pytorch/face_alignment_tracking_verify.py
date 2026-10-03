"""Original tracking-cache gate and controlled 160 -> 120 -> original-point chain.

This isolates original operators, not the full host tracking/quality pipeline.
Vendor tables, actual tensors and portraits stay in ignored private evidence.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from espresso_oracle import private_path, sha256
from face_alignment_decode_native import NativeAlignmentDecode
from face_alignment_decode_verify import stage1_witness
from face_alignment_input_native import NativeAlignmentInput
from face_alignment_input_verify import difference
from face_alignment_warp_native import NativeAlignmentWarp, TRACKING_ANCHORS, validate_tracking
from face_alignment_warp_verify import map_witness, near, similarity_witness
from face_geometry_native import LIBRARY_SHA256, MODEL_SHA256


EXACT_CHECKS = ("input", "decoder", "stage1", "repeat_input", "repeat_raw", "repeat_stage1",
                "repeat_pixels", "cache_copy", "gate_cache_unchanged")
NEAR_CHECKS = ("fit", "backmap", "roundtrip")


def anchor_witness(*, points):
    values, _ = validate_tracking(points=points)
    a, b, c, d = TRACKING_ANCHORS
    return np.stack(((values[a] + values[b]) / np.float32(2),
                     (values[c] + values[d]) / np.float32(2)))


def gate_witness(*, points, cached, threshold=0.1):
    values, threshold = validate_tracking(points=points, threshold=threshold)
    if cached is None:
        return True
    previous = anchor_witness(points=cached)
    current = anchor_witness(points=values)
    delta = current - previous
    lengths = np.sqrt(delta[:, 0] * delta[:, 0] + delta[:, 1] * delta[:, 1])
    movement = lengths[0] / np.float32(2) + lengths[1] / np.float32(2)
    span = previous[0] - previous[1]
    reference = np.sqrt(span[0] * span[0] + span[1] * span[1]) / np.float32(2)
    if float(reference) <= 1e-6:
        return True
    return bool(movement / reference >= threshold)


def target_witness(*, mean):
    values = np.asarray(mean, np.float32)
    if values.shape != (106, 2) or not np.isfinite(values).all() or (values < 0).any() or (values > 256).any():
        raise ValueError("bounded base reference required")
    return (values.astype(np.float64) / 256 * 120).astype(np.float32)


def synthetic_seed():
    points = np.random.default_rng(460).uniform(-50, 150, (106, 2)).astype(np.float32)
    points[[55, 58]] = [0, 0]
    points[[84, 90]] = [100, 0]
    return points


def gate_controls(*, source):
    for dy in (0, 1, 4, np.nextafter(np.float32(5), np.float32(0)), 5,
               np.nextafter(np.float32(5), np.float32(10)), 6, -4, -5, -6):
        yield f"translate-y-{dy}", source + np.array([0, dy], np.float32)
    for dx in (1, 4, 5, 6, -4, -5, -6):
        yield f"translate-x-{dx}", source + np.array([dx, 0], np.float32)
    for index in (0, 20, 54, 55, 58, 84, 90, 105):
        changed = source.copy()
        changed[index, 1] += 24
        yield f"point-{index}", changed
    changed = source.copy()
    changed[55, 1], changed[58, 1] = 24, -24
    yield "pair-cancel", changed
    for angle in (1, 5, 15, 30, 60, 90):
        radians = np.deg2rad(angle)
        matrix = np.array([[np.cos(radians), -np.sin(radians), 0],
                           [np.sin(radians), np.cos(radians), 0]], np.float32)
        yield f"rotate-{angle}", map_witness(points=source, matrix=matrix)


def check_gate(*, warp, points, cached, name):
    actual = warp.needs_update(points=points)
    anchors = difference(actual=warp.anchors(points=points), expected=anchor_witness(points=points))
    unchanged = difference(actual=warp.cached_points(), expected=cached)
    expected = gate_witness(points=points, cached=cached)
    return {"name": name, "actual": actual, "expected": expected, "anchors": anchors,
            "cache_unchanged": unchanged,
            "passed": actual == expected and anchors["exact"] and unchanged["exact"]}


def gate_cases(*, warp):
    source = synthetic_seed()
    first = warp.needs_update(points=source)
    if first is not True:
        raise ValueError("original fresh transform did not request fitting")
    warp.fit(source=source, mean=source)
    copied = difference(actual=warp.cached_points(), expected=source)
    reports = [check_gate(warp=warp, points=points, cached=source, name=name)
               for name, points in gate_controls(source=source)]
    for span in (0, 1e-6, 2e-6, 3e-6):
        tiny = source.copy()
        tiny[[84, 90]] = [span, 0]
        warp.fit(source=tiny, mean=tiny)
        reports.append(check_gate(warp=warp, points=tiny, cached=tiny, name=f"reference-span-{span}"))
    warp.fit(source=source, mean=source)
    cached, sequence = source.copy(), []
    for displacement in range(1, 11):
        points = source + np.array([0, displacement], np.float32)
        report = check_gate(warp=warp, points=points, cached=cached, name=f"sequence-{displacement}")
        if report["actual"]:
            warp.fit(source=points, mean=source)
            cached = points.copy()
        report["post_fit_cache"] = difference(actual=warp.cached_points(), expected=cached)
        report["passed"] = report["passed"] and report["post_fit_cache"]["exact"]
        sequence.append(report)
    changed = source.copy()
    changed[0] += [200, -100]
    original, _ = warp.fit(source=source, mean=source)
    ignored = not warp.needs_update(points=changed)
    updated, _ = warp.fit(source=changed, mean=source)
    full_fit_changed = not np.array_equal(updated, original)
    return {"first_fit": first, "initial_cache_copy": copied, "cases": reports, "sequence": sequence,
            "nonanchor_ignored_by_gate": ignored, "nonanchor_changes_full_fit": full_fit_changed,
            "passed": first and copied["exact"] and ignored and full_fit_changed
                      and all(report["passed"] for report in (*reports, *sequence))}


def chain_passed(*, report):
    return (type(report.get("optimized")) is bool and type(report.get("step")) is int and report["step"] in (1, 2)
            and report.get("threshold") == 0.0 and type(report.get("threshold")) is float
            and type(report.get("confidence")) is float and np.isfinite(report["confidence"])
            and report.get("repeat_confidence") == report["confidence"]
            and all(report.get(key, {}).get("exact") is True for key in EXACT_CHECKS)
            and all(report.get(key, {}).get("within") is True for key in NEAR_CHECKS))


def visual(*, frame, pixels, actual, expected, output):
    background = Image.fromarray(frame)
    background.thumbnail((320, 350))
    factor = background.width / frame.shape[1]
    overlays = []
    for points in (actual, expected):
        tile = background.copy()
        draw = ImageDraw.Draw(tile)
        for x, y in points * factor:
            draw.ellipse((float(x - 1), float(y - 1), float(x + 1), float(y + 1)), fill="lime")
        overlays.append(tile)
    delta = np.max(np.abs(np.asarray(overlays[0]).astype(np.int16) - np.asarray(overlays[1]).astype(np.int16)), axis=2)
    tiles = (background, Image.fromarray(pixels[:, :, ::-1]).resize((320, 320)), *overlays,
             Image.fromarray(np.clip(delta * 8, 0, 255).astype(np.uint8)))
    labels = ("Generated source portrait", "Original 120 aligned block", "Original SDK inverse points",
              "Diagnostic inverse points", "Overlay difference x8")
    canvas = Image.new("RGB", (1650, 420), "white")
    draw = ImageDraw.Draw(canvas)
    for index, (tile, label) in enumerate(zip(tiles, labels, strict=True)):
        canvas.paste(tile, (index * 330 + 5, 35))
        draw.text((index * 330 + 5, 8), label, fill="black")
    draw.text((5, 400), "Controlled original operators; threshold=0; no host temporal filter, Stage2 or final beauty parity", fill="black")
    canvas.save(output)


def chain_case(*, native, oracle, warp, frame, source, optimized, step, directory):
    directory.mkdir()
    target = target_witness(mean=oracle.means["base"])
    forward, inverse = warp.fit(source=source, mean=target)
    cached = warp.cached_points()
    warp.needs_update(points=source)
    gate_cache = warp.cached_points()
    pixels = warp.prepare(frame=frame, mode="RGB", size=(120, 120), fused=False)
    repeated_pixels = warp.prepare(frame=frame, mode="RGB", size=(120, 120), fused=False)
    inputs, raw, decoded, points, confidence = oracle.run_phase(pixels=pixels, optimized=optimized)
    repeated_input, repeated_raw, _, repeated_points, repeated_confidence = oracle.run_phase(pixels=pixels, optimized=optimized)
    expected_decode, expected_points = stage1_witness(raw_pairs=raw, mean=oracle.means["base"], order=oracle.order, size=120)
    actual = warp.points(points=points, original=True)
    expected = map_witness(points=expected_points, matrix=inverse)
    checks = (("input", inputs, (pixels.astype(np.int16) - 128).astype(inputs.dtype)[None]),
              ("decoder", decoded, expected_decode), ("stage1", points, expected_points),
              ("repeat_input", repeated_input, inputs), ("repeat_raw", repeated_raw, raw),
              ("repeat_stage1", repeated_points, points), ("repeat_pixels", repeated_pixels, pixels),
              ("cache_copy", cached, source), ("gate_cache_unchanged", gate_cache, cached))
    report = {"step": step, "optimized": optimized, "threshold": 0.0,
              "confidence": confidence, "repeat_confidence": repeated_confidence,
              **{key: difference(actual=value, expected=control) for key, value, control in checks},
              "fit": near(actual=forward, expected=similarity_witness(source=source, mean=target), tolerance=0.001),
              "backmap": near(actual=actual, expected=expected, tolerance=0.002),
              "roundtrip": near(actual=warp.points(points=actual), expected=points, tolerance=0.002),
              "wrong_residual_backmap": difference(actual=warp.points(points=decoded, original=True), expected=actual)}
    for name, values in (("source-points", source), ("target", target), ("forward", forward), ("inverse", inverse),
                         ("prepared-bgr", pixels), ("network-input", inputs), ("raw", raw), ("stage1", points),
                         ("original-points", actual), ("witness-points", expected)):
        path = directory / f"{name}.npy"
        np.save(path, values)
        report[name + "_sha256"] = sha256(path=path)
    report["passed"] = chain_passed(report=report)
    visual(frame=frame, pixels=pixels, actual=actual, expected=expected, output=directory / "stages.png")
    (directory / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    return actual, report


def seed_case(*, native, oracle, pixels, crop, optimized, directory):
    directory.mkdir()
    inputs, raw, decoded, points, confidence = oracle.run_phase(pixels=pixels, optimized=optimized)
    expected_decode, expected_points = stage1_witness(raw_pairs=raw, mean=oracle.means["base"], order=oracle.order, size=160)
    inverse, source = native.detector.geometry.resize_mapping(rect=crop, network_size=(160, 160), points=points)
    report = {"optimized": optimized, "crop": list(crop), "threshold": 0.0, "confidence": confidence,
              "input": difference(actual=inputs, expected=(pixels.astype(np.int16) - 128).astype(inputs.dtype)[None]),
              "decoder": difference(actual=decoded, expected=expected_decode),
              "stage1": difference(actual=points, expected=expected_points),
              "backmap": near(actual=source, expected=map_witness(points=expected_points, matrix=inverse), tolerance=0.002)}
    for name, values in (("prepared-bgr", pixels), ("network-input", inputs), ("raw", raw),
                         ("stage1", points), ("inverse", inverse), ("original-points", source)):
        path = directory / f"{name}.npy"
        np.save(path, values)
        report[name + "_sha256"] = sha256(path=path)
    report["passed"] = all(report[key]["exact"] for key in ("input", "decoder", "stage1")) and report["backmap"]["within"]
    (directory / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    return source, report


def run(*, output, image):
    output = private_path(path=output)
    if output.exists():
        raise ValueError("refusing to overwrite prior tracking evidence")
    if not Path(image).is_file():
        raise ValueError("existing portrait fixture required")
    with Image.open(image) as picture:
        if not all(32 <= value <= 4096 for value in picture.size):
            raise ValueError("portrait dimensions exceed probe limits")
        portrait = np.asarray(picture.convert("RGB"))
    output.mkdir(parents=True)
    reports, seeds = [], []
    with NativeAlignmentInput(output=output / "oracle") as native, NativeAlignmentWarp(native=native) as warp:
        oracle = NativeAlignmentDecode(native=native, output=output / "decode")
        gates = gate_cases(warp=warp)
        boxes, _, _, _, _ = native.detector.detect(frame=portrait)
        if len(boxes) != 1:
            raise ValueError("controlled tracking probe requires one detected face")
        for expansion in (1.2, 1.5, 1.8):
            crop, pixels = native.prepare(frame=portrait[:, :, ::-1].copy(), rect=boxes[0],
                                         network_size=(160, 160), expansion=expansion)
            for optimized in (False, True):
                source, seed = seed_case(native=native, oracle=oracle, pixels=pixels, crop=crop, optimized=optimized,
                                         directory=output / f"seed-{len(seeds):03d}")
                seeds.append({"expansion": expansion, **seed})
                for step in (1, 2):
                    source, report = chain_case(native=native, oracle=oracle, warp=warp, frame=portrait, source=source,
                                               optimized=optimized, step=step, directory=output / f"case-{len(reports):03d}")
                    reports.append({"expansion": expansion, **report})
    summary = {"scope": "original cache gate and controlled base alignment/backmap; not full host tracking",
               "editor_changed": False, "independent_backend": False, "gates": gates, "seeds": seeds, "cases": reports,
               "runtime_sha256": LIBRARY_SHA256, "model_sha256": MODEL_SHA256,
               "loaded_bytenn": warp.runtime, "portrait_sha256": sha256(path=image),
               "passed": gates["passed"] and len(seeds) == 6 and len(reports) == 12
                         and all(report["passed"] for report in (*seeds, *reports)),
               "unverified": ["full FaceAlignmentTracking entry and temporal-filtered input",
                              "optimized tracking outer routing", "host quality acceptance",
                              "enhanced/partial-face routing", "Stage2/iris", "real video tracking", "final beauty render"]}
    (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    args = parser.parse_args()
    summary = run(output=args.out, image=args.image)
    print(json.dumps({"passed": summary["passed"], "gate_cases": len(summary["gates"]["cases"]),
                      "sequence": len(summary["gates"]["sequence"]), "chains": len(summary["cases"]), "output": str(args.out)}))
    return 0 if summary["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
