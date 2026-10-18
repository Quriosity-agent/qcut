"""QCut slider percentages to the installed body package's internal targets."""

import math
from numbers import Real

import numpy as np


# Part, negative multiplier, positive multiplier, editor percentage range.
RULES = {
    "body_adjust_SmallHead": ("SmallHead", 0.0, 0.2, 0, 100),
    "body_adjust_StretchLeg": ("LongLeg", 0.0, 0.35, 0, 100),
    "body_adjust_SlimWaist": ("SlimWaist", 0.0, 0.25, 0, 100),
    "body_adjust_SlimBody": ("SlimBody", 0.0, 0.3, 0, 100),
    "body_adjust_OrthoShoulder": ("OrthoShoulder", 1.0, 1.0, 0, 100),
    "body_adjust_WidenShoulderTest": ("WidenShoulder", 2.0, 2.0, -50, 50),
    "body_adjust_SwanNeck": ("SwanNeck", 0.0, 0.55, 0, 100),
    "body_adjust_SlimHip": ("SlimHip", 0.84, 1.4, -50, 50),
    "body_adjust_SlimArm": ("SlimArm", 0.0, 1.0, 0, 100),
    "body_adjust_SlimBreast": ("SlimBreast", 0.6, 1.1, -50, 50),
}
BODY_ORDER = tuple(rule[0] for rule in RULES.values())


def internal_targets(*, values):
    """Convert editor percentages once; omitted controls disable their part."""
    if not isinstance(values, dict):
        raise ValueError("body slider values must be an object")
    if any(not isinstance(key, str) for key in values):
        raise ValueError("body control names must be strings")
    unknown = set(values) - RULES.keys()
    if unknown:
        raise ValueError("Unknown body controls: " + ", ".join(sorted(unknown)))
    targets = {}
    for key, (part, negative, positive, minimum, maximum) in RULES.items():
        value = values.get(key, 0)
        if (
            isinstance(value, (bool, np.bool_))
            or not isinstance(value, Real)
            or not math.isfinite(value)
            or not minimum <= value <= maximum
        ):
            raise ValueError(
                f"{key} must be a finite percentage in [{minimum}, {maximum}]"
            )
        multiplier = positive if value > 0 else negative
        # Lua multiplies doubles; the component's property stores float32.
        targets[part] = np.float32(float(value) / 100 * multiplier)
    return targets


def validate_controls(*, controls):
    """Unprefixed research controls; an empty mapping advances a zero-target sequence."""
    names = {key.removeprefix("body_adjust_") for key in RULES}
    if not isinstance(controls, dict) or any(not isinstance(key, str) or key not in names for key in controls):
        raise ValueError("supported intelligent-body control names required")
    targets = internal_targets(values={f"body_adjust_{key}": value for key, value in controls.items()})
    return {key: float(value) if value else 0.0 for key, value in controls.items()}, targets
