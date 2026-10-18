"""Independent controlled dual-lobe SlimBreast geometry, affine basis and delta cache."""

import numpy as np, math
from .hip_geometry import smooth

f = np.float32


def deform(
    src,
    intensity,
    extra,
    lobes,
    axis=(1.0, 0.0),
    perpendicular=(0.0, 1.0),
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
    ax = np.asarray(axis, np.float32)
    perp = np.asarray(perpendicular, np.float32)
    xs = f(w / f(cols))
    ys = f(h / f(rows))
    cache = {}
    for lobe in lobes:
        if not lobe["valid"] or (
            abs(f(f(intensity) * f(lobe["weight"]))) < np.finfo(np.float32).eps
            and abs(f(extra)) < np.finfo(np.float32).eps
        ):
            continue
        cx, cy = map(f, lobe["center"])
        left, right, above, below = map(f, lobe["radii"])
        xmin, xmax, ymin, ymax = map(f, lobe["bounds"])
        center = np.array([cx, cy], np.float32)
        for row in range(
            max(0, math.ceil(float(f(ymin / ys)))), min(rows, int(f(ymax / ys))) + 1
        ):
            for col in range(
                max(0, math.ceil(float(f(xmin / xs)))), min(cols, int(f(xmax / xs))) + 1
            ):
                original = src[row, col]
                rel = original - center
                along = f(f(rel[0] * ax[0]) + f(rel[1] * ax[1]))
                vertical = f(f(rel[0] * perp[0]) + f(rel[1] * perp[1]))
                sx = smooth(f(f(1) - f(abs(along) / (right if along > 0 else left))))
                sy = smooth(
                    f(f(1) - f(abs(vertical) / (below if vertical > 0 else above)))
                )
                scaleA = f(f(f(sx * f(f(intensity) * f(lobe["weight"]))) * sy) + f(1))
                scaleB = f(f(sx * f(sy * f(extra))) + f(1))
                partA = f(f(ax * along) * scaleA)
                partB = f(f(perp * vertical) * scaleB)
                p = f(f(center + partA) + partB)
                delta = f(p - original)
                key = (row, col)
                cache[key] = f(cache[key] + delta) if key in cache else delta
    for key, d in cache.items():
        dst[key] = f(dst[key] + d)
    return dst
