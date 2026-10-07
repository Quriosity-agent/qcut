"""Independent eye, nose and mouth degree bindings for the shared face mesh."""
from numbers import Real

import numpy as np

DEFINITIONS = (
    {'name': 'EnlargeEye', 'title': '大眼', 'min': 0, 'max': 100,
     'degree': 1, 'eventScale': 1, 'negative': 0, 'positive': .14},
    {'name': 'EyeSpacing', 'title': '眼距', 'min': -50, 'max': 50,
     'degree': 0, 'eventScale': 4, 'negative': -.18, 'positive': .18},
    {'name': 'MoveEye', 'title': '眼高低', 'min': -50, 'max': 50,
     'degree': 3, 'eventScale': 3, 'negative': .2, 'positive': -.2},
    {'name': 'Nose', 'title': '瘦鼻', 'min': 0, 'max': 100,
     'degree': 4, 'eventScale': 1, 'negative': 0, 'positive': -.14},
    {'name': 'MoveNose', 'title': '鼻位移', 'min': -50, 'max': 50,
     'degree': 5, 'eventScale': 1, 'negative': .28, 'positive': -.28},
    {'name': 'ZoomMouth', 'title': '嘴大小', 'min': -50, 'max': 50,
     'degree': 7, 'eventScale': 7, 'negative': .12, 'positive': -.12},
    {'name': 'MoveMouth', 'title': '嘴高低', 'min': -50, 'max': 50,
     'degree': 6, 'eventScale': 2, 'negative': .36, 'positive': -.36},
)
BY_NAME = {entry['name']: entry for entry in DEFINITIONS}


def normalize_controls(*, values):
    if not isinstance(values, dict) or set(values) - set(BY_NAME):
        raise ValueError('a mapping of supported eye, nose and mouth controls is required')
    result = {}
    for name, value in values.items():
        definition = BY_NAME[name]
        if (isinstance(value, (bool, np.bool_)) or not isinstance(value, Real)
                or not np.isfinite(value) or not definition['min'] <= value <= definition['max']):
            raise ValueError(f"{name} must be finite and in [{definition['min']},{definition['max']}]")
        result[name] = float(value)
    return result


def feature_degrees(*, values):
    values = normalize_controls(values=values)
    degrees = np.zeros(23, np.float64)
    degrees[20] = 2
    for name, value in values.items():
        definition = BY_NAME[name]
        fraction = value / 100 * definition['eventScale']
        coefficient = definition['negative'] if fraction < 0 else definition['positive']
        degrees[definition['degree']] = abs(fraction) * coefficient
    return degrees.astype(np.float32)


def features_active(*, values):
    values = normalize_controls(values=values)
    return any(abs(value / 100 * BY_NAME[name]['eventScale']) > .001
               for name, value in values.items())
