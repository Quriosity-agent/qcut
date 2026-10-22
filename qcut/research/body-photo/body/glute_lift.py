"""Explicit image-plane glute contours; detected pose joints are not glute landmarks."""
from numbers import Real

import numpy as np


VIEWS = ("side-left", "side-right", "rear")


def _point(*, value):
    if (not isinstance(value, (list, tuple)) or len(value) != 2
            or any(isinstance(item, (bool, np.bool_)) or not isinstance(item, Real) for item in value)):
        raise ValueError("contour coordinates must be two finite normalized numbers")
    result = [float(item) for item in value]
    if not np.all(np.isfinite(result)) or min(result) < 0 or max(result) > 1:
        raise ValueError("contour coordinates must be inside the normalized photo")
    return result


def validate_selection(*, selection):
    """Normalize only explicit contours, with no pose-derived or implicit defaults."""
    if not isinstance(selection, dict) or set(selection) != {"view", "anchors"}:
        raise ValueError("buttocks requires exactly view and anchors")
    view, anchors = selection["view"], selection["anchors"]
    if not isinstance(view, str) or view not in VIEWS:
        raise ValueError("buttocks view must be side-left, side-right or rear")
    count = 2 if view == "rear" else 1
    if not isinstance(anchors, (list, tuple)) or len(anchors) != count:
        raise ValueError(f"{view} requires {count} peak/fold contour pairs")
    canonical = []
    for anchor in anchors:
        if not isinstance(anchor, dict) or set(anchor) != {"peak", "fold"}:
            raise ValueError("each buttocks anchor requires exactly peak and fold")
        peak, fold = _point(value=anchor["peak"]), _point(value=anchor["fold"])
        if fold[1] <= peak[1]:
            raise ValueError("the visible underbutt fold must be below its peak")
        canonical.append({"peak": peak, "fold": fold})
    if view == "rear":
        canonical.sort(key=lambda anchor: anchor["peak"][0])
        if canonical[0]["peak"][0] >= canonical[1]["peak"][0]:
            raise ValueError("rear contours require two spatially separated lobes")
        if canonical[0]["fold"][0] >= canonical[1]["fold"][0]:
            raise ValueError("rear peak/fold pairs must preserve their left/right ownership")
    return {"view": view, "anchors": canonical}


def _smooth(*, value):
    bounded = np.clip(value, 0, 1)
    return bounded * bounded * (3 - 2 * bounded)


def _geometry(*, base, width, height):
    if any(isinstance(value, (bool, np.bool_)) or not isinstance(value, Real)
           for value in (width, height)):
        raise ValueError("finite photo dimensions required")
    dimensions = np.asarray([width, height], dtype=np.float64)
    if not np.all(np.isfinite(dimensions)) or np.any(dimensions < 2) or np.any(dimensions > 32768):
        raise ValueError("bounded photo dimensions required")
    try:
        raw = np.asarray(base)
        if raw.dtype.kind not in "iuf":
            raise ValueError("numeric source-pixel mesh required")
        source = raw.astype(np.float64)
    except (TypeError, OverflowError) as error:
        raise ValueError("numeric source-pixel mesh required") from error
    if (source.ndim not in (2, 3) or source.shape[-1] != 2 or not source.size
            or source.size > 16384 or not np.all(np.isfinite(source))
            or np.any(source < 0) or np.any(source > dimensions)):
        raise ValueError("bounded finite source-pixel mesh required")
    spacing = dimensions / 80
    if source.ndim == 3 and min(source.shape[:2]) > 1:
        spacing = dimensions / [source.shape[1] - 1, source.shape[0] - 1]
    xy = source.copy()
    xy[..., 1] = height - xy[..., 1]
    return source, xy, dimensions, spacing


