"""Independent align-160 preprocessing from explicit algorithm BGR and crop parameters."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image

from facefitting_infer import native_images

sys.path.insert(0, str(Path(__file__).resolve().parent / "vendor"))
from alignment_crop_transform import crop_matrices
from owned_prepare import prepare

CALL_KEYS = {"format", "orientation", "target", "flags", "rect", "expansion"}


def prepare_bgr(*, source, call):
    if (not isinstance(source, np.ndarray) or source.dtype != np.uint8 or source.ndim != 3
            or source.shape[2] != 3 or not all(1 <= side <= 4096 for side in source.shape[:2])
            or source.nbytes > 16 * 1024**2):
        raise ValueError("bounded HWC uint8 algorithm BGR required")
    if (not isinstance(call, dict) or set(call) != CALL_KEYS
            or not isinstance(call["rect"], dict) or set(call["rect"]) != {"values"}):
        raise ValueError("explicit crop parameters required; captured oracle buffers are not inputs")
    rgba = np.empty((*source.shape[:2], 4), np.uint8)
    rgba[:, :, :3], rgba[:, :, 3] = source[:, :, ::-1], 255
    result = prepare(frame=rgba, call=call)
    result["forward"], result["inverse"] = crop_matrices(rect=result["post_crop_rect"], network_size=(160, 160))
    return result


def run(*, source, call, output):
    if output.exists() or not output.parent.is_dir():
        raise ValueError("fresh output directory with an existing parent required")
    result = prepare_bgr(source=source, call=call)
    isolation = native_images()
    if isolation["private_native_images"]:
        raise ValueError("independent preprocessing loaded a private native library")
    output.mkdir()
    hashes = {}
    for name in ("source", "crop", "resized", "tensor"):
        hashes[name] = hashlib.sha256(result[name].tobytes()).hexdigest()
    np.savez(output / "prepared.npz", **result)
    for name in ("source", "crop", "resized"):
        Image.fromarray(result[name][:, :, ::-1]).save(output / f"{name}.png")
    receipt = {"scope": "algorithm-BGR-observed-crop-to-independent-align160-input",
               "source_size": [source.shape[1], source.shape[0]], "call": call,
               "post_crop_rect": result["post_crop_rect"], "resize": result["resize"],
               "tensor_shape": list(result["tensor"].shape), "tensor_dtype": str(result["tensor"].dtype),
               "inverse": result["inverse"].tolist(), "sha256": hashes, "independence": isolation,
               "full_photo_to_algorithm_image_verified": False, "native_crop_selection_reproduced": False,
               "native_product_parity_verified": False}
    (output / "report.json").write_text(json.dumps(receipt, indent=2, allow_nan=False))
    return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bgr", type=Path, required=True)
    parser.add_argument("--width", type=int, required=True)
    parser.add_argument("--height", type=int, required=True)
    parser.add_argument("--call", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not 1 <= min(args.width, args.height) <= max(args.width, args.height) <= 4096 or args.width * args.height * 3 > 16 * 1024**2:
        parser.error("algorithm frame dimensions exceed budget")
    if args.bgr.stat().st_size != args.width * args.height * 3:
        parser.error("algorithm BGR byte count does not match dimensions")
    source = np.frombuffer(args.bgr.read_bytes(), np.uint8).reshape(args.height, args.width, 3)
    print(json.dumps(run(source=source, call=json.loads(args.call.read_text()), output=args.output)))
