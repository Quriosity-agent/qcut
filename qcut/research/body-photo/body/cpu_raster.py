"""Bounded CPU drawing for the body's opaque, single-sample triangle mesh."""
import hashlib
from pathlib import Path
import time

import numpy as np

MAX_EDGE = 4096
MAX_PIXELS = 8_294_400
MAX_VERTICES = 8192
MAX_TRIANGLES = 16384
MAX_COORDINATE = 32768
TILE_ROWS = 64


def _validate(*, rgba, vertices, triangles):
    pixels, points, indices = map(np.asarray, (rgba, vertices, triangles))
    if (pixels.dtype != np.uint8 or pixels.ndim != 3 or pixels.shape[2] != 4
            or min(pixels.shape[:2]) < 1 or max(pixels.shape[:2]) > MAX_EDGE
            or pixels.shape[0] * pixels.shape[1] > MAX_PIXELS
            or np.any(pixels[..., 3] != 255)):
        raise ValueError("bounded opaque uint8 RGBA photo required")
    if (points.ndim != 2 or points.shape[1] != 5
            or not 3 <= len(points) <= MAX_VERTICES or points.dtype.kind not in "fiu"
            or not np.isfinite(points).all() or np.any(np.abs(points.astype(np.float64)) > MAX_COORDINATE)):
        raise ValueError("bounded finite NDC/UV vertices required")
    if (indices.ndim != 2 or indices.shape[1] != 3
            or not 1 <= len(indices) <= MAX_TRIANGLES or indices.dtype.kind not in "iu"
            or indices.min() < 0 or indices.max() >= len(points)):
        raise ValueError("bounded nonempty indexed triangles required")
    return pixels, points.astype(np.float32), indices.astype(np.int32)


def _edge(*, start, end, x, y):
    # Canonical endpoints make opposite shared edges exact negatives, including after rounding.
    if tuple(start) <= tuple(end):
        return (end[0] - start[0]) * (y - start[1]) - (end[1] - start[1]) * (x - start[0])
    return -((start[0] - end[0]) * (y - end[1]) - (start[1] - end[1]) * (x - end[0]))


def _inside(*, edge, start, end):
    dx, dy = end - start
    inclusive = dy < 0 or (dy == 0 and dx > 0)
    return (edge > 0) | ((edge == 0) & inclusive)


def _areas(*, coordinates):
    first = coordinates[:, 1] - coordinates[:, 0]
    second = coordinates[:, 2] - coordinates[:, 0]
    return first[:, 0] * second[:, 1] - first[:, 1] * second[:, 0]


def _prepare(*, points, indices, width, height):
    screen = np.column_stack(((points[:, 0].astype(np.float64) + 1) * (width / 2),
                              (1 - points[:, 1].astype(np.float64)) * (height / 2)))
    faces = screen[indices]
    lower = np.maximum(0, np.ceil(faces.min(axis=1) - .5)).astype(np.int64)
    upper = np.minimum([width, height], np.floor(faces.max(axis=1) - .5) + 1).astype(np.int64)
    spans = np.maximum(0, upper - lower)
    work = int(np.sum(spans[:, 0] * spans[:, 1], dtype=np.int64))
    if work > min(128_000_000, max(8_000_000, width * height * 32)):
        raise ValueError("mesh exceeds bounded raster work budget")
    destination_area = _areas(coordinates=points[indices, :2].astype(np.float64))
    source_area = _areas(coordinates=points[indices, 3:].astype(np.float64))
    stats = {
        "degenerateTriangles": int(np.count_nonzero(destination_area == 0)),
        "foldedTriangles": int(np.count_nonzero(destination_area * source_area < 0)),
        "outOfBoundsTriangles": int(np.count_nonzero(np.any(np.abs(points[indices, :2]) > 1, axis=(1, 2)))),
        "fullyOutsideTriangles": int(np.count_nonzero(np.any(spans == 0, axis=1))),
        "candidatePixels": work,
    }
    return screen, lower, upper, stats


