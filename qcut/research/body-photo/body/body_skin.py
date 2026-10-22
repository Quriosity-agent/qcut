"""Local body tone and small texture softening, isolated from face beauty rendering."""
import hashlib
import numbers

import numpy as np

if __package__:
    from .skin_blemish import soften_small_spots
    from .skin_mask import build_skin_mask, lab_to_rgb, normalize_person_mask, rgb_to_lab, validate_rgba
else:
    from skin_blemish import soften_small_spots
    from skin_mask import build_skin_mask, lab_to_rgb, normalize_person_mask, rgb_to_lab, validate_rgba


BOUNDS = {"BodySkinTone": (-50, 50), "BodySkinWarmth": (-50, 50),
          "BodySkinSmooth": (0, 100), "BodyBlemish": (0, 100)}


def _controls(*, controls):
    if not isinstance(controls, dict):
        raise ValueError("body skin controls must be an object")
    values = {}
    for name, (low, high) in BOUNDS.items():
        value = controls.get(name, 0)
        if (isinstance(value, (bool, np.bool_)) or not isinstance(value, numbers.Real)
                or not np.isfinite(value) or not low <= value <= high):
            raise ValueError("invalid body skin strength: " + name)
        values[name] = float(value)
    return values


def _box_average(*, array, radius):
    value = np.asarray(array, np.float32)
    for axis in (0, 1):
        padding = [(0, 0)] * value.ndim
        padding[axis] = (radius, radius)
        extended = np.pad(value, padding, mode="edge")
        zero_shape = list(extended.shape)
        zero_shape[axis] = 1
        cumulative = np.concatenate((np.zeros(zero_shape, np.float32),
                                     np.cumsum(extended, axis=axis, dtype=np.float32)), axis=axis)
        upper, lower = [slice(None)] * value.ndim, [slice(None)] * value.ndim
        upper[axis], lower[axis] = slice(2 * radius + 1, None), slice(None, -2 * radius - 1)
        value = (cumulative[tuple(upper)] - cumulative[tuple(lower)]) / (2 * radius + 1)
    return value


def _skin_average(*, rgb, mask, radius):
    denominator = _box_average(array=mask, radius=radius)
    numerator = _box_average(array=rgb * mask[..., None], radius=radius)
    return np.where(denominator[..., None] > 1e-5,
                    numerator / np.maximum(denominator[..., None], 1e-5), rgb)


def _effect(*, name, value, rgb, mask):
    if name in ("BodySkinTone", "BodySkinWarmth"):
        lab = rgb_to_lab(rgb=rgb)
        if name == "BodySkinTone":
            lab[..., 0] = np.clip(lab[..., 0] + value / 50 * 18, 0, 100)
        else:
            lab[..., 1] += value / 50 * 2
            lab[..., 2] += value / 50 * 10
        return lab_to_rgb(lab=lab), np.ones(mask.shape, np.float32)
    radius = max(1, min(6, round(min(mask.shape) / 420)))
    average = _skin_average(rgb=rgb, mask=mask, radius=radius)
    residual = rgb_to_lab(rgb=average)[..., 0] - rgb_to_lab(rgb=rgb)[..., 0]
    if name == "BodySkinSmooth":
        strength = np.exp(-np.abs(residual) / 18) * value / 100 * .65
        return average, strength
    raise ValueError("unknown body skin effect: " + name)


def apply_body_skin(*, rgba, person_mask, pose, algorithm_size, controls, faces=None):
    """Edit original pixels before warping; missing reliable skin seeds return identity.

    Faces contain original-pixel 106 landmarks, xywh box and detector score.
    Pose is CPM18 algorithm-pixel x/y/score/visible; person_mask is a matching
    bool, uint8 or normalized float silhouette. Neither mask is semantic skin truth.
    """
    validate_rgba(rgba=rgba)
    values = _controls(controls=controls)
    result = rgba.copy()
    parts = {name: {"intensity": value / 100, "value": value, "moved": False,
                    "changedPixels": 0, "reasonCode": "zero"} for name, value in values.items()}
    if not any(values.values()):
        return result, parts
    mask, selection = build_skin_mask(rgba=rgba, person_mask=person_mask, pose=pose,
                                     algorithm_size=algorithm_size, faces=faces)
    if not selection["available"]:
        for name, value in values.items():
            if value:
                parts[name].update(reasonCode=selection["reasonCode"], skinSelection=selection)
        return result, parts
    union_support = mask > 0
    for name, value in values.items():
        if not value:
            continue
        before = result[..., :3].copy()
        effect_mask = mask
        if name == "BodyBlemish":
            guard = (normalize_person_mask(person_mask=person_mask, shape=mask.shape) >= .9) & (rgba[..., 3] == 255)
            x0, y0, x1, y1 = selection['headProtectedBoxXYXY']
            guard[y0:y1, x0:x1] = False
            target, weight, effect_mask, blemish = soften_small_spots(
                rgb=before.astype(np.float32), mask=mask, value=value, repair_guard=guard)
            parts[name]["blemishDetection"] = blemish
        else:
            target, weight = _effect(name=name, value=value, rgb=before.astype(np.float32), mask=mask)
        support = effect_mask > 0
        union_support |= support
        untouched_hash = hashlib.sha256(result[~support].tobytes()).hexdigest()
        weight = np.clip(effect_mask * weight, 0, 1)[..., None]
        blended = np.clip(np.rint(before + (target - before) * weight), 0, 255).astype(np.uint8)
        result[..., :3][support] = blended[support]
        changed = int(np.count_nonzero(np.any(result[..., :3] != before, axis=-1)))
        assert hashlib.sha256(result[~support].tobytes()).hexdigest() == untouched_hash
        parts[name].update(moved=changed > 0, changedPixels=changed,
                           reasonCode=None if changed else "no-visible-change", skinSelection=selection,
                           protectedPixels=int(np.count_nonzero(~support)), changedProtectedPixels=0,
                           protectedRgbaSha256=untouched_hash, alphaUnchanged=True,
                           textureGenerated=False, method={
                               "BodySkinTone": "local-lab-lightness",
                               "BodySkinWarmth": "local-lab-warmth",
                               "BodySkinSmooth": "masked-edge-aware-local-average",
                               "BodyBlemish": "multiscale-isolated-dark-spot-repair",
                           }[name])
    assert np.array_equal(result[..., 3], rgba[..., 3])
    assert np.array_equal(result[~union_support], rgba[~union_support])
    return result, parts
