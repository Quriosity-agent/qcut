"""BGR detector resize with float32 coordinates and seven-bit separable weights."""
import numpy as np

from facefitting_input import fma32


def _axis(*, source_extent, target_extent):
    reciprocal = np.float32(1) / np.float32(target_extent)
    centers = np.float32(np.arange(target_extent, dtype=np.float32) + np.float32(.5))
    products = np.float32(centers * np.float32(source_extent))
    # The reciprocal is rounded before the fused half-pixel subtraction.
    coordinates = np.asarray([fma32(left=value, right=reciprocal,
                                    addend=np.float32(-.5)) for value in products], np.float32)
    lower = np.floor(coordinates).astype(np.int32)
    fractions = np.float32(coordinates - lower.astype(np.float32))
    weights = np.rint(np.float32(fractions * np.float32(128))).astype(np.int32)
    weights[lower < 0] = 0
    weights[lower >= source_extent - 1] = 128
    lower = np.clip(lower, 0, source_extent - 2)
    return lower, lower + 1, weights


def resize_bgr(*, pixels, size):
    if (not isinstance(pixels, np.ndarray) or pixels.dtype != np.uint8
            or pixels.ndim != 3 or pixels.shape[2] != 3
            or min(pixels.shape[:2]) < 2):
        raise ValueError('BGR uint8 image with both dimensions at least two required')
    if (not isinstance(size, tuple) or len(size) != 2
            or any(type(extent) is not int or not 2 <= extent <= 2048 for extent in size)):
        raise ValueError('bounded detector target dimensions required')
    left, right, horizontal = _axis(source_extent=pixels.shape[1], target_extent=size[0])
    top, bottom, vertical = _axis(source_extent=pixels.shape[0], target_extent=size[1])
    source = pixels.astype(np.int32)
    rows = ((source[:, left] * (128 - horizontal)[None, :, None]
             + source[:, right] * horizontal[None, :, None]) >> 7)
    return ((rows[top] * (128 - vertical)[:, None, None]
             + rows[bottom] * vertical[:, None, None]) >> 7).astype(np.uint8)
