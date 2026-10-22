"""Owned, compact-support leg-width geometry on source-image coordinates."""
import numpy as np


SEGMENTS = {"ThighWidth": ((8, 9), (11, 12)), "CalfWidth": ((9, 10), (12, 13))}


def _segments(*, pose, algorithm_size, width, height, pairs):
    try:
        points = np.asarray(pose, dtype=np.float64)
        size = np.asarray(algorithm_size, dtype=np.float64)
        if points.shape != (18, 4) or size.shape != (2,) or not np.all(np.isfinite(size)) or np.any(size <= 0):
            return [], "invalid pose or algorithm dimensions"
        result = []
        for start, end in pairs:
            data = points[[start, end]]
            if not np.all(np.isfinite(data)) or np.any(data[:, 3] != 1) or np.any(data[:, 2] < .2):
                return [], "both legs need confident visible joints"
            xy = data[:, :2] * np.array([width, height]) / size
            if np.any(xy < 0) or np.any(xy > np.array([width, height])):
                return [], "leg endpoints are outside the photo"
            xy[:, 1] = height - xy[:, 1]
            axis = xy[1] - xy[0]
            length = float(np.linalg.norm(axis))
            if length < max(12, .06 * max(width, height)) or axis[1] > -.55 * length:
                return [], "upright sufficiently large leg segments required"
            result.append((xy[0], xy[1], axis / length, length))
        first, second = result
        # Crossing axes have ambiguous ownership; never silently reshape one leg only.
        separations = [((1 - t) * second[0] + t * second[1])[0]
                       - ((1 - t) * first[0] + t * first[1])[0] for t in (0, .5, 1)]
        if min(separations) < 0 < max(separations) or min(abs(value) for value in separations) < .008 * width:
            return [], "crossed or overlapping legs require manual correction"
        return result, None
    except (ValueError, TypeError, IndexError):
        return [], "invalid pose or algorithm dimensions"


def _segment_delta(*, base, segment, radius, strength, width, height):
    start, _, axis, length = segment
    normal = np.array([-axis[1], axis[0]])
    relative = base - start
    t = np.sum(relative * axis, axis=-1) / length
    distance = np.sum(relative * normal, axis=-1)
    q = distance / radius
    inside = (t > 0) & (t < 1) & (np.abs(q) < 1)
    along = np.sin(np.pi * np.clip(t, 0, 1)) ** 2
    across = np.maximum(0, 1 - q * q) ** 2
    amount = np.where(inside, .72 * strength * distance * along * across, 0)
    border = np.minimum.reduce([base[..., 0], width - base[..., 0], base[..., 1], height - base[..., 1]])
    fade = np.clip(border / max(8, radius * .35), 0, 1)
    return (normal * (amount * fade)[..., None]).astype(np.float32)


def build_leg_delta(*, base, pose, algorithm_size, width, height, controls):
    base = np.asarray(base, dtype=np.float32)
    if base.ndim < 2 or base.shape[-1] != 2 or not np.all(np.isfinite(base)) or min(width, height) <= 0:
        raise ValueError("finite source-pixel grid and positive dimensions required")
    total, parts = np.zeros_like(base), {}
    for name, pairs in SEGMENTS.items():
        value = controls.get(name, 0)
        if type(value) is not int or not -50 <= value <= 50:
            raise ValueError("leg width must be an integer in -50..50")
        detail = {"intensity": value / 50, "moved": False, "sides": [], "reason": "zero"}
        parts[name] = detail
        if not value:
            continue
        segments, reason = _segments(pose=pose, algorithm_size=algorithm_size, width=width,
                                     height=height, pairs=pairs)
        if reason:
            detail["reason"] = reason
            continue
        delta = np.zeros_like(base)
        for side, segment in enumerate(segments):
            other = segments[1 - side]
            separation = min(float(np.linalg.norm(((1 - t) * segment[0] + t * segment[1])
                              - ((1 - t) * other[0] + t * other[1]))) for t in (.2, .5, .8))
            radius = min(segment[3] * (.40 if name == "ThighWidth" else .34), .48 * separation)
            part = _segment_delta(base=base, segment=segment, radius=max(1, radius),
                                  strength=value / 50, width=width, height=height)
            delta += part
            detail["sides"].append({"side": side, "start": segment[0].tolist(),
                "end": segment[1].tolist(), "radius": radius, "moved": bool(np.any(part))})
        if all(side["moved"] for side in detail["sides"]):
            total += delta
            detail.update(moved=True, reason=None)
        else:
            detail["reason"] = "leg support is too small for this mesh"
    return total, parts


def _areas(*, positions, triangles):
    vertices = np.asarray(positions).reshape(-1, 2)[triangles]
    a, b = vertices[:, 1] - vertices[:, 0], vertices[:, 2] - vertices[:, 0]
    return a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0]


def safe_leg_delta(*, base, existing_delta, leg_delta, triangles):
    base, old, leg = [np.asarray(value, dtype=np.float32) for value in (base, existing_delta, leg_delta)]
    if old.shape != base.shape or leg.shape != base.shape:
        raise ValueError("mesh displacement shapes must match")
    zero = np.zeros_like(base)
    if not all(np.all(np.isfinite(value)) for value in (base, old, leg)):
        return zero, 0.0
    reference = _areas(positions=base, triangles=triangles)
    old_areas = _areas(positions=base + old, triangles=triangles)
    if np.any(reference == 0) or np.any(old_areas * np.sign(reference) < np.abs(reference) * .02):
        return zero, 0.0
    if not np.any(leg):
        return zero, 0.0
    scale = 1.0
    for _ in range(5):
        candidate = leg * scale
        areas = _areas(positions=base + old + candidate, triangles=triangles)
        if np.all(areas * np.sign(reference) >= np.abs(reference) * .02):
            return candidate, scale
        scale *= .5
    return zero, 0.0


def resample_grid_delta(*, delta, rows, cols):
    """Interpolate geometry only, so old and new controls still sample the photo once."""
    source = np.asarray(delta, dtype=np.float32)
    old_rows, old_cols = source.shape[0] - 1, source.shape[1] - 1
    x, y = np.meshgrid(np.linspace(0, old_cols, cols + 1), np.linspace(0, old_rows, rows + 1))
    x0, y0 = x.astype(int), y.astype(int)
    x1, y1 = np.minimum(x0 + 1, old_cols), np.minimum(y0 + 1, old_rows)
    tx, ty = (x - x0)[..., None], (y - y0)[..., None]
    return ((1 - ty) * ((1 - tx) * source[y0, x0] + tx * source[y0, x1])
            + ty * ((1 - tx) * source[y1, x0] + tx * source[y1, x1])).astype(np.float32)
