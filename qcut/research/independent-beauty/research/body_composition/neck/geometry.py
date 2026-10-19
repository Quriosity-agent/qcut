"""Independent SwanNeck paired half-plane geometry, float32 delta cache."""

import numpy as np, math
from ..hip_breast.hip_geometry import smooth

f = np.float32


def deform(
    src,
    intensity,
    halves,
    coefficients=(1.0, 1.0),
    destination=None,
    width=None,
    height=None,
):
    src = np.asarray(src, np.float32)
    dst = (
        src.copy()
        if destination is None
        else np.asarray(destination, np.float32).copy()
    )
    rows, cols = np.array(src.shape[:2]) - 1
    w = f(src[0, -1, 0] if width is None else width)
    h = f(src[-1, 0, 1] if height is None else height)
    xs = f(w / f(cols))
    ys = f(h / f(rows))
    cache = {}
    epsilon = np.finfo(np.float32).eps
    if abs(f(intensity)) < epsilon or not halves:
        return dst
    # Native checks the first half's three radii before either half is generated.
    first_radii = halves[0]['radii']
    if any(abs(f(first_radii[index])) < epsilon for index in (0, 2, 3)):
        return dst
    for j, half in enumerate(halves):
        center = np.asarray(half["center"], np.float32)
        axis = np.asarray(half["axis"], np.float32)
        perp = np.asarray(half["perpendicular"], np.float32)
        left, right, above, below = map(f, half["radii"])
        xmin, xmax, ymin, ymax = map(f, half["bounds"])
        for row in range(
            max(0, math.ceil(float(f(ymin / ys)))), min(rows, int(f(ymax / ys))) + 1
        ):
            for col in range(
                max(0, math.ceil(float(f(xmin / xs)))), min(cols, int(f(xmax / xs))) + 1
            ):
                original = src[row, col]
                rel = f(original - center)
                along = f(f(rel[0] * axis[0]) + f(rel[1] * axis[1]))
                vertical = f(f(rel[0] * perp[0]) + f(rel[1] * perp[1]))
                if j == 0 and along >= 0 or (j == 1 and along < 0):
                    continue
                radius = left if j == 0 else right
                tx = f(min(f(abs(along) / radius), f(1)))
                ty = f(
                    min(f(abs(vertical) / (above if vertical >= 0 else below)), f(1))
                )
                weight = f(min(f(smooth(f(f(1) - ty)) * f(f(1) - tx)), f(0.4)))
                denominator = (
                    float(f(f(coefficients[j]) * f(f(intensity) * weight))) + 1.0
                )
                along = f(float(along) / denominator)
                point = f(f(center + f(axis * along)) + f(perp * vertical))
                delta = f(point - original)
                key = (row, col)
                cache[key] = f(cache[key] + delta) if key in cache else delta
    for key, delta in cache.items():
        dst[key] = f(dst[key] + delta)
    return dst
