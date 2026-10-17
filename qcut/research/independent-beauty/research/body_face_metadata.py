"""Face metadata the body components read: the normalized rectangle (y up) and the filtered
yaw, pitch and roll. The filter starts at zero pose and keeps a three-component delta history."""
import ctypes as C
import math
import numpy as np
F = np.float32
DEGREE_TO_RADIAN = F(0.017453294)
_atanf = C.CDLL(None).atanf
_atanf.argtypes = [C.c_float]
_atanf.restype = C.c_float

def rectangle(points, size):
    p = np.asarray(points, F)
    w, h = size
    if p.shape != (106, 2) or not np.isfinite(p).all() or min(w, h) <= 0:
        raise ValueError('106 finite algorithm-pixel points and positive size required')
    lo = p.min(0)
    hi = p.max(0)
    x, y = np.trunc(lo).astype(np.int64)
    rw, rh = np.trunc(F(hi - lo)).astype(np.int64)
    return np.array([F(x) / F(w), F(h - y - rh) / F(h), F(rw) / F(w), F(rh) / F(h)], F)

def raw_roll(points):
    p = np.asarray(points, F)
    if p.shape != (106, 2) or not np.isfinite(p).all():
        raise ValueError('106 finite unfiltered decoded points required')
    eye = F(F(p[55] + p[58]) / F(2))
    mouth = F(F(p[84] + p[90]) / F(2))
    dx, dy = F(mouth - eye)
    angle = F(math.pi / 2) if dx == 0 else F(_atanf(float(abs(F(dy / dx)))))
    if dx >= 0 and dy < 0:
        angle = F(-(math.pi / 2 + float(angle)))
    elif dx < 0 and dy < 0:
        angle = F(math.pi / 2 + float(angle))
    elif dx < 0 and dy >= 0:
        angle = F(math.pi / 2 - float(angle))
    elif dx >= 0 and dy >= 0:
        angle = F(-(math.pi / 2 - float(angle)))
    angle = F(-angle)
    return F(float(F(angle * F(180))) / math.pi)

class PoseFilter:

    def __init__(self):
        self.current = np.zeros(3, F)
        self.delta = None

    def update_degrees(self, incoming):
        incoming = np.asarray(incoming, F)
        if incoming.shape != (3,) or not np.isfinite(incoming).all():
            raise ValueError('finite yaw/pitch/roll triple required')
        displacement = F(incoming - self.current)
        delta = displacement if self.delta is None else F(F(self.delta * F(0.2)) + F(displacement * F(0.8)))
        weight = np.array([math.exp(-math.pow(float(abs(d) / F(3)), 0.5)) for d in delta], F)
        self.current = F(F(self.current * weight) + F(incoming * F(F(1) - weight)))
        self.delta = delta
        return F(self.current * DEGREE_TO_RADIAN)

class FaceMetadata(PoseFilter):

    def update(self, result, size=None, algorithm_size=None):
        """Accept FaceSequence result; JSON rows need tracked_points plus raw heads."""
        size = algorithm_size if algorithm_size is not None else size
        if size is None:
            raise ValueError('explicit algorithm_size required')
        if 'algorithm_points' in result:
            points = np.asarray(result['algorithm_points'], F)
            tracked = np.asarray(result['tracked_points'], F)
            yaw, pitch = (result['raw_yaw'], result['raw_pitch'])
        else:
            points = result['points']
            tracked = result['tracked']
            heads = result['heads'][120]
            yaw = heads['fc_yaw'].reshape(-1)[0]
            pitch = heads['fc_pitch'].reshape(-1)[0]
        incoming = np.array([-F(yaw), -F(pitch), raw_roll(tracked)], F)
        radians = self.update_degrees(incoming)
        rect = rectangle(points, size)
        return {'rectangle': rect, 'roll': radians[2], 'rectangles': rect[None, :], 'yaw': radians[:1].copy(), 'pitch': radians[1:2].copy(), 'rolls': radians[2:3].copy(), 'raw_degrees': incoming.copy()}
