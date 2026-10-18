"""Independent WidenShoulder Part10 -> populated state, no segmentation input."""

import numpy as np
import ctypes as C

libm = C.CDLL(None)
libm.powf.argtypes = [C.c_float, C.c_float]
libm.powf.restype = C.c_float
F = np.float32
KEYS = [1, 2, 5, 3, 6]


def step_value(old, target, step):
    old, target, step = map(F, (old, target, step))
    d = F(old - target)
    if abs(d) < F(1e-06):
        return target
    power = F(max(F(libm.powf(float(step), float(F(abs(d) + F(1))))), F(0.02)))
    return (
        F(max(target, F(old - F(power * step))))
        if target <= old
        else F(min(target, F(F(power * step) + old)))
    )


def prepare(
    points,
    visibility,
    target=0.5,
    intensity=0.0,
    step=2.0,
    flip=False,
    strategy=0,
    previous=None,
):
    points = np.asarray(points, np.float32)
    visibility = np.asarray(visibility, bool)
    value = (
        step_value(intensity, target, step)
        if F(intensity) != F(target)
        else F(intensity)
    )
    return {
        "enabled": True,
        "target": float(F(target)),
        "intensity": float(value),
        "step": float(F(step)),
        "active": False,
        "strategy": strategy,
        "points": points[KEYS].tolist(),
        "visibility": visibility[KEYS].astype(np.uint8).tolist(),
        "flip": bool(flip),
        "history_invalid": True
        if F(intensity) != F(target)
        else bool(previous["history_invalid"] if previous else True),
        "segmentation": False,
    }


def from_descriptor(
    descriptor,
    target=0.5,
    intensity=0.0,
    step=2.0,
    flip=False,
    strategy=0,
    previous=None,
):
    p = np.full((18, 2), -1, np.float32)
    v = np.zeros(18, np.uint8)
    for key, point, valid in zip(
        descriptor["keys"], descriptor["points"], descriptor["point_valid"]
    ):
        p[key] = point
        v[key] = valid
    return prepare(p, v, target, intensity, step, flip, strategy, previous)
