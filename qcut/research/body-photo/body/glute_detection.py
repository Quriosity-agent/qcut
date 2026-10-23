"""Conservative source-contour estimates, not trained anatomical glute landmarks."""
import numpy as np
from PIL import Image, ImageFilter

if __package__:
    from .glute_lift import build_glute_delta
else:
    from glute_lift import build_glute_delta


METHOD = "silhouette-garment-contour-estimate-v1"


def _unavailable(*, reason, diagnostics, candidate=None):
    result = {"available": False, "selection": None, "confidence": 0., "reason": reason,
              "method": METHOD, "diagnostics": diagnostics}
    if candidate is not None:
        result["candidateSelection"] = candidate
    return result


def _smooth(*, values, radius):
    radius = max(1, int(round(radius)))
    return np.convolve(np.pad(values, (radius, radius), mode="edge"),
                       np.ones(2 * radius + 1) / (2 * radius + 1), mode="valid")


def _source(*, rgba, person_mask):
    if (not isinstance(rgba, np.ndarray) or rgba.dtype != np.uint8 or rgba.ndim != 3
            or rgba.shape[2] != 4 or min(rgba.shape[:2]) < 64
            or max(rgba.shape[:2]) > 4096 or rgba.shape[0] * rgba.shape[1] > 8_294_400):
        raise ValueError("bounded uint8 RGBA photo required for contour detection")
    if (not isinstance(person_mask, np.ndarray) or person_mask.shape != rgba.shape[:2]
            or person_mask.dtype.kind not in "buif" or not np.isfinite(person_mask).all()
            or not np.isin(person_mask, (0, 1, 255)).all()):
        raise ValueError("aligned binary person mask required for contour detection")
    height, width = rgba.shape[:2]
    ratio = min(1., 768 / max(width, height))
    size = (max(2, round(width * ratio)), max(2, round(height * ratio)))
    rgb = Image.fromarray(rgba[..., :3]).resize(size, Image.Resampling.BILINEAR)
    mask = np.asarray(Image.fromarray((person_mask > 0).astype(np.uint8) * 255).resize(
        size, Image.Resampling.NEAREST)) > 0
    return rgb, mask, np.array(size, dtype=float)


def _pose(*, pose, algorithm_size, dimensions):
    if pose is None or np.asarray(pose).size == 0:
        raise ValueError("no reliable pose; mark visible contours manually")
    data, size = np.asarray(pose), np.asarray(algorithm_size)
    if (data.dtype.kind not in "iuf" or data.shape != (18, 4) or size.shape != (2,)
            or size.dtype.kind not in "iuf" or not np.isfinite(size).all() or np.any(size < 2)):
        raise ValueError("valid pose and algorithm dimensions required")
    data = data.astype(float)
    joints = data[[2, 5, 8, 11]]
    if (not np.isfinite(joints).all() or np.any(joints[:, 3] != 1)
            or np.any(joints[:, 2] < .35) or np.any(joints[:, :2] < 0)
            or np.any(joints[:, :2] >= size)):
        raise ValueError("visible confident shoulders and hips required")
    xy = data[:, :2] / size * dimensions
    return data, xy


def _orientation(*, xy):
    shoulders, hips = xy[[2, 5]], xy[[8, 11]]
    top, center = shoulders.mean(axis=0), hips.mean(axis=0)
    rise = float(center[1] - top[1])
    if rise < 24 or rise / max(1., np.linalg.norm(center - top)) < .78:
        raise ValueError("upright visible torso required")
    shoulder_dx, hip_dx = float(shoulders[0, 0] - shoulders[1, 0]), float(hips[0, 0] - hips[1, 0])
    if abs(hips[0, 1] - hips[1, 1]) > .25 * rise:
        raise ValueError("strongly tilted or ambiguous hips require manual contours")
    if abs(hip_dx) < .15 * rise and abs(shoulder_dx) < .38 * rise:
        return "side", center, rise
    if shoulder_dx > .25 * rise and hip_dx > .12 * rise:
        return "rear", center, rise
    if shoulder_dx < -.20 * rise and hip_dx < -.10 * rise:
        raise ValueError("front-facing torso; visible posterior contours required")
    raise ValueError("ambiguous front/rear orientation; mark contours manually")


