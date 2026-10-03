"""Gate independent square crops, endpoint transforms and landmark order against the SDK.

Boxes and mapping points are supplied, not detected. This does not run an independent
landmark network, mean-face/refinement pipeline, or the editor's beauty renderer.
"""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import sys

import numpy as np

from espresso_oracle import private_path, sha256
from face_geometry import crop_pixels, crop_region, map_points, reorder_landmarks, resize_inverse
from face_geometry_native import LIBRARY, LIBRARY_SHA256, MODEL, MODEL_SHA256, NativeGeometry


PIXEL_TOLERANCE = 0.001


def compare(*, actual, expected, tolerance=0):
    if (actual.shape != expected.shape or actual.dtype != expected.dtype or not actual.size
            or not np.isfinite(actual).all() or not np.isfinite(expected).all()):
        return {"passed": False, "reason": "nonfinite, empty or incompatible arrays"}
    difference = np.abs(actual.astype(np.float64) - expected.astype(np.float64))
    return {"passed": bool((difference <= tolerance).all()), "elements": int(actual.size),
            "mismatches": int((difference > tolerance).sum()), "max_abs": float(difference.max()),
            "tolerance": tolerance}


def evaluate(*, oracle, frame, box, expansion, legacy_anchor, network_size, points):
    region = crop_region(rect=box, frame_size=(frame.shape[1], frame.shape[0]),
                         expansion=expansion, legacy_anchor=legacy_anchor)
    own_pixels = crop_pixels(frame=frame, region=region)
    native_box, native_pixels = oracle.crop(frame=frame, rect=box, expansion=expansion, legacy_anchor=legacy_anchor)
    box_check = compare(actual=np.array(region.rect, np.float32), expected=np.array(native_box, np.float32))
    pixels_check = compare(actual=own_pixels, expected=native_pixels)
    checks = {"box": box_check, "pixels": pixels_check}
    if region.size >= 2:
        own_inverse = resize_inverse(region=region, network_size=network_size)
        native_inverse, native_points = oracle.resize_mapping(rect=native_box, network_size=network_size, points=points)
        checks["matrix"] = compare(actual=own_inverse, expected=native_inverse, tolerance=PIXEL_TOLERANCE)
        checks["points"] = compare(actual=map_points(points=points, inverse=own_inverse),
                                   expected=native_points, tolerance=PIXEL_TOLERANCE)
    report = {"passed": all(check["passed"] for check in checks.values()), "box": list(box),
              "expansion": expansion, "legacy_anchor": legacy_anchor, "crop_region": list(region.rect),
              "network_size": list(network_size), "checks": checks,
              "frame_sha256": hashlib.sha256(frame.tobytes()).hexdigest(),
              "native_crop_sha256": hashlib.sha256(native_pixels.tobytes()).hexdigest(),
              "owned_crop_sha256": hashlib.sha256(own_pixels.tobytes()).hexdigest()}
    return report, native_pixels, own_pixels


def comparison_image(*, frame, native_pixels, own_pixels, out):
    from PIL import Image, ImageDraw

    difference = np.max(np.abs(native_pixels.astype(np.int16) - own_pixels.astype(np.int16)), axis=2)
    difference = np.clip(difference * 8, 0, 255).astype(np.uint8)
    tiles = [Image.fromarray(frame), Image.fromarray(native_pixels), Image.fromarray(own_pixels), Image.fromarray(difference)]
    image = Image.new("RGB", (1280, 390), "white")
    draw = ImageDraw.Draw(image)
    labels = ("Source (manual box, no detector)", "Native square crop", "Owned square crop", "Abs diff x8; black = exact")
    for index, (tile, label) in enumerate(zip(tiles, labels)):
        tile.thumbnail((310, 340))
        image.paste(tile, (index * 320 + 5, 35))
        draw.text((index * 320 + 5, 12), label, fill="black")
    image.save(out)


