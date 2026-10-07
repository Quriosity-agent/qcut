"""Bounded BaseInfo point-filter math reconstructed from pinned arm64 liblens.

Adapted from QCut owned research. Evidence: init 0x37b3d8, Base init 0x37b7e8, optimized 0x37be00,
ordinary 0x37c3f8, Base output 0x37cc58. No vendor library is loaded.
Only finite, nonnegative-scale, matched-size point-vector states are supported.
The constructor's coefficient default and runtime routing are NOT established:
alpha must be supplied, never inferred from outputs. Synthetic tests do not
establish native or dynamic render parity. Optimized expf uses host system libm;
ordinary pow/exp use Python's system libm. Cross-platform bit parity is unproven.
"""
from __future__ import annotations

import ctypes
from dataclasses import dataclass
from functools import lru_cache
import math

import numpy as np



def _points(*, values, count=None, limit=32768):
    values = np.asarray(values)
    if (values.dtype != np.float32 or values.ndim != 2 or values.shape[1] != 2 or
            not 0 <= len(values) <= 106 or (count is not None and len(values) != count) or
            not np.isfinite(values).all() or np.max(np.abs(values), initial=0) > limit):
        raise ValueError("bounded float32 XY point vector required")
    return values


def _scalar(*, value, maximum):
    if (not isinstance(value, (int, float, np.integer, np.floating)) or
            isinstance(value, (bool, np.bool_)) or not math.isfinite(float(value)) or
            not 0 <= float(value) <= maximum):
        raise ValueError("bounded nonnegative numeric scalar required")
    return np.float32(value)


def _owned(*, values):
    result = values.copy()
    result.setflags(write=False)
    return result


@dataclass(frozen=True, kw_only=True)
class FilterState:
    current: np.ndarray
    previous: np.ndarray
    delta: np.ndarray
    alpha: np.float32
    scale: np.float32
    first: bool

    def __post_init__(self):
        current = _points(values=self.current)
        previous = _points(values=self.previous)
        delta = _points(values=self.delta, limit=65536)
        if (type(self.first) is not bool or len(previous) not in (0, len(current)) or
                len(delta) not in (0, len(current)) or
                (not self.first and len(delta) != len(current))):
            raise ValueError("matched initialized history required")
        for name, value in (("current", current), ("previous", previous), ("delta", delta)):
            object.__setattr__(self, name, _owned(values=value))
        object.__setattr__(self, "alpha", _scalar(value=self.alpha, maximum=1))
        object.__setattr__(self, "scale", _scalar(value=self.scale, maximum=2**20))


def initialize(*, points, width, height, escale, alpha):
    """Fresh modeled state; alpha is the explicit pre-existing native +0x60 field.

    Native init does not assign alpha or clear older delta/previous vectors.
    Fresh empty histories are valid because first=True seeds delta before use.
    0x37b43c loads denominator 720 from 0x498ce8; no fitted parameter.
    """
    points = _points(values=points)
    if not all(type(side) is int and 1 <= side <= 4096 for side in (width, height)):
        raise ValueError("bounded integer dimensions required")
    integer_scale = int(_scalar(value=escale, maximum=32768))
    scale = np.float32((float(integer_scale) / 720.0) * float(min(width, height)))
    empty = np.empty((0, 2), dtype=np.float32)
    return FilterState(current=points, previous=empty, delta=empty,
                       alpha=alpha, scale=scale, first=True)


@lru_cache(maxsize=1)
def _system_expf():
    namespace = ctypes.CDLL(None)
    try:
        function = namespace.expf
    except AttributeError as error:
        raise RuntimeError("host system expf is required; no approximate fallback") from error
    function.argtypes = [ctypes.c_float]
    function.restype = ctypes.c_float
    return function


def _weights(*, delta, scale, optimized):
    ratio = np.abs(delta) / scale
    if optimized:
        arguments = -np.sqrt(ratio)
        function = _system_expf()
        return np.array([function(float(value)) for value in arguments.flat],
                        dtype=np.float32).reshape(delta.shape)
    return np.array([math.exp(-math.pow(float(value), 0.5)) for value in ratio.flat],
                    dtype=np.float32).reshape(delta.shape)


def update(*, state, points, optimized):
    """One original-method-equivalent update within the supported math profile."""
    if not isinstance(state, FilterState) or type(optimized) is not bool:
        raise ValueError("filter state and boolean mode required")
    points = _points(values=points)
    if not len(state.current) or not len(points):
        return points.copy(), state
    if len(points) != len(state.current):
        raise ValueError("size-changing native branch is unsupported")
    # Native compares promoted float scale against a double 1e-5 constant.
    if abs(float(state.scale)) < 1e-5:
        output, delta, first = points.copy(), state.delta, state.first
    else:
        displacement = points - state.current
        delta = displacement if state.first else (
            state.delta * state.alpha + displacement * (np.float32(1) - state.alpha))
        weights = _weights(delta=delta, scale=state.scale, optimized=optimized)
        # Algebraically equivalent forms have different float32 rounding.
        output = (points - displacement * weights if optimized else
                  state.current * weights + points * (np.float32(1) - weights))
        first = False
    result = FilterState(current=output, previous=state.current, delta=delta,
                         alpha=state.alpha, scale=state.scale, first=first)
    return output.copy(), result


@dataclass(frozen=True, kw_only=True)
class BaseState:
    first33: FilterState
    last73: FilterState

    def __post_init__(self):
        if (not isinstance(self.first33, FilterState) or
                not isinstance(self.last73, FilterState) or
                len(self.first33.current) != 33 or len(self.last73.current) != 73):
            raise ValueError("BaseInfo requires independent 33/73 point states")


def initialize_base(*, points, width, height, escales, alphas):
    points = _points(values=points, count=106)
    if not all(isinstance(pair, tuple) and len(pair) == 2 for pair in (escales, alphas)):
        raise ValueError("two explicit scale/coefficient parameters required")
    return BaseState(
        first33=initialize(points=points[:33], width=width, height=height,
                           escale=escales[0], alpha=alphas[0]),
        last73=initialize(points=points[33:], width=width, height=height,
                          escale=escales[1], alpha=alphas[1]))


def update_base(*, state, points, optimized):
    if not isinstance(state, BaseState):
        raise ValueError("BaseInfo state required")
    points = _points(values=points, count=106)
    first, first_state = update(state=state.first33, points=points[:33], optimized=optimized)
    last, last_state = update(state=state.last73, points=points[33:], optimized=optimized)
    return np.concatenate((first, last)), BaseState(first33=first_state, last73=last_state)
