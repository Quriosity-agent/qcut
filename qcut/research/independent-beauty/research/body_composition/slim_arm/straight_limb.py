"""Independent mathematical single-segment SlimArm branch (not manual stretch).
Explicit state only. Bent two-segment elbow branch is rejected, not approximated.
"""

import numpy as np

F = np.float32


def projection(point, origin, direction):
    px, py = map(F, point)
    ax, ay = map(F, origin)
    ux, uy = map(F, direction)
    bx, by = (F(ax + ux), F(ay + uy))
    ny = F(ay - by)
    nx = F(bx - ax)
    ny2 = F(ny * ny)
    nx2 = F(nx * nx)
    den = F(ny2 + nx2)
    if abs(den) < F(2 ** (-23)):
        return np.array([-1, -1], np.float32)
    cross = F(F(ax * by) - F(ay * bx))
    mix = F(ny * nx)
    x = F(F(F(F(px * nx2) - F(py * mix)) - F(ny * cross)) / den)
    y = F(F(F(F(py * ny2) - F(px * mix)) - F(nx * cross)) / den)
    return np.array([x, y], np.float32)


def length(v):
    return F(np.sqrt(F(F(v[0] * v[0]) + F(v[1] * v[1]))))


def dot(a, b):
    return F(F(a[0] * b[0]) + F(a[1] * b[1]))


def between(a, b, p):
    a, b, p = map(lambda v: np.asarray(v, np.float32), (a, b, p))
    lo = np.minimum(a, b)
    hi = np.maximum(a, b)
    tiny = F(hi - lo) < F(1)
    lo = np.where(tiny, F(lo - F(1)), lo)
    hi = np.where(tiny, F(hi + F(1)), hi)
    return bool(np.all((p >= lo) & (p <= hi)))


def displace_limb(source, limb, global_state, arm_index=0):
    if limb["flags"][2] and (not limb["byte54"]):
        raise NotImplementedError("bent two-segment SlimArm branch not yet implemented")
    src = np.asarray(source, np.float32)
    out = np.zeros_like(src)
    strength, radius = (F(limb["intensity"]), F(limb["radius"]))
    if not limb["flags"][0] or not limb["flags"][1] or abs(strength) < F(2 ** (-23)):
        return (False, out)
    pos = np.array(limb["shoulder_elbow_wrist"], np.float32)
    s, e, w = pos
    f = limb["float_fields"]
    g = global_state
    vector = lambda a: np.array([f[hex(a)], f[hex(a + 4)]], np.float32)
    direction = vector(36)
    normal = vector(44)
    start = vector(60)
    end = vector(76 if limb["flags"][2] else 68)
    endpoint = w if limb["flags"][2] else e
    side = np.array([f["0x5c"], f["0x60"]], np.float32)
    blend = F(g["0x18c"])
    origin = F(s + F(F(e - s) * blend))
    segment_length = length(F(e - s))
    rows, cols = np.array(src.shape[:2]) - 1
    width, height = (F(src[-1, -1, 0]), F(src[-1, -1, 1]))
    xstep, ystep = (F(width / F(cols)), F(height / F(rows)))
    left = max(0, int(np.ceil(F(F(f["0x64"]) / xstep))))
    right = min(cols, int(np.floor(F(F(f["0x68"]) / xstep))))
    top = max(0, int(np.ceil(F(F(f["0x6c"]) / ystep))))
    bottom = min(rows, int(np.floor(F(F(f["0x70"]) / ystep))))
    for index in np.ndindex(src.shape[:2]):
        if not (top <= index[0] <= bottom and left <= index[1] <= right):
            continue
        p = src[index]
        q = projection(p, s, direction)
        distance = length(F(q - p))
        if distance >= radius or not between(start, end, q):
            continue
        if dot(F(endpoint - q), F(s - q)) <= F(0):
            if dot(F(origin - q), F(s - q)) >= F(0):
                coefficient = F(g["0x190"])
                portion = F(F(1) - blend)
            else:
                coefficient = F(g["0x194"])
                portion = blend
            denom = (
                (1.0 - float(blend)) * float(segment_length)
                if portion != blend
                else float(F(blend * segment_length))
            )
            taper = F(1.0 - float(length(F(q - origin))) / denom)
            axial = F((1.0 - float(coefficient)) * float(taper) + float(coefficient))
        elif dot(F(endpoint - s), F(q - s)) <= F(0):
            axial = F(F(g["0x194"]) * F(1.0 - float(length(F(s - q))) / float(radius)))
        else:
            axial = F(
                F(g["0x190"]) * F(1.0 - float(length(F(endpoint - q))) / float(radius))
            )
        if g.get("strategy") == 196608 and dot(F(endpoint - q), F(s - q)) <= F(0):
            axial = F(g["0x198"])
        positive = bool(dot(F(p - q), normal) > F(0))
        which = (
            int(positive)
            if g.get("special") and (not g.get("strategy", 65536) & 65536)
            else int(positive) ^ arm_index ^ int(g.get("flip", False))
        )
        radial = F(distance / radius)
        radial = F(min(max(float(radial), 0.0), 1.0))
        falloff = F(
            F(1) - F(F(F(radial * radial) - F(F(radial * radial) * radial)) + radial)
        )
        poly = F(F(F(radial * radial) - F(F(radial * radial) * radial)) + radial)
        amount = F((1.0 - float(poly)) * float(F(axial * strength)))
        denominator = F(F(F(side[0] if which else side[1]) * amount) + F(1))
        out[index] = F(F(q + F(F(p - q) / denominator)) - p)
    return (True, out)