def run(*, out, seeds=(17, 41, 509), image=None, boxes=()):
    out = private_path(path=out)
    if out.exists():
        raise ValueError("use a fresh directory; previous geometry evidence is not overwritten")
    if not seeds or len(set(seeds)) != len(seeds):
        raise ValueError("at least one unique synthetic seed is required")
    if (image is None) != (len(boxes) == 0):
        raise ValueError("real image and at least one explicitly supplied box are required together")
    out.mkdir(parents=True)
    oracle = NativeGeometry()
    cases = {}
    reference_boxes = [(6, 4, 8, 6), (6, 4, 6, 8), (0, 0, 8, 6), (0, 0, 6, 8), (59, 37, 8, 6),
                       (61, 35, 6, 8), (-2, -3, 9, 7), (59.5, 36.5, 8.5, 6.5), (11.25, 12.75, 7.5, 8.5),
                       (4, 2, 1, 1), (0, 0, 43, 43)]
    for seed in seeds:
        rng = np.random.default_rng(seed)
        for width, height in [(67, 43), (179, 101), (384, 224)]:
            frame = rng.integers(0, 256, (height, width, 3), dtype=np.uint8)
            for index, rect in enumerate(reference_boxes):
                box = tuple(float(value * ratio) for value, ratio in zip(rect, (width / 67, height / 43) * 2))
                network_size = [(120, 120), (160, 160), (120, 160)][index % 3]
                points = rng.uniform(-0.25, 1.25, (106, 2)).astype(np.float32) * (np.array(network_size) - 1)
                points[:4] = [[0, 0], [network_size[0] - 1, network_size[1] - 1],
                              [(network_size[0] - 1) / 2, (network_size[1] - 1) / 2], [1, 1]]
                points = points.astype(np.float32)
                for factor in (1.0, 1.25, 1.4, 1.5, 2.0):
                    for legacy in (False, True):
                        name = f"seed-{seed}-{width}x{height}-box-{index}-factor-{factor}-legacy-{int(legacy)}"
                        report, _, _ = evaluate(oracle=oracle, frame=frame, box=box, expansion=factor,
                                                legacy_anchor=legacy, network_size=network_size, points=points)
                        cases[name] = report
        print(f"synthetic seed {seed}: {sum(name.startswith(f'seed-{seed}-') for name in cases)} cases", flush=True)
    source = None
    if image is not None:
        from PIL import Image

        with Image.open(image) as original:
            frame = np.asarray(original.convert("RGB"))
        source = {"path": str(Path(image).resolve()), "sha256": sha256(path=image),
                  "size": [frame.shape[1], frame.shape[0]], "box_origin": "manual, not detector output"}
        for index, box in enumerate(boxes):
            for factor in (1.0, 1.4, 1.5):
                points = np.array([[0, 0], [119, 119], [59.5, 59.5], [17.37, 52.28]], np.float32)
                report, native, own = evaluate(oracle=oracle, frame=frame, box=box, expansion=factor,
                                               legacy_anchor=False, network_size=(120, 120), points=points)
                name = f"portrait-box-{index}-factor-{factor}"
                cases[name] = report
                if report["checks"]["pixels"]["passed"]:
                    comparison_image(frame=frame, native_pixels=native, own_pixels=own, out=out / f"{name}.png")
    order = oracle.landmark_order()
    np.save(out / "initialized-landmark-order.npy", order)
    oracle.build_reorder_probe(binary=out / "landmark-shim.dylib")
    ordering = {}
    for name, points in [("ramp", np.arange(212, dtype=np.float32).reshape(106, 2)),
                         *((f"seed-{seed}", np.random.default_rng(seed).normal(0, 2, (106, 2)).astype(np.float32))
                           for seed in seeds)]:
        expected = reorder_landmarks(raw_pairs=points, destinations=order)
        for optimized in (False, True):
            actual = oracle.reorder(raw_pairs=points, optimized=optimized)
            ordering[f"{name}-optimized-{int(optimized)}"] = compare(actual=actual, expected=expected)
    summary = {"passed": all(case["passed"] for case in cases.values()) and all(check["passed"] for check in ordering.values()),
               "scope": "supplied boxes / points only; no detector decoding, network inference, mean-face, refinement or editor",
               "runtime": {"path": str(LIBRARY), "sha256": LIBRARY_SHA256},
               "initialization_model": {"path": str(MODEL), "sha256": MODEL_SHA256},
               "versions": {"python": sys.version, "numpy": np.__version__, "platform": platform.platform()},
               "seeds": list(seeds), "source": source, "crop_cases": len(cases),
               "mapping_cases": sum("points" in case["checks"] for case in cases.values()),
               "max_mapping_pixel_error": max(case["checks"]["points"]["max_abs"]
                                               for case in cases.values() if "points" in case["checks"]),
               "landmark_order_sha256": sha256(path=out / "initialized-landmark-order.npy"),
               "ordering": ordering, "cases": cases}
    (out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps({key: summary[key] for key in ("passed", "crop_cases", "mapping_cases", "max_mapping_pixel_error")}), flush=True)
    if not summary["passed"]:
        raise ValueError("geometry parity gate failed; see private summary.json")
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--image", type=Path)
    parser.add_argument("--box", action="append", type=lambda value: tuple(float(v) for v in value.split(",")), default=[])
    arguments = parser.parse_args()
    run(out=arguments.out, image=arguments.image, boxes=arguments.box)


if __name__ == "__main__":
    main()
