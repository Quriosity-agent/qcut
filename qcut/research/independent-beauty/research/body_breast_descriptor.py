"""Bust descriptor: center and radii from the torso basis, the public measurements and the head."""
import ctypes as C
import numpy as np
from body_hip_descriptor import ema
f = np.float32

def clip_radius(direction, radius, center, w, h):
    direction = np.asarray(direction, np.float32)
    radius = f(radius)
    center = np.asarray(center, np.float32)
    end = np.minimum(np.maximum(f(direction * radius + center), f(0)), np.array([f(w) - f(1), f(h) - f(1)], np.float32))
    delta = f(end - center)
    values = [f(delta[i] / direction[i]) if abs(direction[i]) >= np.finfo(np.float32).eps else radius for i in range(2)]
    return f(-0.0) if values[0] == 0 and values[1] == 0 and any((np.signbit(x) for x in values)) else f(min(values))

class BreastDescriptor:

    def __init__(self):
        self.center = np.full(2, -1, np.float32)
        self.radii = np.full(4, -1, np.float32)

    def update(self, seq, axis, perp, w, h, shoulder_count, strategy=65536, head=None):
        if shoulder_count != 2 or seq.scale <= 0 or seq.turnvar <= 0:
            return {'valid': False, 'center': tuple(self.center), 'radii': tuple(self.radii)}
        scale = f(seq.scale)
        frontal = f(seq.turnvar)
        side = seq.yaw < 0
        offset = f(f(scale * f(f(1) - frontal)) * f(0.7))
        vertical = f(scale * f(0.26 if strategy & 65536 else 0.295))
        if not strategy & 65536 and head is not None and head.data[228] and (frontal > f(0.75)):
            from body_public_basis import norm, unary

            def down_angle(v):
                v = np.asarray(v, np.float32)
                q = f(f(-v[1]) / norm(v))
                return unary('acosf', f(min(max(q, f(-1)), f(1))))
            if down_angle(perp) < f(0.174) and down_angle(seq.hip_smooth - seq.sh_smooth) < f(0.174):
                offset = f(f(f(f(1) - frontal) * head.get(240)) * f(0.6))
        offset = f(-offset) if side else offset
        target = f(f(seq.sh_smooth + f(np.asarray(perp, np.float32) * vertical)) + f(np.asarray(axis, np.float32) * offset))
        target = np.minimum(np.maximum(target, 0), np.array([w, h], np.float32))
        self.center = np.array([ema(x, y, 0.1) for x, y in zip(self.center, target)], np.float32)
        fn = C.CDLL(None).powf
        fn.argtypes = [C.c_float, C.c_float]
        fn.restype = C.c_float
        power = f(fn(frontal, f(1.5)))
        radius = f(scale * f(0.4))
        left = f(radius * power) if side else radius
        right = radius if side else f(radius * power)
        targets = (left, right, f(scale * f(0.22)), f(scale * f(0.19)))
        self.radii = np.array([ema(x, y, 0.5) for x, y in zip(self.radii, targets)], np.float32)
        valid = bool(self.radii[0] >= np.finfo(np.float32).eps and self.radii[1] >= np.finfo(np.float32).eps)
        directions = [-np.asarray(axis, np.float32), np.asarray(axis, np.float32), -np.asarray(perp, np.float32), np.asarray(perp, np.float32)]
        self.radii = np.array([clip_radius(d, r, self.center, w, h) for d, r in zip(directions, self.radii)], np.float32)
        return {'valid': valid, 'center': tuple(self.center), 'radii': tuple(self.radii)}
