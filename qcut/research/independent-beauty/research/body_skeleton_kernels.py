"""Float32 kernels of the body-keypoint decoder: heatmap peaks, limb affinity, map resize.

QCut-owned port of the measured arm64 arithmetic: every stage rounds to IEEE float32,
fused multiply-adds round once, float-to-int conversions truncate with saturation.
Python 3.12 has no math.fma, so an exact single-rounding fallback is used; with float32
operands it equals a*b+c in float64 (the product is exact), which the vectorized cubic
resize relies on.
"""
from fractions import Fraction
import math
import struct

import numpy as np

try:
    from math import fma as _native_fma
except ImportError:  # Python < 3.13
    _native_fma = None


def f32(x):
    return struct.unpack('<f', struct.pack('<f', x))[0]


def fma(a, b, c):
    """a*b+c rounded once to float64, as math.fma."""
    if _native_fma is not None:
        return _native_fma(a, b, c)
    return float(Fraction(a) * Fraction(b) + Fraction(c))


def fcvtzs(x):
    """arm64 float-to-signed conversion: truncation with saturation, NaN to 0."""
    if math.isnan(x):
        return 0
    if x >= 2147483647:
        return 2147483647
    if x <= -2147483648:
        return -2147483648
    return math.trunc(x)


def _add(a, b):
    return f32(a + b)


def _mul(a, b):
    return f32(a * b)


def _fma(a, b, c):
    return f32(fma(a, b, c))


def _cubic_coefficients(x):
    a = f32(-.75)
    x = f32(x)
    xp = f32(x + 1)
    xm = f32(1 - x)
    c0 = f32(f32(f32(f32(f32(f32(a * xp) - 5 * a) * xp) + 8 * a) * xp) - 4 * a)
    c1 = f32(f32(f32(f32(f32(a + 2) * x) - f32(a + 3)) * x) * x + 1)
    c2 = f32(f32(f32(f32(f32(a + 2) * xm) - f32(a + 3)) * xm) * xm + 1)
    c3 = f32(f32(f32(1 - c0) - c1) - c2)
    return [c0, c1, c2, c3]


def _cubic_plan(size, out):
    indices, coefficients = [], []
    for dst in range(out):
        t = f32((dst + .5) * size / out - .5)
        source = math.floor(t)
        indices.append([max(0, min(size - 1, source + k - 1)) for k in range(4)])
        coefficients.append(_cubic_coefficients(f32(t - source)))
    return np.array(indices, np.intp), np.array(coefficients, np.float64)


def resize_cubic(mat, out_h, out_w):
    """A=-0.75 cubic with replicated edges; each tap is a float32-rounded fused multiply-add."""
    source = np.asarray(mat, np.float32).astype(np.float64)
    height, width = source.shape
    xs, xc = _cubic_plan(width, out_w)
    ys, yc = _cubic_plan(height, out_h)
    taps = source[:, xs]  # (height, out_w, 4)
    horizontal = (taps[..., 0] * xc[:, 0]).astype(np.float32).astype(np.float64)
    for k in (1, 2, 3):
        horizontal = (taps[..., k] * xc[:, k] + horizontal).astype(np.float32).astype(np.float64)
    taps = horizontal[ys]  # (out_h, 4, out_w)
    vertical = (taps[:, 0] * yc[:, 0, None]).astype(np.float32).astype(np.float64)
    for k in (1, 2, 3):
        vertical = (taps[:, k] * yc[:, k, None] + vertical).astype(np.float32).astype(np.float64)
    return vertical.tolist()


def resize_nearest(mat, out_h, out_w):
    h, w = len(mat), len(mat[0])
    return [[f32(mat[min(h - 1, int(y * h / out_h))][min(w - 1, int(x * w / out_w))]) for x in range(out_w)]
            for y in range(out_h)]


def compute_affinity(map_x, map_y, a, b):
    """Ten float32 cosine samples at i/9 along the limb (sample XY truncated); mean and length."""
    h, w = len(map_x), len(map_x[0])
    ax, ay = a
    bx, by = b
    if not (0 <= ax < w and 0 <= bx < w and 0 <= ay < h and 0 <= by < h):
        raise ValueError('limb endpoints outside the vector map')
    dx, dy = f32(bx - ax), f32(by - ay)
    eps = f32(1e-9)
    length = f32(math.sqrt(max(_fma(dy, dy, _mul(dx, dx)), eps)))
    dots, total = [], 0.0
    for i in range(10):
        t = _mul(f32(i), f32(1 / 9))
        x = fcvtzs(_fma(t, dx, f32(ax)))
        y = fcvtzs(_fma(t, dy, f32(ay)))
        px, py = f32(map_x[y][x]), f32(map_y[y][x])
        norm = f32(math.sqrt(max(_fma(py, py, _mul(px, px)), eps)))
        dot = f32(_fma(py, dy, _mul(px, dx)) / _mul(norm, length))
        dots.append(dot)
        total = _add(total, dot)
    return _mul(total, f32(.1)), dots, length


# Limb topology (zero-based joint pairs) and the vector-map channel pair of each limb.
LIMB_JOINTS = [(1, 2), (1, 5), (2, 3), (3, 4), (5, 6), (6, 7), (1, 8), (8, 9), (9, 10),
               (1, 11), (11, 12), (12, 13), (1, 0), (0, 14), (14, 16), (0, 15), (15, 17), (2, 16), (5, 17)]
