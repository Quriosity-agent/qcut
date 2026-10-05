"""Pure CPU arithmetic audit of supplied primary-106 conversion bit words.

Prior instruction evidence: 0xa207ec loads s2/s3, followed by X fmul,
Y fmul, then Y fsub from height. This module neither reads a target nor
establishes that supplied words came from those instructions. The caller
must establish provenance, dimensions, and landmark identity/order.
"""
from __future__ import annotations

import math
import struct

POINT_COUNT = 106
MAX_DIMENSION = 4096
MAX_WORD = 2**32 - 1


def _bounded_integer(*, value, minimum, maximum, label):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError(f"{label}: integer in [{minimum}, {maximum}] required")
    return value


def _float32(*, value):
    return struct.unpack("<f", struct.pack("<f", value))[0]


def _word(*, value):
    return struct.unpack("<I", struct.pack("<f", value))[0]


def _coordinates(*, bits, label, normalized):
    if type(bits) is not list or len(bits) != POINT_COUNT:
        raise ValueError(f"{label}: exactly 106 point lists required")
    coordinates = []
    for index, pair in enumerate(bits):
        if type(pair) is not list or len(pair) != 2:
            raise ValueError(f"{label}[{index}]: exactly two uint32 words required")
        values = []
        for axis, word in enumerate(pair):
            location = f"{label}[{index}][{axis}]"
            _bounded_integer(value=word, minimum=0, maximum=MAX_WORD, label=location)
            value = struct.unpack("<f", struct.pack("<I", word))[0]
            if not math.isfinite(value):
                raise ValueError(f"{location}: finite float32 required")
            if normalized and not 0 <= value <= 1:
                raise ValueError(f"{location}: normalized [0, 1] source required")
            values.append(value)
        coordinates.append(values)
    return coordinates


def audit_conversion(*, source_bits, destination_bits, width, height) -> dict:
    """Verify ordered bitwise agreement, raising ValueError on invalid data.

    Each input must be a list of 106 two-word lists; dimensions are integers
    in [1, 4096]. Booleans are not integers here. Source negative zero is
    valid and its X sign must survive. Arithmetic uses binary32 rounding
    after each operation (round-to-nearest, ties-to-even, no subnormal flush).
    This does not verify the native floating-point environment or target
    reads, renderer consumption, product parity, or input provenance.
    Jointly reordered or numerically identical points cannot be identified
    without caller-owned landmark/provenance evidence.
    """
    width = _bounded_integer(value=width, minimum=1, maximum=MAX_DIMENSION, label="width")
    height = _bounded_integer(value=height, minimum=1, maximum=MAX_DIMENSION, label="height")
    source = _coordinates(bits=source_bits, label="source_bits", normalized=True)
    _coordinates(bits=destination_bits, label="destination_bits", normalized=False)
    width32, height32 = _float32(value=width), _float32(value=height)

    for index, (x, y) in enumerate(source):
        # The rounded Y product must reach fsub; an elided/fused product differs.
        # With <=4096 integer dimensions, binary64 holds each product exactly.
        scaled_x = _float32(value=_float32(value=x) * width32)
        scaled_y = _float32(value=_float32(value=y) * height32)
        flipped_y = _float32(value=height32 - scaled_y)
        expected = (_word(value=scaled_x), _word(value=flipped_y))
        for axis, expected_word in enumerate(expected):
            actual_word = destination_bits[index][axis]
            if actual_word != expected_word:
                raise ValueError(
                    f"destination_bits[{index}][{axis}]: conversion mismatch; "
                    f"expected 0x{expected_word:08x}, got 0x{actual_word:08x}"
                )

    return dict(
        schema="face-live-makeup-conversion-math-v1",
        point_count=POINT_COUNT,
        width=width,
        height=height,
        cpu_conversion_math_verified=True,
        target_reads_verified=False,
        provenance_verified=False,
        renderer_consumption=False,
        product_parity_verified=False,
    )
