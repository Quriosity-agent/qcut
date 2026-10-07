"""Validated face and organ controls accumulated into one float32 degree vector."""
from collections.abc import Mapping
from numbers import Real

import numpy as np

from face_shape_controls import DEFINITIONS as FACE_DEFINITIONS
from features_controls import DEFINITIONS as FEATURE_DEFINITIONS

DEFINITIONS = (*FACE_DEFINITIONS, *FEATURE_DEFINITIONS)
BY_NAME = {entry['name']: entry for entry in DEFINITIONS}


def normalize_controls(*, values):
    if (not isinstance(values, Mapping) or any(not isinstance(name, str) for name in values)
            or set(values) - set(BY_NAME)):
        raise ValueError('a mapping of supported face, eye, nose and mouth controls is required')
    result = {}
    for name, value in values.items():
        definition = BY_NAME[name]
        if (isinstance(value, (bool, np.bool_)) or not isinstance(value, Real)
                or not np.isfinite(value) or not definition['min'] <= value <= definition['max']):
            raise ValueError(f"{name} must be finite and in [{definition['min']},{definition['max']}]")
        result[name] = float(value)
    return result


def combined_degrees(*, values):
    values = normalize_controls(values=values)
    degrees = np.zeros(23, np.float64)
    degrees[20] = 2
    for definition in DEFINITIONS:
        name = definition['name']
        fraction = values.get(name, 0) / 100 * definition['eventScale']
        if name == 'TotalFace':
            for index, coefficient in ((0, .08), (10, -.2), (12, -.01), (19, -.2)):
                degrees[index] += coefficient * fraction
            continue
        coefficient = definition['negative'] if fraction < 0 else definition['positive']
        degrees[definition['degree']] += abs(fraction) * coefficient
    return degrees.astype(np.float32)


def controls_active(*, values):
    values = normalize_controls(values=values)
    return any(abs(value / 100 * BY_NAME[name]['eventScale']) > .001
               for name, value in values.items())
