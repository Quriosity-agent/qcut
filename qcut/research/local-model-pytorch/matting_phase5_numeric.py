"""Bounded CPU arithmetic experiments; no loader selects this profile."""
import torch
from torch.nn import functional as F

from matting_cpu_math import cpu_exp, fused, reciprocal_estimate


@torch.jit.script
def dense_accumulate(patches: torch.Tensor, weight: torch.Tensor,
                     bias: torch.Tensor, bias_first: bool) -> torch.Tensor:
    total = torch.zeros((patches.size(0), weight.size(0), patches.size(2)))
    if bias_first:
        total = total + bias[None, :, None]
    for index in range(weight.size(1)):
        total = (patches[:, index, None].double() * weight[None, :, index, None].double()
                 + total.double()).float()
    if not bias_first:
        total = total + bias[None, :, None]
    return total


@torch.jit.script
def depthwise_accumulate(patches: torch.Tensor, weight: torch.Tensor,
                         bias: torch.Tensor, bias_first: bool) -> torch.Tensor:
    total = torch.zeros_like(patches[:, :, 0])
    if bias_first:
        total = total + bias[None, :, None]
    for index in range(weight.size(1)):
        total = (patches[:, :, index].double() * weight[None, :, index, None].double()
                 + total.double()).float()
    if not bias_first:
        total = total + bias[None, :, None]
    return total


def ordered_convolution(*, value: torch.Tensor, conv: torch.nn.Conv2d,
                        bias_first: bool | None = None) -> torch.Tensor:
    if (value.dtype != torch.float32 or value.device.type != "cpu" or value.ndim != 4
            or value.shape[1] != conv.in_channels or conv.dilation != (1, 1)
            or conv.bias is None or conv.weight.dtype != torch.float32
            or conv.weight.device.type != "cpu" or not torch.isfinite(value).all()):
        raise ValueError("ordered convolution requires finite CPU float32 and biased undilated kernels")
    n, channels, height, width = value.shape
    kh, kw = conv.kernel_size
    if channels * kh * kw > 8192 or value.numel() > 1 << 24:
        raise ValueError("diagnostic convolution exceeds reduction or input bound")
    if bias_first is not None and type(bias_first) is not bool:
        raise ValueError("bias_first must be a boolean or None")
    depthwise = conv.groups == channels == conv.out_channels
    if conv.groups != 1 and not depthwise:
        raise ValueError("only dense and depthwise grouping supported")
    first = (depthwise or kh * kw != 1) if bias_first is None else bias_first
    patches = F.unfold(value, conv.kernel_size, padding=conv.padding, stride=conv.stride)
    if depthwise:
        result = depthwise_accumulate(patches.reshape(n, channels, kh * kw, -1),
                                      conv.weight.reshape(channels, -1), conv.bias, first)
    else:
        patches = patches.reshape(n, channels, kh * kw, -1).transpose(1, 2).flatten(1, 2)
        weight = conv.weight.permute(0, 2, 3, 1).reshape(conv.out_channels, -1)
        result = dense_accumulate(patches, weight, conv.bias, first)
    oh = (height + 2 * conv.padding[0] - kh) // conv.stride[0] + 1
    ow = (width + 2 * conv.padding[1] - kw) // conv.stride[1] + 1
    return result.reshape(n, conv.out_channels, oh, ow)


def refined_reciprocal(*, denominator: torch.Tensor) -> torch.Tensor:
    reciprocal = reciprocal_estimate(value=denominator)
    for _ in range(2):
        reciprocal = reciprocal * (2 - denominator.double() * reciprocal.double()).float()
    return reciprocal


def pinned_sigmoid(*, value: torch.Tensor) -> torch.Tensor:
    return refined_reciprocal(denominator=1 + cpu_exp(value=-value))


def pinned_tanh(*, value: torch.Tensor, formulation: str = "sigmoid") -> torch.Tensor:
    exponential = cpu_exp(value=-2 * value)
    reciprocal = refined_reciprocal(denominator=1 + exponential)
    if formulation == "sigmoid":
        return 2 * reciprocal - 1
    if formulation == "ratio":
        return (1 - exponential) * reciprocal
    raise ValueError("unsupported tanh formulation")