def _supports(*, selection, dimensions, spacing):
    points = [{key: np.asarray(point) * dimensions for key, point in anchor.items()}
              for anchor in selection["anchors"]]
    view = selection["view"]
    separation = points[1]["peak"][0] - points[0]["peak"][0] if view == "rear" else None
    supports = []
    for point in points:
        peak, fold = point["peak"], point["fold"]
        span, horizontal = float(fold[1] - peak[1]), float(fold[0] - peak[0])
        if span < max(8., 3 * spacing[1]):
            raise ValueError("peak-to-fold contour needs at least three mesh rows")
        if span > .30 * dimensions[1] or abs(horizontal) > span:
            raise ValueError("peak/fold pair does not describe a compact glute contour")
        if (np.any(peak < 2 * spacing) or np.any(fold < 2 * spacing)
                or np.any(dimensions - peak < 2 * spacing) or np.any(dimensions - fold < 2 * spacing)):
            raise ValueError("visible glute contours need room inside the photo border")
        if view == "side-left" and horizontal < -.25 * span:
            raise ValueError("side-left fold must be at or inside the left-projecting peak")
        if view == "side-right" and horizontal > .25 * span:
            raise ValueError("side-right fold must be at or inside the right-projecting peak")
        core = .5 * abs(horizontal) + .15 * span
        radius = core + 1.20 * span
        if view == "rear":
            if separation < .80 * span or separation > 5 * span:
                raise ValueError("rear lobes need distinct, proportionate contour support")
            radius = min(radius, .70 * separation)
            if radius - core < .25 * span:
                raise ValueError("rear contours are too oblique or overlapping")
        top, requested_bottom = float(peak[1] - 1.1 * span), float(fold[1] + 1.1 * span)
        bottom = min(requested_bottom, float(dimensions[1] - spacing[1]))
        if top < spacing[1]:
            raise ValueError("visible glute contours need upper-waist feathering room")
        # Below the fold the lift decays to zero, so a shorter crop feather expands vertically.
        if bottom - fold[1] < max(2 * spacing[1], .25 * span):
            raise ValueError("visible underbutt fold needs lower-thigh feathering room above the crop")
        supports.append({"peak": peak, "fold": fold, "span": span,
                         "centerX": float((peak[0] + fold[0]) / 2), "core": core,
                         "radius": radius, "top": top, "bottom": bottom,
                         "requestedBottom": requested_bottom, "cropAdapted": bottom < requested_bottom})
    if view == "rear":
        spans = [support["span"] for support in supports]
        if max(spans) > 2 * min(spans) or abs(points[0]["peak"][1] - points[1]["peak"][1]) > max(spans):
            raise ValueError("rear contours need two comparable visible glute lobes")
    return supports


def _profile(*, y, support, peak_amount, fold_amount):
    peak_y, fold_y = support["peak"][1], support["fold"][1]
    before = peak_amount * _smooth(value=(y - support["top"]) / (peak_y - support["top"]))
    middle = peak_amount + (fold_amount - peak_amount) * _smooth(value=(y - peak_y) / (fold_y - peak_y))
    after = fold_amount * _smooth(value=(support["bottom"] - y) / (support["bottom"] - fold_y))
    return np.where(y < peak_y, before, np.where(y < fold_y, middle, after))


def _field(*, xy, supports, view, dimensions, spacing):
    weights, verticals, horizontals = [], [], []
    for support in supports:
        across = 1 - _smooth(value=(np.abs(xy[..., 0] - support["centerX"]) - support["core"])
                             / (support["radius"] - support["core"]))
        span = support["span"]
        verticals.append(_profile(y=xy[..., 1], support=support, peak_amount=.16 * span,
                                  fold_amount=.32 * span))
        horizontals.append(_profile(y=xy[..., 1], support=support, peak_amount=.10 * span,
                                    fold_amount=.02 * span))
        weights.append(across)
    stacked = np.stack(weights)
    total = np.sum(stacked, axis=0)
    # Union coverage avoids doubling an overlapping pair's displacement at the cleft.
    coverage = 1 - np.prod(1 - stacked, axis=0)
    blend = stacked / np.maximum(total, 1e-12) * coverage
    delta = np.zeros_like(xy)
    delta[..., 1] = -np.sum(blend * np.stack(verticals), axis=0)
    if view != "rear":
        direction = -1 if view == "side-left" else 1
        delta[..., 0] = direction * np.sum(blend * np.stack(horizontals), axis=0)
    distance = np.minimum(xy, dimensions - xy)
    # A narrow canvas feather can fold a tall crop under outward side projection.
    border_span = np.maximum(2 * spacing, .60 * max(support["span"] for support in supports))
    fade = np.prod(_smooth(value=distance / border_span), axis=-1)
    return delta * fade[..., None]


