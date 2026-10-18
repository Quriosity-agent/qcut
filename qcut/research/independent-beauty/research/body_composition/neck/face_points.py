"""Independent 106-point face -> ten neck support points, native float32 operations."""

import ctypes as C, math
import numpy as np

f = np.float32
libm = C.CDLL(None)


def trig(name, x):
    fn = getattr(libm, name)
    fn.argtypes = [C.c_float]
    fn.restype = C.c_float
    return f(fn(f(x)))


def rotated_bounds(points, angle):

    class Pair(C.Structure):
        _fields_ = [("s", C.c_float), ("c", C.c_float)]

    fn = libm.__sincosf_stret
    fn.argtypes = [C.c_float]
    fn.restype = Pair
    pair = fn(f(angle))
    c = f(pair.c)
    s = f(pair.s)
    p = np.asarray(points, np.float32)
    r = np.empty_like(p)
    r[:, 0] = f(f(p[:, 0] * c) - f(p[:, 1] * s))
    r[:, 1] = f(f(p[:, 1] * c) + f(p[:, 0] * s))
    mi = int(np.argmin(r[:, 1]))
    a = np.array(
        [[min(r[:, 0]), min(r[:, 1])], [max(r[:, 0]), min(r[:, 1])], r[mi]], np.float32
    )
    out = np.empty_like(a)
    out[:, 0] = f(f(a[:, 0] * c) + f(a[:, 1] * s))
    out[:, 1] = f(f(a[:, 1] * c) - f(a[:, 0] * s))
    return out


def intersect(p, q):

    def coeff(a):
        x0, y0 = a[0]
        x1, y1 = a[1]
        return (f(y0 - y1), f(x1 - x0), f(f(y1 * x0) - f(y0 * x1)))

    a, b, c = coeff(p)
    d, e, g = coeff(q)
    den = f(f(a * e) - f(b * d))
    if abs(den) < np.finfo(np.float32).eps:
        return np.array([-1, -1], np.float32)
    return np.array(
        [f(f(f(b * g) - f(c * e)) / den), f(f(f(c * d) - f(a * g)) / den)], np.float32
    )


def extract(face, w, h, roll=0.0):
    p = np.asarray(face, np.float32).reshape(106, 2) * np.array([w, h], np.float32)
    total = np.zeros(2, np.float32)
    for point in p:
        total = f(total + point)
    mean = f(total / f(106))
    p = f(p - mean)
    roll = f(roll)
    a = rotated_bounds(p, f(-f(float(roll) - math.pi / 3)))
    b = rotated_bounds(p, f(-f(float(roll) + math.pi / 3)))
    c = rotated_bounds(p, f(-roll))
    a = f(a + mean)
    b = f(b + mean)
    c = f(c + mean)
    left = intersect(a[[1, 0]], c[[1, 0]])
    right = intersect(b[[1, 0]], c[[1, 0]])
    return np.array(
        [a[0], left, right, b[1], a[0], a[1], b[0], b[1], c[0], c[1]], np.float32
    )
