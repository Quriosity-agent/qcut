"""Swan neck state from its descriptor (halves, coefficients and bounds)."""
from dataclasses import dataclass, field, replace
import numpy as np
from body_hip_state import State as HipState, Part as HipPart, prepare as hip_prepare
f = np.float32

@dataclass
class State:
    active: bool = False
    mode: int = 1
    intensity: float = 0.0
    target: float = 0.35
    step: float = 2.0
    coefficients: tuple = (1.0, 1.0)
    halves: list = field(default_factory=list)

def prepare(s, part, w, h):
    s = replace(s, halves=[dict(x) for x in s.halves])
    if part is None:
        return s
    if part['valid'] and (not s.active or s.mode != 2):
        s.active = True
        s.coefficients = tuple(map(f, part['coefficients']))
        halves = []
        for half in part['halves']:
            center = np.asarray(half['center'], np.float32)
            axis = np.asarray(half['axis'], np.float32)
            perp = np.asarray(half['perpendicular'], np.float32)
            left, right, negative, positive = map(f, half['radii'])
            a = f(center - f(axis * left))
            b = f(center + f(axis * right))
            u = f(perp * negative)
            d = f(perp * positive)
            corners = np.array([f(a - u), f(b - u), f(a + d), f(b + d)], np.float32)
            halves.append({'center': tuple(center), 'axis': tuple(axis), 'perpendicular': tuple(perp), 'radii': (left, right, positive, negative), 'bounds': (min(corners[:, 0]), max(corners[:, 0]), min(corners[:, 1]), max(corners[:, 1]))})
        s.halves = halves
    updated = hip_prepare(HipState(active=True, mode=2, intensity=s.intensity, target=s.target, step=s.step), HipPart(part['valid']), w, h)
    s.intensity = updated.intensity
    s.step = f(0.1)
    return s
