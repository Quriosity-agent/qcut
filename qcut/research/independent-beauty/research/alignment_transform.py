"""Float32 similarity fitting and the four-anchor tracking refresh gate.

The fitted source is owned history, not a native point cache. Sequential sums
and separate multiply/add operations preserve the pinned arm64 rounding.
"""
from dataclasses import dataclass
import ctypes
from functools import lru_cache

import numpy as np

from alignment_sampling import inverse_forward
from facefitting_input import fma32

ANCHORS = (55, 58, 84, 90)


def points106(*, points):
    if (not isinstance(points, np.ndarray) or points.dtype != np.float32
            or points.shape != (106, 2) or not np.isfinite(points).all()
            or np.max(np.abs(points)) > 32768):
        raise ValueError("bounded float32 106 points required")
    return points


def target_points(*, mean):
    values = points106(points=mean)
    if (values < 0).any() or (values > 256).any():
        raise ValueError("base mean must be in [0, 256]")
    return (values.astype(np.float64) / 256 * 120).astype(np.float32)


def anchors(*, points):
    values = points106(points=points)
    a, b, c, d = ANCHORS
    return np.stack(((values[a] + values[b]) / np.float32(2),
                     (values[c] + values[d]) / np.float32(2)))


def needs_refresh(*, points, cached, threshold=0.1):
    current = anchors(points=points)
    if (isinstance(threshold, (bool, np.bool_)) or not isinstance(threshold, (int, float, np.floating))
            or not np.isfinite(threshold) or not 0 <= threshold <= 1):
        raise ValueError("finite refresh threshold in [0, 1] required")
    if cached is None:
        return True
    previous = anchors(points=cached)
    delta = current - previous
    lengths = np.sqrt(delta[:, 0] * delta[:, 0] + delta[:, 1] * delta[:, 1])
    movement = lengths[0] / np.float32(2) + lengths[1] / np.float32(2)
    span = previous[0] - previous[1]
    reference = np.sqrt(span[0] * span[0] + span[1] * span[1]) / np.float32(2)
    if float(reference) <= 1e-6:
        return True
    return bool(movement / reference >= np.float32(threshold))


@lru_cache(maxsize=1)
def system_fma():
    function = ctypes.CDLL(None).fma
    function.argtypes = [ctypes.c_double] * 3
    function.restype = ctypes.c_double
    return function


def inverse_mapping(*, forward):
    inverse_forward(forward=forward)
    a, b, tx, c, d, ty = forward.reshape(-1)
    determinant = fma32(left=d, right=a, addend=-np.float32(c * b))
    if abs(float(determinant)) < 1e-8:
        raise ValueError("nonsingular mapping transform required")
    reciprocal = 1.0 / float(determinant)
    p, q, r, s = (float(value) * reciprocal for value in (d, -b, -c, a))
    fma = system_fma()
    # Mapping keeps double coefficients until store; sampling rounds them earlier.
    u = -fma(p, float(tx), q * float(ty))
    v = -fma(r, float(tx), s * float(ty))
    result = np.array([[p, q, u], [r, s, v]], np.float32)
    if not np.isfinite(result).all() or np.max(np.abs(result)) > 32768:
        raise ValueError("mapping inverse exceeds budget")
    return result


def fit(*, source, target):
    source, target = points106(points=source), points106(points=target)
    source_center, target_center = np.zeros(2, np.float32), np.zeros(2, np.float32)
    for p, q in zip(source, target, strict=True):
        source_center += p
        target_center += q
    source_center /= np.float32(106)
    target_center /= np.float32(106)
    centered_source, centered_target = source - source_center, target - target_center
    dot, cross, denominator = np.float32(0), np.float32(0), np.float32(0)
    for p, q in zip(centered_source, centered_target, strict=True):
        dot += p[0] * q[0] + p[1] * q[1]
        cross += p[0] * q[1] - p[1] * q[0]
        denominator += p[0] * p[0] + p[1] * p[1]
    if float(denominator) < 1e-6 or float(np.hypot(dot, cross)) < 1e-6:
        raise ValueError("degenerate similarity fit")
    a, b = dot / denominator, cross / denominator
    scale = float(np.hypot(a, b))
    if not 1e-4 <= scale <= 100:
        raise ValueError("similarity scale exceeds budget")
    projected = np.array([a * source_center[0] - b * source_center[1],
                          b * source_center[0] + a * source_center[1]], np.float32)
    translation = target_center - projected
    forward = np.array([[a, -b, translation[0]], [b, a, translation[1]]], np.float32)
    return forward, inverse_mapping(forward=forward)


@dataclass(frozen=True, kw_only=True)
class TransformState:
    source: np.ndarray
    target: np.ndarray
    forward: np.ndarray
    inverse: np.ndarray

    def __post_init__(self):
        points106(points=self.source)
        points106(points=self.target)
        expected = inverse_mapping(forward=self.forward)
        if (not isinstance(self.inverse, np.ndarray) or self.inverse.dtype != np.float32
                or not np.array_equal(expected, self.inverse)):
            raise ValueError("matched float32 transform inverse required")
        for name in ("source", "target", "forward", "inverse"):
            owned = getattr(self, name).copy()
            owned.setflags(write=False)
            object.__setattr__(self, name, owned)


def update_transform(*, state, points, mean):
    target = target_points(mean=mean)
    if state is not None and (not isinstance(state, TransformState) or not np.array_equal(target, state.target)):
        raise ValueError("stable transform target required")
    refreshed = needs_refresh(points=points, cached=None if state is None else state.source)
    if refreshed:
        forward, inverse = fit(source=points, target=target)
        state = TransformState(source=points, target=target, forward=forward, inverse=inverse)
    return state, refreshed
