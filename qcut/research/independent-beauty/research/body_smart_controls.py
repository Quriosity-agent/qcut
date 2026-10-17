"""Smart-body controls: the editor's ten sliders and the targets the body parts take.

The effect divides each slider value by 100, multiplies it by a per-part factor (one for
positive values, one for negative ones) in double precision and stores the product as
float32. Long legs at 35 therefore target float32(0.35 * 0.35) = 0.1225, not 0.35.
"""
import math
import numbers

import numpy as np

# control: (body part, slider minimum, slider maximum, negative factor, positive factor)
CONTROLS = {
    'SmallHead': ('SmallHead', 0, 100, 0.0, 0.2),
    'StretchLeg': ('LongLeg', 0, 100, 0.0, 0.35),
    'SlimWaist': ('SlimWaist', 0, 100, 0.0, 0.25),
    'SlimBody': ('SlimBody', 0, 100, 0.0, 0.3),
    'OrthoShoulder': ('OrthoShoulder', 0, 100, 1.0, 1.0),
    'WidenShoulderTest': ('WidenShoulder', -50, 50, 2.0, 2.0),
    'SwanNeck': ('SwanNeck', 0, 100, 0.0, 0.55),
    'SlimHip': ('SlimHip', -50, 50, 0.84, 1.4),
    'SlimArm': ('SlimArm', 0, 100, 0.0, 1.0),
    'SlimBreast': ('SlimBreast', -50, 50, 0.6, 1.1),
}


def validate_controls(*, values):
    """A non-empty mapping of known controls to finite values within their slider ranges."""
    if not isinstance(values, dict) or not values:
        raise ValueError('smart body controls must be a non-empty object')
    unknown = sorted(set(values) - set(CONTROLS))
    if unknown:
        raise ValueError('unsupported smart body controls: ' + ', '.join(map(str, unknown)))
    result = {}
    for name, value in values.items():
        _, minimum, maximum, _, _ = CONTROLS[name]
        if isinstance(value, bool) or not isinstance(value, numbers.Real) or not math.isfinite(value) \
                or not minimum <= value <= maximum:
            raise ValueError(f'{name} must be a finite number in [{minimum}, {maximum}]')
        result[name] = 0.0 if value == 0 else float(value)
    return result


def internal_targets(*, values):
    """Every part's float32 target for validated slider values; parts without a control are 0."""
    targets = {part: np.float32(0) for part, *_ in CONTROLS.values()}
    for name, value in values.items():
        part, _, _, negative, positive = CONTROLS[name]
        targets[part] = np.float32((positive if value > 0 else negative) * (value / 100))
    return targets