def build_glute_delta(*, base, width, height, intensity, selection):
    """Return compact bottom-origin displacement plus explicitly manual contour evidence."""
    source, xy, dimensions, spacing = _geometry(base=base, width=width, height=height)
    if type(intensity) is not int or not 0 <= intensity <= 100:
        raise ValueError("ButtLift must be an integer in 0..100")
    detail = {"intensity": intensity / 100, "moved": False, "reason": "zero",
              "coordinateSpace": "source-top-left", "borderPinned": True,
              "anchorSource": "user-supplied-manual-contour", "contourLandmarksDetected": False,
              "landmarksAreDetectedJoints": False, "shapeModel": "2d-manual-glute-contour",
              "posteriorProjection": False, "reconstructs3D": False,
              "limitation": "explicit image-plane contour warp; no 3D volume or hidden-surface reconstruction"}
    if not intensity:
        return np.zeros_like(source, dtype=np.float32), detail
    canonical = validate_selection(selection=selection)
    supports = _supports(selection=canonical, dimensions=dimensions, spacing=spacing)
    strength = intensity / 100
    delta = _field(xy=xy, supports=supports, view=canonical["view"], dimensions=dimensions,
                   spacing=spacing) * strength
    anchors, bounds, feathers = [], [], []
    for support in supports:
        points = np.stack((support["peak"], support["fold"]))
        change = _field(xy=points, supports=supports, view=canonical["view"],
                        dimensions=dimensions, spacing=spacing) * strength
        anchors.append({"sourcePeak": points[0].tolist(), "sourceFold": points[1].tolist(),
                        "requestedPeakAfter": (points[0] + change[0]).tolist(),
                        "requestedFoldAfter": (points[1] + change[1]).tolist(),
                        "requestedPeakShiftTopLeft": change[0].tolist(),
                        "requestedFoldShiftTopLeft": change[1].tolist(),
                        "peakToFoldPixels": support["span"]})
        bounds.append([max(0., support["centerX"] - support["radius"]), support["top"],
                       min(float(width), support["centerX"] + support["radius"]), support["bottom"]])
        feathers.append({"topY": support["top"], "bottomY": support["bottom"],
                         "lowerFeatherPixels": float(support["bottom"] - support["fold"][1]),
                         "requestedBottomY": support["requestedBottom"], "cropAdapted": support["cropAdapted"]})
    moved = bool(np.any(delta))
    detail.update(view=canonical["view"], selection=canonical, anchors=anchors,
                  support={"kind": "manual-peak-and-underbutt-fold", "boundsXYXY": bounds,
                           "lobes": feathers, "cropAdapted": any(support["cropAdapted"] for support in supports),
                           "peakLiftFraction": .16, "foldLiftFraction": .32,
                           "sideProjectionFraction": .10 if canonical["view"] != "rear" else 0.,
                           "upperAndLowerSupportEdgesPinned": True},
                  moved=moved, reason=None if moved else "contour support misses movable mesh vertices",
                  affectedVertices=int(np.count_nonzero(np.any(delta != 0, axis=-1))),
                  maxMeshShiftPixelsBeforeCombinedSafety=float(np.max(np.linalg.norm(delta, axis=-1))))
    delta[..., 1] *= -1
    return delta.astype(np.float32), detail
