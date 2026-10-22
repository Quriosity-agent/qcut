"""Owned, image-local drag strokes with bounded support and mesh safety."""
import math

import numpy as np

if __package__:
    from .glute_lift import validate_selection
else:
    from glute_lift import validate_selection


MAX_STROKES = 32
MIN_RADIUS = .02
MAX_RADIUS = .30
MIN_AREA_RATIO = .02


def _number(*, value, minimum, maximum, label):
    try:
        number = float(value) if type(value) in (int, float) else float("nan")
    except OverflowError:
        number = float("nan")
    if not math.isfinite(number) or not minimum <= number <= maximum:
        raise ValueError(f"{label} must be a finite number in {minimum}..{maximum}")
    return number


def _point(*, value, label):
    if not isinstance(value, list) or len(value) != 2:
        raise ValueError(f"{label} must contain two normalized coordinates")
    return [_number(value=coordinate, minimum=0, maximum=1, label=label) for coordinate in value]


def validate_edits(*, edits=None):
    if edits is None:
        edits = {}
    if not isinstance(edits, dict) or set(edits) - {"backgroundProtection", "strokes", "buttocks", "autoButtocks"}:
        raise ValueError("unknown local editing fields")
    protection = edits.get("backgroundProtection", False)
    if type(protection) is not bool:
        raise ValueError("backgroundProtection must be a boolean")
    strokes = edits.get("strokes", [])
    if not isinstance(strokes, list) or len(strokes) > MAX_STROKES:
        raise ValueError(f"strokes must be a list of at most {MAX_STROKES} drags")
    validated = []
    for stroke in strokes:
        if not isinstance(stroke, dict) or set(stroke) != {"start", "end", "radius"}:
            raise ValueError("each stroke requires exactly start, end, and radius")
        validated.append({
            "start": _point(value=stroke["start"], label="stroke start"),
            "end": _point(value=stroke["end"], label="stroke end"),
            "radius": _number(value=stroke["radius"], minimum=MIN_RADIUS,
                              maximum=MAX_RADIUS, label="stroke radius"),
        })
    result = {"backgroundProtection": protection, "strokes": validated}
    if "autoButtocks" in edits:
        if type(edits["autoButtocks"]) is not bool:
            raise ValueError("autoButtocks must be a boolean")
        result["autoButtocks"] = edits["autoButtocks"]
    if "buttocks" in edits:
        result["buttocks"] = validate_selection(selection=edits["buttocks"])
    return result


def _areas(*, positions):
    a, b = positions[:-1, :-1], positions[:-1, 1:]
    c, d = positions[1:, :-1], positions[1:, 1:]
    ca, da, ba = c - a, d - a, b - a
    # Match the pinned renderer's a-c-d / a-d-b cell diagonal.
    return np.stack((ca[..., 0] * da[..., 1] - ca[..., 1] * da[..., 0],
                     da[..., 0] * ba[..., 1] - da[..., 1] * ba[..., 0]), axis=-1)


def _mesh(*, base, width, height):
    dimensions = np.array([
        _number(value=width, minimum=1, maximum=65536, label="image width"),
        _number(value=height, minimum=1, maximum=65536, label="image height"),
    ], dtype=np.float64)
    try:
        positions = np.asarray(base, dtype=np.float32)
    except (TypeError, ValueError) as error:
        raise ValueError("a finite rectangular source-pixel mesh is required") from error
    if positions.ndim != 3 or positions.shape[-1] != 2 or min(positions.shape[:2]) < 2:
        raise ValueError("a rectangular mesh with at least two rows and columns is required")
    if positions.shape[0] * positions.shape[1] > 8192:
        raise ValueError("local editing mesh exceeds the renderer vertex limit")
    if not np.all(np.isfinite(positions)):
        raise ValueError("mesh vertices must be finite")
    return positions.copy(), dimensions


def _stroke_pixels(*, stroke, dimensions):
    start = np.asarray(stroke["start"], dtype=np.float64) * dimensions
    end = np.asarray(stroke["end"], dtype=np.float64) * dimensions
    start[1], end[1] = dimensions[1] - start[1], dimensions[1] - end[1]
    radius = float(stroke["radius"] * np.min(dimensions))
    displacement = end - start
    if np.linalg.norm(displacement) > radius * .5 + 1e-9:
        raise ValueError("a drag cannot exceed half its brush radius in source-image pixels")
    return start, displacement, radius


