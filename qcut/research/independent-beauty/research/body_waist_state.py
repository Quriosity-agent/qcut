"""Slim waist and slim body states from their descriptors."""
from dataclasses import dataclass, replace
import numpy as np
from body_waist_geometry import GridState, f

@dataclass
class Part:
    valid: bool = True
    center: tuple = (72.0, 96.0)
    radii: tuple = (50.0, 50.0, 70.0, 70.0)
    sideways: bool = False
    flip: bool = False

@dataclass
class State(GridState):
    mode: int = 1
    target: float = 0.35
    step: float = 0.05

def intensity_update(old, target, step):
    old, target, step = map(f, (old, target, step))
    delta = f(old - target)
    if abs(delta) < f(1e-06):
        return target
    power = max(f(np.power(step, f(abs(delta) + f(1)))), f(0.02))
    amount = f(power * step)
    return f(max(target, f(old - amount))) if target <= old else f(min(target, f(old + amount)))

def prepare(s, part, w, h, kind='waist', strategy=0):
    s = replace(s, strategy=strategy)
    if part is None:
        return s
    if part.valid and (not s.active or s.mode != 2):
        s.active = True
        s.center = tuple(map(f, part.center))
        cx, cy = s.center
        l, r, down, up = map(f, part.radii)
        xmin = max(f(cx - l), f(1))
        xmax = min(f(cx + r), f(f(w) - f(1)))
        ymin = max(f(cy - down), f(0))
        ymax = min(f(cy + up), f(h))
        s.bounds = (xmin, xmax, ymin, ymax)
        lr = max(f(cx - xmin), f(1))
        rr = max(f(xmax - cx), f(1))
        dr = max(f(cy - ymin), f(1))
        ur = max(f(ymax - cy), f(1))
        if kind == 'body' and (not strategy & 65536):
            s.sideways = part.sideways
            s.flip = part.flip
            if not s.sideways:
                lr = max(l, f(1))
                rr = max(r, f(1))
        if kind == 'waist' and strategy & 65536:
            ur = f(ymax - cy)
        s.radii = (lr, rr, dr, ur)
        if kind == 'waist' and strategy == 257:
            s.axis = (f(1), f(0))
            s.perpendicular = (f(0), f(1))
    s.intensity = intensity_update(s.intensity, s.target if part.valid else 0.0, s.step)
    s.step = f(0.05)
    return s
