"""Half-pixel x2 interpolation with the observed horizontal-then-vertical rounding."""
import torch


def neighbours(*, value):
    if value.dtype != torch.float32 or value.device.type != "cpu" or value.ndim != 4:
        raise ValueError("CPU FP32 NCHW input required")
    height, width = value.shape[-2:]
    if min(height, width) < 1 or max(height, width) > 256:
        raise ValueError("bounded x2 input required")
    x = (torch.arange(width * 2, dtype=torch.float32) / 2 - 0.25).clamp(0, width - 1)
    y = (torch.arange(height * 2, dtype=torch.float32) / 2 - 0.25).clamp(0, height - 1)
    x0, y0 = x.long(), y.long()
    x1, y1 = (x0 + 1).clamp(max=width - 1), (y0 + 1).clamp(max=height - 1)
    dx, dy = (x - x0)[None, None, None, :], (y - y0)[None, None, :, None]
    a, b = value[:, :, y0[:, None], x0], value[:, :, y0[:, None], x1]
    c, d = value[:, :, y1[:, None], x0], value[:, :, y1[:, None], x1]
    return (a, b, c, d), ((1 - dx) * (1 - dy), dx * (1 - dy), (1 - dx) * dy, dx * dy), dx, dy


def blend(*, left, right, ratio, fused):
    base = (1 - ratio) * left
    return (base.double() + ratio.double() * right.double()).float() if fused else base + ratio * right


def upsample_twox(*, value):
    (a, b, c, d), _, dx, dy = neighbours(value=value)
    top = blend(left=a, right=b, ratio=dx, fused=True)
    bottom = blend(left=c, right=d, ratio=dx, fused=True)
    return blend(left=top, right=bottom, ratio=dy, fused=True)
