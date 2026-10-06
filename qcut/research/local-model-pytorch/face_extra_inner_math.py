"""CPU-only, bounded inner filter branches reconstructed from pinned liblens.

GetCurrentPostitionNew: 0x2d14a4..0x2d1874; AutoVector init:
0x2d5d00..0x2d5e14. See face_filter_abi.LENS_SHA256. Static reconstruction
is not native branch parity. No matrix, returned state, or renderer is an input.
Negative scales and profiles other than the empty/primary106 state are rejected.
"""
from __future__ import annotations

from copy import deepcopy
import math

import numpy as np

from face_host_geometry_contract import integer, numbers


def validate_state(*, state):
    if type(state) is not dict or type(state.get("first")) is not bool:
        raise ValueError("typed inner state required")
    count = integer(value=state.get("count"), maximum=106)
    if count not in (0, 106):
        raise ValueError("empty or primary106 inner profile required")
    for key in ("width", "height"):
        integer(value=state.get(key), minimum=1 if count else 0, maximum=4096 if count else 0)
    for key, maximum in (("alpha", 1), ("scale", 2**20), ("escale", 32768)):
        numbers(value=[state.get(key)], length=1, maximum=maximum)
        if state[key] < 0:
            raise ValueError("nonnegative inner scalar required")
    for key in ("current_xy", "previous_xy", "delta_x", "delta_y"):
        value = state.get(key)
        allowed = (0, 212, 560) if key.endswith("_xy") else (0, 106)
        if type(value) is not list or len(value) not in allowed:
            raise ValueError("bounded inner history required")
        numbers(value=value, length=len(value), maximum=65536 if key.startswith("delta_") else 32768)
    if (len(state["delta_x"]) != len(state["delta_y"]) or
            (not count and state["current_xy"])):
        raise ValueError("inner history/profile mismatch")


def point_input(*, points):
    if (not isinstance(points, np.ndarray) or points.dtype != np.float32 or
            points.ndim != 2 or points.shape[1] != 2 or len(points) not in (0, 106, 280) or
            not np.isfinite(points).all() or np.max(np.abs(points), initial=0) > 32768):
        raise ValueError("bounded float32 empty/106/280 inner input required")
    return points


def branch_for(*, state, points):
    validate_state(state=state)
    values = point_input(points=points)
    if not state["current_xy"] or not len(values):
        return "empty-copy"
    # Native promotes the stored float to double before comparing with 1e-5.
    if abs(float(np.float32(state["scale"]))) < 1e-5:
        return "near-zero-copy"
    if state["count"] != 106 or len(values) < 106 or len(state["current_xy"]) < 212:
        raise ValueError("primary106 arithmetic requires both complete prefixes")
    return "cubic-primary106"


def cubic_points(*, current, points, scale):
    """Separate float32 operations; exp(pow()) uses host double libm."""
    delta = points - current
    ratio = np.abs(delta) / scale
    weights = np.asarray([math.exp(-math.pow(float(value), 3.0)) for value in ratio.flat],
                         np.float32).reshape(points.shape)
    output = current * weights + points * (np.float32(1) - weights)
    return output, delta


def replay_inner_filter(*, state, points):
    """State count is independent of current/output vector length after a copy."""
    branch = branch_for(state=state, points=points)
    updated = deepcopy(state)
    if branch == "empty-copy":
        return points.copy(), updated
    if branch == "near-zero-copy":
        output = points.copy()
    else:
        current = np.asarray(state["current_xy"][:212], np.float32).reshape(106, 2)
        output, delta = cubic_points(current=current, points=points[:106], scale=np.float32(state["scale"]))
        updated.update(delta_x=delta[:, 0].tolist(), delta_y=delta[:, 1].tolist(), first=False)
    updated.update(previous_xy=list(state["current_xy"]), current_xy=output.reshape(-1).tolist())
    validate_state(state=updated)
    return output.copy(), updated


def initialize_inner_filter(*, state, points, begin, end, width, height, escale, count):
    """Model the int-argument initializer, not caller-side FCVTZS or reset routing.

    Only current is cleared. Alpha, previous and both deltas survive re-init;
    w7 is stored independently of the copied [w2,w3) range. This profile bounds
    both to106. Width/height are the actual w4/w5 arguments, not image labels.
    """
    validate_state(state=state)
    values = point_input(points=points)
    for side in (width, height):
        integer(value=side, minimum=1, maximum=4096)
    integer(value=escale, maximum=32768)
    integer(value=begin, maximum=len(values))
    integer(value=end, minimum=begin, maximum=len(values))
    integer(value=count, minimum=106, maximum=106)
    if end - begin != count:
        raise ValueError("primary106 initialization range required")
    updated = deepcopy(state)
    updated.update(current_xy=values[begin:end].reshape(-1).tolist(), count=count, first=True,
                   width=width, height=height, escale=float(np.float32(escale)),
                   scale=float(np.float32((float(escale) / 720.0) * float(min(width, height)))))
    validate_state(state=updated)
    return updated
