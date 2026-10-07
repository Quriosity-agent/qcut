"""Photo -> research 106 points -> TotalFace mesh -> independent PNG rendering."""
import argparse
import hashlib
import json
from pathlib import Path
import time

import numpy as np
from PIL import Image

from facefitting_image import decode_image
from facefitting_infer import native_images
from face_shape_controls import mesh_active, validate_controls
from face_shape_assets import load_assets as load_shape_assets
from mesh_raster import render_mesh
from slimface_detection import single_face_prediction
from slimface_geometry import validate_intensity
from slimface_mesh import generate_mesh
from slimface_mesh_assets import load_assets
from slimface_render import validate_rgba


def run(*, rgba, intensity, output, report, assets_path, fixed_request=None, controls=None, shape_assets_path=None):
    started = time.monotonic()
    validate_rgba(rgba=rgba)
    intensity = validate_intensity(intensity=intensity)
    if controls is not None and intensity != 0:
        raise ValueError("controls and legacy intensity cannot both be supplied")
    values = validate_controls(values={"TotalFace": intensity} if controls is None else controls)
    active = mesh_active(values=values)
    mesh_info = None
    alignment = None
    pose = {"yaw": 0, "pitch": 0, "source": "zero-bypass"}
    if not active:
        result = rgba.copy()
        diagnostics = {"changed_pixel_count": 0, "triangle_count": 0,
                       "uncovered_pixel_count": 0, "maximum_sampling_displacement_px": 0,
                       "zero_bypass": True}
    else:
        size = [rgba.shape[1], rgba.shape[0]]
        if fixed_request is not None and fixed_request["size"] != size:
            raise ValueError("fixed landmark request dimensions do not match the image")
        if fixed_request is None:
            prediction = single_face_prediction(rgba=rgba)
            points = np.asarray(prediction["points"], np.float32)
            alignment = {key: value for key, value in prediction.items() if key != "points"}
            pose = prediction["consumer_pose"]
        else:
            points = np.asarray(fixed_request["points"], np.float32)
            pose = {"yaw": fixed_request.get("yaw", 0), "pitch": fixed_request.get("pitch", 0),
                    "source": "fixed-request"}
        assets = load_assets(path=assets_path)
        shape_assets = load_shape_assets(path=shape_assets_path or assets_path.with_name("face-shape-v1.npz")) if controls is not None else None
        mesh = generate_mesh(points=points, intensity=intensity, size=size, assets=assets,
                             yaw=pose["yaw"], pitch=pose["pitch"], controls=values, shape_assets=shape_assets)
        result, diagnostics = render_mesh(rgba=rgba, mesh=mesh)
        diagnostics["zero_bypass"] = False
        mesh_info = {"face_vertices": 311, "render_vertices": 315, "triangles": 597,
                     "landmarks_before": points.tolist(),
                     "prepared_source": mesh["prepared_source"].tolist(),
                     "deformed_landmarks": mesh["deformed_landmarks"].tolist(),
                     "point_sha256": hashlib.sha256(points.tobytes()).hexdigest(),
                     "assets_sha256": hashlib.sha256(assets_path.read_bytes()).hexdigest(),
                     "shape_assets_sha256": hashlib.sha256((shape_assets_path or assets_path.with_name("face-shape-v1.npz")).read_bytes()).hexdigest() if controls is not None else None}
    independence = native_images()
    if independence["private_native_images"]:
        raise ValueError("independent mesh renderer loaded a private native library")
    receipt = {"scope": "one-face-TotalFace-311-mesh-texture-PNG" if controls is None else "one-face-311-mesh-texture-PNG",
               "control": "face_adjust_TotalFace" if controls is None else None, "intensity": intensity,
               "controls": values,
               "width": rgba.shape[1], "height": rgba.shape[0], "mesh": mesh_info,
               "alignment": alignment,
               "fixed_landmarks": fixed_request is not None,
               "pose_source": pose["source"], "consumer_pose": pose,
               "private_asset_dependency": active, "diagnostics": diagnostics,
               "independence": independence, "native_product_parity_verified": False,
               "input_rgba_sha256": hashlib.sha256(rgba.tobytes()).hexdigest(),
               "output_rgba_sha256": hashlib.sha256(result.tobytes()).hexdigest(),
               "milliseconds": round((time.monotonic() - started) * 1000)}
    Image.fromarray(result).save(output)
    report.write_text(json.dumps(receipt, ensure_ascii=False, indent=2, allow_nan=False))
    return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--image", type=Path)
    source.add_argument("--rgba", type=Path)
    parser.add_argument("--width", type=int)
    parser.add_argument("--height", type=int)
    parser.add_argument("--max-edge", type=int, default=1280)
    parser.add_argument("--points", type=Path, help="fixed research landmark JSON; skips detection")
    parser.add_argument("--assets", type=Path, default=Path(__file__).resolve().parents[1] / "runtime/research/slimface-mesh-v1.npz")
    control_input = parser.add_mutually_exclusive_group(required=True)
    control_input.add_argument("--intensity", type=float)
    control_input.add_argument("--controls", help="JSON object of supported independent face control values")
    parser.add_argument("--shape-assets", type=Path, default=Path(__file__).resolve().parents[1] / "runtime/research/face-shape-v1.npz")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    if args.output.resolve() == args.report.resolve() or args.output.exists() or args.report.exists():
        parser.error("use distinct fresh output and report paths")
    if not args.output.parent.is_dir() or not args.report.parent.is_dir():
        parser.error("output/report parent directory must exist")
    if args.image:
        rgba = decode_image(image=args.image, max_edge=args.max_edge)["rgba"]
    else:
        if not args.width or not args.height or min(args.width, args.height) < 1 or max(args.width, args.height) > 4096 or args.width * args.height * 4 > 16 * 1024 * 1024:
            parser.error("RGBA dimensions exceed the analysis-frame budget")
        if args.rgba.stat().st_size != args.width * args.height * 4:
            parser.error("RGBA length does not match dimensions")
        rgba = np.frombuffer(args.rgba.read_bytes(), np.uint8).reshape(args.height, args.width, 4)
    fixed_request = json.loads(args.points.read_text()) if args.points else None
    receipt = run(rgba=rgba, intensity=args.intensity if args.intensity is not None else 0,
                  controls=json.loads(args.controls) if args.controls is not None else None,
                  shape_assets_path=args.shape_assets, output=args.output, report=args.report,
                  assets_path=args.assets, fixed_request=fixed_request)
    print(json.dumps({"output": str(args.output), "changed_pixels": receipt["diagnostics"]["changed_pixel_count"],
                      "milliseconds": receipt["milliseconds"], "private_native_images": []}))
