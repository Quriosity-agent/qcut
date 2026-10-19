"""Independent NumPy float32 translation of observed NsLongLeg state preparation.
Inputs are decoded body-part descriptor fields, NOT raw network output.
No native library is loaded by this module.
"""

from dataclasses import dataclass
import numpy as np

f = np.float32


@dataclass
class Part4:
    valid: bool
    end: float
    pivot: float
    left_valid: bool = False
    left: tuple = (-1.0, -1.0)
    right_valid: bool = False
    right: tuple = (-1.0, -1.0)


@dataclass
class State:
    mode: int = 1
    active: bool = False
    width: float = -1.0
    end: float = -1.0
    pivot: float = -1.0
    strategy: int = 0
    foot: tuple = (-1.0, -1.0)
    target: float = 0.35
    intensity: float = 0.0
    step: float = 0.05


def ema(old, new, a):
    old, new, a = map(f, (old, new, a))
    return (
        new
        if abs(f(old + f(1))) <= np.finfo(np.float32).eps
        else f(f(f(old - new) * a) + new)
    )


def intensity_update(old, target, step):
    old, target, step = map(f, (old, target, step))
    delta = f(old - target)
    if abs(delta) < f(1e-06):
        return target
    power = f(np.power(step, f(abs(delta) + f(1))))
    power = max(power, f(0.02))
    return (
        f(max(target, f(old - f(power * step))))
        if target <= old
        else f(min(target, f(f(power * step) + old)))
    )


def prepare(
    state,
    part4,
    width,
    height,
    strategy=0,
    part5_valid=False,
    part5_y=0.0,
    body_scale=0.0,
):
    s = State(**vars(state))
    if part4 is None:
        return s
    if part4.valid:
        if not s.active or s.mode != 2:
            s.active = True
            hold = False
            y = f(part5_y)
            scale = f(body_scale)
            if part5_valid and f(0) < y < s.end:
                if s.pivot < f(y + f(scale * f(-0.1))):
                    hold = f(s.end - s.pivot) < f(scale * f(0.85))
            if s.mode == 1:
                s.width = f(width)
                s.end = f(min(f(part4.end), f(height)))
                s.pivot = f(min(f(part4.pivot), s.end))
            elif not hold:
                s.width = f(width)
                s.end = f(min(ema(s.end, part4.end, 0.7), f(height)))
                s.pivot = f(min(ema(s.pivot, part4.pivot, 0.95), s.end))
            s.strategy = strategy
            s.foot = (-1.0, -1.0)
            if part4.left_valid:
                s.foot = tuple(map(f, part4.left))
            if part4.right_valid:
                if not part4.left_valid or s.foot == (-1.0, -1.0):
                    s.foot = tuple(map(f, part4.right))
                else:
                    s.foot = tuple(
                        (
                            f(f(f(x) + f(y)) * f(0.5))
                            for x, y in zip(s.foot, part4.right)
                        )
                    )
    s.intensity = intensity_update(
        s.intensity, s.target if part4.valid else 0.0, s.step
    )
    s.step = f(0.05)
    return s
