"""Independent float32 preparation and sampling coordinates for local face warps."""
import math
from numbers import Real

import numpy as np

F = np.float32


def finite_array(*, value, shape, name):
    array = np.asarray(value)
    if array.dtype != np.float32 or array.shape != shape or not np.isfinite(array).all():
        raise ValueError(f"finite float32 {name} with shape {shape} required")
    return array


def build_steps(*, points, records, size, yaw_radians, anchor_mode=0):
    points = finite_array(value=points, shape=(106, 2), name="normalized landmarks")
    records = np.asarray(records)
    if records.ndim != 2 or not 1 <= len(records) <= 40:
        raise ValueError("one to forty deformation steps required")
    records = finite_array(value=records, shape=(len(records), 9), name="step records")
    if (not isinstance(size, (tuple, list)) or len(size) != 2
            or any(type(side) is not int or not 1 <= side <= 4096 for side in size)):
        raise ValueError("bounded image dimensions required")
    if (isinstance(yaw_radians, (bool, np.bool_)) or not isinstance(yaw_radians, Real)
            or not math.isfinite(yaw_radians) or abs(yaw_radians) > math.pi / 2):
        raise ValueError("bounded yaw in radians required")
    if type(anchor_mode) is not int or anchor_mode not in (0, 1, 2):
        raise ValueError("unsupported anchor mode")
    if (np.any(records[:, 6] < 0) or np.any(records[:, 6] >= 106)
            or np.any(records[:, 0] < 0) or np.any(records[:, 0] > 2)):
        raise ValueError("out-of-range landmark indices or actions")
    indices = records[:, 6].astype(np.int32)
    actions = records[:, 0].astype(np.int32)
    if (np.any(records[:, 6] != indices) or np.any(indices < 0) or np.any(indices >= 106)
            or np.any(records[:, 0] != actions) or np.any(actions < 0) or np.any(actions > 2)
            or np.any(records[:, 7] <= 0)):
        raise ValueError("invalid landmark indices, actions or radii")
    scaled = points * np.asarray(size, np.float32)
    left, right = ((74, 77), (74, 75), (80, 81))[anchor_mode]
    direction = scaled[right] - scaled[left]
    length = F(np.sqrt(F(direction[0] * direction[0] + direction[1] * direction[1])))
    if length <= F(1e-5):
        raise ValueError("degenerate anchor landmarks")
    yaw = F(yaw_radians)
    reciprocal = F(min(1.0 / float(F(F(math.cos(float(yaw))) + F(.001))), 10.0))
    radius_scale = reciprocal
    if abs(float(F(F(F(yaw * F(.5)) / F(math.pi)) * F(360)))) < 57:
        radius_scale = F(F(F(math.sin(abs(float(yaw)))) + F(.001)) + F(1))
    basis = (direction * F(.25)) * reciprocal
    perpendicular = np.array([-basis[1], basis[0]], np.float32)
    start = (basis * records[:, 2:3] + scaled[indices]) + perpendicular * records[:, 3:4]
    end = (basis * records[:, 4:5] + start) + perpendicular * records[:, 5:6]
    radius = (float(length) * float(radius_scale) * records[:, 7].astype(np.float64)).astype(np.float32)
    return {"start": start, "end": end, "action": actions.astype(np.float32),
            "strength": records[:, 8].copy(), "radius": radius}


def warp_coordinates(*, coordinates, steps, radial_profile="linear"):
    coordinates = np.asarray(coordinates)
    if coordinates.ndim != 2 or coordinates.shape[1] != 2 or len(coordinates) > 16777216:
        raise ValueError("bounded coordinate pairs required")
    result = finite_array(value=coordinates, shape=coordinates.shape, name="coordinates").copy()
    if not isinstance(steps, dict) or set(steps) != {"start", "end", "action", "strength", "radius"}:
        raise ValueError("explicit deformation step fields required")
    if radial_profile not in ("linear", "quadratic"):
        raise ValueError("unsupported radial falloff")
    radii = np.asarray(steps["radius"])
    if radii.ndim != 1:
        raise ValueError("one-dimensional deformation radii required")
    count = len(radii)
    if not 1 <= count <= 40:
        raise ValueError("one to forty deformation steps required")
    for name, value in steps.items():
        finite_array(value=value, shape=(count, 2) if name in ("start", "end") else (count,), name=name)
    if np.any(steps["radius"] <= 0) or not np.isin(steps["action"], (0, 1, 2)).all():
        raise ValueError("invalid deformation action or radius")
    for start, end, action, strength, radius in zip(steps["start"], steps["end"], steps["action"], steps["strength"], steps["radius"]):
        center = start if action == 0 else end
        relative = result - center
        distance = np.sqrt(np.sum(relative * relative, axis=1, dtype=np.float32))
        if action == 0:
            weight = np.clip(F(1) - distance / radius, 0, 1)
            result -= ((end - start) * weight[:, None]) * strength
            continue
        if action == 1:
            weight = np.clip(F(1) - distance / F(radius * F(1.2)), 0, 1)
            factor = F(1) - strength * weight
            if radial_profile == "quadratic":
                weight = distance / radius
                factor = np.clip(F(1) - strength * (F(1) - weight * weight), F(0), F(1))
            result = center + relative * factor[:, None]
            continue
        weight = distance / radius
        factor = np.clip(F(1) - strength * (F(1) - weight * weight), F(.0001), F(1))
        result = center + relative / factor[:, None]
    if not np.isfinite(result).all():
        raise ValueError("deformation produced nonfinite coordinates")
    return result
