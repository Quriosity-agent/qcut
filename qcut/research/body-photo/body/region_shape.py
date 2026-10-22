"""Pose-anchored 2D abdomen, lower-hip, knee and ankle mesh adjustments."""
import numpy as np


REGION_RANGES = {
    "Abdomen": (0, 100), "ButtLift": (0, 100), "ButtShape": (-50, 50),
    "LegStraighten": (0, 100), "AnkleWidth": (-50, 50),
}
MIN_SCORE = .2


def _numeric(*, value):
    data = np.asarray(value)
    if data.dtype.kind not in "iuf":
        raise ValueError("numeric coordinates required")
    return data.astype(np.float64)


def _points(*, pose, algorithm_size, dimensions, indices):
    try:
        data, size = _numeric(value=pose), _numeric(value=algorithm_size)
        if (data.shape != (18, 4) or size.shape != (2,)
                or not np.all(np.isfinite(size)) or np.any(size < 2)):
            raise ValueError("valid 18-joint pose and algorithm dimensions required")
        selected = data[list(indices)]
        if (not np.all(np.isfinite(selected)) or np.any(selected[:, 3] != 1)
                or np.any(selected[:, 2] < MIN_SCORE)):
            raise ValueError("required joints must be visible and confident")
        if np.any(selected[:, :2] < 0) or np.any(selected[:, :2] >= size):
            raise ValueError("required joints must be inside the photo")
        return selected[:, :2] / size * dimensions
    except (TypeError, OverflowError) as error:
        raise ValueError("valid numeric pose required") from error


def _smooth(*, value):
    value = np.clip(value, 0, 1)
    return value * value * (3 - 2 * value)


def _ellipse(*, xy, center, radii):
    relative = (xy - center) / radii
    return np.maximum(0, 1 - np.sum(relative * relative, axis=-1)) ** 2


def _border_weight(*, xy, dimensions, radius):
    distance = np.minimum(np.min(xy, axis=-1), np.min(dimensions - xy, axis=-1))
    return _smooth(value=distance / max(1., min(64., radius * .25)))


def _torso(*, pose, algorithm_size, dimensions):
    points = _points(pose=pose, algorithm_size=algorithm_size, dimensions=dimensions,
                     indices=(2, 5, 8, 11))
    shoulders, hips = points[:2], points[2:]
    top, bottom = shoulders.mean(axis=0), hips.mean(axis=0)
    rise = bottom[1] - top[1]
    hip_width = abs(float(hips[1, 0] - hips[0, 0]))
    shoulder_width = abs(float(shoulders[1, 0] - shoulders[0, 0]))
    minimum = max(12., .035 * float(np.max(dimensions)))
    if (rise < minimum or min(hip_width, shoulder_width) < minimum
            or rise / max(1., np.linalg.norm(bottom - top)) < .75
            or abs(hips[1, 1] - hips[0, 1]) > .45 * hip_width
            or abs(shoulders[1, 1] - shoulders[0, 1]) > .65 * shoulder_width
            or not .35 < hip_width / shoulder_width < 2.5):
        raise ValueError("upright separated shoulders and hips required")
    return shoulders, hips, top, bottom, rise, hip_width


def _paired_legs(*, points, dimensions, downward):
    lengths = np.linalg.norm(np.diff(points, axis=1), axis=-1)
    dy = np.diff(points[..., 1], axis=1)
    minimum = max(12., .035 * float(np.max(dimensions)))
    if np.any(lengths < minimum) or np.any(dy / np.maximum(lengths, 1) < downward):
        raise ValueError("upright sufficiently large leg segments required")
    # Compare spatial sides at a common image Y, including every detected bend.
    ordered = points[np.argsort(points[:, 0, 0])]
    lower = max(ordered[0, 0, 1], ordered[1, 0, 1])
    upper = min(ordered[0, -1, 1], ordered[1, -1, 1])
    if upper - lower < minimum:
        raise ValueError("both legs need an overlapping upright span")
    rows = np.unique(np.concatenate((np.linspace(lower, upper, 33), points[..., 1].ravel())))
    rows = rows[(rows >= lower) & (rows <= upper)]
    gap = (np.interp(rows, ordered[1, :, 1], ordered[1, :, 0])
           - np.interp(rows, ordered[0, :, 1], ordered[0, :, 0]))
    if np.min(gap) < max(6., .015 * dimensions[0]):
        raise ValueError("crossed or overlapping legs require manual correction")
    return lengths, float(np.min(gap))


