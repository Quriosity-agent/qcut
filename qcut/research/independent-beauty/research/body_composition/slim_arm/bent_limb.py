"""Independent two-segment SlimArm geometry from explicitly populated limb state."""

import math
import ctypes as C

_system = C.CDLL(None)
for _name in ["tanf", "acosf"]:
    _fn = getattr(_system, _name)
    _fn.argtypes = [C.c_float]
    _fn.restype = C.c_float


def tanf(v):
    return F(_system.tanf(float(v)))


import numpy as np
from .straight_limb import F, length, dot, between, projection


def angle(a, b):
    cosine = F(dot(a, b) / F(length(a) * length(b)))
    return F(_system.acosf(float(np.clip(cosine, F(-1), F(1)))))


def cone(point, origin, a, b):
    a, b, p = (F(a - origin), F(b - origin), F(point - origin))
    if np.all(np.abs(p) < F(2 ** (-23))):
        return False
    a, b, p = (F(a / length(a)), F(b / length(b)), F(p / length(p)))
    total = angle(a, b)
    return bool(
        angle(a, p) < total and angle(p, b) < total and (dot(F(a + b), p) > F(0))
    )


def taper_upper(q, s, e, g):
    t = F(g["0x18c"])
    anchor = F(s + F(F(e - s) * t))
    seg = length(F(e - s))
    if dot(F(e - q), F(s - q)) <= F(0):
        if dot(F(anchor - q), F(s - q)) >= F(0):
            coefficient = F(g["0x190"])
            portion = F(F(1) - t)
        else:
            coefficient = F(g["0x194"])
            portion = t
        attenuation = F(1.0 - float(length(F(q - anchor))) / float(F(portion * seg)))
        return (
            F((1.0 - float(coefficient)) * float(attenuation) + float(coefficient))
            if portion != t
            else F(F(F(F(1) - coefficient) * attenuation) + coefficient)
        )
    if dot(F(e - s), F(q - s)) <= F(0):
        coefficient = F(g["0x194"])
        d = length(F(s - q))
    else:
        coefficient = F(g["0x190"])
        d = length(F(e - q))
    return (coefficient, d)


