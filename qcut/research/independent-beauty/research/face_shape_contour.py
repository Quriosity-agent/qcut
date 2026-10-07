"""Chin supports use ordered float32 updates and a separate contour copy."""
import numpy as np

from slimface_mesh_landmarks import F, coefficient_delta, distance


def reshape_contour(*, target, axis, chin, sharp, assets):
    position = target[:33].copy()
    if float(chin) < -.001:
        for landmark, horizontal, vertical in assets["chin"]:
            index = int(landmark)
            target[index] += coefficient_delta(eye=axis, horizontal=horizontal, vertical=vertical) * chin * F(5)
            position[index] = target[index]
    if float(chin) > .001:
        radius = distance(a=target[74], b=target[77]) * F(1.5)
        if radius < F(1e-5):
            raise ValueError("degenerate chin support radius")
        eye_delta = (target[77] - target[74]) * F(.2)
        midpoint = (target[77] + target[74]) * F(.5)
        center = midpoint + (target[16] - midpoint)
        degree = chin
        for offset, index in enumerate(range(12, 21)):
            if offset in (1, 2, 6, 7):
                degree = F(float(chin) * .7)
            if offset in (0, 8):
                degree = F(float(degree) * .2)
            if offset in (3, 5) and float(chin) > .01:
                degree = F(float(chin) * .8)
            if offset == 4 and float(chin) > .01:
                degree = F(float(chin) * .6)
            weight = F(np.clip(F(1) - distance(a=center, b=target[index]) / radius, 0, 1))
            delta = eye_delta * degree * weight * np.array([1.5, -1.5], np.float32)
            position[index] = target[index] + delta[::-1]
            # Native state broadcasts Y; contour output retains the reversed XY delta.
            target[index] += delta[1]
    if float(abs(sharp)) > .00001:
        name, scale = ("sharp_positive", -5) if sharp > 0 else ("sharp_negative", 5)
        for landmark, horizontal, vertical in assets[name]:
            index = int(landmark)
            delta = coefficient_delta(eye=axis, horizontal=horizontal, vertical=vertical) * sharp
            target[index] = target[index].astype(np.float64) + delta.astype(np.float64) * scale
    return position
