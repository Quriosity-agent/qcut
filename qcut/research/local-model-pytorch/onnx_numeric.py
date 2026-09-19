"""ONNX-compatible expression of the audited positive ARM exp/reciprocal profile."""
import torch

from tracking_numeric import exp_parts


class PinnedSigmoid(torch.nn.Module):
    def forward(self, value):
        denominator = 1 + exp_estimate(value=-value)
        reciprocal = reciprocal_estimate(value=denominator)
        for _ in range(2):
            reciprocal = reciprocal * (2 - denominator.double() * reciprocal.double()).float()
        return reciprocal


def exp_estimate(*, value):
    polynomial, exponent = exp_parts(value=value)
    # The polynomial is positive in [0.5,2); recover its exact mantissa arithmetically.
    above_one = polynomial >= 1
    mantissa = torch.where(above_one, polynomial - 1, polynomial * 2 - 1).double() * (1 << 23)
    encoded_exponent = exponent.double() + torch.where(above_one, 127.0, 126.0).double()
    normal = (1 + mantissa / (1 << 23)) * torch.pow(2.0, encoded_exponent - 127)
    subnormal = mantissa * (2.0 ** -149)
    exceptional = torch.where(mantissa == 0, torch.full_like(normal, float("inf")), torch.full_like(normal, float("nan")))
    return torch.where(encoded_exponent == 0, subnormal, torch.where(encoded_exponent == 255, exceptional, normal)).float()


def reciprocal_estimate(*, value):
    mantissa = value.double()
    exponent = torch.zeros_like(mantissa)
    # Exact powers of two avoid log2 rounding at floating-point exponent boundaries.
    for step in (64, 32, 16, 8, 4, 2, 1):
        selected = mantissa >= 2.0 ** step
        mantissa = torch.where(selected, mantissa / (2.0 ** step), mantissa)
        exponent = exponent + torch.where(selected, float(step), 0.0)
    bucket = torch.floor(mantissa * 256)
    estimate = torch.floor(131072 / (bucket + 0.5) + 0.5) / 256
    return (estimate * torch.pow(2.0, -exponent - 1)).float()


def pair_softmax(*, value):
    pairs = value.reshape(-1, 2)
    difference = pairs[:, 1] - pairs[:, 0]
    vector_rows = len(pairs) // 4 * 4
    vector = reciprocal_estimate(value=1 + exp_estimate(value=difference[:vector_rows]))
    scalar = 1 / (1 + difference[vector_rows:].exp())
    first = torch.cat((vector, scalar))
    return torch.stack((first, 1 - first), dim=1).reshape_as(value)