def _profile(*, mask, center, rise):
    height, width = mask.shape
    first, last = int(round(center[1] - .28 * rise)), int(round(center[1] + .64 * rise))
    if first < 2 or last >= height - 2:
        raise ValueError("lower buttocks or thigh feathering is cropped")
    rows = np.arange(first, last + 1)
    left, right = [], []
    for y in rows:
        runs = np.split(np.flatnonzero(mask[y]), np.flatnonzero(np.diff(np.flatnonzero(mask[y])) > 1) + 1)
        runs = [run for run in runs if len(run) >= max(4, .035 * rise)]
        containing = [run for run in runs if run[0] <= center[0] <= run[-1]]
        if not containing:
            raise ValueError("person silhouette is interrupted near the hip")
        run = max(containing, key=len)
        if run[0] < 2 or run[-1] >= width - 2:
            raise ValueError("glute silhouette touches the photo border")
        left.append(float(run[0])); right.append(float(run[-1]))
    left, right = (_smooth(values=np.array(values), radius=.018 * rise) for values in (left, right))
    if np.min(right - left) < .12 * rise:
        raise ValueError("insufficient resolved person silhouette")
    return rows, left, right


def _side(*, rows, left, right, rise, center, dimensions):
    first = int(np.argmin(np.abs(rows - (center[1] - .20 * rise))))
    last = int(np.argmin(np.abs(rows - (center[1] + .40 * rise))))
    candidates = []
    for edge, direction, view in ((left, -1, "side-left"), (right, 1, "side-right")):
        line = np.interp(rows, [rows[first], rows[last]], [edge[first], edge[last]])
        bulge = direction * (edge - line)
        valid = (rows >= center[1] - .12 * rise) & (rows <= center[1] + .23 * rise)
        peak_index = int(np.argmax(np.where(valid, bulge, -np.inf)))
        prominence = float(bulge[peak_index])
        after = (rows > rows[peak_index] + max(.11 * rise, .038 * dimensions[1])) & (rows < center[1] + .52 * rise)
        # The fold estimate is a measured inward turn, rather than a fixed fraction below the hip.
        inward = -direction * np.gradient(edge)
        inward = _smooth(values=inward, radius=.02 * rise)
        maxima = after & (inward >= np.roll(inward, 1)) & (inward >= np.roll(inward, -1))
        eligible = np.flatnonzero(maxima & (inward > .10))
        if not len(eligible):
            continue
        fold_index = int(eligible[np.argmax(inward[eligible])])
        peak = np.array([edge[peak_index], rows[peak_index]], dtype=float)
        fold = np.array([edge[fold_index], rows[fold_index]], dtype=float)
        retreat = float(-direction * (fold[0] - peak[0]))
        if prominence < .045 * rise or retreat < .025 * rise:
            continue
        confidence = min(.86, .58 + min(.18, prominence / rise) + min(.10, retreat / rise))
        candidates.append((prominence, {"view": view, "anchors": [{"peak": (peak / dimensions).tolist(),
            "fold": (fold / dimensions).tolist()}]}, confidence,
            {"peak": round(confidence, 4), "fold": round(confidence - .04, 4),
             "foldEvidence": "observed-silhouette-inward-turn", "prominencePixels": prominence,
             "retreatPixels": retreat, "peakPixel": peak.tolist(), "foldPixel": fold.tolist()}))
    if not candidates:
        raise ValueError("no distinct visible posterior bulge and inward lower transition")
    candidates.sort(key=lambda item: item[0], reverse=True)
    if len(candidates) > 1 and candidates[1][0] > .75 * candidates[0][0]:
        raise ValueError("both silhouette sides are ambiguous; mark posterior side manually")
    _, selection, confidence, evidence = candidates[0]
    return selection, confidence, [evidence]


def _garment_edges(*, rgb, mask, rows, left, right, rise):
    luminance = np.asarray(rgb.convert("L").filter(ImageFilter.GaussianBlur(max(.7, .005 * rise))), dtype=float)
    gy, gx = np.gradient(luminance)
    horizontal = np.maximum(0, np.abs(gy) - .8 * np.abs(gx))
    profiles = []
    for fraction in ((.10, .43), (.57, .90)):
        profile = []
        for index, y in enumerate(rows):
            width = right[index] - left[index]
            first, last = (int(round(left[index] + amount * width)) for amount in fraction)
            values = horizontal[y, first:last]
            profile.append(float(np.mean(values)) if values.size else 0.)
        profiles.append(_smooth(values=np.array(profile), radius=.014 * rise))
    return profiles


