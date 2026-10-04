"""Bounded CPU sampler hypotheses; no oracle pixels or image-specific correction.

The staged formula is the 11-bit byte linear-resize arithmetic documented in
OpenCV 4.11.0 modules/imgproc/src/resize.cpp, VResizeLinear<uchar, ...>.
This is a numerical hypothesis, not evidence that the native caller uses OpenCV.
https://github.com/opencv/opencv/blob/4.11.0/modules/imgproc/src/resize.cpp
"""
from __future__ import annotations

import numpy as np

MAX_DIMENSION = 4096
ROW_BLOCK = 16
COORDINATES = ("half-pixel", "asymmetric", "align-corners")
ARITHMETIC = ("staged", "no-horizontal-truncation", "half-up", "even", "floor")


def validate_frame(*, frame, size):
    if (type(frame) is not np.ndarray or frame.dtype != np.uint8 or
            frame.ndim != 3 or frame.shape[2] != 4 or
            not all(1 <= n <= MAX_DIMENSION for n in frame.shape[:2]) or
            type(size) is not tuple or len(size) != 2 or
            any(type(n) is not int or not 1 <= n <= MAX_DIMENSION for n in size)):
        raise ValueError("bounded uint8 RGBA and plain integer (width, height) required")


def axis(*, source, target, coordinate, bits, weight_rounding):
    position = np.arange(target, dtype=np.float64)
    if coordinate == "half-pixel":
        if bits is None:
            position = (position + .5) * source / target - .5
        else:
            position = (position + .5) * (source / target) - .5
    elif coordinate == "align-corners":
        position *= (source - 1) / max(1, target - 1)
    else:
        position *= source / target
    if bits is not None:
        position = position.astype(np.float32)
    lower = np.floor(position).astype(np.int64)
    weight = position - lower
    if bits is None:
        first, second = 1 - weight, weight
    else:
        scale = 1 << bits
        rounding = np.rint if weight_rounding == "even" else np.floor
        second = rounding(weight * scale).astype(np.int64)
        first = scale - second
    return (np.clip(lower, 0, source - 1), np.clip(lower + 1, 0, source - 1),
            first, second)


def resize_rgba(*, frame, size, bits=11, coordinate="half-pixel",
                arithmetic="staged", weight_rounding="even"):
    validate_frame(frame=frame, size=size)
    if (bits is not None and (type(bits) is not int or not 4 <= bits <= 16) or
            coordinate not in COORDINATES or arithmetic not in ARITHMETIC or
            weight_rounding not in ("even", "floor")):
        raise ValueError("unsupported sampler hypothesis")
    if arithmetic in ("staged", "no-horizontal-truncation") and bits != 11:
        raise ValueError("staged byte arithmetic requires 11-bit weights")
    height, width = frame.shape[:2]
    x0, x1, a0, a1 = axis(source=width, target=size[0], coordinate=coordinate,
                          bits=bits, weight_rounding=weight_rounding)
    y0, y1, b0, b1 = axis(source=height, target=size[1], coordinate=coordinate,
                          bits=bits, weight_rounding=weight_rounding)
    result = np.empty((size[1], size[0], 4), np.uint8)
    a0, a1 = a0[None, :, None], a1[None, :, None]
    denominator = 1 if bits is None else 1 << (2 * bits)
    for start in range(0, size[1], ROW_BLOCK):
        rows = slice(start, start + ROW_BLOCK)
        top = frame[y0[rows, None], x0] * a0 + frame[y0[rows, None], x1] * a1
        bottom = frame[y1[rows, None], x0] * a0 + frame[y1[rows, None], x1] * a1
        beta0, beta1 = b0[rows, None, None], b1[rows, None, None]
        if arithmetic in ("staged", "no-horizontal-truncation"):
            shift = 4 if arithmetic == "staged" else 0
            # Discard each product's low bits before adding, not after the sum.
            first = (beta0 * (top >> shift)) >> (20 - shift)
            second = (beta1 * (bottom >> shift)) >> (20 - shift)
            value = (first + second + 2) >> 2
        else:
            value = (top * beta0 + bottom * beta1) / denominator
            if arithmetic == "half-up":
                value = np.floor(value + .5)
            elif arithmetic == "even":
                value = np.rint(value)
            else:
                value = np.floor(value)
        result[rows] = value.astype(np.uint8)
    return result


def hypotheses():
    modes = {"staged-q11": {},
             "staged-q11-no-horizontal-truncation": {"arithmetic": "no-horizontal-truncation"}}
    for coordinate in COORDINATES:
        for arithmetic in ("half-up", "even", "floor"):
            modes[f"float-{coordinate}-{arithmetic}"] = dict(
                bits=None, coordinate=coordinate, arithmetic=arithmetic)
    for bits in (4, 5, 6, 7, 8, 9, 10, 11, 12, 16):
        for weight_rounding in ("even", "floor"):
            for arithmetic in ("half-up", "even", "floor"):
                modes[f"q{bits}-{weight_rounding}-{arithmetic}"] = dict(
                    bits=bits, weight_rounding=weight_rounding, arithmetic=arithmetic)
    for coordinate in COORDINATES[1:]:
        modes[f"staged-q11-{coordinate}"] = dict(coordinate=coordinate)
    return modes
