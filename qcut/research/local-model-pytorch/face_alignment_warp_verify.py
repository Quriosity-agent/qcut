"""Stage evidence for original point fitting, image warp and network input.

Synthetic point pairs and explicit portrait transforms isolate stages. They
do not establish the host's actual landmark/mean-face selection or routing.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from espresso_oracle import private_path, sha256
from face_alignment_input_native import NativeAlignmentInput
from face_alignment_input_verify import difference
from face_alignment_warp_native import FORMATS, NativeAlignmentWarp, validate_fit
from face_geometry_native import LIBRARY_SHA256, MODEL_SHA256


def similarity_witness(*, source, mean):
    source, mean = validate_fit(source=source, mean=mean)
    source, mean = source.astype(np.float64), mean.astype(np.float64)
    center, target_center = source.mean(axis=0), mean.mean(axis=0)
    centered, target = source - center, mean - target_center
    denominator = np.sum(centered * centered)
    a = np.sum(centered * target) / denominator
    b = np.sum(centered[:, 0] * target[:, 1] - centered[:, 1] * target[:, 0]) / denominator
    linear = np.array([[a, -b], [b, a]])
    return np.column_stack((linear, target_center - linear @ center)).astype(np.float32)


def map_witness(*, points, matrix):
    return (np.asarray(points, np.float32) @ matrix[:, :2].T + matrix[:, 2]).astype(np.float32)


def near(*, actual, expected, tolerance):
    result = difference(actual=actual, expected=expected)
    result["within"] = "max_abs" in result and result["max_abs"] <= tolerance
    return result


def geometry_passed(*, report):
    return (report.get("count") in (2, 7, 106)
            and all(report.get(key, {}).get("within") is True
                    for key in ("matrix_witness", "inverse_witness", "point_mapping", "roundtrip"))
            and all(report.get(key, {}).get("exact") is True for key in ("repeat_forward", "repeat_inverse")))


def raster_passed(*, report):
    size = report.get("size")
    raw = [2, 6] if size == 120 else [1, 6]
    checks = ("staged_color", "repeat_pixels", "network_input", "repeat_input", "repeat_raw_landmarks")
    return (size in (120, 160) and isinstance(report.get("mode"), str) and report["mode"] in FORMATS
            and type(report.get("fused")) is bool
            and "integer_control" in report and report.get("raw") == raw and report.get("repeat_raw_equal") is True
            and all(report.get(key, {}).get("exact") is True for key in checks)
            and (report.get("integer_control") is None or report["integer_control"].get("exact") is True))


def geometry_cases():
    rng = np.random.default_rng(812)
    for count in (2, 7, 106):
        source = rng.uniform(10, 300, (count, 2)).astype(np.float32)
        for angle in (-35, 0, 25, 90):
            radians = np.deg2rad(angle)
            for scale in (0.6, 1.0, 1.7):
                matrix = np.array([[scale * np.cos(radians), -scale * np.sin(radians), -13.25],
                                   [scale * np.sin(radians), scale * np.cos(radians), 29.5]], np.float32)
                for noise in (0, 0.3):
                    mean = map_witness(points=source, matrix=matrix)
                    mean += rng.normal(0, noise, mean.shape).astype(np.float32)
                    yield source, mean, {"count": count, "angle": angle, "scale": scale, "noise": noise}


def geometry_case(*, warp, source, mean, detail):
    forward, inverse = warp.fit(source=source, mean=mean)
    mapped = warp.points(points=source)
    roundtrip = warp.points(points=mapped, original=True)
    expected = similarity_witness(source=source, mean=mean)
    inverse_expected = np.linalg.inv(np.vstack((expected, [0, 0, 1])))[:2].astype(np.float32)
    repeated, repeated_inverse = warp.fit(source=source, mean=mean)
    report = {**detail, "matrix_witness": near(actual=forward, expected=expected, tolerance=0.001),
              "inverse_witness": near(actual=inverse, expected=inverse_expected, tolerance=0.001),
              "point_mapping": near(actual=mapped, expected=map_witness(points=source, matrix=forward), tolerance=0.002),
              "roundtrip": near(actual=roundtrip, expected=source, tolerance=0.002),
              "repeat_forward": difference(actual=repeated, expected=forward),
              "repeat_inverse": difference(actual=repeated_inverse, expected=inverse),
              "forward": forward.tolist(), "inverse": inverse.tolist()}
    report["passed"] = geometry_passed(report=report)
    return report


def color_witness(*, pixels, mode):
    if mode in ("RGB", "RGBA"):
        return pixels[:, :, :3][:, :, ::-1].copy()
    return pixels[:, :, :3].copy()


def integer_witness(*, frame, matrix, size):
    if not (np.array_equal(matrix[:, :2], np.eye(2)) and np.array_equal(matrix[:, 2], np.round(matrix[:, 2]))):
        return None
    columns = np.arange(size) - int(matrix[0, 2])
    rows = np.arange(size) - int(matrix[1, 2])
    valid = (rows[:, None] >= 0) & (rows[:, None] < frame.shape[0]) & (columns >= 0) & (columns < frame.shape[1])
    pixels = frame[np.clip(rows, 0, frame.shape[0] - 1)[:, None], np.clip(columns, 0, frame.shape[1] - 1)].copy()
    pixels[~valid] = 0
    return pixels


def visual(*, frame, raw, expected, prepared, recovered, mode, output):
    delta = np.max(np.abs(prepared.astype(np.int16) - expected.astype(np.int16)), axis=2)
    input_delta = np.max(np.abs(recovered.astype(np.int16) - prepared.astype(np.int16)), axis=2)
    source = frame[:, :, :3][:, :, ::-1] if mode in ("BGR", "BGRA") else frame
    raw_rgb = raw[:, :, :3][:, :, ::-1] if mode in ("BGR", "BGRA") else raw
    tiles = (("Source (explicit controls)", source), ("Original SDK warp", raw_rgb),
             ("Prepared BGR shown as RGB", prepared[:, :, ::-1]), ("Warp/prepared diff x8", np.clip(delta * 8, 0, 255).astype(np.uint8)),
             ("Network input recovered", recovered[:, :, ::-1]), ("Input diff x8", np.clip(input_delta * 8, 0, 255).astype(np.uint8)))
    canvas = Image.new("RGB", (1440, 350), "white")
    draw = ImageDraw.Draw(canvas)
    for index, (label, pixels) in enumerate(tiles):
        tile = Image.fromarray(pixels).convert("RGB")
        tile.thumbnail((230, 285))
        canvas.paste(tile, (index * 240 + 5, 35))
        draw.text((index * 240 + 5, 8), label, fill="black")
    draw.text((5, 327), "Original SDK stage controls, not Jianying GUI/export or final beauty output", fill="black")
    canvas.save(output)


def raster_case(*, native, warp, frame, mode, matrix, size, fused, directory):
    directory.mkdir()
    warp.set_matrix(matrix=matrix)
    raw_pixels = warp.warp_raw(frame=frame, mode=mode, size=(size, size))
    expected = color_witness(pixels=raw_pixels, mode=mode)
    fallback = warp.prepare(frame=frame, mode=mode, size=(size, size), fused=False)
    pixels = warp.prepare(frame=frame, mode=mode, size=(size, size), fused=fused)
    repeated = warp.prepare(frame=frame, mode=mode, size=(size, size), fused=fused)
    inputs, raw, landmarks = native.infer(pixels=pixels)
    repeat_input, repeat_raw, repeat_landmarks = native.infer(pixels=pixels)
    control = integer_witness(frame=frame, matrix=matrix, size=size)
    tensor_expected = (pixels.astype(np.int16) - 128).astype(inputs.dtype)[None]
    report = {"size": size, "mode": mode, "fused": fused, "raw": list(raw), "matrix": matrix.tolist(),
              "frame_sha256": hashlib.sha256(frame.tobytes()).hexdigest(),
              "staged_color": difference(actual=fallback, expected=expected),
              "fused_vs_fallback": difference(actual=pixels, expected=fallback),
              "integer_control": None if control is None else difference(actual=pixels, expected=color_witness(pixels=control, mode=mode)),
              "repeat_pixels": difference(actual=repeated, expected=pixels),
              "network_input": difference(actual=inputs, expected=tensor_expected),
              "repeat_input": difference(actual=repeat_input, expected=inputs),
              "repeat_raw_landmarks": difference(actual=repeat_landmarks, expected=landmarks),
              "repeat_raw_equal": raw == repeat_raw}
    report["passed"] = raster_passed(report=report)
    for name, pixels_to_save in (("original-warp", raw_pixels), ("prepared-bgr", pixels)):
        np.save(directory / f"{name}.npy", pixels_to_save)
    np.save(directory / "actual-network-input.npy", inputs)
    np.save(directory / "actual-raw-landmarks.npy", landmarks)
    report["input_sha256"] = sha256(path=directory / "actual-network-input.npy")
    report["landmarks_sha256"] = sha256(path=directory / "actual-raw-landmarks.npy")
    recovered = np.clip(inputs[0].astype(np.int16) + 128, 0, 255).astype(np.uint8)
    visual(frame=frame, raw=raw_pixels, expected=expected, prepared=pixels, recovered=recovered,
           mode=mode, output=directory / "stages.png")
    (directory / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def encoded_frame(*, rgb, mode):
    pixels = rgb[:, :, ::-1].copy() if mode in ("BGR", "BGRA") else rgb
    if mode in ("RGBA", "BGRA"):
        alpha = ((np.indices(rgb.shape[:2]).sum(axis=0) * 17) % 256).astype(np.uint8)
        return np.dstack((pixels, alpha))
    return pixels


def raster_cases():
    rng = np.random.default_rng(502)
    rgb = rng.integers(0, 256, (177, 189, 3), dtype=np.uint8)
    matrices = [("identity", np.array([[1, 0, 0], [0, 1, 0]], np.float32)),
                ("integer-border", np.array([[1, 0, 11], [0, 1, -7]], np.float32)),
                ("scale", np.array([[0.65, 0, 3.25], [0, 0.65, -5.5]], np.float32))]
    for angle in (-25, 20, 90):
        r = np.deg2rad(angle)
        matrices.append((f"rotate-{angle}", np.array([[np.cos(r), -np.sin(r), 27.25],
                                                     [np.sin(r), np.cos(r), -11.5]], np.float32)))
    for name, matrix in matrices:
        for size in (120, 160):
            for mode in ("RGB", "BGR", "RGBA", "BGRA"):
                for fused in ((False, True) if mode == "RGBA" else (False,)):
                    yield {"fixture": name, "frame": encoded_frame(rgb=rgb, mode=mode), "matrix": matrix,
                           "size": size, "mode": mode, "fused": fused}


def run(*, output, image):
    output = private_path(path=output)
    if output.exists():
        raise ValueError("refusing to overwrite prior warp evidence")
    if not Path(image).is_file():
        raise ValueError("existing portrait fixture required")
    with Image.open(image) as picture:
        if not all(32 <= value <= 4096 for value in picture.size):
            raise ValueError("portrait dimensions exceed probe limits")
        portrait = np.asarray(picture.convert("RGB"))
    output.mkdir(parents=True)
    geometry, rasters = [], []
    with NativeAlignmentInput(output=output / "oracle") as native, NativeAlignmentWarp(native=native) as warp:
        for source, mean, detail in geometry_cases():
            geometry.append(geometry_case(warp=warp, source=source, mean=mean, detail=detail))
        (output / "geometry-results.json").write_text(json.dumps(geometry, indent=2) + "\n")
        boxes, _, _, detector_size, _ = native.detector.detect(frame=portrait)
        if len(boxes) != 1:
            raise ValueError("portrait probe requires one original detected face")
        box = boxes[0]
        controls = list(raster_cases())
        for size in (120, 160):
            center = np.array([box[0] + box[2] / 2, box[1] + box[3] / 2])
            for angle in (-20, 0, 20):
                r, scale = np.deg2rad(angle), size / (1.5 * max(box[2:]))
                linear = scale * np.array([[np.cos(r), -np.sin(r)], [np.sin(r), np.cos(r)]])
                matrix = np.column_stack((linear, np.array([size / 2, size / 2]) - linear @ center)).astype(np.float32)
                for mode, fused in (("RGB", False), ("RGBA", False), ("RGBA", True)):
                    controls.append({"fixture": f"portrait-{angle}", "frame": encoded_frame(rgb=portrait, mode=mode),
                                     "matrix": matrix, "size": size, "mode": mode, "fused": fused})
        for index, request in enumerate(controls):
            fixture = request.pop("fixture")
            report = raster_case(native=native, warp=warp, directory=output / f"case-{index:03d}", **request)
            report["fixture"] = fixture
            rasters.append(report)
    fused_reports = [item for item in rasters if item["fused"]]
    fused_parity = bool(fused_reports) and all(item["fused_vs_fallback"]["exact"] for item in fused_reports)
    summary = {"scope": "original SDK submodule calls with explicit point/affine controls",
               "editor_changed": False, "independent_alignment_backend": False,
               "runtime_sha256": LIBRARY_SHA256, "model_sha256": MODEL_SHA256,
               "loaded_bytenn": warp.runtime, "fused_parity": {"passed": fused_parity, "cases": len(fused_reports)},
               "portrait_sha256": sha256(path=image), "portrait_detector_size": detector_size,
               "portrait_box": list(map(float, box)), "geometry": geometry, "rasters": rasters,
               "passed": bool(geometry) and bool(rasters) and fused_parity and all(item["passed"] for item in geometry + rasters),
               "unverified": ["host mean-face selection and branch routing", "landmark units and Stage2",
                              "general sampling formula", "video tracking and final beauty render"]}
    (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    args = parser.parse_args()
    report = run(output=args.out, image=args.image)
    print(json.dumps({"passed": report["passed"], "geometry": len(report["geometry"]), "rasters": len(report["rasters"])}))
    raise SystemExit(0 if report["passed"] else 1)


if __name__ == "__main__":
    main()
