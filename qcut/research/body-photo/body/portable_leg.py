"""Foot-anchored leg lengthening for the portable still-image renderer."""
import numbers

import numpy as np


MAX_TARGET = .35
MAX_LEG_GAIN = .14
MIN_AREA_RATIO = .05


def _array(*, value, shape, name):
    data = np.asarray(value, dtype=np.float32)
    if data.shape != shape or not np.all(np.isfinite(data)):
        raise ValueError(name + " must match the finite source grid")
    return data


def _validate(*, state, target, width, height):
    dimensions = np.asarray([width, height], dtype=np.float64)
    if (not np.all(np.isfinite(dimensions)) or np.any(dimensions < 1)
            or np.any(dimensions > 32768)):
        raise ValueError("finite image dimensions in 1..32768 required")
    if (isinstance(target, (bool, np.bool_)) or not isinstance(target, numbers.Real)
            or not np.isfinite(target) or not 0 <= target <= MAX_TARGET + 1e-7):
        raise ValueError("LongLeg target must be finite and in 0..0.35")
    base = np.asarray(state["base"], dtype=np.float32)
    if (base.ndim != 3 or base.shape[2] != 2 or min(base.shape[:2]) < 3
            or base.shape[0] * base.shape[1] > 8192 or not np.all(np.isfinite(base))):
        raise ValueError("bounded regular source-pixel grid required")
    xx, yy = np.meshgrid(np.linspace(0, width, base.shape[1]),
                         np.linspace(0, height, base.shape[0]))
    if not np.allclose(base, np.stack((xx, yy), axis=-1), atol=.003, rtol=1e-6):
        raise ValueError("source grid must cover the image with bottom-origin coordinates")
    delta = _array(value=state["delta"], shape=base.shape, name="delta")
    positions = _array(value=state["positions"], shape=base.shape, name="positions")
    stages = {name: _array(value=value, shape=base.shape, name=name)
              for name, value in state["stages"].items()}
    names = list(stages)
    if "SmallHead" not in stages or "LongLeg" not in stages or names.index("LongLeg") != 1:
        raise ValueError("expected cumulative SmallHead then LongLeg stages")
    if names[0] != "SmallHead" or not np.array_equal(delta, stages[names[-1]]):
        raise ValueError("cumulative stages must end with the final delta")
    triangles = np.asarray(state["tri"])
    if (triangles.ndim != 2 or triangles.shape[1] != 3 or not 0 < len(triangles) <= 16384
            or triangles.dtype.kind not in "iu" or np.any(triangles < 0)
            or np.any(triangles >= base.shape[0] * base.shape[1])):
        raise ValueError("bounded valid triangle indices required")
    return base, delta, positions, stages, triangles


def _pinned(*, delta):
    result = delta.copy()
    result[0, :, 1] = np.minimum(result[0, :, 1], 0)
    result[-1, :, 1] = np.maximum(result[-1, :, 1], 0)
    result[:, 0, 0] = np.minimum(result[:, 0, 0], 0)
    result[:, -1, 0] = np.maximum(result[:, -1, 0], 0)
    return result


def _areas(*, positions, triangles):
    points = np.asarray(positions, dtype=np.float64).reshape(-1, 2)[triangles]
    first, second = points[:, 1] - points[:, 0], points[:, 2] - points[:, 0]
    return first[:, 0] * second[:, 1] - first[:, 1] * second[:, 0]


def _points(*, eligibility, name, width, height, optional=False):
    points = np.asarray(eligibility.get("points", {}).get(name, []), dtype=np.float64)
    if optional and points.size == 0:
        return points
    if (points.shape != (2, 2) or not np.all(np.isfinite(points)) or np.any(points < 0)
            or np.any(points > [width, height])):
        raise ValueError("eligible pose requires two finite in-image " + name)
    return points


def _profile(*, base, eligibility, width, height):
    hips, knees, ankles = [_points(eligibility=eligibility, name=name, width=width, height=height)
                           for name in ("hips", "knees", "ankles")]
    shoulders = _points(eligibility=eligibility, name="shoulders", width=width, height=height,
                        optional=True)
    hip_y = float(np.mean(hips[:, 1]))
    ankle_y = float(np.min(ankles[:, 1]))
    shin_span = float(np.min(ankles[:, 1] - knees[:, 1]))
    leg_span = ankle_y - hip_y
    if shin_span <= 0 or leg_span <= 0 or np.any(knees[:, 1] <= hips[:, 1]):
        raise ValueError("eligible leg anchors must progress from hips through knees to ankles")
    spacing = height / (base.shape[0] - 1)
    # Two coarse rows leave bilinear support above the ankle/shoe region.
    foot_guard = max(2 * spacing, .08 * shin_span)
    foot_y = np.floor((ankle_y - foot_guard) / spacing) * spacing
    upper_y = (float(np.min(shoulders[:, 1])) if shoulders.size else
               max(0, float(np.min(hips[:, 1])) - .55 * leg_span))
    upper_y = np.ceil(upper_y / spacing) * spacing
    if not 0 <= upper_y < hip_y < foot_y <= height:
        return None, {"reason": "not enough vertical space for fixed feet and upper torso",
                      "reasonCode": "insufficient-anchor-space"}
    yy = height - base[..., 1].astype(np.float64)
    rise = np.clip((yy - upper_y) / (hip_y - upper_y), 0, 1)
    fall = np.clip((foot_y - yy) / (foot_y - hip_y), 0, 1)
    smooth = lambda value: value * value * (3 - 2 * value)
    weights = np.where(yy <= hip_y, smooth(rise), smooth(fall))
    weights[(yy <= upper_y + 1e-4) | (yy >= foot_y - 1e-4)] = 0
    unit = np.zeros_like(base, dtype=np.float64)
    unit[..., 1] = weights
    # Bound the upper ramp's maximum derivative, independently of slider strength.
    requested_max = min(MAX_LEG_GAIN * leg_span, .35 * (hip_y - upper_y))
    return unit, {"upperAnchorY": float(upper_y), "hipAnchorY": hip_y,
                  "fixedFootFromY": float(foot_y), "minimumAnkleY": ankle_y,
                  "footGuardPixels": float(ankle_y - foot_y),
                  "requestedShiftAt100Pixels": requested_max,
                  "shoulderAnchorAvailable": bool(shoulders.size)}