def ordered_tanh(*, value: torch.Tensor) -> torch.Tensor:
    if (value.ndim != 4 or value.dtype != torch.float32 or value.numel() < 8
            or value.device.type != "cpu" or not torch.isfinite(value).all()):
        raise ValueError("matting tanh requires full-shape float32 NCHW with at least eight elements")
    denominator = 1 + cpu_exp(value=-2 * value)
    reciprocal = reciprocal_estimate(value=denominator)
    reciprocal = reciprocal * (2 - denominator.double() * reciprocal.double()).float()
    step = (2 - denominator.double() * reciprocal.double()).float()
    result = fused(a=2 * reciprocal, b=step, c=-1)
    flat = value.permute(0, 2, 3, 1).flatten()
    # The vector loop uses < count-8, leaving 1..8 NHWC elements to expf/divide.
    vector_count = (flat.numel() - 1) // 8 * 8
    tail_exp = (-2 * flat[vector_count:]).double().exp().float()
    output = result.permute(0, 2, 3, 1).flatten()
    output[vector_count:] = 2 / (1 + tail_exp) - 1
    return output.reshape(value.shape[0], value.shape[2], value.shape[3], value.shape[1]).permute(0, 3, 1, 2).contiguous()


def four_lane_pointwise(*, value: torch.Tensor, conv: torch.nn.Conv2d) -> torch.Tensor:
    if (conv.kernel_size != (1, 1) or conv.in_channels != 16 or conv.out_channels != 2
            or conv.stride != (1, 1) or conv.padding != (0, 0) or conv.groups != 1
            or conv.bias is None or value.ndim != 4 or value.shape[1] != 16
            or value.dtype != torch.float32 or value.device.type != "cpu"
            or not torch.isfinite(value).all()):
        raise ValueError("four-lane reduction is restricted to the 16-to-2 pointwise output")
    total = [torch.zeros(value.shape[0], 2, value.shape[2], value.shape[3]) for _ in range(4)]
    for channel in range(16):
        lane = channel % 4
        total[lane] = fused(a=value[:, channel:channel + 1], b=conv.weight[:, channel, 0, 0][None, :, None, None], c=total[lane])
    return ((total[0] + total[1]) + (total[2] + total[3])) + conv.bias[None, :, None, None]


def upsample_terms(*, value: torch.Tensor) -> tuple[list[torch.Tensor], list[torch.Tensor]]:
    if (value.ndim != 4 or value.dtype != torch.float32 or value.device.type != "cpu"
            or min(value.shape) < 1 or not torch.isfinite(value).all()):
        raise ValueError("resize requires CPU float32 NCHW")
    h, w = value.shape[-2:]
    ys, xs = torch.arange(h * 2) * 0.5 - 0.25, torch.arange(w * 2) * 0.5 - 0.25
    y0, x0 = ys.floor().long(), xs.floor().long()
    wy, wx = (ys - y0).reshape(-1, 1), (xs - x0).reshape(1, -1)
    padded = F.pad(value, (1, 1, 1, 1))
    values = [padded[:, :, (y0 + dy + 1)[:, None], (x0 + dx + 1)[None, :]]
              for dy, dx in ((0, 0), (0, 1), (1, 0), (1, 1))]
    weights = [(1 - wy) * (1 - wx), (1 - wy) * wx, wy * (1 - wx), wy * wx]
    return values, weights


def ordered_upsample(*, value: torch.Tensor, formulation: str = "separable") -> torch.Tensor:
    values, weights = upsample_terms(value=value)
    if formulation in {"sum", "fma", "pinned"}:
        result = values[0] * weights[0]
        for term, weight in zip(values[1:], weights[1:]):
            result = fused(a=term, b=weight, c=result) if formulation != "sum" else result + term * weight
        if formulation == "pinned":
            channels = value.shape[1]
            if channels == 2:
                wx = weights[1] + weights[3]
                bottom = fused(a=values[1][:, :, -1] * .75, b=wx[-1],
                               c=values[0][:, :, -1] * .75 * (1 - wx[-1]))
                result[:, :, -1] = bottom
                result[:, :, -1, 0] = value[:, :, -1, 0] * .5625
                result[:, :, -1, -1] = value[:, :, -1, -1] * .5625
            elif channels % 4 == 0:
                result[:, :, -1, 0] = (value[:, :, -1, 0] * .75) * .75
                result[:, :, -1, -1] = (value[:, :, -1, -1] * .75) * .75
            else:
                raise ValueError("pinned resize supports two or four-aligned channels only")
        return result
    if formulation == "separable":
        wx = weights[1] + weights[3]
        wy = weights[2] + weights[3]
        top = fused(a=values[1], b=wx, c=values[0] * (1 - wx))
        bottom = fused(a=values[3], b=wx, c=values[2] * (1 - wx))
        return fused(a=bottom, b=wy, c=top * (1 - wy))
    raise ValueError("unsupported resize formulation")
