"""Narrow ARM CPU numerical profile, not a generic or GPU softmax replacement."""
import struct

import torch

CPU_SOFTMAX = "arm64-two-channel-frecpe-v1"


def float_bits(*, bits: int) -> float:
    return struct.unpack("<f", struct.pack("<I", bits))[0]


def fused(*, a: torch.Tensor, b: torch.Tensor | float, c: torch.Tensor | float) -> torch.Tensor:
    right = b.double() if isinstance(b, torch.Tensor) else b
    base = c.double() if isinstance(c, torch.Tensor) else c
    return (a.double() * right + base).float()


def cpu_exp(*, value: torch.Tensor) -> torch.Tensor:
    value = value.clamp(float_bits(bits=0xC2AEAC4F), float_bits(bits=0x42B17217))
    scaled = value * float_bits(bits=0x3FB8AA3B)
    exponent = torch.trunc(scaled + torch.where(scaled <= 0, -0.5, 0.5))
    reduced = fused(a=exponent, b=-float_bits(bits=0x3F317200), c=value)
    reduced = fused(a=exponent, b=float_bits(bits=0xB5BFBE8E), c=reduced)
    polynomial = fused(a=reduced, b=float_bits(bits=0x3D2BCDE1), c=float_bits(bits=0x3E2C09F1))
    for bits in (0x3EFFFFFE, 0x3F7FFD2D, 0x3F7FFFFA):
        polynomial = fused(a=polynomial, b=reduced, c=float_bits(bits=bits))
    return (polynomial.view(torch.int32) + exponent.to(torch.int32) * (1 << 23)).view(torch.float32)


def reciprocal_estimate(*, value: torch.Tensor) -> torch.Tensor:
    if value.dtype != torch.float32 or bool(torch.isnan(value).any()) or bool((value < 1).any()):
        raise ValueError("CPU reciprocal profile requires finite float32 denominators >= 1")
    infinite = torch.isinf(value)
    mantissa, exponent = torch.frexp(torch.where(infinite, 1, value))
    bucket = torch.floor(mantissa * 512).to(torch.int64)
    estimate = torch.div(torch.div(1 << 19, 2 * bucket + 1, rounding_mode="floor") + 1, 2, rounding_mode="floor")
    return torch.where(infinite, 0, torch.ldexp(estimate.to(torch.float32), -8 - exponent))


def two_channel_softmax(*, value: torch.Tensor) -> torch.Tensor:
    if value.ndim != 4 or value.shape[1] != 2 or value.dtype != torch.float32 or not torch.isfinite(value).all():
        raise ValueError("CPU softmax profile requires finite two-channel NCHW float32")
    denominator = 1 + cpu_exp(value=value[:, 1:2] - value[:, :1])
    first = reciprocal_estimate(value=denominator)
    # The pinned CPU kernel uses an unrefined reciprocal and its complement.
    return torch.cat((first, 1 - first), dim=1)
