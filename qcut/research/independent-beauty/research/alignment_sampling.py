"""Bounded RGBA affine sampler with separately quantized coordinate tables.

Pure NumPy; no native library, model, mean face or captured input is loaded.
The verified profile uses float32 arithmetic and nearest-even FP rounding.
"""
from __future__ import annotations

import numpy as np


def inverse_forward(*, forward):
    matrix = np.asarray(forward)
    if (matrix.dtype != np.float32 or matrix.shape != (2, 3) or
            not np.isfinite(matrix).all() or np.max(np.abs(matrix)) > 32768):
        raise ValueError("bounded float32 forward affine required")
    a, b, tx, c, d, ty = matrix.reshape(-1)
    determinant = np.float32(np.float32(a * d) - np.float32(b * c))
    if not np.isfinite(determinant) or abs(float(determinant)) < 1e-8:
        raise ValueError("nonsingular sampling transform required")
    reciprocal = np.float32(1.0 / float(determinant))
    p, q = np.float32(d * reciprocal), np.float32(-b * reciprocal)
    r, s = np.float32(-c * reciprocal), np.float32(a * reciprocal)
    u = np.float32(np.float32(-p * tx) - np.float32(q * ty))
    v = np.float32(np.float32(-r * tx) - np.float32(s * ty))
    result = np.array([[p, q, u], [r, s, v]], dtype=np.float32)
    if not np.isfinite(result).all():
        raise ValueError("sampling inverse is not finite")
    return result


def quantize(*, values):
    values = np.asarray(values)
    if values.dtype != np.float32 or not np.isfinite(values).all():
        raise ValueError("finite float32 sampling contribution required")
    scaled = values * np.float32(1024)
    if not np.isfinite(scaled).all() or np.max(np.abs(scaled), initial=0) > 2**30:
        raise ValueError("sampling contribution exceeds safe integer range")
    rounded = np.rint(scaled).astype(np.int64)
    # Bias each table separately; adding coordinates before rounding changes pixels.
    shifted = (rounded + 512) >> 10
    unsigned = shifted & 0xFFFF
    signed = np.where(unsigned >= 0x8000, unsigned - 0x10000, unsigned)
    return signed.astype(np.int32)


def sample_bgr(*, frame, forward, size=(120, 120)):
    values = np.asarray(frame)
    if (values.dtype != np.uint8 or values.ndim != 3 or values.shape[2] != 4 or
            not all(1 <= side <= 4096 for side in values.shape[:2]) or
            values.nbytes > 64 * 1024**2 or not isinstance(size, tuple) or len(size) != 2 or
            not all(type(side) is int and 2 <= side <= 160 for side in size)):
        raise ValueError("bounded RGBA frame and sampling size required")
    inverse = inverse_forward(forward=forward)
    p, q, u, r, s, v = inverse.reshape(-1)
    x = np.arange(size[0], dtype=np.float32)[None, :]
    y = np.arange(size[1], dtype=np.float32)[:, None]
    source_x = quantize(values=p * x + u) + quantize(values=q * y)
    source_y = quantize(values=r * x + v) + quantize(values=s * y)
    height, width = values.shape[:2]
    valid = (source_x >= 0) & (source_x < width) & (source_y >= 0) & (source_y < height)
    output = np.zeros((size[1], size[0], 3), dtype=np.uint8)
    output[valid] = values[source_y[valid], source_x[valid], :3][:, ::-1]
    return output


def signed_input(*, frame, forward, size=(120, 120)):
    pixels = sample_bgr(frame=frame, forward=forward, size=size)
    return (pixels.astype(np.int16) - 128)[None, ...]
