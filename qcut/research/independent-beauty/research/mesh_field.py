"""Interpolate bounded vertex fields over an ordered adaptive triangle mesh."""
import numpy as np

from mesh_raster import edge, inclusive_edge


def interpolate_field(*, positions, values, triangles, size):
    positions, values, triangles = np.asarray(positions), np.asarray(values), np.asarray(triangles)
    if (positions.dtype != np.float32 or positions.ndim != 2 or positions.shape[1] != 2
            or not 3 <= len(positions) <= 2270 or not np.isfinite(positions).all()
            or np.abs(positions).max() > 1e7):
        raise ValueError("bounded float32 field positions required")
    if (values.dtype != np.float32 or values.ndim != 2 or len(values) != len(positions)
            or not 1 <= values.shape[1] <= 8 or not np.isfinite(values).all()):
        raise ValueError("matching finite float32 vertex fields required")
    if (triangles.ndim != 2 or triangles.shape[1] != 3 or triangles.dtype.kind not in 'iu'
            or not 1 <= len(triangles) <= 4472 or triangles.min() < 0 or triangles.max() >= len(positions)):
        raise ValueError("bounded integer field topology required")
    if not isinstance(size, (tuple, list)) or len(size) != 2 or any(type(n) is not int or not 1 <= n <= 512 for n in size):
        raise ValueError("bounded field dimensions required")
    width, height = size
    output = np.zeros((height, width, values.shape[1]), np.float32)
    owner = np.full((height, width), -1, np.int32)
    for index, triangle in enumerate(triangles):
        p, v = positions[triangle].astype(np.float64), values[triangle].astype(np.float64)
        area = edge(a=p[0], b=p[1], x=p[2, 0], y=p[2, 1])
        if abs(area) < 1e-10:
            continue
        if area < 0:
            p, v, area = p[[0, 2, 1]], v[[0, 2, 1]], -area
        low = np.maximum(np.ceil(p.min(axis=0) - .5), [0, 0]).astype(int)
        high = np.minimum(np.floor(p.max(axis=0) - .5), [width - 1, height - 1]).astype(int)
        if np.any(high < low):
            continue
        y, x = np.mgrid[low[1]:high[1]+1, low[0]:high[0]+1]
        x, y = x + .5, y + .5
        edges = [edge(a=p[a], b=p[b], x=x, y=y) for a, b in ((1, 2), (2, 0), (0, 1))]
        inside = np.ones(x.shape, bool)
        for weights, (a, b) in zip(edges, ((1, 2), (2, 0), (0, 1))):
            inside &= (weights > 0) | ((weights == 0) & inclusive_edge(a=p[a], b=p[b]))
        if not inside.any():
            continue
        weights = np.stack([value[inside] for value in edges], axis=-1) / area
        output[low[1]:high[1]+1, low[0]:high[0]+1][inside] = weights @ v
        owner[low[1]:high[1]+1, low[0]:high[0]+1][inside] = index
    return output, owner >= 0
