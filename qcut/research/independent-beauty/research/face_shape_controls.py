"""Validated public face controls and their compound float32 mesh degrees."""
from collections.abc import Mapping
import json
import numbers
from pathlib import Path

import numpy as np

DEFINITIONS = json.loads(Path(__file__).with_name("face-shape-controls.json").read_text())
CONTROLS = {entry["name"]: (entry["min"], entry["max"]) for entry in DEFINITIONS}
RANGES = {entry["name"]: (entry["degree"], entry["negative"], entry["positive"])
          for entry in DEFINITIONS if "degree" in entry}
EVENT_SCALES = {entry["name"]: entry["eventScale"] for entry in DEFINITIONS}


def validate_controls(*, values):
    if not isinstance(values, Mapping):
        raise ValueError("expected a face control object")
    if any(not isinstance(name, str) for name in values):
        raise ValueError("face control names must be strings")
    if set(values) - set(CONTROLS):
        raise ValueError("unsupported independent face controls: " + ", ".join(sorted(set(values) - set(CONTROLS))))
    result = {}
    for name, value in values.items():
        minimum, maximum = CONTROLS[name]
        if isinstance(value, (bool, np.bool_)) or not isinstance(value, numbers.Real):
            raise ValueError(f"{name} must be numeric")
        if not np.isfinite(value) or not minimum <= value <= maximum:
            raise ValueError(f"{name} must be {minimum}..{maximum}")
        result[name] = float(value)
    return result


def mesh_degrees(*, values):
    values = validate_controls(values=values)
    result = np.zeros(23, np.float64)
    result[20] = 2
    for name, value in values.items():
        fraction = value / 100 * EVENT_SCALES.get(name, 1)
        if name == "TotalFace":
            for index, coefficient in ((0, .08), (10, -.2), (12, -.01), (19, -.2)):
                result[index] += coefficient * fraction
            continue
        index, negative, positive = RANGES[name]
        result[index] += -fraction * negative if fraction < 0 else fraction * positive
    return result.astype(np.float32)


def mesh_active(*, values):
    return any(abs(value / 100 * EVENT_SCALES.get(name, 1)) > .001
               for name, value in validate_controls(values=values).items())
