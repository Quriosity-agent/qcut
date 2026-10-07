"""Independent NH 106-point similarity fit for the bounded mode-zero crop."""
import numpy as np
from numbers import Real

from alignment_transform import inverse_mapping, points106
from facefitting_input import fma32

F = np.float32


def crop_transform(*, points, mean, size=320, margin=.4, offset_y=18.75):
    points106(points=points)
    points106(points=mean)
    if type(size) is not int or not 16 <= size <= 640:
        raise ValueError('bounded square NH crop required')
    if any(isinstance(value, (bool, np.bool_)) or not isinstance(value, Real) or not np.isfinite(value)
            for value in (margin, offset_y)) or not 0 <= margin <= 1 or not 0 <= offset_y <= size:
        raise ValueError('bounded finite NH crop margins required')
    source_center, target_center = np.zeros(2, F), np.zeros(2, F)
    for source, target in zip(points, mean, strict=True):
        source_center += source
        target_center += target
    source_center /= F(106)
    target_center /= F(106)
    dot, cross, energy = F(0), F(0), F(0)
    for (x, y), (u, v) in zip(points-source_center, mean-target_center, strict=True):
        dot = fma32(left=y, right=v, addend=F(dot+F(x*u)))
        cross = fma32(left=x, right=v, addend=F(cross-F(y*u)))
        energy = F(F(F(x*x)+energy)+F(y*y))
    if float(energy) < 1e-6:
        raise ValueError('degenerate NH similarity input')
    a, b = F(dot/energy), F(cross/energy)
    tx = fma32(left=source_center[1], right=b,
        addend=fma32(left=-source_center[0], right=a, addend=target_center[0]))
    ty = fma32(left=-source_center[1], right=a,
        addend=fma32(left=-source_center[0], right=b, addend=target_center[1]))
    forward = np.array([[a, -b, tx], [b, a, ty]], F)
    margin_x = F(margin)
    # The aspect-ratio conversion rounds the vertical margin before GEMM.
    margin_y = F(F(F(margin_x+F(.5))*F(size))/F(size)-F(.5))
    scales = np.array([F(size)/fma32(left=margin, right=F(2), addend=F(1))
        for margin in (margin_x, margin_y)], F)
    forward[:, :2] *= scales[:, None]
    forward[:, 2] = forward[:, 2]*scales + scales*np.array([margin_x, margin_y], F)
    forward[1, 2] += F(offset_y)
    return {'forward': forward, 'inverse': inverse_mapping(forward=forward)}
