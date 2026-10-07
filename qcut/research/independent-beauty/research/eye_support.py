"""Construct 87 supports per eye from fresh ordinary Extra240 landmarks."""
import numpy as np

from eye_trig import sincos
from makeup_geometry import points_array

F = np.float32

def arc(*, a, b, radius, shape, angle, side, kind=0):
    factor = F(F(shape * F(-0.5 if kind == 0 else -0.25)) + F(1.2 if kind == 0 else 1.1))
    sine, cosine = sincos(radians=F(F(angle)*F(.01745)))
    s = F(F(sine * radius) * factor)
    c = F(F(cosine * radius) * factor)
    if side:
        s = F(-s)
    delta = b - a
    base = a + delta * c
    perp = delta[::-1] * s
    return np.array([F(base[0] - perp[0]), F(base[1] + perp[1])], F)

def norm(*, p):
    squared = F(F(p[0]*p[0])+F(p[1]*p[1]))
    if not np.isfinite(squared):
        raise ValueError('finite eye distance required')
    return F(np.sqrt(squared))


def distance_ratio(*, numerator, denominator):
    distance = norm(p=denominator)
    if distance <= F(1e-6):
        raise ValueError('distinct eye controls required')
    return F(norm(p=numerator)/distance)

def support(*, eyes, side):
    points_array(value=eyes, count=44)
    if type(side) is not int or side not in (0, 1):
        raise ValueError('left or right eye selector required')
    eyes = np.array(eyes, F)
    p = eyes[:22] if side else eyes[22:44]
    o = np.zeros((87, 2), F)
    o[:22] = p
    top = p[5] * F(0.5) + p[6] * F(0.5)
    bottom = p[16] * F(0.5) + p[17] * F(0.5)
    opening = F(np.clip(distance_ratio(numerator=top-bottom, denominator=p[0]-p[11]), 0, 0.4))
    half = opening * F(0.5)
    gap = F(0.4) - opening
    gap_half = F(0.4) - half
    ratio = distance_ratio(numerator=p[0]-p[2], denominator=p[0]-p[5])
    extent = F(half + F(0.8))
    local = F(half + F(0.2))
    aux = np.zeros((25, 2), F)
    aux[0] = arc(a=p[0], b=p[5], radius=F(ratio * extent), shape=opening, angle=180, side=side, kind=1)
    anchor = arc(a=p[11], b=p[6], radius=F(ratio * F(opening + F(0.6))), shape=opening, angle=150, side=side)
    aux[1] = arc(a=anchor, b=p[11], radius=F(0.5), shape=opening, angle=90, side=side ^ 1, kind=1)
    aux[2] = arc(a=aux[0], b=p[0], radius=F(0.5), shape=local, angle=90, side=side, kind=1)
    aux[3] = arc(a=aux[0], b=p[0], radius=F(F(2) - gap), shape=F(0.4), angle=90, side=side, kind=1)
    aux[4] = arc(a=aux[0], b=p[0], radius=F(1.8), shape=local, angle=135, side=side, kind=1)
    for i in range(10):
        radius = F(F(F(gap_half * F(0.07)) * F(F(F(i) * F(0.3)) + F(-10))) + F(1))
        aux[5 + i] = arc(a=p[i], b=p[i + 2], radius=radius, shape=F(0.4), angle=int(F(F(gap_half * F(130 - 26 * i)) + F(60))), side=side)
    for i in range(10):
        radius = F(F(1.3) - F(F(gap_half * F(0.15)) * F(10 - i)))
        radius = F(radius + radius)
        aux[15 + i] = arc(a=p[11 + i], b=p[12 + i], radius=radius, shape=F(0.4), angle=int(F(F(gap_half * F(130 - 26 * i)) + F(60))), side=side)
    o[22:47] = aux
    o[47] = arc(a=p[0], b=p[5], radius=F(ratio * F(extent + extent)), shape=opening, angle=180, side=side, kind=1)
    for i in range(8):
        o[48 + i] = arc(a=aux[5 + i], b=aux[6 + i], radius=F(1), shape=local, angle=60, side=side)
    for i in range(10):
        o[56 + i] = arc(a=aux[14 + i], b=aux[15 + i], radius=F(1), shape=local, angle=60, side=side)
    o[66] = arc(a=o[47], b=o[64], radius=F(1.3), shape=opening, angle=60, side=side ^ 1)
    for i in range(7):
        o[67 + i] = arc(a=o[48 + i], b=o[49 + i], radius=F(F(gap * F(3)) + F(1)), shape=local, angle=int(F(F(gap_half * F(130 - 26 * i)) + F(60))), side=side)
    f = F(F(1) - F(gap / F(1.5)))
    f2 = F(F(1) - F(gap * F(0.5)))
    o[74] = arc(a=o[26], b=o[25], radius=F(f * F(0.9)), shape=opening, angle=int(F(F(gap * F(100)) + F(120))), side=side)
    o[75] = arc(a=p[0], b=p[11], radius=F(f * F(0.7)), shape=opening, angle=int(F(F(150) - F(gap * F(50)))), side=side)
    o[76] = arc(a=p[0], b=p[11], radius=F(f2 * F(0.75)), shape=opening, angle=int(F(F(gap * F(-80)) + F(125))), side=side)
    o[77] = arc(a=p[0], b=p[11], radius=F(f2 * F(0.8)), shape=opening, angle=int(F(F(90) - F(gap * F(50)))), side=side)
    o[78] = arc(a=p[0], b=p[11], radius=f2, shape=opening, angle=int(F(F(60) - F(gap * F(50)))), side=side)
    o[79] = arc(a=p[11], b=p[0], radius=F(F(F(1) - gap) * F(0.8)), shape=opening, angle=90, side=side ^ 1)
    o[80] = arc(a=p[11], b=p[0], radius=F(F(F(1) - gap) * F(0.8)), shape=opening, angle=105, side=side ^ 1)
    o[81] = arc(a=p[11], b=p[0], radius=F(F(F(1) - gap) * F(0.5)), shape=opening, angle=int(F(F(140) - F(gap * F(50)))), side=side ^ 1)
    o[82] = arc(a=p[11], b=p[0], radius=f2, shape=opening, angle=120, side=side ^ 1)
    o[83] = arc(a=p[11], b=p[0], radius=F(f2 * F(1.6)), shape=opening, angle=120, side=side)
    o[84] = arc(a=p[0], b=p[11], radius=F(f2 * F(2.2)), shape=opening, angle=120, side=side ^ 1)
    o[85] = arc(a=p[0], b=p[11], radius=F(f2 * F(1.5)), shape=opening, angle=140, side=side)
    o[86] = o[85] * F(0.5) + o[84] * F(0.5)
    return o


def eye_mesh(*, points):
    points_array(value=points, count=240)
    eyes = points[196:240].copy()
    for index in range(44):
        if index % 22 not in (0, 11):
            eyes[index, 1] = F(float(eyes[index, 1])*(1.0015 if index < 22 else .999))
    result = np.vstack((support(eyes=eyes, side=1), support(eyes=eyes, side=0)))
    points_array(value=result, count=174)
    return result
