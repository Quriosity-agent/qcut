"""Image -> research landmarks -> 212 input floats -> independent 442 output floats."""
import argparse
import ctypes as ct
import hashlib
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image

from facefitting_image import decode_image
from facefitting_input import MODEL_SHA256, load_mean_face, prepare_input
from facefitting_model import FittingNetwork
from facefitting_output import map_output, resize_forward


ROOT = Path(__file__).resolve().parent.parent


def native_images():
    if sys.platform != "darwin":
        raise ValueError("loaded-image verification requires macOS")
    process = ct.CDLL(None)
    count = process._dyld_image_count
    count.restype = ct.c_uint32
    name = process._dyld_get_image_name
    name.argtypes, name.restype = [ct.c_uint32], ct.c_char_p
    images = [name(index).decode() for index in range(count())]
    private = [path for path in images if "libcccreator" in path or "libbytenn" in path or "liblens" in path
               or "/runtime/Frameworks/" in path or "/JianyingPro.app/" in path]
    return {"loaded_image_count": len(images), "private_native_images": private,
            "loaded_images": images}


def run_image(*, image, output, model, max_edge, fit_3d=False):
    if output.exists():
        raise ValueError("use a fresh output directory")
    if not output.resolve().is_relative_to((ROOT / "output").resolve()):
        raise ValueError("local model evidence must remain under output/")
    network, mean = FittingNetwork(model=model), load_mean_face(model=model)
    if fit_3d:
        from facefitting_geometry import load_morphable_model
        from facefitting_solver import solve
        morphable = load_morphable_model(model=model)
    decoded = decode_image(image=image, max_edge=max_edge)
    rgba = decoded["rgba"]
    resize_matrix = resize_forward(source_size=decoded["oriented_source_size"], analyzed_size=decoded["decoded_size"])
    from worker import ASSUMPTIONS, detect, landmarks

    faces = detect(np.ascontiguousarray(rgba[:, :, :3]))
    accepted = []
    for index, face in enumerate(faces):
        face["landmarks"] = landmarks(rgba, face)
        if face["landmarks"]["prob"][0] <= 0.5:
            prepared = prepare_input(points=face["landmarks"]["points"], mean=mean)
            fitted = network.infer(values=prepared["input"])
            mapped = map_output(values=fitted, matrix=prepared["matrix"])
            source_mapping = map_output(values=mapped["image_points"].reshape(1, 442), matrix=resize_matrix)
            mapped.update(source_points=source_mapping["image_points"], resize_matrix=resize_matrix,
                          resize_inverse=source_mapping["inverse"])
            geometry = solve(model=morphable, points=mapped["image_points"], size=tuple(decoded["decoded_size"])) if fit_3d else None
            accepted.append((index, prepared, fitted, mapped, geometry))
    if not accepted:
        raise ValueError("image produced no accepted research landmarks")
    receipt = native_images()
    if receipt["private_native_images"]:
        raise ValueError("independent inference loaded a private native library")
    output.mkdir(parents=True)
    Image.fromarray(rgba).save(output / "decoded.png")
    case_names = []
    for index, prepared, fitted, mapped, geometry in accepted:
        directory = output / f"case-face-{index}"
        directory.mkdir()
        prepared["input"].astype("<f4").tofile(directory / "input.f32")
        fitted.astype("<f4").tofile(directory / "owned-output.f32")
        mapped["image_points"].astype("<f4").tofile(directory / "owned-image-points.f32")
        mapped["source_points"].astype("<f4").tofile(directory / "owned-source-points.f32")
        np.savez(directory / "owned.npz", **prepared, output=fitted, **mapped)
        if geometry is not None:
            np.savez(directory / "fitting-3d.npz", **geometry)
            from facefitting_export import export_geometry
            export_geometry(model=morphable, result=geometry, directory=directory, image=output / "decoded.png")
        case_names.append(directory.name)
    record = {"image": str(image), "image_sha256": hashlib.sha256(image.read_bytes()).hexdigest(),
              **{key: value for key, value in decoded.items() if key != "rgba"},
              "max_edge": max_edge, "model_sha256": MODEL_SHA256, "faces": faces,
              "cases": case_names, "input_shape": [1, 212], "output_shape": [1, 442],
              "assumptions": ASSUMPTIONS, "independence": receipt,
              "output_semantics_verified": True, "output_point_count": 221,
              "output_order": "interleaved-xy-in-network-slot-order",
              "image_points_space": "decoded-analysis-image-pixels-top-left-origin",
              "source_points_space": "full-resolution-EXIF-oriented-source-pixel-centers-top-left-origin",
              "image_points_full_resolution": decoded["decoded_size"] == decoded["oriented_source_size"],
              "fitting_3d_computed": fit_3d,
              "full_3d_fitting_verified": False,
              "fitting_3d_scope": "single-frame-221-point-perspective-pose-and-morphable-geometry" if fit_3d else None,
              "camera_assumption": "53.130102-degree vertical FOV; principal point at image center; uncalibrated" if fit_3d else None,
              "native_product_parity_verified": False}
    (output / "independent-run.json").write_text(json.dumps(record, indent=2, ensure_ascii=False, allow_nan=False))
    print(json.dumps({"output": str(output), "cases": case_names, "private_native_images": []}))
    return record


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model", type=Path, default=ROOT / "runtime/Models/tt_facefitting_3d_v6.2_size4_md5054e6805e1f42ba6950a9ff678aedb49.model")
    parser.add_argument("--max-edge", type=int, default=1280)
    parser.add_argument("--fit-3d", action="store_true")
    arguments = parser.parse_args()
    run_image(image=arguments.image.resolve(), output=arguments.output.resolve(),
              model=arguments.model.resolve(), max_edge=arguments.max_edge, fit_3d=arguments.fit_3d)
