"""Unrounded Stage1 coordinates and the ordinary output coordinate conversion."""
import numpy as np

from alignment_crop_transform import crop_matrices
from vendor.face_geometry import reorder_landmarks


def map_affine(*, points, inverse):
    if (not isinstance(points, np.ndarray) or points.dtype != np.float32 or points.shape != (106, 2)
            or not isinstance(inverse, np.ndarray) or inverse.dtype != np.float32 or inverse.shape != (2, 3)
            or not np.isfinite(points).all() or not np.isfinite(inverse).all()
            or np.max(np.abs(points)) > 32768 or np.max(np.abs(inverse)) > 32768
            or abs(float(np.linalg.det(inverse[:, :2]))) < 1e-8):
        raise ValueError("bounded float32 106 pairs and nonsingular affine required")
    values, matrix = points.astype(np.float64), inverse.astype(np.float64)
    result = (values[:, :1] * matrix[:, 0] + values[:, 1:] * matrix[:, 1] + matrix[:, 2]).astype(np.float32)
    if not np.isfinite(result).all() or np.max(np.abs(result)) > 32768:
        raise ValueError("mapped coordinates exceed budget")
    return result


def decode(*, raw, order, inverse, size, mean=None):
    if type(size) is not int or size not in (120, 160):
        raise ValueError("explicit 120 or 160 profile required")
    if not isinstance(raw, np.ndarray) or raw.dtype != np.float32 or raw.shape != (106, 2):
        raise ValueError("raw float32 interleaved 106 pairs required")
    stage = reorder_landmarks(raw_pairs=raw, destinations=order)
    if size == 120:
        if (not isinstance(mean, np.ndarray) or mean.dtype != np.float32 or mean.shape != (106, 2)
                or not np.isfinite(mean).all() or np.max(np.abs(mean)) > 32768):
            raise ValueError("explicit finite float32 120 residual mean required")
        stage = (stage.astype(np.float64) + mean.astype(np.float64) / 256 * 120).astype(np.float32)
    elif mean is not None:
        raise ValueError("160 coordinates are absolute; residual mean prohibited")
    return stage, map_affine(points=stage, inverse=inverse)


def crop_inverse(*, rect):
    inverse = crop_matrices(rect=rect, network_size=(160, 160))[1]
    if rect[2] != rect[3]:
        raise ValueError("square integer crop required")
    return inverse


def normalized(*, points, size):
    if (not isinstance(size, tuple) or len(size) != 2
            or any(type(side) is not int or not 1 <= side <= 4096 for side in size)
            or not isinstance(points, np.ndarray) or points.dtype != np.float32
            or points.shape != (106, 2) or not np.isfinite(points).all()):
        raise ValueError("float32 106 points and bounded integer frame size required")
    reciprocal = np.float32(1) / np.asarray(size, np.float32)
    result = np.empty_like(points)
    result[:, 0] = points[:, 0] * reciprocal[0]
    # H-y rounds before the multiply; 1-y/H changes the consumer's bits.
    result[:, 1] = (np.float32(size[1]) - points[:, 1]) * reciprocal[1]
    if (result < 0).any() or (result > 1).any():
        raise ValueError("normalized points outside frame; clipping prohibited")
    return result
