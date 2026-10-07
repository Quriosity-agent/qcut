"""System float32 sine/cosine rounding for the pinned macOS eye profile."""
import ctypes
import sys

import numpy as np


class SinCos(ctypes.Structure):
    _fields_ = [('sin', ctypes.c_float), ('cos', ctypes.c_float)]


def sincos(*, radians):
    if sys.platform != 'darwin' or not np.isfinite(radians) or abs(radians) > 16:
        raise ValueError('bounded macOS float32 eye trigonometry required')
    function = ctypes.CDLL(None).__sincosf_stret
    function.argtypes = [ctypes.c_float]
    function.restype = SinCos
    result = function(float(np.float32(radians)))
    return np.float32(result.sin), np.float32(result.cos)