def _bounds(*, center, radii):
    return [float(center[0] - radii[0]), float(center[1] - radii[1]),
            float(center[0] + radii[0]), float(center[1] + radii[1])]


def _longitudinal_weight(*, y, top, peak, bottom):
    return np.where(y < peak, _smooth(value=(y - top) / (peak - top)),
                    _smooth(value=(bottom - y) / (bottom - peak)))


def _plateau_weight(*, distance, core, radius):
    return 1 - _smooth(value=(np.abs(distance) - core) / np.maximum(radius - core, 1.))


def _lift_support(*, xy, hips, knees, thigh_height, center, radius, hip_width,
                  shoulder_width, row_spacing):
    hip_y = float(np.max(hips[:, 1]))
    top = (np.ceil(hip_y / row_spacing) + 1) * row_spacing
    peak_start, peak_end, bottom = hip_y + np.array([.30, .42, .82]) * thigh_height
    bottom = min(bottom, float(np.min(knees[:, 1])) - 2 * row_spacing)
    if min(peak_start - top, bottom - peak_end) < 2 * row_spacing:
        raise ValueError("insufficient lower-hip support below the fixed hip band")
    core = min(.55 * radius, max(.65 * hip_width, .45 * shoulder_width))
    across = _plateau_weight(distance=xy[..., 0] - center[0], core=core, radius=radius)
    vertical = (_smooth(value=(xy[..., 1] - top) / (peak_start - top))
                * _smooth(value=(bottom - xy[..., 1]) / (bottom - peak_end)))
    # Smoothstep's maximum slope is 1.5; bound compression before combined-mesh safety.
    lift = min(.12 * thigh_height, .18 * hip_width, .22 * (peak_start - top))
    return across * vertical, lift, {
        "kind": "hip-pinned-lower-body-lift",
        "center": [float(center[0]), float((peak_start + peak_end) * .5)],
        "coreRadiusX": float(core), "radiusX": float(radius), "topY": float(top),
        "peakStartY": float(peak_start), "peakEndY": float(peak_end),
        "bottomY": float(bottom), "boundsXYXY": [float(center[0] - radius), float(top),
        float(center[0] + radius), float(bottom)], "maximumBaseCompression": .33,
    }


def _arm_protection(*, xy, pose, algorithm_size, dimensions, shoulder_width, row_spacing):
    weight = np.ones(xy.shape[:-1], dtype=np.float64)
    guards = []
    for elbow_index, wrist_index in ((3, 4), (6, 7)):
        try:
            elbow, wrist = _points(pose=pose, algorithm_size=algorithm_size,
                                   dimensions=dimensions, indices=(elbow_index, wrist_index))
        except (ValueError, TypeError):
            continue
        axis = wrist - elbow
        length = float(np.linalg.norm(axis))
        if length < max(8., .01 * float(np.max(dimensions))):
            continue
        # The extra mesh rows keep interpolation triangles outside the protected limb.
        padding = 2 * row_spacing
        radius = max(.13 * shoulder_width, .22 * length) + padding
        hand_radius = max(.18 * shoulder_width, .42 * length) + padding
        feather = max(row_spacing, .12 * shoulder_width)
        along = np.clip(np.sum((xy - elbow) * axis, axis=-1) / (length * length), 0, 1)
        distance = np.linalg.norm(xy - (elbow + along[..., None] * axis), axis=-1)
        hand_distance = np.linalg.norm(xy - wrist, axis=-1)
        weight *= _smooth(value=(distance - radius) / feather)
        weight *= _smooth(value=(hand_distance - hand_radius) / feather)
        guards.append({"elbow": elbow.tolist(), "wrist": wrist.tolist(),
                       "forearmRadius": radius, "wristDiskRadius": hand_radius,
                       "featherPixels": feather, "landmarksAreDetectedJoints": True})
    return weight, guards


