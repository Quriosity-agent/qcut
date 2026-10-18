"""Validation at the normalized perception and internal-target boundary."""

import math
from numbers import Real

import numpy as np

from .controls import RULES


def resolve_targets(target):
    parts = [rule[0] for rule in RULES.values()]
    if isinstance(target, dict):
        if any(not isinstance(key, str) for key in target) or set(target) - set(parts):
            raise ValueError("Unknown body target names")
        values = {part: target.get(part, 0) for part in parts}
    else:
        values = {part: target for part in parts}
    if any(
        isinstance(value, (bool, np.bool_))
        or not isinstance(value, Real)
        or not math.isfinite(value)
        or abs(value) > 2
        for value in values.values()
    ):
        raise ValueError("Finite internal targets in [-2, 2] required")
    return {part: float(value) for part, value in values.items()}


def _float_array(*, value, shape, name):
    array = np.asarray(value, np.float32)
    if array.shape != shape or not np.isfinite(array).all():
        raise ValueError(f"{name} must be finite with shape {shape}")
    return np.ascontiguousarray(array)


def validate_inputs(*, coords, visibility, width, height, faces, rectangles, rolls):
    if any(
        isinstance(value, (bool, np.bool_))
        or not isinstance(value, (int, np.integer))
        or not 1 <= value <= 4096
        for value in (width, height)
    ):
        raise ValueError("positive image dimensions no greater than 4096 required")
    coords = _float_array(value=coords, shape=(18, 2), name="body coordinates")
    visible = np.asarray(visibility)
    if visible.shape != (18,) or not np.isin(visible, (0, 1)).all():
        raise ValueError("18 binary body visibility flags required")
    visible = visible.astype(np.uint8)
    if faces is None:
        if rectangles is not None or rolls is not None:
            raise ValueError("face metadata requires corresponding face points")
        return coords, visible, None, None, None
    count = len(faces)
    if count > 16:
        raise ValueError("at most 16 face candidates supported")
    faces = _float_array(value=faces, shape=(count, 106, 2), name="face coordinates")
    rectangles = _float_array(
        value=rectangles, shape=(count, 4), name="face rectangles"
    )
    rolls = _float_array(value=rolls, shape=(count,), name="face rolls")
    if np.any(rectangles[:, 2:] < 0):
        raise ValueError("face rectangle sizes cannot be negative")
    return coords, visible, faces, rectangles, rolls