def _safe_amplitude(*, base, positions, unit, triangles, requested):
    reference = _areas(positions=base, triangles=triangles)
    if np.any(reference == 0):
        raise ValueError("source triangles must have nonzero area")
    orientation = np.sign(reference)
    initial = _areas(positions=positions, triangles=triangles) * orientation
    minimum = np.abs(reference) * MIN_AREA_RATIO
    if np.any(initial < minimum):
        return 0.0, "existing mesh has a fold or an excessively compressed triangle"
    # Vertical-only motion makes each triangle's signed area linear in amplitude.
    slope = (_areas(positions=positions.astype(np.float64) + unit, triangles=triangles)
             * orientation - initial)
    shrinking = slope < -1e-10
    limit = float(np.min((initial[shrinking] - minimum[shrinking]) / -slope[shrinking])) \
        if np.any(shrinking) else requested / .98
    return max(0.0, min(requested, .98 * limit)), None


def adjust_long_leg(*, state, eligibility, target, width, height):
    """Replace the legacy leg increment, preserving other cumulative increments.

    ``target`` is the internal 0..0.35 value. Pose anchors use source-pixel
    top-left coordinates; mesh arrays use bottom-left coordinates.
    """
    base, delta, positions, stages, triangles = _validate(
        state=state, target=target, width=width, height=height)
    details = {"policy": "raise-hip-fixed-foot-v1", "target": float(target),
               "strength": round(min(float(target) / MAX_TARGET, 1) * 100, 6),
               "moved": False, "reason": "zero", "reasonCode": "zero",
               "maximumShiftPixels": 0.0, "safetyScale": 0.0,
               "footRegionUnchangedByLongLeg": True}
    if not target:
        return state, details
    old_leg = stages["LongLeg"] - stages["SmallHead"]
    other_delta = delta - old_leg
    # Preserve the solver's post-processing of every non-leg displacement.
    other_positions = positions + (_pinned(delta=other_delta) - _pinned(delta=delta))
    replacement = np.zeros_like(base)
    if not eligibility.get("eligible"):
        details.update(reason=eligibility.get("reason") or "complete leg anchors required",
                       reasonCode=eligibility.get("reasonCode") or "ineligible-pose")
    else:
        unit, anchors = _profile(base=base, eligibility=eligibility, width=width, height=height)
        details.update(anchors)
        if unit is not None:
            requested = anchors["requestedShiftAt100Pixels"]
            maximum, reason = _safe_amplitude(base=base, positions=other_positions, unit=unit,
                                              triangles=triangles, requested=requested)
            amplitude = maximum * min(float(target) / MAX_TARGET, 1)
            replacement = (unit * amplitude).astype(np.float32)
            moved = bool(np.any(replacement))
            details.update(moved=moved, reason=reason if not moved else None,
                           reasonCode="unsafe-existing-mesh" if not moved else None,
                           shiftAt100Pixels=maximum, requestedShiftPixels=requested * target / MAX_TARGET,
                           maximumShiftPixels=float(np.max(replacement[..., 1])),
                           safetyScale=maximum / requested if requested else 0,
                           proportionChange="hips rise, upper torso compresses, ankles and shoes stay fixed")
    difference = replacement - old_leg
    new_stages = {name: (value.copy() if name == "SmallHead" else value + difference)
                  for name, value in stages.items()}
    new_delta = next(reversed(new_stages.values()))
    new_positions = other_positions + replacement
    reference = _areas(positions=base, triangles=triangles)
    if np.any(reference == 0):
        raise ValueError("source triangles must have nonzero area")
    ratios = _areas(positions=new_positions, triangles=triangles) / reference
    details["minimumTriangleAreaRatio"] = float(np.min(ratios))
    details["removedLegacyMaximumShiftPixels"] = float(np.max(np.abs(old_leg[..., 1])))
    return {**state, "delta": new_delta, "positions": new_positions, "stages": new_stages}, details
