"""Video recovery detection matching for the pinned upright native face profile."""
import numpy as np


def _rectangles(*, values):
    values = np.asarray(values, np.float32)
    if (values.ndim != 2 or values.shape[1] != 4 or not np.isfinite(values).all()
            or (values[:, 2:] < 0).any() or (np.abs(values) > 32768).any()):
        raise ValueError('finite bounded XYWH face rectangles required')
    return values


def overlap(*, first, second):
    boxes = _rectangles(values=[first, second])
    starts = boxes[:, :2]
    ends = starts + boxes[:, 2:]
    if any(np.all(start == 0) and np.all(end == 0) for start, end in zip(starts, ends, strict=True)):
        return np.float32(0)
    span = np.minimum(ends[0], ends[1]) - np.maximum(starts[0], starts[1])
    sides = np.maximum(span.astype(np.float64) + 1, 0).astype(np.float32)
    intersection = np.float32(sides[0] * sides[1])
    # Inclusive edges and the double area calculation both affect the strict .3 gate.
    sizes = (ends - starts).astype(np.float64) + 1
    areas = sizes[:, 0] * sizes[:, 1]
    union = np.float32(areas[0] + areas[1] - float(intersection))
    return np.float32(intersection / union)


def nearest_detection(*, retained, detections, capacity):
    boxes = _rectangles(values=detections)
    _rectangles(values=[retained])
    if type(capacity) is not int or not 0 <= capacity <= 72:
        raise ValueError('bounded native face capacity required')
    best, score = -1, np.float32(.3)
    for index, box in enumerate(boxes[:capacity]):
        candidate = overlap(first=retained, second=box)
        if candidate > score:
            best, score = index, candidate
    return best


def tracked_rectangle(*, points, size):
    points = np.asarray(points, np.float32)
    if (points.shape != (106, 2) or not np.isfinite(points).all()
            or (np.abs(points) > 32768).any() or not isinstance(size, tuple)
            or len(size) != 2 or any(type(side) is not int or not 1 <= side <= 4096 for side in size)):
        raise ValueError('106 bounded face points and integer image dimensions required')
    start = np.maximum(points.min(axis=0), np.float32(0))
    end = np.maximum(points.max(axis=0), np.float32(0))
    extent = np.trunc(end - start).astype(np.float32)
    limit = np.asarray(size, np.float32)
    clamped_start = np.minimum(start, limit)
    clamped_end = np.minimum(start + extent, limit)
    return np.concatenate((clamped_start, clamped_end - clamped_start))
