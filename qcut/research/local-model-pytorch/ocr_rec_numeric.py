"""Ordered spatial reduction observed in the hash-pinned recognizer CPU oracle."""
import torch
from torch import nn
from torch.nn import functional as F
from tracking_numeric import exp_estimate, reciprocal_estimate


@torch.jit.script
def ordered_sum(value: torch.Tensor) -> torch.Tensor:
    flattened = value.flatten(2)
    total = torch.zeros_like(flattened[:, :, 0])
    for index in range(flattened.size(2)):
        total = total + flattened[:, :, index]
    return total[:, :, None, None]


class SpatialSum(nn.Module):
    def __init__(self, *, ordered=False):
        super().__init__()
        self.ordered = ordered

    def forward(self, value):
        if self.ordered:
            return ordered_sum(value)
        return value.sum(dim=(2, 3), keepdim=True)


class PinnedSigmoid(nn.Module):
    def forward(self, value):
        denominator = 1 + exp_estimate(value=-value)
        reciprocal = reciprocal_estimate(value=denominator)
        for _ in range(2):
            reciprocal = reciprocal * (2 - denominator.double() * reciprocal.double()).float()
        return reciprocal


@torch.jit.script
def accumulate(patches: torch.Tensor, weights: torch.Tensor, bias: torch.Tensor, bias_first: bool) -> torch.Tensor:
    total = torch.zeros((patches.size(0), weights.size(0), patches.size(2)), dtype=torch.float32)
    if bias_first:
        total = total + bias[None, :, None]
    for index in range(weights.size(1)):
        total = (patches[:, index, None].double() * weights[None, :, index, None].double() + total.double()).float()
    if not bias_first:
        total = total + bias[None, :, None]
    return total


@torch.jit.script
def depthwise_accumulate(patches: torch.Tensor, weights: torch.Tensor, bias: torch.Tensor) -> torch.Tensor:
    total = torch.zeros_like(patches[:, :, 0]) + bias[None, :, None]
    for index in range(weights.size(1)):
        total = (patches[:, :, index].double() * weights[None, :, index, None].double() + total.double()).float()
    return total


def ordered_convolution(*, value, weight, bias, stride, padding, groups):
    n, channels, height, width = value.shape
    cout, _, kh, kw = weight.shape
    patches = F.unfold(value, (kh, kw), padding=padding, stride=stride)
    if groups == 1:
        patches = patches.reshape(n, channels, kh * kw, -1).transpose(1, 2).flatten(1, 2)
        weights = weight.permute(0, 2, 3, 1).reshape(cout, -1)
        result = accumulate(patches, weights, bias, kh * kw != 1)
    elif groups == channels == cout:
        result = depthwise_accumulate(patches.reshape(n, channels, kh * kw, -1), weight.reshape(cout, -1), bias)
    else:
        raise ValueError("unsupported ordered convolution grouping")
    oh = (height + 2 * padding[0] - kh) // stride[0] + 1
    ow = (width + 2 * padding[1] - kw) // stride[1] + 1
    return result.reshape(n, cout, oh, ow)
