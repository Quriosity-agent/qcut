"""Independent Neck descriptor single matched face, orientation0/bit16 branch."""

import numpy as np
from ..hip_breast.hip_descriptor import ema
from ..hip_breast.breast_descriptor import clip_radius
from ..hip_breast.public_basis import normalized, norm
from .face_points import extract
import ctypes as C, math

f = np.float32


def project_x(center, axis, point):
    x, y = map(f, center)
    a, b = map(f, axis)
    px, py = map(f, point)
    dy = f(y - f(y + b))
    dx = f(f(x + a) - x)
    d = f(f(dy * dy) + f(dx * dx))
    if abs(d) < np.finfo(np.float32).eps:
        return np.array([-1, py], np.float32)
    cross = f(f(x * f(y + b)) - f(y * f(x + a)))
    num = f(f(px * f(dx * dx)) - f(py * f(dy * dx)))
    num = f(num - f(dy * cross))
    ny = f(f(f(py * f(dy * dy)) - f(px * f(dy * dx))) - f(dx * cross))
    return np.array([f(num / d), f(ny / d)], np.float32)


def neck_axis(angle):

    class Pair(C.Structure):
        _fields_ = [("s", C.c_float), ("c", C.c_float)]

    fn = C.CDLL(None).__sincosf_stret
    fn.argtypes = [C.c_float]
    fn.restype = Pair
    p = fn(f(angle))
    return normalized(np.array([p.c, f(-f(p.s))], np.float32))


class NeckDescriptor:
    def __init__(self):
        self.radL = f(-1)
        self.radR = f(-1)

    def update(self, seq, basis, head, faces, w, h, shoulder_count=2):
        valid = bool(
            shoulder_count == 2
            and head.data[60]
            and (head.get(56) >= 0)
            and (len(faces) > 0)
        )
        if not valid:
            return {"valid": False, "halves": [], "coefficients": (1.0, 1.0)}
        selected = int(__import__("struct").unpack_from("i", head.data, 56)[0])
        roll = head.get(68)
        support = extract(faces[selected], w, h, roll)
        scale = f(seq.scale)
        pubaxis = np.asarray(basis.axis, np.float32)
        pubperp = np.asarray(basis.perp, np.float32)
        base = np.maximum(
            np.minimum(f(seq.sh_smooth + f(f(pubperp * scale) * f(0.1))), [w, h]), 0
        ).astype(np.float32)
        halves = []
        for j in range(2):
            angle = (
                f(float(basis.angle) + (math.pi / 4 if j == 0 else -math.pi / 4))
                if basis.angle != f(-1)
                else f(math.pi / 4 if j == 0 else -math.pi / 4)
            )
            axis = neck_axis(angle)
            perp = np.array([axis[1], f(-axis[0])], np.float32)
            offset = f(f(pubaxis * scale) * f(0.1))
            center = f(base - offset) if j == 0 else f(base + offset)
            center = np.maximum(np.minimum(center, [w, h]), 0).astype(np.float32)
            target = f(scale * f(0.3))
            radius = ema(self.radL if j == 0 else self.radR, target, 0.5)
            if j == 0:
                self.radL = radius
            else:
                self.radR = radius
            radius = clip_radius(-axis if j == 0 else axis, radius, center, w, h)
            if j == 0:
                self.radL = radius
            else:
                self.radR = radius
            vertical = clip_radius(-perp, target, center, w, h)
            p = project_x(center, axis, support[1 + j])
            rel = f(support[1 + j] - p)
            dot = f(f(rel[0] * perp[0]) + f(rel[1] * perp[1]))
            if dot <= 0:
                vertical = f(min(float(norm(rel)), float(vertical)))
            else:
                vertical = f(0)
            center = f(center - f(f(perp * vertical) * f(0.6)))
            negative = f((1.0 - float(f(0.6))) * float(vertical))
            positive = f(vertical * f(0.6))
            radii = (
                (radius, f(0), negative, positive)
                if j == 0
                else (f(0), radius, negative, positive)
            )
            halves.append(
                {
                    "center": tuple(center),
                    "axis": tuple(axis),
                    "perpendicular": tuple(perp),
                    "radii": radii,
                }
            )
        return {"valid": True, "halves": halves, "coefficients": (f(1), f(1))}