def displace_limb(source, limb, g, arm_index=0):
    src = np.asarray(source, np.float32)
    out = np.zeros_like(src)
    strength = F(limb["intensity"])
    radius = F(limb["radius"])
    f = limb["float_fields"]
    pos = np.asarray(limb["shoulder_elbow_wrist"], np.float32)
    s, e, w = pos
    vec = lambda a: np.array([f[hex(a)], f[hex(a + 4)]], np.float32)
    u, v, n, start, extmid, end = map(vec, [36, 52, 44, 60, 68, 76])
    side = F([f["0x5c"], f["0x60"]])
    theta = F(f["0x58"])
    rows, cols = np.array(src.shape[:2]) - 1
    width, height = src[-1, -1]
    xs, ys = (F(width / F(cols)), F(height / F(rows)))
    left = max(0, int(np.ceil(F(F(f["0x64"]) / xs))))
    right = min(cols, int(np.floor(F(F(f["0x68"]) / xs))))
    top = max(0, int(np.ceil(F(F(f["0x6c"]) / ys))))
    bottom = min(rows, int(np.floor(F(F(f["0x70"]) / ys))))
    diagnostics = []
    for ri, ci in np.ndindex(src.shape[:2]):
        if not (top <= ri <= bottom and left <= ci <= right):
            continue
        p = src[ri, ci]
        q1 = projection(p, s, u)
        q2 = projection(p, w, v)
        d1 = length(F(q1 - p))
        d2 = length(F(q2 - p))
        inner = cone(p, e, s, w)
        near = cone(F(s + F(n * F(0.5))), e, s, w)
        which = (
            int(inner) ^ int(near) ^ 1
            if g.get("special") and (not g.get("strategy", 65536) & 65536)
            else int(inner) ^ int(near) ^ 1 ^ arm_index ^ int(g.get("flip", False))
        )
        in1 = between(start, e, q1)
        in2 = between(e, end, q2)
        ok1 = in1 and d1 < radius
        ok2 = in2 and d2 < radius
        upper = False
        corner = False
        if ok1 and (not ok2 or d1 < d2):
            upper = True
            q = q1
            distance = d1
        elif ok2:
            q = q2
            distance = d2
        elif (
            not in1
            and (not in2)
            and (d1 < radius)
            and (d2 < radius)
            and (not inner)
            and (length(F(p - e)) < radius)
        ):
            q = e.copy()
            distance = length(F(p - e))
            corner = True
            upper = bool(d1 > d2)
        else:
            continue
        axial = F(g["0x190"])
        if corner:
            gap = F(math.pi / 2 - float(theta))
            angular = F(abs(float(F(math.pi - float(angle(F(v - u), F(p - e)))))) / gap)
            weight = F(min(max(1.0 - float(angular), 0.0), 1.0))
            normalized = F(min(max(float(gap) / (math.pi / 2), 0.0), 1.0))
            axial = F(
                (1.0 - float(F(F(normalized * normalized) * weight)))
                * float(F(g["0x190"]))
            )
        elif upper:
            if between(s, e, q):
                axial = taper_upper(q, s, e, g)
                if g.get("strategy") == 196608:
                    axial = F(g["0x198"])
            if dot(F(s - q), F(e - q)) > F(0):
                axial = F(
                    F(g["0x194"]) * F(1.0 - float(length(F(s - q))) / float(radius))
                )
        elif not corner and dot(F(w - q), F(e - q)) > F(0):
            axial = F(F(g["0x190"]) * F(1.0 - float(length(F(w - q))) / float(radius)))
        effective = radius
        force_zero = (
            upper
            and (not corner)
            and (d1 > d2)
            and (dot(F(q2 - e), F(w - e)) > 0)
            or (
                not upper
                and (not corner)
                and (d2 > d1)
                and (dot(F(q1 - e), F(s - e)) > 0)
            )
        )
        special_radial = False
        if inner and (not corner):
            reach = min(
                float(F(radius / F(float(tanf(theta))))),
                float(length(F((start if upper else end) - e))),
            )
            ell = float(length(F(e - q)))
            if reach > ell:
                special_radial = True
                a = F(
                    min(
                        max((2.0 * float(theta) - math.pi / 2) / (math.pi / 2), 0.0),
                        1.0,
                    )
                )
                b = F(F(F(a * a) - F(F(a * a) * a)) + a)
                effective = F(
                    ell * float(tanf(theta)) * (1.0 - float(b)) + float(F(radius * b))
                )
        ratio = F(distance / effective) if special_radial or not force_zero else F(1)
        ratio = F(min(max(float(ratio), 0.0), 1.0))
        poly = F(F(F(ratio * ratio) - F(F(ratio * ratio) * ratio)) + ratio)
        power = F((1.0 - float(poly)) * float(F(axial * strength)))
        if upper:
            amount = F(side[0] if which else side[1]) * power
        else:
            a = F(
                min(max((2.0 * float(theta) - math.pi / 4) / (math.pi / 2), 0.0), 1.0)
            )
            proportion = F(float(length(F(q - e))) / float(length(F(end - e))))
            mix = F(F(F(a - F(1)) * proportion) + F(1))
            sa = side[1] if which else side[0]
            sb = side[0] if which else side[1]
            amount = F(power * F((1.0 - float(mix)) * float(sa) + float(F(sb * mix))))
        if not upper and (not g.get("strategy", 65536) & 65536):
            amount = F(amount * F(0.45))
            amount = F(amount * F(0)) if g.get("strategy") == 272 else amount
        out[ri, ci] = F(F(q + F(F(p - q) / F(amount + F(1)))) - p)
        diagnostics.append(
            {
                "index": [ri, ci],
                "upper": upper,
                "corner": corner,
                "inner": inner,
                "which": which,
                "radial": float(ratio),
                "axial": float(axial),
            }
        )
    return (True, out, diagnostics)