def _torso_delta(*, name, xy, pose, algorithm_size, dimensions, strength, row_spacing):
    shoulders, hips, top, bottom, rise, hip_width = _torso(
        pose=pose, algorithm_size=algorithm_size, dimensions=dimensions)
    anchors = {"shoulders": shoulders.tolist(), "hips": hips.tolist()}
    shoulder_width = abs(float(shoulders[1, 0] - shoulders[0, 0]))
    if name == "Abdomen":
        center = top + (bottom - top) * .80
        radii = np.array([max(1.35 * hip_width, .95 * shoulder_width), .19 * rise])
    else:
        knees = _points(pose=pose, algorithm_size=algorithm_size, dimensions=dimensions,
                         indices=(9, 12))
        thighs = np.stack((hips, knees), axis=1)
        _paired_legs(points=thighs, dimensions=dimensions, downward=.65)
        thigh_height = float(np.min(knees[:, 1] - hips[:, 1]))
        center = bottom + [0, .17 * thigh_height]
        radii = np.array([max(1.5 * hip_width, 1.10 * shoulder_width), .21 * thigh_height])
        anchors["knees"] = knees.tolist()
    weight = _ellipse(xy=xy, center=center, radii=radii)
    support = {"kind": "local-ellipse", "center": center.tolist(), "radii": radii.tolist(),
               "boundsXYXY": _bounds(center=center, radii=radii)}
    if name == "ButtLift":
        weight, lift, support = _lift_support(xy=xy, hips=hips, knees=knees, thigh_height=thigh_height,
            center=center, radius=float(radii[0]), hip_width=hip_width,
            shoulder_width=shoulder_width, row_spacing=row_spacing)
    if name == "ButtShape":
        top_y, peak_y, bottom_y = bottom[1] + np.array([-.16, .20, .75]) * thigh_height
        across = np.maximum(0, 1 - ((xy[..., 0] - center[0]) / radii[0]) ** 2) ** 2
        weight = across * _longitudinal_weight(y=xy[..., 1], top=top_y, peak=peak_y, bottom=bottom_y)
        support = {"kind": "lower-hip-upper-thigh-blend", "center": center.tolist(),
                   "radiusX": float(radii[0]), "topY": float(top_y), "peakY": float(peak_y),
                   "bottomY": float(bottom_y), "boundsXYXY": [float(center[0] - radii[0]),
                   float(top_y), float(center[0] + radii[0]), float(bottom_y)]}
    protected, guards = _arm_protection(xy=xy, pose=pose, algorithm_size=algorithm_size,
        dimensions=dimensions, shoulder_width=shoulder_width, row_spacing=row_spacing)
    weight *= protected
    weight *= _border_weight(xy=xy, dimensions=dimensions, radius=float(min(radii)))
    delta = np.zeros_like(xy)
    if name == "ButtLift":
        delta[..., 1] = -lift * strength * weight
        anchors.update(hipsPinned=True, kneesPinned=True, requestedPeakLiftPixels=lift * strength)
    else:
        amount = -.40 if name == "Abdomen" else .16
        delta[..., 0] = amount * strength * (xy[..., 0] - center[0]) * weight
    return delta, {
        "anchors": anchors,
        "support": support, "protectedDetectedArms": guards,
        "shapeModel": "2d-pose-anchored-contour", "posteriorProjection": False,
        "landmarksAreDetectedJoints": True,
        "limitation": "local contour displacement; no 3D volume, muscle or occlusion reconstruction",
    }


def _foot_top(*, ankles, calf_heights, row_spacing):
    guard = max(2 * row_spacing, .10 * float(np.min(calf_heights)))
    top = float(np.min(ankles[:, 1]) - guard)
    return float(np.floor(top / row_spacing) * row_spacing), guard