def _rear(*, rgb, mask, rows, left, right, rise, center, dimensions):
    profiles = _garment_edges(rgb=rgb, mask=mask, rows=rows, left=left, right=right, rise=rise)
    valid = (rows > center[1] + .17 * rise) & (rows < center[1] + .51 * rise)
    combined = np.maximum(*profiles)
    fold_index = int(np.argmax(np.where(valid, combined, -np.inf)))
    baseline = float(np.median(combined[valid]))
    edge_strength = float(combined[fold_index])
    if edge_strength < .26 or edge_strength < max(.01, baseline) * 2.0:
        raise ValueError("no distinct lower garment fold; mark both underbutt points manually")
    # A strong observed crease can locate the shared lower transition; each lobe still needs contour evidence.
    fold_y = float(rows[fold_index])
    upper = int(np.argmin(np.abs(rows - (center[1] - .13 * rise))))
    if fold_index <= upper:
        raise ValueError("lower contour cannot be resolved")
    width = right - left
    chord = np.interp(rows, [rows[upper], fold_y], [width[upper], width[fold_index]])
    bulge = width - chord
    before_fold = (rows >= center[1] - .10 * rise) & (rows <= fold_y - .038 * dimensions[1])
    prominence = float(np.max(np.where(before_fold, bulge, -np.inf)))
    peak_index = int(np.argmax(np.where(before_fold, width, -np.inf)))
    if prominence < .018 * rise:
        raise ValueError("no distinct two-lobe posterior contour before the fold")
    span = fold_y - float(rows[peak_index])
    if span < .038 * dimensions[1]:
        raise ValueError("peak and lower transition are too close for the photo mesh")
    # Curved silhouette departure distinguishes a lobe from a straight arm or a bent thigh.
    inward_left = float(left[fold_index] - left[peak_index])
    inward_right = float(right[peak_index] - right[fold_index])
    if min(inward_left, inward_right) < -.035 * rise:
        raise ValueError("a bent thigh hides one lower glute contour; correct it manually")
    anchors, evidence = [], []
    for index, fraction in enumerate((.25, .75)):
        local_valid = valid & (np.abs(rows - fold_y) < .045 * rise)
        local_index = int(np.argmax(np.where(local_valid, profiles[index], -np.inf)))
        local_strength = float(profiles[index][local_index])
        has_local = local_strength > .20 and local_strength > max(.01, float(np.median(profiles[index][valid]))) * 1.5
        lower_y = float(rows[local_index]) if has_local else fold_y
        peak = np.array([left[peak_index] + fraction * width[peak_index], rows[peak_index]], dtype=float)
        lower_at = int(np.argmin(np.abs(rows - lower_y)))
        fold = np.array([left[lower_at] + fraction * width[lower_at], lower_y], dtype=float)
        confidence = min(.82, .63 + min(.10, prominence / rise) + (.07 if has_local else 0.))
        anchors.append({"peak": (peak / dimensions).tolist(), "fold": (fold / dimensions).tolist()})
        evidence.append({"peak": round(confidence, 4), "fold": round(confidence - (.02 if has_local else .08), 4),
                         "foldEvidence": "local-garment-fold" if has_local else "shared-visible-lower-transition",
                         "foldEdgeStrength": local_strength, "peakPixel": peak.tolist(), "foldPixel": fold.tolist()})
    return {"view": "rear", "anchors": anchors}, float(np.mean([point["fold"] for point in evidence])), evidence


def _occluded(*, selection, pose, xy, rise, dimensions):
    for elbow_index, wrist_index in ((3, 4), (6, 7)):
        if (not np.isfinite(pose[wrist_index]).all() or pose[wrist_index, 3] != 1
                or pose[wrist_index, 2] < .25):
            continue
        wrist = xy[wrist_index]
        elbow_visible = (np.isfinite(pose[elbow_index]).all() and pose[elbow_index, 3] == 1
                         and pose[elbow_index, 2] >= .25)
        for anchor in selection["anchors"]:
            peak, fold = (np.asarray(anchor[key]) * dimensions for key in ("peak", "fold"))
            span = fold[1] - peak[1]
            if (abs(wrist[0] - (peak[0] + fold[0]) / 2) < max(1.35 * span, .12 * rise)
                    and peak[1] - .65 * span < wrist[1] < fold[1] + .65 * span):
                return True
            if not elbow_visible:
                continue
            elbow = xy[elbow_index]
            axis = wrist - elbow
            squared = float(np.dot(axis, axis))
            if squared < 1:
                continue
            contour = peak + np.linspace(0, 1, 9)[:, None] * (fold - peak)
            projection = np.clip(np.sum((contour - elbow) * axis, axis=-1) / squared, 0, 1)
            distance = np.linalg.norm(contour - (elbow + projection[:, None] * axis), axis=-1)
            if np.min(distance) < .08 * rise:
                return True
    return False


