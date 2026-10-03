"""Compare owned decoding, live native frames and the converted detector chain.

All evidence is private. Live-frame cases run the detector, not the full editor
or landmark pipeline. Captured-input cases separately exercise PyTorch/ONNX.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from espresso_oracle import private_path, sha256
from face_detector import decode, frame_rectangles, suppress_ordered
from face_detector_native import NativeDetector
from face_geometry import crop_pixels, crop_region
from face_geometry_native import LIBRARY, LIBRARY_SHA256, MODEL, MODEL_SHA256


def parameters(*, profile):
    return {name: profile[name] for name in ("strides", "minimum_sizes", "confidence", "before", "after", "iou")}


def compare(*, actual, expected):
    if (actual.shape != expected.shape or actual.ndim != 2 or actual.shape[1] != 5
            or not np.isfinite(actual).all() or not np.isfinite(expected).all()):
        return {"passed": False, "reason": "shape mismatch or nonfinite result",
                "actual_shape": list(actual.shape), "expected_shape": list(expected.shape)}
    maximum = float(np.abs(actual - expected).max()) if actual.size else 0
    coordinates = bool(np.array_equal(actual[:, :4], expected[:, :4]))
    return {"passed": coordinates and maximum <= 1e-6, "count": len(actual),
            "exact_coordinates": coordinates, "max_abs": maximum}


def synthetic_cases(*, native):
    cases = []
    for seed in (17, 41, 509):
        rng = np.random.default_rng(seed)
        for size in ((32, 32), (64, 64), (73, 49), (49, 73)):
            for bins in (1, 8):
                for fraction in (2, 4, 6):
                    regression, scores = [], []
                    pool = rng.permutation(np.arange(-128, 32, dtype=np.int16)).astype(np.int8)
                    cursor = 0
                    for stride in native.profile["strides"]:
                        h, w = (size[1] + stride - 1) // stride, (size[0] + stride - 1) // stride
                        regression.append((rng.integers(-16, 100, size=(h, w, 4 * bins), dtype=np.int8), fraction))
                        scores.append((pool[cursor:cursor + h * w].reshape(h, w, 1), fraction))
                        cursor += h * w
                    heads = regression + scores
                    expected = native.decode(heads=heads, image_size=size)
                    actual = decode(heads=heads, image_size=size, **parameters(profile=native.profile))
                    cases.append({"seed": seed, "size": size, "bins": bins, "fraction": fraction,
                                  **compare(actual=actual, expected=expected)})
    return cases


def nms_cases(*, native):
    rng = np.random.default_rng(509)
    cases = []
    for index in range(300):
        count = index % 73
        origin = rng.integers(0, 80, size=(count, 2)).astype(np.float32)
        end = origin + rng.integers(0, 30, size=(count, 2)).astype(np.float32)
        scores = np.linspace(.99, .1, count, dtype=np.float32)
        boxes = np.column_stack((origin, end, scores)).astype(np.float32)
        before, after = index % 91 + 1, index % 13 + 1
        threshold = (0, .1, .3, .5, 1)[index % 5]
        expected = native.nms(boxes=boxes, before=before, after=after, threshold=threshold)
        actual = suppress_ordered(boxes=boxes, before=before, after=after, threshold=threshold)
        cases.append({"case": index, **compare(actual=actual, expected=expected)})
    return cases


def tied_score_cases(*, native):
    cases = []
    for size in ((128, 128), (320, 320)):
        rng = np.random.default_rng(41)
        regressions, scores = [], []
        for stride in native.profile["strides"]:
            h, w = size[1] // stride, size[0] // stride
            regressions.append((np.full((h, w, 4), 16, dtype=np.int8), 4))
            scores.append((rng.choice(np.array([-16, 0, 16], dtype=np.int8), size=(h, w, 1)), 4))
        heads = regressions + scores
        expected = native.decode(heads=heads, image_size=size)
        actual = decode(heads=heads, image_size=size, **parameters(profile=native.profile))
        cases.append({"size": size, "native_count": len(expected), "owned_count": len(actual),
                      "known_boundary": "equal-score proposal ordering differs from native unstable sort",
                      **compare(actual=actual, expected=expected)})
    return cases


def visual(*, frame, native_boxes, owned_boxes, crops, output):
    source = Image.fromarray(frame)
    canvas = Image.new("RGB", (1280, 780), "white")
    draw = ImageDraw.Draw(canvas)
    for index, (label, boxes) in enumerate((("Original", []), ("Native detector", native_boxes), ("Owned decode", owned_boxes))):
        tile = source.copy()
        overlay = ImageDraw.Draw(tile)
        for x, y, w, h in boxes:
            overlay.rectangle((x, y, x + w - 1, y + h - 1), outline="red", width=4)
        tile.thumbnail((410, 350))
        x = index * 425 + 5
        draw.text((x, 8), label, fill="black")
        canvas.paste(tile, (x, 30))
    draw.text((5, 385), "Actual detected boxes -> square crops; abs difference x8 (black = exact)", fill="black")
    for index, (expected, actual) in enumerate(crops[:2]):
        difference = np.clip(np.abs(expected.astype(np.int16) - actual.astype(np.int16)) * 8, 0, 255).astype(np.uint8)
        for column, pixels in enumerate((expected, actual, difference)):
            tile = Image.fromarray(pixels)
            tile.thumbnail((200, 320))
            canvas.paste(tile, (5 + index * 640 + column * 210, 415))
    draw.text((5, 752), "SDK detector probe, not Jianying GUI/export or completed landmark alignment", fill="black")
    canvas.save(output)


def frame_case(*, native, name, frame, expected_faces, out):
    boxes, scores, heads, size, scales = native.detect(frame=frame)
    proposals = native.decode(heads=heads, image_size=size)
    owned = decode(heads=heads, image_size=size, **parameters(profile=native.profile))
    mapped = frame_rectangles(boxes=owned, scales=scales)
    native_mapped = frame_rectangles(boxes=proposals, scales=scales)
    crop_checks, crops = [], []
    if mapped.shape == boxes.shape and np.array_equal(mapped, boxes):
        for box in mapped:
            native_rect, expected = native.geometry.crop(frame=frame, rect=box, expansion=1.5)
            region = crop_region(rect=box, frame_size=(frame.shape[1], frame.shape[0]), expansion=1.5)
            actual = crop_pixels(frame=frame, region=region)
            crop_checks.append({"passed": region.rect == native_rect and np.array_equal(actual, expected),
                                "region": region.rect, "elements": int(actual.size)})
            crops.append((expected, actual))
    report = {"name": name, "frame_sha256": hashlib.sha256(frame.tobytes()).hexdigest(),
              "size": size, "scales": scales, "native_rectangles": boxes.tolist(),
              "owned_rectangles": mapped.tolist(), "head_decode": compare(actual=owned, expected=proposals),
              "full_detector_rectangles": compare(actual=np.column_stack((mapped, owned[:, 4])),
                                                    expected=np.column_stack((boxes, scores))),
              "native_decoder_mapping": bool(np.array_equal(native_mapped, boxes)), "crops": crop_checks,
              "head_shapes": [list(value.shape) for value, _ in heads],
              "expected_faces": expected_faces, "fixture_face_count_matches": len(boxes) == expected_faces}
    report["passed"] = (report["head_decode"]["passed"] and report["full_detector_rectangles"]["passed"]
                        and report["native_decoder_mapping"] and len(crop_checks) == len(boxes)
                        and all(check["passed"] for check in crop_checks))
    visual(frame=frame, native_boxes=boxes, owned_boxes=mapped, crops=crops, output=out / f"{name}.png")
    return report


def converted_case(*, native, network, capture, onnx_path):
    import torch
    from espresso_integer_export import capture_case, session
    from espresso_integer_torch import load

    torch.set_num_threads(1)
    model = load(directory=network)
    record = capture_case(capture=capture, graph_digest=sha256(path=network / "graph.txt"),
                          descriptors=model.graph["descriptors"])
    shapes = {name: value.shape for name, (value, _) in record["inputs"].items()}
    model = load(directory=network, input_shapes=shapes)
    feed = {name: value.astype(np.int64) for name, (value, _) in record["inputs"].items()}
    with torch.no_grad():
        pytorch = dict(zip(model.output_names, (v.numpy() for v in model(*(torch.from_numpy(feed[n]) for n in model.input_names)))))
    runner = session(path=onnx_path)
    onnx = dict(zip((o.name for o in runner.get_outputs()), runner.run(None, feed)))
    names = native.profile["regression_names"] + native.profile["score_names"]
    expected = record["outputs"]
    if not set(names) <= set(expected) or not set(names) <= set(onnx):
        raise ValueError("converted model or capture is missing detector heads")
    storage = model.graph["descriptors"]
    size = (next(iter(feed.values())).shape[2], next(iter(feed.values())).shape[1])
    def heads_for(*, values):
        result = []
        for name in names:
            value = values[name]
            if not np.issubdtype(value.dtype, np.integer) or (value < -128).any() or (value > 127).any():
                raise ValueError("converted int8 output is out of range")
            result.append((value[0].astype(np.int8), storage[name]["fraction"]))
        return result
    reference = native.decode(heads=heads_for(values={n: expected[n][0] for n in names}), image_size=size)
    checks = {}
    for label, values in (("pytorch", pytorch), ("onnx", onnx)):
        checks[label] = compare(actual=decode(heads=heads_for(values=values), image_size=size,
                                             **parameters(profile=native.profile)), expected=reference)
        checks[label]["exact_heads"] = all(np.array_equal(values[n], expected[n][0]) for n in names)
        checks[label]["passed"] &= checks[label]["exact_heads"]
    return {"passed": all(c["passed"] for c in checks.values()), "checks": checks,
            "input_files": record["files"], "onnx_sha256": sha256(path=onnx_path),
            "graph_sha256": sha256(path=network / "graph.txt"), "arena_sha256": sha256(path=network / "arena.bin"),
            "native_proposals": reference.tolist(), "scope": "captured model input -> PyTorch/ONNX -> independent boxes"}


def run(*, out, portrait, frame=None, network=None, capture=None, onnx_path=None):
    out = private_path(path=out)
    if out.exists():
        raise ValueError("use a fresh evidence directory")
    if any(v is not None for v in (network, capture, onnx_path)) and not all(v is not None for v in (network, capture, onnx_path)):
        raise ValueError("network, capture and ONNX must be supplied together")
    source = np.array(Image.open(portrait).convert("RGB"))
    out.mkdir(parents=True)
    summary = {"runtime": str(LIBRARY), "runtime_sha256": LIBRARY_SHA256,
               "model": str(MODEL), "model_sha256": MODEL_SHA256,
               "portrait": str(portrait.resolve()), "portrait_sha256": sha256(path=portrait)}
    with NativeDetector(binary=out / "bridge.dylib") as native:
        summary["profile"] = native.profile
        summary["proposals"] = synthetic_cases(native=native)
        summary["nms"] = nms_cases(native=native)
        summary["tied_scores"] = tied_score_cases(native=native)
        fixtures = [("portrait", source, 1), ("portrait-mirror", source[:, ::-1].copy(), 1),
                    ("blank", np.zeros((320, 320, 3), dtype=np.uint8), 0)]
        small = np.array(Image.fromarray(source).resize((640, 480)))
        fixtures.append(("two-portraits", np.concatenate((small, small[:, ::-1]), axis=1), 2))
        if frame is not None:
            pixels = np.fromfile(frame, dtype=np.uint8)
            if pixels.size != 1280 * 720 * 4:
                raise ValueError("historical fixture must be 1280x720 RGBA")
            fixtures.append(("historical-frame", pixels.reshape(720, 1280, 4)[..., :3].copy(), 2))
            summary["frame_sha256"] = sha256(path=frame)
        summary["frames"] = [frame_case(native=native, name=name, frame=pixels, expected_faces=count, out=out)
                             for name, pixels, count in fixtures]
        if network is not None:
            summary["converted"] = converted_case(native=native, network=network, capture=capture, onnx_path=onnx_path)
    summary["controls_passed"] = (all(case["passed"] for key in ("proposals", "nms", "frames") for case in summary[key])
                                  and summary.get("converted", {"passed": True})["passed"])
    summary["passed"] = summary["controls_passed"] and all(case["passed"] for case in summary["tied_scores"])
    summary["fixture_face_counts_match"] = all(case["fixture_face_count_matches"] for case in summary["frames"])
    summary["scope"] = "numerical parity, not face-detection accuracy or editor beauty acceptance"
    (out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps({"passed": summary["passed"], "controls_passed": summary["controls_passed"],
                      "summary": str(out / "summary.json"),
                      "fixture_face_counts_match": summary["fixture_face_counts_match"],
                      "converted": summary.get("converted", {}).get("checks"),
                      "failed": {key: [case for case in summary[key] if not case["passed"]]
                                 for key in ("proposals", "nms", "frames", "tied_scores")}}, indent=2))
    return summary["passed"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for name in ("out", "portrait", "frame", "network", "capture", "onnx"):
        parser.add_argument(f"--{name}", type=Path, required=name in ("out", "portrait"))
    args = parser.parse_args()
    raise SystemExit(0 if run(out=args.out, portrait=args.portrait, frame=args.frame,
                             network=args.network, capture=args.capture, onnx_path=args.onnx) else 1)