def validate_strokes_for_image(*, strokes, width, height):
    canonical = validate_edits(edits={"strokes": strokes})["strokes"]
    dimensions = np.array([
        _number(value=width, minimum=1, maximum=65536, label="image width"),
        _number(value=height, minimum=1, maximum=65536, label="image height"),
    ], dtype=np.float64)
    for stroke in canonical:
        _stroke_pixels(stroke=stroke, dimensions=dimensions)
    return canonical


def _stroke_delta(*, positions, start, displacement, radius, dimensions):
    relative = positions.astype(np.float64) - start
    distance_squared = np.sum(relative * relative, axis=-1)
    weight = np.maximum(0, 1 - distance_squared / (radius * radius)) ** 3
    border_distance = np.minimum(np.min(positions, axis=-1),
                                 np.min(dimensions - positions, axis=-1))
    start_border = float(np.min(np.concatenate((start, dimensions - start))))
    fade_length = max(1, min(radius * .25, start_border))
    t = np.clip(border_distance / fade_length, 0, 1)
    weight *= t * t * (3 - 2 * t)
    weight[[0, -1], :] = 0
    weight[:, [0, -1]] = 0
    return (weight[..., None] * displacement).astype(np.float32)


def _safe_candidate(*, positions, delta, reference, lower, upper):
    sign = np.sign(reference)
    floor = np.abs(reference) * MIN_AREA_RATIO
    scale = 1.0
    for _ in range(12):
        candidate = (positions + delta * scale).astype(np.float32)
        inside = np.all(candidate >= lower) and np.all(candidate <= upper)
        areas = _areas(positions=candidate.astype(np.float64))
        if inside and np.all(areas * sign >= floor):
            return candidate, scale
        scale *= .5
    return positions.copy(), 0.0


def build_manual_positions(*, base, strokes, width, height):
    """Compose strokes on current positions; source pixels are still sampled once."""
    canonical = validate_edits(edits={"strokes": strokes})["strokes"]
    positions, dimensions = _mesh(base=base, width=width, height=height)
    # Existing body effects may extend outside the canvas; never extend them further.
    lower, upper = np.minimum(0, positions), np.maximum(dimensions, positions)
    pixel_strokes = [_stroke_pixels(stroke=stroke, dimensions=dimensions) for stroke in canonical]
    reference = _areas(positions=positions.astype(np.float64))
    signs = np.sign(reference)
    usable = bool(np.all(signs == signs.flat[0]) and signs.flat[0] != 0)
    diagnostics = {"moved": False, "safe": usable, "strokes": [],
                   "coordinateSpace": "normalized-source-top-left", "borderPinned": True,
                   "minAreaRatio": MIN_AREA_RATIO}
    for index, (start, displacement, radius) in enumerate(pixel_strokes):
        detail = {"index": index, "affectedVertices": 0, "scale": 0.0,
                  "start": canonical[index]["start"], "end": canonical[index]["end"],
                  "centerPixels": [float(start[0]), float(dimensions[1] - start[1])],
                  "radiusPixels": radius,
                  "requestedPixels": [float(displacement[0]), float(-displacement[1])],
                  "reason": None}
        diagnostics["strokes"].append(detail)
        if not usable:
            detail["reason"] = "existing mesh is folded or degenerate"
            continue
        delta = _stroke_delta(positions=positions, start=start, displacement=displacement,
                              radius=radius, dimensions=dimensions)
        if not np.any(delta):
            detail["reason"] = "zero drag or brush misses movable mesh vertices"
            continue
        candidate, scale = _safe_candidate(positions=positions, delta=delta, reference=reference,
                                          lower=lower, upper=upper)
        count = int(np.count_nonzero(np.any(candidate != positions, axis=-1)))
        detail.update(affectedVertices=count, scale=scale if count else 0.0)
        if not count:
            detail["reason"] = "mesh safety prevented this drag"
        elif scale < 1:
            detail["reason"] = "drag reduced to preserve mesh orientation"
        positions = candidate
        diagnostics["moved"] = diagnostics["moved"] or bool(count)
    return positions, diagnostics