def _straighten_delta(*, xy, pose, algorithm_size, dimensions, strength, row_spacing):
    points = _points(pose=pose, algorithm_size=algorithm_size, dimensions=dimensions,
                     indices=(8, 9, 10, 11, 12, 13)).reshape(2, 3, 2)
    lengths, gap = _paired_legs(points=points, dimensions=dimensions, downward=.80)
    hips, knees, ankles = points[:, 0], points[:, 1], points[:, 2]
    ratios = lengths[:, 0] / lengths[:, 1]
    if np.any(ratios < .4) or np.any(ratios > 2.5):
        raise ValueError("consistent thigh and calf proportions required")
    span = ankles[:, 1] - hips[:, 1]
    target_x = hips[:, 0] + (ankles[:, 0] - hips[:, 0]) * (knees[:, 1] - hips[:, 1]) / span
    corrections = target_x - knees[:, 0]
    radius = min(.22 * float(np.min(lengths)), .35 * gap)
    if np.any(np.abs(corrections) > min(.07 * float(np.min(span)), .40 * radius)):
        raise ValueError("large intentional knee bends require manual correction")
    if np.max(np.abs(corrections)) < .25:
        raise ValueError("knees are already aligned with hips and ankles")
    foot_top, guard = _foot_top(ankles=ankles, calf_heights=ankles[:, 1] - knees[:, 1],
                                row_spacing=row_spacing)
    if foot_top - np.max(knees[:, 1]) <= max(2 * row_spacing, .15 * np.min(lengths)):
        raise ValueError("insufficient room above the fixed foot band")
    delta = np.zeros_like(xy)
    sides = []
    y = xy[..., 1]
    axes = [np.interp(y, leg[:, 1], leg[:, 0]) for leg in points]
    local_gap = np.abs(axes[1] - axes[0])
    outer = np.minimum(.42 * float(np.min(lengths)), .47 * local_gap)
    core = np.minimum(.20 * float(np.min(lengths)), .22 * local_gap)
    for index, (hip, knee, ankle) in enumerate(points):
        center_x = axes[index]
        hip_top = (np.ceil(hip[1] / row_spacing) + 1) * row_spacing
        if hip_top >= knee[1]:
            raise ValueError("insufficient leg support below the fixed hip band")
        rise = _smooth(value=(y - hip_top) / (knee[1] - hip_top))
        fall = _smooth(value=(foot_top - y) / (foot_top - knee[1]))
        vertical = np.where(y <= knee[1], rise, fall)
        across = _plateau_weight(distance=xy[..., 0] - center_x, core=core, radius=outer)
        weight = vertical * across * _border_weight(xy=xy, dimensions=dimensions,
                                                    radius=float(np.max(outer)))
        weight[(y <= hip_top) | (y >= foot_top)] = 0
        delta[..., 0] += corrections[index] * strength * weight
        knee_gap = abs(float(np.interp(knee[1], points[1 - index, :, 1],
                                      points[1 - index, :, 0])) - knee[0])
        sides.append({"index": index, "hip": hip.tolist(), "knee": knee.tolist(),
                      "ankle": ankle.tolist(), "targetKneeX": float(target_x[index]),
                      "requestedKneeShiftX": float(corrections[index] * strength),
                      "analyticKneeAfter": [float(knee[0] + corrections[index] * strength), float(knee[1])],
                      "fixedHipThroughY": float(hip_top),
                      "coreRadiusAtKnee": min(.20 * float(np.min(lengths)), .22 * knee_gap),
                      "radius": min(.42 * float(np.min(lengths)), .47 * knee_gap)})
    return delta, {"anchors": {"sides": sides}, "support": {"kind": "paired-rigid-core-capsules",
                   "minimumSideGap": gap, "sideSupportFraction": .47,
                   "targetIsOriginalHipAnkleAxis": True}, "fixedFootFromY": foot_top,
                   "footGuardPixels": guard, "hipsAndAnklesPinned": True,
                   "shapeModel": "2d-knee-axis-alignment"}


