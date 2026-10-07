"""Owned preparation of the pinned v6.2 fitting network's 212 input values."""
import hashlib
from pathlib import Path
import struct

import numpy as np


MODEL_SHA256 = "b92958fdf04059110cae7899005b4550ad3ce95d00f5027e7235542971f06e93"
POINT_COUNT = 106
CANONICAL_EDGE = 256


def points_array(*, values):
    points = np.asarray(values, dtype=np.float32)
    if points.shape != (POINT_COUNT, 2) or not np.isfinite(points).all():
        raise ValueError("expected 106 finite XY points")
    if np.abs(points).max() > 1_000_000:
        raise ValueError("points exceed the preparation bounds")
    return points


def load_model_bytes(*, model):
    path = Path(model)
    if path.stat().st_size != 3_354_200:
        raise ValueError("unsupported fitting model size")
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != MODEL_SHA256:
        raise ValueError("unsupported fitting model identity")
    if struct.unpack_from("<4I", data, 648) != (964, 256, 106, 221):
        raise ValueError("unsupported mean-face header")
    if struct.unpack_from("<I", data, 3_354_196) != (1,):
        raise ValueError("fitting model does not select the point-input route")
    return data


def load_mean_face(*, model):
    data = load_model_bytes(model=model)
    mean = np.frombuffer(data, dtype="<f4", count=212, offset=664).reshape(106, 2).copy()
    return points_array(values=mean)


def fma32(*, left, right, addend):
    # Float32 operands fit the multiply-add in float64 before the final rounding.
    return np.float32(float(left) * float(right) + float(addend))


def alignment_matrix(*, points, mean):
    source = points_array(values=points)
    target = points_array(values=mean)
    source_sum = np.zeros(2, np.float32)
    target_sum = np.zeros(2, np.float32)
    for point, reference in zip(source, target):
        source_sum = np.float32(source_sum + point)
        target_sum = np.float32(target_sum + reference)
    reciprocal = np.float32(1) / np.float32(POINT_COUNT)
    source_center = np.float32(source_sum * reciprocal)
    target_center = np.float32(target_sum * reciprocal)
    centered_source = np.float32(source - source_center)
    centered_target = np.float32(target - target_center)
    cosine, sine, energy = np.float32(0), np.float32(0), np.float32(0)
    for (x, y), (tx, ty) in zip(centered_source, centered_target):
        sine = fma32(left=x, right=ty, addend=np.float32(sine - np.float32(y * tx)))
        cosine = fma32(left=y, right=ty, addend=np.float32(cosine + np.float32(x * tx)))
        energy = np.float32(np.float32(np.float32(x * x) + energy) + np.float32(y * y))
    if energy <= np.finfo(np.float32).tiny:
        raise ValueError("degenerate landmarks cannot define a fitting transform")
    a, b = np.float32(cosine / energy), np.float32(sine / energy)
    dx = fma32(left=source_center[1], right=b, addend=target_center[0])
    dx = fma32(left=-source_center[0], right=a, addend=dx)
    dy = fma32(left=-source_center[1], right=a, addend=target_center[1])
    dy = fma32(left=-source_center[0], right=b, addend=dy)
    matrix = np.array([[a, -b, dx], [b, a, dy]], np.float32)
    if not np.isfinite(matrix).all() or a * a + b * b <= np.finfo(np.float32).tiny:
        raise ValueError("singular fitting transform")
    return matrix


def prepare_input(*, points, mean):
    source = points_array(values=points)
    matrix = alignment_matrix(points=source, mean=mean)
    # The native 2x3 by 3x106 GEMM accumulates these three terms in double.
    homogeneous = np.column_stack((source, np.ones(POINT_COUNT, np.float32)))
    aligned = (matrix.astype(np.float64) @ homogeneous.astype(np.float64).T).T.astype(np.float32)
    reciprocal = np.float32(1) / np.float32(CANONICAL_EDGE)
    values = np.array([fma32(left=np.float32(value + value), right=reciprocal,
                             addend=np.float32(-1)) for value in aligned.reshape(-1)], np.float32)
    return {"matrix": matrix, "aligned": aligned, "input": values.reshape(1, 212)}


if __name__ == "__main__":
    import argparse
    import json

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--analysis", type=Path, required=True)
    parser.add_argument("--face", type=int, default=0)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    if arguments.output.exists():
        parser.error("use a fresh output file")
    analysis = json.loads(arguments.analysis.read_text())
    if not 0 <= arguments.face < len(analysis["faces"]):
        parser.error("face index is outside the analysis")
    landmarks = analysis["faces"][arguments.face].get("landmarks")
    if not landmarks or landmarks["prob"][0] > 0.5:
        parser.error("selected face has no accepted landmarks")
    result = prepare_input(points=landmarks["points"], mean=load_mean_face(model=arguments.model))
    with arguments.output.open("xb") as stream:
        np.savez(stream, **result)
    print(json.dumps({"output": str(arguments.output), "shape": list(result["input"].shape),
                      "range": [float(result["input"].min()), float(result["input"].max())]}))
