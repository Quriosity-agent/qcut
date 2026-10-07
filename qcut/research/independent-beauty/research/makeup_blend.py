"""Float32 pigment blending in premultiplied RGBA, independent of native shaders."""
from numbers import Real

import numpy as np

F = np.float32
MODES = ("normal", "multiply", "screen", "overlay", "soft-light", "add", "color")


def rgba_array(*, value):
    array = np.asarray(value)
    if (array.dtype != np.float32 or not 1 <= array.ndim <= 3 or array.shape[-1] != 4
            or array.size > 16777216 or not np.isfinite(array).all()
            or np.any(array < 0) or np.any(array > 1)
            or np.any(array[..., :3] > array[..., 3:4] + F(1e-6))):
        raise ValueError("bounded float32 premultiplied RGBA required")
    return array


def unit_scalar(*, value, name):
    if isinstance(value, (bool, np.bool_)) or not isinstance(value, Real) or not np.isfinite(value) or not 0 <= value <= 1:
        raise ValueError(f"{name} must be a finite number in 0..1")
    return F(value)


def colorize(*, base, pigment):
    high, low = pigment.max(axis=-1), pigment.min(axis=-1)
    delta = high - low
    hue = np.zeros(delta.shape, np.float32)
    nonzero = delta > 0
    red, green, blue = np.moveaxis(pigment, -1, 0)
    masks = (nonzero & (high == red), nonzero & (high != red) & (high == green),
             nonzero & (high != red) & (high != green))
    for mask, numerator, offset in zip(masks, (green - blue, blue - red, red - green),
                                       (np.where(green < blue, F(6), F(0)), F(2), F(4))):
        component = np.divide(numerator, delta, out=np.zeros_like(delta), where=nonzero) + offset
        hue = np.where(mask, component, hue)
    hue /= F(6)
    lightness = (high + low) * F(.5)
    denominator = F(1) - np.abs(F(2) * lightness - F(1))
    saturation = np.divide(delta, denominator, out=np.zeros_like(delta), where=nonzero)
    base_lightness = (base.max(axis=-1) + base.min(axis=-1)) * F(.5)
    ramp = np.clip(np.abs(np.remainder(hue[..., None] * F(6) + np.array([0, 4, 2], np.float32), F(6)) - F(3)) - F(1), 0, 1)
    chroma = saturation * (F(1) - np.abs(F(2) * base_lightness - F(1)))
    return base_lightness[..., None] + (ramp - F(.5)) * chroma[..., None]


def blend_rgb(*, base, pigment, mode):
    if mode == "normal":
        return pigment
    if mode == "multiply":
        return base * pigment
    if mode == "screen":
        return F(1) - (F(1) - base) * (F(1) - pigment)
    if mode == "overlay":
        return np.where(base < F(.5), F(2) * base * pigment, F(1) - F(2) * (F(1) - base) * (F(1) - pigment))
    if mode == "soft-light":
        return np.where(pigment < F(.5), F(2) * base * pigment + base * base * (F(1) - F(2) * pigment),
                        np.sqrt(base) * (F(2) * pigment - F(1)) + F(2) * base * (F(1) - pigment))
    if mode == "add":
        return np.minimum(base + pigment, F(1))
    if mode == "color":
        return colorize(base=base, pigment=pigment)
    raise ValueError("unsupported pigment blend mode")


def compose(*, base, pigment, strength, mode, opacity=1):
    base, pigment = rgba_array(value=base), rgba_array(value=pigment)
    if base.shape != pigment.shape:
        raise ValueError("matching base and pigment dimensions required")
    strength = unit_scalar(value=strength, name="strength")
    opacity = unit_scalar(value=opacity, name="opacity")
    if mode not in MODES:
        raise ValueError("unsupported pigment blend mode")
    if strength == 0 or opacity == 0:
        return base.copy()
    layer = pigment * F(strength * opacity)
    base_rgb = np.clip(base[..., :3] / np.maximum(base[..., 3:4], F(1e-6)), 0, 1)
    pigment_rgb = np.clip(layer[..., :3] / np.maximum(layer[..., 3:4], F(1e-6)), 0, 1)
    alpha = layer[..., 3:4]
    color = blend_rgb(base=base_rgb, pigment=pigment_rgb, mode=mode)
    color = base_rgb * (F(1) - alpha) + color * alpha
    result_alpha = alpha * (F(1) - base[..., 3:4]) + base[..., 3:4]
    return np.concatenate((color * result_alpha, result_alpha), axis=-1).astype(np.float32)
