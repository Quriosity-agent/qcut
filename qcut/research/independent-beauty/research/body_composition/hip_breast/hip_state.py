"""Independent controlled axis-aligned SlimHip state preparation (Part7)."""

from dataclasses import dataclass, replace
import numpy as np

f = np.float32


@dataclass
class State:
    active: bool = False
    mode: int = 1
    intensity: float = 0.0
    target: float = 0.35
    step: float = 2.0
    center: tuple = (0.0, 0.0)
    radii: tuple = (1.0, 1.0, 1.0, 1.0)
    bounds: tuple = (0.0, 1.0, 0.0, 1.0)
    amplitude: float = 0.3
    profile: tuple = (0.5, 0.0, 0.5, 0.3, 0.3)
    strategy: int = 65536


@dataclass
class Part:
    valid: bool = True
    center: tuple = (72.0, 96.0)
    radii: tuple = (50.0, 55.0, 70.0, 65.0)


def ratio(a, b):
    with np.errstate(divide="ignore", invalid="ignore"):
        return f(np.minimum(f(a / b), f(1)))


def prepare(s, p, w, h):

    s = replace(s)
    if p is None:
        return s
    if p.valid and (not s.active or s.mode != 2):
        cx, cy = map(f, p.center)
        l, r, down, up = map(f, p.radii)
        l = min(l, cx)
        r = min(r, f(f(w) - f(1) - cx))
        up = min(up, f(f(h) - f(1) - cy))
        down = min(down, cy)
        s.active = True
        s.center = (cx, cy)
        s.radii = (l, r, down, up)
        s.bounds = (f(cx - l), f(cx + r), f(cy - down), f(cy + up))
        s.profile = (
            s.profile[0],
            s.profile[1],
            s.profile[2],
            f(ratio(l, r) * f(s.amplitude)),
            f(ratio(r, l) * f(s.amplitude)),
        )
    from ctypes import CDLL, c_float

    powf = CDLL(None).powf
    powf.argtypes = [c_float, c_float]
    powf.restype = c_float
    old, target, step = map(f, (s.intensity, s.target if p.valid else 0, s.step))
    delta = f(old - target)
    if abs(delta) < f(1e-06):
        s.intensity = target
    else:
        amount = f(max(f(powf(step, f(abs(delta) + f(1)))), f(0.02)) * step)
        s.intensity = (
            f(max(target, f(old - amount)))
            if target <= old
            else f(min(target, f(old + amount)))
        )
    s.profile = (s.profile[0], f(0.3) if s.intensity > 0 else f(0), *s.profile[2:])
    s.step = f(0.1)
    return s
