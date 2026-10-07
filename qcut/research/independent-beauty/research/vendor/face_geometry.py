"""Face crop geometry recovered from the version-pinned native reference.

These primitives do not decode detector heads or select tracking/refinement
anchors. They consume an already known pixel-space box or point permutation.
"""
from dataclasses import dataclass
import math

import numpy as np


@dataclass(frozen=True)
class CropRegion:
    x: int
    y: int
    size: int

    @property
    def rect(self):
        return (self.x, self.y, self.size, self.size)


def validate_region(*, region, minimum=1):
    if (not isinstance(region, CropRegion)
            or not all(isinstance(v, int) and not isinstance(v, bool) for v in region.rect)
            or not minimum <= region.size <= 32768):
        raise ValueError("invalid integer crop region")


def crop_region(*, rect, frame_size, expansion, legacy_anchor=False):
    box = np.asarray(rect, dtype=np.float32)
    if box.shape != (4,) or not np.isfinite(box).all() or (box[2:] < 1).any():
        raise ValueError("box must have four finite pixel coordinates and sides >= 1")
    width, height = frame_size
    if not all(isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= 32768 for v in (width, height)):
        raise ValueError("frame dimensions must be positive bounded integers")
    factor = np.float32(expansion)
    if not np.isfinite(factor) or factor <= 0:
        raise ValueError("expansion must be finite and positive")
    x, y, w, h = box
    one, two = np.float32(1), np.float32(2)
    side = max(w, h)
    if not legacy_anchor:
        cx, cy = x + w / two, y + h / two
    elif w >= h:
        cx = x + (side - one) / two
        cy = (y + (side - one) / two if y + side - one > height - 1
              else y + h - one - (side - one) / two)
    else:
        cy = y + (side - one) / two
        cx = (x + (side - one) / two if x + side - one > width - 1
              else x + w - one - (side - one) / two)
    expanded = np.float32(side * factor)
    if not np.isfinite(expanded) or not 1 <= expanded <= 32768:
        raise ValueError("expanded crop must have a bounded nonzero side")
    offset = (expanded - one) / two
    # The origin truncates toward zero before the side rounds, including negatives.
    left, top = math.trunc(float(cx - offset)), math.trunc(float(cy - offset))
    size = math.floor(float(expanded) + 0.5)
    region = CropRegion(x=left, y=top, size=size)
    if left >= width or top >= height or left + size <= 0 or top + size <= 0:
        raise ValueError("crop does not intersect the image")
    return region


def crop_pixels(*, frame, region):
    image = np.asarray(frame)
    if (image.dtype != np.uint8 or image.ndim != 3 or image.shape[2] != 3
            or not image.shape[0] or not image.shape[1]):
        raise ValueError("frame must be a nonempty HWC uint8 three-channel image")
    validate_region(region=region)
    if region.size * region.size * 3 > 128 * 1024 * 1024:
        raise ValueError("crop allocation exceeds the probe memory limit")
    height, width = image.shape[:2]
    left, top = max(0, region.x), max(0, region.y)
    right, bottom = min(width, region.x + region.size), min(height, region.y + region.size)
    if left >= right or top >= bottom:
        raise ValueError("crop does not intersect the image")
    result = np.zeros((region.size, region.size, 3), dtype=np.uint8)
    result[top - region.y:bottom - region.y, left - region.x:right - region.x] = image[top:bottom, left:right]
    return result


def resize_inverse(*, region, network_size):
    validate_region(region=region, minimum=2)
    width, height = network_size
    if not all(isinstance(v, int) and not isinstance(v, bool) and 2 <= v <= 32768 for v in (width, height)):
        raise ValueError("endpoint mapping requires crop and network sides >= 2")
    return np.array([
        [(region.size - 1) / (width - 1), 0, region.x],
        [0, (region.size - 1) / (height - 1), region.y],
    ], dtype=np.float32)


def map_points(*, points, inverse):
    values = np.asarray(points, dtype=np.float32)
    matrix = np.asarray(inverse, dtype=np.float32)
    if (values.ndim != 2 or values.shape[1] != 2 or not values.shape[0]
            or matrix.shape != (2, 3) or not np.isfinite(values).all()
            or not np.isfinite(matrix).all()):
        raise ValueError("points and affine matrix must be finite Nx2 and 2x3 arrays")
    return values @ matrix[:, :2].T + matrix[:, 2]


def reorder_landmarks(*, raw_pairs, destinations):
    points = np.asarray(raw_pairs, dtype=np.float32)
    order = np.asarray(destinations)
    if (points.shape != (106, 2) or not np.isfinite(points).all()
            or order.shape != (106,) or order.dtype.kind not in "iu"
            or not np.array_equal(np.sort(order), np.arange(106))):
        raise ValueError("106 finite interleaved pairs and a bijective index map are required")
    result = np.empty_like(points)
    result[order] = points
    return result
