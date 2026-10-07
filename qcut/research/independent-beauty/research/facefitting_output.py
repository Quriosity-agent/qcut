"""Decode the fitting network's 221 XY pairs and map them to the analyzed image."""
import numpy as np

from facefitting_input import fma32


OUTPUT_POINTS = 221


def resize_forward(*, source_size, analyzed_size):
    if len(source_size) != 2 or len(analyzed_size) != 2:
        raise ValueError("expected width and height pairs")
    if any(type(value) is not int or not 1 <= value <= 100000 for value in (*source_size, *analyzed_size)):
        raise ValueError("expected bounded positive integer image dimensions")
    sx, sy = (target / source for source, target in zip(source_size, analyzed_size))
    # Resize samples pixel centers; point zero denotes the center of the first pixel.
    return np.array([[sx, 0, (sx - 1) / 2], [0, sy, (sy - 1) / 2]], np.float32)


def decode_output(*, values):
    if not isinstance(values, np.ndarray) or values.dtype != np.float32:
        raise ValueError("expected float32 fitting output")
    if values.shape != (1, OUTPUT_POINTS * 2) or not np.isfinite(values).all():
        raise ValueError("expected 442 finite output values with shape (1, 442)")
    return values.reshape(OUTPUT_POINTS, 2).copy()


def inverse_affine(*, matrix):
    if not isinstance(matrix, np.ndarray) or matrix.dtype != np.float32 or matrix.shape != (2, 3):
        raise ValueError("expected float32 forward matrix with shape (2, 3)")
    if not np.isfinite(matrix).all():
        raise ValueError("forward matrix must be finite")
    a, b, tx, c, d, ty = matrix.reshape(-1)
    try:
        with np.errstate(over="raise", invalid="raise", under="ignore"):
            determinant = fma32(left=d, right=a, addend=-np.float32(c * b))
            if not np.isfinite(determinant) or abs(determinant) <= np.finfo(np.float32).tiny:
                raise ValueError("singular forward matrix")
            reciprocal = 1.0 / float(determinant)
            ia, ib, ic, id_ = (reciprocal * float(value) for value in (d, -b, -c, a))
            # Native inversion retains double coefficients until translation is computed.
            inverse = np.array([[ia, ib, -ia * float(tx) - ib * float(ty)],
                                [ic, id_, -ic * float(tx) - id_ * float(ty)]], np.float32)
    except FloatingPointError as error:
        raise ValueError("inverse exceeds float32 bounds") from error
    if not np.isfinite(inverse).all():
        raise ValueError("inverse exceeds float32 bounds")
    return inverse


def map_output(*, values, matrix):
    canonical = decode_output(values=values)
    inverse = inverse_affine(matrix=matrix)
    homogeneous = np.column_stack((canonical, np.ones(OUTPUT_POINTS, np.float32)))
    try:
        with np.errstate(over="raise", invalid="raise"):
            points = (inverse.astype(np.float64) @ homogeneous.astype(np.float64).T).T.astype(np.float32)
    except FloatingPointError as error:
        raise ValueError("mapped coordinates exceed float32 bounds") from error
    if not np.isfinite(points).all():
        raise ValueError("mapped coordinates exceed float32 bounds")
    return {"canonical_points": canonical, "inverse": inverse, "image_points": points}