def _sample(*, rgba, coordinates):
    height, width = rgba.shape[:2]
    uv = np.clip(coordinates, 0, 1)
    xy = np.column_stack((uv[:, 0] * width - .5, (1 - uv[:, 1]) * height - .5))
    lower = np.floor(xy).astype(np.int32)
    weights = (xy - lower).astype(np.float32)
    left = np.clip(lower[:, 0], 0, width - 1)
    right = np.clip(lower[:, 0] + 1, 0, width - 1)
    top = np.clip(lower[:, 1], 0, height - 1)
    bottom = np.clip(lower[:, 1] + 1, 0, height - 1)
    wx, wy = weights[:, 0, None], weights[:, 1, None]
    upper = rgba[top, left].astype(np.float32) * (1 - wx) + rgba[top, right].astype(np.float32) * wx
    lower_pixels = rgba[bottom, left].astype(np.float32) * (1 - wx) + rgba[bottom, right].astype(np.float32) * wx
    return np.rint(upper * (1 - wy) + lower_pixels * wy).clip(0, 255).astype(np.uint8)


def _draw_triangle(*, rgba, target, coverage, screen, uv, lower, upper):
    area = _edge(start=screen[0], end=screen[1], x=screen[2, 0], y=screen[2, 1])
    if area == 0 or np.any(upper <= lower):
        return 0, 0
    if area < 0:
        screen, uv, area = screen[[0, 2, 1]], uv[[0, 2, 1]], -area
    left, top = lower
    right, bottom = upper
    columns = np.arange(left, right, dtype=np.float64)[None, :] + .5
    fragments, overdraw = 0, 0
    for row_start in range(top, bottom, TILE_ROWS):
        rows = np.arange(row_start, min(bottom, row_start + TILE_ROWS), dtype=np.float64)[:, None] + .5
        edges = [_edge(start=screen[(index + 1) % 3], end=screen[(index + 2) % 3], x=columns, y=rows)
                 for index in range(3)]
        inside = np.logical_and.reduce([
            _inside(edge=edge, start=screen[(index + 1) % 3], end=screen[(index + 2) % 3])
            for index, edge in enumerate(edges)])
        local_y, local_x = np.nonzero(inside)
        if not len(local_x):
            continue
        x, y = local_x + left, local_y + row_start
        weights = np.column_stack([edge[local_y, local_x] / area for edge in edges])
        target[y, x] = _sample(rgba=rgba, coordinates=weights @ uv)
        overdraw += int(np.count_nonzero(coverage[y, x]))
        coverage[y, x] = True
        fragments += len(x)
    return fragments, overdraw


def draw_mesh(*, rgba, vertices, triangles, runtime):
    """Return RGBA and an owned CPU receipt; runtime is retained for host compatibility."""
    started = time.monotonic()
    pixels, points, indices = _validate(rgba=rgba, vertices=vertices, triangles=triangles)
    height, width = pixels.shape[:2]
    screen, lower, upper, geometry = _prepare(points=points, indices=indices, width=width, height=height)
    result = np.zeros_like(pixels)
    coverage = np.zeros((height, width), dtype=bool)
    fragments, overdraw = 0, 0
    for number, triangle in enumerate(indices):
        drawn, repeated = _draw_triangle(rgba=pixels, target=result, coverage=coverage,
            screen=screen[triangle], uv=points[triangle, 3:].astype(np.float64),
            lower=lower[number], upper=upper[number])
        fragments += drawn
        overdraw += repeated
    missing = int(coverage.size - np.count_nonzero(coverage))
    if missing:
        raise ValueError(f"opaque body mesh left {missing} output pixels uncovered")
    receipt = {
        "renderer": "numpy-cpu", "backend": "portable-cpu", "width": width, "height": height,
        "format": "RGBA8Unorm", "sampling": "linear", "address": "clamp", "blending": False,
        "depth": False, "culling": False, "sourcePrecision": "float32", "meshProfile": "body",
        "pixelBytes": result.nbytes, "vertexCount": len(points), "triangleCount": len(indices),
        "privateNativeImages": [], "flipSampleY": False, "resolutionMode": "original",
        "sourceFrameSize": [width, height], "sourceRgbaBytes": pixels.nbytes, "maxSourceEdge": MAX_EDGE,
        "geometry": {**geometry, "fragmentsWritten": fragments, "overdrawFragments": overdraw,
                     "uncoveredPixels": missing, "coverageRepair": False},
        "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "milliseconds": round((time.monotonic() - started) * 1000),
    }
    return result, receipt