PAF_CHANNELS = [(12, 13), (20, 21), (14, 15), (16, 17), (22, 23), (24, 25), (0, 1), (2, 3), (4, 5), (6, 7),
                (8, 9), (10, 11), (28, 29), (30, 31), (34, 35), (32, 33), (36, 37), (18, 19), (26, 27)]


def find_candidate_limbs(pafs, candidate_xy, ids_by_joint, scale=1.0):
    """Ten-sample affinity with a distance penalty; candidates ranked per limb type."""
    height = len(pafs[0])
    half_height = f32(f32(height) * f32(.5))
    scale = f32(scale)
    result = []
    for (ja, jb), (cx, cy) in zip(LIMB_JOINTS, PAF_CHANNELS):
        found = []
        for a in ids_by_joint[ja]:
            for b in ids_by_joint[jb]:
                pa = [fcvtzs(_mul(f32(v), scale)) for v in candidate_xy[a]]
                pb = [fcvtzs(_mul(f32(v), scale)) for v in candidate_xy[b]]
                mean, dots, length = compute_affinity(pafs[cx], pafs[cy], pa, pb)
                if sum(v > f32(.05) for v in dots) <= len(dots) * .8:
                    continue
                penalty = min(f32(f32(half_height / max(length, f32(.1))) - f32(1)), f32(0))
                score = f32(mean + penalty)
                if score > 0:
                    found.append([a, b, score])
        found.sort(key=lambda x: -x[2])
        result.append(found)
    return result


def find_coarse_peaks(heatmaps):
    """Seed peaks: 4-neighbour maxima above 0.2 with the native centroid offsets (right column skipped)."""
    result = []
    for channel, mat in enumerate(heatmaps):
        a = [[f32(v) for v in row] for row in mat]
        h, w = len(a), len(a[0])
        for y in range(1, h - 1):
            if w >= 2 and a[y][0] >= max(a[y][1], a[y - 1][0], a[y + 1][0]) and a[y][0] > f32(.2):
                result.append([0, y, channel])
            for x in range(1, w - 1):
                center, left, right, up, down = a[y][x], a[y][x - 1], a[y][x + 1], a[y - 1][x], a[y + 1][x]
                if center < max(left, right, up, down) or center <= f32(.2):
                    continue
                ul, ur, dl, dr = a[y - 1][x - 1], a[y - 1][x + 1], a[y + 1][x - 1], a[y + 1][x + 1]
                us = _add(_add(ul, up), ur)
                cs = _add(_add(right, center), left)
                denom = _add(_add(cs, dl), _add(_add(down, us), dr))
                yo = f32(f32(cs - us) / denom)
                xo = f32(_add(f32(_add(right, ur) - _add(_add(left, ul), dl)), dr) / denom)
                result.append([fcvtzs(_add(xo, f32(x))), fcvtzs(_add(yo, f32(y))), channel])
    return result


def find_max_by_mask(heatmaps, coarse_peaks, stride):
    """Multi-person refinement inside each seed's mask; may repeat coordinates across masks."""
    result = []
    for cx, cy, channel in coarse_peaks:
        mat = heatmaps[channel]
        h, w = len(mat), len(mat[0])
        a = [[f32(v) for v in row] for row in mat]
        ymin, ymax = max(1, (cy - 2) * stride), min(h - 1, (cy + 2) * stride)
        xmin, last = max(0, (cx - 2) * stride), min(w, (cx + 2) * stride) - 1
        for y in range(ymin, ymax):
            if xmin < last and a[y][xmin] > max(a[y][xmin + 1], a[y - 1][xmin], a[y + 1][xmin], f32(.1)):
                result.append([xmin, y, channel])
            for x in range(xmin + 1, last):
                if a[y][x] > max(a[y][x + 1], a[y][x - 1], a[y - 1][x], a[y + 1][x], f32(.1)):
                    result.append([x, y, channel])
            if xmin < last and a[y][last] > max(a[y][last - 1], a[y - 1][last], a[y + 1][last], f32(.1)):
                result.append([last, y, channel])
    return result


def find_max_by_mask_single(heatmaps, coarse_peaks, stride):
    """Single-person variant: ties kept inside and at the right edge, strict at the left edge."""
    result = []
    for cx, cy, channel in coarse_peaks:
        a = heatmaps[channel]
        h, w = len(a), len(a[0])
        ymin, ymax = max(1, (cy - 2) * stride), min(h - 1, (cy + 2) * stride)
        xmin, last = max(0, (cx - 2) * stride), min(w, (cx + 2) * stride) - 1
        for y in range(ymin, ymax):
            if xmin < last and a[y][xmin] > max(a[y][xmin + 1], a[y - 1][xmin], a[y + 1][xmin], f32(.1)):
                result.append([xmin, y, channel])
            for x in range(xmin + 1, last):
                if a[y][x] >= max(a[y][x + 1], a[y][x - 1], a[y - 1][x], a[y + 1][x]) and a[y][x] > f32(.1):
                    result.append([x, y, channel])
            if xmin < last and a[y][last] >= max(a[y][last - 1], a[y - 1][last], a[y + 1][last]) and a[y][last] > f32(.1):
                result.append([last, y, channel])
    return result
