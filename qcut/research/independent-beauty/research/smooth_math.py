"""Owned control-mask and detail recombination equations for photo smoothing."""
import numpy as np

from makeup_blend import unit_scalar

F = np.float32


def unit_pixels(*, values, channels):
    array = np.asarray(values)
    if (array.dtype != np.float32 or array.ndim < 1 or array.shape[-1] != channels
            or not np.isfinite(array).all() or np.any(array < 0) or np.any(array > 1)):
        raise ValueError('finite float32 unit pixels required')
    return array


def hue_value(*, rgb):
    rgb = unit_pixels(values=rgb, channels=3)
    red, green, blue = np.moveaxis(rgb, -1, 0)
    green_first = green >= blue
    maximum = np.where(green_first, green, blue)
    minimum = np.where(green_first, blue, green)
    offset = np.where(green_first, F(-.33333), F(.66667))
    red_first = red >= maximum
    hue_offset = np.where(red_first, np.where(green_first, F(0), F(-1)), offset)
    low = np.where(red_first, maximum, red)
    high = np.where(red_first, red, maximum)
    difference = high - np.minimum(low, minimum)
    hue = np.abs(hue_offset + (low - minimum) / (F(6) * difference + F(1e-10)))
    return hue.astype(F), high.astype(F)


def control_mask(*, rgb, face_rgb, skin_alpha, strength, has_face):
    rgb = unit_pixels(values=rgb, channels=3)
    face_rgb = unit_pixels(values=face_rgb, channels=3)
    skin_alpha = np.asarray(skin_alpha)
    if (face_rgb.shape != rgb.shape or skin_alpha.dtype != F or skin_alpha.shape != rgb.shape[:-1]
            or not np.isfinite(skin_alpha).all() or np.any(skin_alpha < 0) or np.any(skin_alpha > 1)
            or type(has_face) is not bool):
        raise ValueError('matching bounded skin and face masks required')
    strength = unit_scalar(value=strength, name='smoothing strength')
    result = np.zeros((*skin_alpha.shape, 4), F)
    if not has_face:
        result[..., 2] = skin_alpha
        result[..., 3] = skin_alpha * strength
        return result
    hue, value = hue_value(rgb=rgb)
    allowed = np.where(((hue >= F(.1)) & (hue <= F(.89))) | (value <= F(.3)), F(0), F(1))
    transition = (value > F(.3)) & (value < F(.32))
    allowed = np.where(transition, np.minimum(allowed, (F(.32) - value) * F(50)), allowed)
    result[..., :2] = face_rgb[..., :2]
    result[..., 2] = np.minimum(face_rgb[..., 2], allowed)
    area = np.where(face_rgb[..., 1] >= F(.1), face_rgb[..., 1], skin_alpha)
    result[..., 3] = area * strength
    return result


def line_filter(*, samples, active, vertical):
    samples = unit_pixels(values=samples, channels=4)
    if samples.ndim < 2 or samples.shape[-2] != 9 or type(vertical) is not bool:
        raise ValueError('center followed by four negative/positive sample pairs required')
    active = np.asarray(active)
    if active.dtype != bool or active.shape != samples.shape[:-2]:
        raise ValueError('matching boolean smoothing coverage required')
    center = samples[..., 0, :]
    total = center[..., :3] * F(.18)
    weight_sum = np.full(active.shape, F(.18), F)
    green_sum = center[..., 1].copy()
    for index, coefficient in enumerate((.15, .15, .12, .12, .09, .09, .05, .05), start=1):
        neighbor = samples[..., index, :]
        delta = neighbor[..., :3] - center[..., :3]
        distance = np.sqrt(np.sum(delta * delta, axis=-1, dtype=F))
        weight = F(coefficient) * (F(1) - np.minimum(distance * F(5.2486386), F(1)))
        total += neighbor[..., :3] * weight[..., None]
        weight_sum += weight
        green_sum += neighbor[..., 1]
    filtered = total / weight_sum[..., None]
    transition = (weight_sum - F(.4)) / F(.1)
    filtered = np.where((weight_sum < F(.5))[..., None],
        center[..., :3] * (F(1) - transition[..., None]) + filtered * transition[..., None], filtered)
    filtered = np.where((weight_sum < F(.4))[..., None], center[..., :3], filtered)
    result = center.copy()
    result[..., :3] = np.where(active[..., None], filtered, center[..., :3])
    alpha = green_sum * F(.1111)
    if vertical:
        variance = (center[..., 1] - alpha) * F(7.07)
        alpha = np.minimum(variance * variance, F(1))
    result[..., 3] = np.where(active, alpha, center[..., 3])
    return result


def recombine(*, original, corrected, broad, repeated, control, skin_alpha):
    arrays = [unit_pixels(values=value, channels=4) for value in (original, corrected, broad, repeated, control)]
    original, corrected, broad, repeated, control = arrays
    skin_alpha = np.asarray(skin_alpha)
    if (any(value.shape != original.shape for value in arrays) or skin_alpha.dtype != F
            or skin_alpha.shape != original.shape[:-1] or not np.isfinite(skin_alpha).all()
            or np.any(skin_alpha < 0) or np.any(skin_alpha > 1)):
        raise ValueError('matching unit smoothing samples required')
    variance_gate = F(1) - corrected[..., 3] / (corrected[..., 3] + F(.5))
    area = np.where(control[..., 1] >= F(.005), control[..., 2], skin_alpha) * skin_alpha * variance_gate
    intensity = control[..., 3]
    detail = (corrected[..., :3] - broad[..., :3]) / F(2) + F(.5)
    reconstructed = np.clip((repeated[..., :3] + detail * F(2)) - F(1), F(0), F(1))
    even = corrected[..., :3] * (F(1) - area[..., None]) + reconstructed * area[..., None]
    extra = np.where(intensity >= F(.6), intensity - F(.3), F(.3)) * area
    even = even * (F(1) - extra[..., None]) + repeated[..., :3] * extra[..., None]
    mix_strength = np.where(intensity >= F(.6), F(1), intensity * F(1.67))
    result = original.copy()
    result[..., :3] = original[..., :3] * (F(1) - mix_strength[..., None]) + even * mix_strength[..., None]
    return result