def _mesh_safe(*, selection, width, height):
    x, y = np.meshgrid(np.linspace(0, width, 81), np.linspace(0, height, 81))
    base = np.stack((x, y), axis=-1)
    delta, detail = build_glute_delta(base=base, width=width, height=height, intensity=100, selection=selection)
    target = base + delta
    minimum_ratio = float("inf")
    for reference, moved in (
            ((base[:-1, :-1], base[1:, :-1], base[1:, 1:]),
             (target[:-1, :-1], target[1:, :-1], target[1:, 1:])),
            ((base[:-1, :-1], base[1:, 1:], base[:-1, 1:]),
             (target[:-1, :-1], target[1:, 1:], target[:-1, 1:]))):
        original, first, second = reference
        edge_a, edge_b = first - original, second - original
        reference_area = edge_a[..., 0] * edge_b[..., 1] - edge_a[..., 1] * edge_b[..., 0]
        origin, first, second = moved
        edge_a, edge_b = first - origin, second - origin
        area = edge_a[..., 0] * edge_b[..., 1] - edge_a[..., 1] * edge_b[..., 0]
        ratios = area / reference_area
        if not np.isfinite(ratios).all() or np.min(ratios) <= .15:
            raise ValueError("detected contours do not support a safe full-strength mesh")
        minimum_ratio = min(minimum_ratio, float(np.min(ratios)))

    return {"fullStrengthMeshValidated": True, "meshCells": [80, 80],
            "maximumRequestedShiftPixels": detail["maxMeshShiftPixelsBeforeCombinedSafety"],
            "minimumTriangleAreaRatio": minimum_ratio, "triangleDiagonal": "a-c-d/a-d-b"}


def detect_glute_contours(*, rgba, person_mask, pose, algorithm_size, faces=None):
    """Estimate editable normalized contours; uncertain inputs require manual correction."""
    rgb, mask, dimensions = _source(rgba=rgba, person_mask=person_mask)
    diagnostics = {"anatomicalGroundTruth": False, "trainedGluteLandmarkModel": False,
                   "coordinateSpace": "source-normalized-top-left", "manualCorrectionSupported": True,
                   "orientationEvidence": "estimated-anatomical-torso-joint-order-and-silhouette",
                   "limitations": "clothed 2D silhouette/garment transition estimates; no hidden-surface reconstruction",
                   "detectionSize": dimensions.astype(int).tolist(),
                   "diagnosticPixelSpace": "detection-size-top-left",
                   "confidenceCalibration": "heuristic-evidence-score-not-probability"}
    if np.any(rgba[..., 3] != 255):
        return _unavailable(reason="transparent photos require manual contours", diagnostics=diagnostics)
    if np.count_nonzero(mask) < mask.size * .025 or np.count_nonzero(mask) > mask.size * .95:
        return _unavailable(reason="person silhouette is missing or ambiguous", diagnostics=diagnostics)
    try:
        data, xy = _pose(pose=pose, algorithm_size=algorithm_size, dimensions=dimensions)
        orientation, center, rise = _orientation(xy=xy)
        diagnostics.update(orientation=orientation, torsoRisePixels=rise, hipCenterPixel=center.tolist())
        rows, left, right = _profile(mask=mask, center=center, rise=rise)
        if orientation == "side":
            selection, confidence, evidence = _side(rows=rows, left=left, right=right, rise=rise,
                                                    center=center, dimensions=dimensions)
        else:
            selection, confidence, evidence = _rear(rgb=rgb, mask=mask, rows=rows, left=left, right=right,
                                                    rise=rise, center=center, dimensions=dimensions)
        diagnostics["anchorConfidence"] = evidence
        if _occluded(selection=selection, pose=data, xy=xy, rise=rise, dimensions=dimensions):
            return _unavailable(reason="hand overlaps the glute contour; correct contours manually",
                                diagnostics=diagnostics, candidate=selection)
        diagnostics.update(_mesh_safe(selection=selection, width=rgba.shape[1], height=rgba.shape[0]))
        if confidence < .60:
            return _unavailable(reason="one lower contour is uncertain; confirm or correct the proposed points",
                                diagnostics=diagnostics, candidate=selection)
        return {"available": True, "selection": selection, "confidence": round(confidence, 4),
                "reason": None, "method": METHOD, "diagnostics": diagnostics}
    except (ValueError, TypeError, OverflowError) as error:
        return _unavailable(reason=str(error), diagnostics=diagnostics)
