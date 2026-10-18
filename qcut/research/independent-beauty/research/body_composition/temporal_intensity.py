"""Float32 intensity ramp shared by the persistent head, arm and shoulder states."""

import ctypes

import numpy as np

F = np.float32
_powf = ctypes.CDLL(None).powf
_powf.argtypes = [ctypes.c_float, ctypes.c_float]
_powf.restype = ctypes.c_float


def approach(old, target, step):
    old, target, step = map(F, (old, target, step))
    delta = F(old - target)
    if abs(delta) < F(1e-6):
        return target
    power = F(max(F(_powf(float(step), float(F(abs(delta) + F(1))))), F(0.02)))
    if target <= old:
        return F(max(target, F(old - F(power * step))))
    return F(min(target, F(F(power * step) + old)))
