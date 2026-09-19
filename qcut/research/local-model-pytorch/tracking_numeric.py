"""Bounded reproduction of the pinned ARM64 two-channel CPU softmax profile."""
import torch


def fused32(*, a, b, c):
    # Products of float32 operands fit in float64 before the single final rounding.
    return (a.double() * b + c.double()).float()


def exp_parts(*, value):
    value = value.clamp(-87.33654022216797, 88.72283172607422)
    exponent = value * 1.4426950216293335
    rounded = exponent + torch.where(exponent <= 0, -0.5, 0.5)
    exponent = torch.where(rounded < 0, torch.ceil(rounded), torch.floor(rounded))
    reduced = fused32(a=exponent, b=-0.693145751953125, c=value)
    reduced = fused32(a=exponent, b=-1.428606765330187e-6, c=reduced)
    polynomial = fused32(a=reduced, b=0.041944388300180435,
                         c=torch.full_like(reduced, 0.16800667345523834))
    for coefficient in (0.4999999403953552, 0.9999569058418274, 0.9999996423721313):
        polynomial = fused32(a=polynomial, b=reduced.double(), c=torch.full_like(reduced, coefficient))
    return polynomial, exponent


def exp_estimate(*, value):
    polynomial, exponent = exp_parts(value=value)
    bits = polynomial.contiguous().view(torch.int32).to(torch.int64) + (exponent.to(torch.int64) << 23)
    return bits.to(torch.int32).view(torch.float32)


def reciprocal_estimate(*, value):
    if value.dtype != torch.float32 or not torch.isfinite(value).all() or not (value >= 1).all():
        raise ValueError("reciprocal profile only accepts finite float32 values >= 1")
    fraction, exponent = torch.frexp(value)
    bucket = torch.floor(fraction.double() * 512)
    estimate = torch.floor(131072 / (bucket + 0.5) + 0.5) / 256
    return torch.ldexp(estimate.float(), -exponent)


def pair_softmax(*, value):
    if value.ndim != 4 or value.shape[1:] != (2, 1, 1) or value.shape[0] > 4096:
        raise ValueError("only the audited two-channel vector softmax layout is supported")
    pairs = value.reshape(-1, 2)
    difference = pairs[:, 1] - pairs[:, 0]
    first = 1 / (1 + difference.exp())
    # The native pair kernel handles four rows per vector, then a scalar tail.
    vector_rows = len(pairs) // 4 * 4
    if vector_rows:
        approximate_exp = exp_estimate(value=difference[:vector_rows])
        first[:vector_rows] = reciprocal_estimate(value=1 + approximate_exp)
    return torch.stack((first, 1 - first), dim=1).reshape_as(value)