def _ankle_delta(*, xy, pose, algorithm_size, dimensions, strength, row_spacing):
    points = _points(pose=pose, algorithm_size=algorithm_size, dimensions=dimensions,
                     indices=(9, 10, 12, 13)).reshape(2, 2, 2)
    lengths, gap = _paired_legs(points=points, dimensions=dimensions, downward=.70)
    knees, ankles = points[:, 0], points[:, 1]
    calf_height = ankles[:, 1] - knees[:, 1]
    if abs(ankles[0, 1] - ankles[1, 1]) > .20 * np.min(calf_height):
        raise ValueError("ankles must be at comparable standing heights")
    if np.any(dimensions[1] - ankles[:, 1] < np.maximum(2., .08 * calf_height)):
        raise ValueError("complete feet below both ankles required")
    foot_top, guard = _foot_top(ankles=ankles, calf_heights=calf_height, row_spacing=row_spacing)
    radius = min(.24 * float(np.min(lengths)), .35 * gap)
    delta, sides = np.zeros_like(xy), []
    for index, (knee, ankle) in enumerate(points):
        top_y = knee[1] + .12 * calf_height[index]
        height = foot_top - top_y
        if height < 4 * row_spacing:
            raise ValueError("ankle support is too small above the fixed foot band")
        y = xy[..., 1]
        center_x = knee[0] + (ankle[0] - knee[0]) * (y - knee[1]) / calf_height[index]
        peak_y = top_y + height * .52
        qx = (xy[..., 0] - center_x) / radius
        weight = np.maximum(0, 1 - qx * qx) ** 2
        weight *= _longitudinal_weight(y=y, top=top_y, peak=peak_y, bottom=foot_top)
        weight *= _border_weight(xy=xy, dimensions=dimensions, radius=radius)
        weight[y >= foot_top] = 0
        delta[..., 0] += .22 * strength * (xy[..., 0] - center_x) * weight
        sides.append({"index": index, "knee": knee.tolist(), "ankle": ankle.tolist(),
                      "radius": radius, "topY": float(top_y), "peakY": float(peak_y), "bottomY": foot_top})
    return delta, {"anchors": {"sides": sides}, "support": {"kind": "paired-above-ankle-capsules",
                   "radius": radius, "minimumSideGap": gap}, "fixedFootFromY": foot_top,
                   "footGuardPixels": guard, "shoesPinned": True, "shapeModel": "2d-above-ankle-width"}


def build_region_delta(*, base, pose, algorithm_size, width, height, controls):
    """Return bottom-origin mesh displacement; the caller gates people and mesh area."""
    dimensions = _numeric(value=[width, height])
    source = _numeric(value=base)
    if (isinstance(width, (bool, np.bool_)) or isinstance(height, (bool, np.bool_))
            or not np.all(np.isfinite(dimensions)) or np.any(dimensions < 2) or np.any(dimensions > 32768)
            or source.ndim < 2 or source.shape[-1] != 2 or source.size == 0
            or source.size > 16384 or not np.all(np.isfinite(source))
            or np.any(source < 0) or np.any(source > dimensions)):
        raise ValueError("bounded finite source-pixel mesh and image dimensions required")
    if not isinstance(controls, dict):
        raise ValueError("region controls must be a dictionary")
    xy = source.copy()
    xy[..., 1] = height - xy[..., 1]
    row_spacing = height / (source.shape[0] - 1) if source.ndim == 3 and source.shape[0] > 1 else height / 80
    total, parts = np.zeros_like(source, dtype=np.float32), {}
    for name, (minimum, maximum) in REGION_RANGES.items():
        value = controls.get(name, 0)
        if type(value) is not int or not minimum <= value <= maximum:
            raise ValueError(f"{name} must be an integer in {minimum}..{maximum}")
        strength = value / maximum
        detail = {"intensity": strength, "moved": False, "reason": "zero", "anchors": {},
                  "support": {}, "coordinateSpace": "source-top-left", "borderPinned": True}
        parts[name] = detail
        if not value:
            continue
        arguments = dict(xy=xy, pose=pose, algorithm_size=algorithm_size, dimensions=dimensions,
                         strength=strength)
        try:
            if name in ("Abdomen", "ButtLift", "ButtShape"):
                delta, geometry = _torso_delta(name=name, row_spacing=row_spacing, **arguments)
            elif name == "LegStraighten":
                delta, geometry = _straighten_delta(row_spacing=row_spacing, **arguments)
            else:
                delta, geometry = _ankle_delta(row_spacing=row_spacing, **arguments)
        except (ValueError, TypeError, OverflowError) as error:
            detail["reason"] = str(error)
            continue
        delta[..., 1] *= -1
        moved = bool(np.any(delta))
        detail.update(geometry, moved=moved, reason=None if moved else "support misses movable mesh vertices",
                      affectedVertices=int(np.count_nonzero(np.any(delta != 0, axis=-1))),
                      maxMeshShiftPixelsBeforeCombinedSafety=float(np.max(np.linalg.norm(delta, axis=-1))))
        total += delta.astype(np.float32)
    return total, parts
