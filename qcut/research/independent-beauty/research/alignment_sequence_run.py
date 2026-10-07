"""Run dependency-fed original-frame tracking and optionally export owned slim-face PNGs."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

from alignment_sequence import FACE_KEYS, OWNED_FACE_KEYS, Sequence, describe
from facefitting_infer import native_images
from mesh_raster import render_mesh
from slimface_geometry import validate_intensity
from slimface_mesh import generate_mesh
from slimface_mesh_assets import load_assets

ROOT = Path(__file__).resolve().parents[1]


def face_packet(*, value):
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) not in (FACE_KEYS, OWNED_FACE_KEYS):
        raise ValueError("geometry-only face packet required")
    result = {**value, "identity": tuple(value["identity"])}
    for key in ({"forward", "inverse", "mean"} & value.keys()):
        result[key] = np.asarray(value[key], np.float32)
    result["order"] = np.asarray(value["order"])
    if value["initialization"] is not None and "inverse" in value["initialization"]:
        result["initialization"] = {**value["initialization"], "inverse": np.asarray(value["initialization"]["inverse"], np.float32)}
    return result


def run(*, manifest, output, intensity):
    intensity = validate_intensity(intensity=intensity)
    if output.exists() or not output.parent.is_dir() or not output.resolve().is_relative_to(ROOT / "output"):
        raise ValueError("fresh output directory under output/ required")
    if manifest.stat().st_size > 8 * 1024**2:
        raise ValueError("dependency manifest exceeds budget")
    data = manifest.read_bytes()
    packets = json.loads(data)
    if not isinstance(packets, list) or not 1 <= len(packets) <= 128:
        raise ValueError("bounded dependency packet sequence required")
    core = Sequence(model_root=ROOT / "runtime/research")
    assets = load_assets(path=ROOT / "runtime/research/slimface-mesh-v1.npz") if intensity else None
    output.mkdir()
    rows, identities = [], {}
    for index, packet in enumerate(packets):
        common_keys = {"index", "rgba_path", "rgba_sha256", "source_size", "algorithm_size", "face", "yaw", "pitch"}
        if not isinstance(packet, dict) or set(packet) not in (common_keys | {"discarded_forward"}, common_keys | {"discarded_tracking"}):
            raise ValueError("exact original/geometry/pose packet fields required")
        width, height = packet["source_size"]
        if any(type(side) is not int or not 1 <= side <= 4096 for side in (width, height)) or width * height * 4 > 64 * 1024**2:
            raise ValueError("source dimensions exceed budget")
        source = Path(packet["rgba_path"])
        if not source.is_absolute() or source.stat().st_size != width * height * 4:
            raise ValueError("absolute packed original RGBA required")
        raw = source.read_bytes()
        if hashlib.sha256(raw).hexdigest() != packet["rgba_sha256"]:
            raise ValueError("source RGBA identity changed")
        identities[str(source)] = packet["rgba_sha256"]
        rgba = np.frombuffer(raw, np.uint8).reshape(height, width, 4)
        face = face_packet(value=packet["face"])
        discarded = np.asarray(packet["discarded_forward"], np.float32) if packet.get("discarded_forward") is not None else None
        result = core.process(rgba=rgba, size=tuple(packet["algorithm_size"]), index=packet["index"],
                              face=face, discarded_forward=discarded, discarded_tracking=packet.get("discarded_tracking", False))
        row = {"prediction": index, "provenance": describe(result=result), "face": face is not None,
               "png": None, "pose_source": "caller-supplied-dependency", "pixel_parity_verified": False}
        if face is not None:
            np.savez(output / f"prediction-{index:02d}.npz", points=result["points"], normalized=result["normalized"])
            if intensity:
                points = result["points"] * np.asarray([width / packet["algorithm_size"][0], height / packet["algorithm_size"][1]], np.float32)
                mesh = generate_mesh(points=points, intensity=intensity, size=[width, height], assets=assets,
                                     yaw=packet["yaw"], pitch=packet["pitch"])
                pixels, diagnostics = render_mesh(rgba=rgba, mesh=mesh)
                filename = f"prediction-{index:02d}-slimface-{intensity:g}.png"
                Image.fromarray(pixels).save(output / filename)
                row.update(png=filename, diagnostics=diagnostics,
                           output_rgba_sha256=hashlib.sha256(pixels.tobytes()).hexdigest())
        rows.append(row)
    if manifest.read_bytes() != data or any(hashlib.sha256(Path(path).read_bytes()).hexdigest() != expected for path, expected in identities.items()):
        raise ValueError("input changed during sequence execution")
    isolation = native_images()
    if isolation["private_native_images"]:
        raise ValueError("independent sequence loaded private native libraries")
    receipt = {"scope": "original-RGBA-explicit-geometry-owned-Base106-to-owned-slimface",
               "manifest_sha256": hashlib.sha256(data).hexdigest(), "original_sha256": identities,
               "cases": rows, "intensity": intensity, "independence": isolation,
               "native_tracking_matrices_used": any(row["provenance"]["native_tracking_matrices_used"] for row in rows),
               "native_seed_inverse_used": any(row["provenance"]["native_seed_inverse_used"] for row in rows),
               "native_geometry_dependencies_required": True, "native_product_parity_verified": False}
    (output / "report.json").write_text(json.dumps(receipt, indent=2, allow_nan=False) + "\n")
    return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--intensity", type=float, default=0)
    args = parser.parse_args()
    result = run(manifest=args.manifest, output=args.output.resolve(), intensity=args.intensity)
    print(json.dumps({"predictions": len(result["cases"]), "rendered": sum(row["png"] is not None for row in result["cases"]),
                      "private_native_images": result["independence"]["private_native_images"]}))
