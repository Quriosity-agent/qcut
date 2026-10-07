"""Independent CPU inference of five unrounded align-160 terminal heads."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

from align160_heads_contract import GATES, HEAD_CHANNELS, MODEL_SHA256
from facefitting_infer import native_images

ROOT = Path(__file__).resolve().parent.parent


def validate_tensor(*, tensor):
    if not isinstance(tensor, np.ndarray) or tensor.dtype != np.int8 or tensor.shape != (1, 160, 160, 3):
        raise ValueError("signed int8 NHWC [1,160,160,3] tensor required")
    return np.ascontiguousarray(tensor)


def validate_heads(*, heads):
    if not isinstance(heads, dict) or set(heads) != set(HEAD_CHANNELS):
        raise ValueError("all five named terminal heads required")
    for name, channels in HEAD_CHANNELS.items():
        value = heads[name]
        if (not isinstance(value, np.ndarray) or value.dtype != np.float32
                or value.shape != (1, 1, 1, channels) or not np.isfinite(value).all()):
            raise ValueError("finite float32 terminal shape required: " + name)


def compare_heads(*, actual, expected):
    from alignment_infer import compare_heads as compare_stage1
    return compare_stage1(actual=actual, expected=expected, size=160)


def infer(*, tensor, model):
    from alignment_infer import Stage1
    tensor = validate_tensor(tensor=tensor)
    heads = Stage1(size=160, model=model, expected_sha256=MODEL_SHA256).infer(tensor=tensor)
    validate_heads(heads=heads)
    return heads


def run(*, prepared, model, output):
    import onnxruntime as ort
    if output.exists() or not output.parent.is_dir() or not output.resolve().is_relative_to((ROOT / "output").resolve()):
        raise ValueError("fresh output directory under output/ required")
    with np.load(prepared, allow_pickle=False) as values:
        tensor = validate_tensor(tensor=values["tensor"])
    heads = infer(tensor=tensor, model=model)
    isolation = native_images()
    if isolation["private_native_images"]:
        raise ValueError("independent inference loaded a private native library")
    output.mkdir()
    np.savez(output / "heads.npz", **heads)
    report = {"scope": "independent-int8-align160-to-five-raw-terminal-heads",
              "model_sha256": MODEL_SHA256, "input_sha256": hashlib.sha256(tensor.tobytes()).hexdigest(),
              "input_shape": list(tensor.shape), "input_raw": [1, 6],
              "head_channels": HEAD_CHANNELS, "head_raw": [4, 0],
              "versions": {"onnxruntime": ort.__version__, "numpy": np.__version__},
              "providers": ["CPUExecutionProvider"],
              "head_sha256": {name: hashlib.sha256(value.tobytes()).hexdigest() for name, value in heads.items()},
              "independence": isolation, "full_photo_perception_verified": False, "native_product_parity_verified": False}
    (output / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepared", type=Path, required=True)
    parser.add_argument("--model", type=Path, default=ROOT / "runtime/research/face-align-160.onnx")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(run(prepared=args.prepared, model=args.model, output=args.output)))
