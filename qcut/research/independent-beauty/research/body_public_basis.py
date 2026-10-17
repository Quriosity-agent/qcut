"""The torso's affine basis (shoulder/hip axis and its perpendicular) from the public measurements."""
import ctypes as C
import numpy as np
from body_hip_descriptor import ema
f = np.float32
libm = C.CDLL(None)

def unary(name, x):
    fn = getattr(libm, name)
    fn.argtypes = [C.c_float]
    fn.restype = C.c_float
    return f(fn(f(x)))

class SinCos(C.Structure):
    _fields_ = [('s', C.c_float), ('c', C.c_float)]

def sincos_axis(a):
    fn = libm.__sincosf_stret
    fn.argtypes = [C.c_float]
    fn.restype = SinCos
    p = fn(f(a))
    return np.array([f(p.c), f(-f(p.s))], np.float32)

def norm(v):
    return f(np.sqrt(f(f(v[0] * v[0]) + f(v[1] * v[1]))))

def normalized(v):
    v = np.asarray(v, np.float32)
    n = norm(v)
    return v / n if n >= np.finfo(np.float32).eps else np.array([1, 0], np.float32)

def angle(v):
    v = np.asarray(v, np.float32)
    n = norm(v)
    r = f(v[0] / n)
    a = unary('acosf', f(min(max(r, f(-1)), f(1))))
    return f(-a) if v[1] > 0 else a

class PublicBasis:

    def __init__(self):
        self.hip_width = f(-1)
        self.angle = f(-1)
        self.axis = np.array([1, 0], np.float32)
        self.perp = np.array([0, -1], np.float32)

    def update(self, seq, coords, vis, w, h):
        p = np.asarray(coords, np.float32) * np.array([w, h], np.float32)
        v = np.asarray(vis, bool)
        groups = [[p[i] for i in ids if v[i] and np.all(p[i] > 0) and np.all(p[i] < [w, h])] for ids in [[2, 5], [8, 11]]]
        sh, hip = groups
        direct = lambda a: np.asarray(a[1] - a[0] if a[0][0] <= a[1][0] else a[0] - a[1], np.float32)
        if len(hip) == 2:
            self.hip_width = ema(self.hip_width, norm(np.asarray(hip[0] - hip[1], np.float32)), 0.7)
        target = f(0)
        if len(sh) == 2 and len(hip) == 2:
            first = ema(angle(direct(hip)), angle(direct(sh)), f(0.25))
            d = seq.hip_smooth - seq.sh_smooth
            rotation = angle(normalized(np.array([-d[1], d[0]], np.float32)))
            alpha = f(min(f(f(seq.width + self.hip_width) / seq.scale), f(1)))
            target = ema(first, rotation, alpha)
        elif len(sh) == 2 and seq.width > f(seq.scale * f(0.3)):
            target = angle(direct(sh))
        elif len(hip) == 2:
            target = angle(direct(hip))
        if abs(target) >= np.finfo(np.float32).eps:
            self.angle = ema(self.angle, target, 0.8)
            axis = normalized(sincos_axis(self.angle))
            self.axis = axis
            self.perp = np.array([axis[1], f(-axis[0])], np.float32)
        return (self.axis, self.perp)
