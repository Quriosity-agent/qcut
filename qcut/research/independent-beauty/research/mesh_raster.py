"""Ordered triangle rasterization at pixel centers, with no depth/blending/culling."""
from functools import partial

import numpy as np

from mesh_texture import linear_samples, sample_texture
from slimface_render import validate_rgba


def edge(*, a, b, x, y):
    return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])


def inclusive_edge(*, a, b):
    delta = b - a
    return delta[1] < 0 or (delta[1] == 0 and delta[0] > 0)


def validate_mesh(*, positions, uv, triangles):
    if positions.ndim != 2 or positions.shape[1] != 2 or uv.shape != positions.shape:
        raise ValueError("expected matching Nx2 positions and UV")
    if not np.isfinite(positions).all() or not np.isfinite(uv).all():
        raise ValueError("nonfinite mesh")
    if np.abs(positions).max(initial=0) > 1e7 or np.abs(uv).max(initial=0) > 1e7:
        raise ValueError("mesh coordinates exceed budget")
    if triangles.ndim != 2 or triangles.shape[1] != 3 or triangles.dtype.kind not in "iu":
        raise ValueError("expected integer Tx3 triangles")
    if len(positions) > 4096 or len(triangles) > 4096:
        raise ValueError("mesh exceeds vertex/triangle budget")
    if triangles.size and (triangles.min() < 0 or triangles.max() >= len(positions)):
        raise ValueError("triangle index out of range")


def rasterize(*, rgba, positions, uv, triangles, floating=False, size=None, premultiply=False, coverage_bits=None):
    validate_rgba(rgba=rgba)
    if type(premultiply) is not bool or premultiply and not floating:
        raise ValueError("premultiplied interpolation requires floating output")
    if coverage_bits is not None and (type(coverage_bits) is not int or coverage_bits != 8):
        raise ValueError("coverage accepts only the measured eight-bit subpixel profile")
    positions, uv, triangles = np.asarray(positions, np.float64), np.asarray(uv, np.float64), np.asarray(triangles)
    validate_mesh(positions=positions, uv=uv, triangles=triangles)
    if size is not None and (not isinstance(size, (tuple, list)) or len(size) != 2
            or any(type(n) is not int or not 1 <= n <= 4096 for n in size)):
        raise ValueError("bounded destination dimensions required")
    width, height = size if size is not None else (rgba.shape[1], rgba.shape[0])
    output = np.zeros((height, width, 4), np.float64 if floating else np.uint8)
    sampler = sample_texture
    if floating:
        sampler = partial(linear_samples, premultiply=True) if premultiply else linear_samples
    owner = np.full((height, width), -1, np.int32)
    maximum_displacement, degenerate = 0., 0
    for triangle_index, indices in enumerate(triangles):
        p, t = positions[indices], uv[indices]
        area = edge(a=p[0], b=p[1], x=p[2, 0], y=p[2, 1])
        if abs(area) < 1e-10:
            degenerate += 1
            continue
        if area < 0:
            p, t, area = p[[0, 2, 1]], t[[0, 2, 1]], -area
        # Coverage uses the subpixel grid; interpolation keeps the floating plane.
        coverage_positions = np.rint(p*256)/256 if coverage_bits == 8 else p
        low = np.maximum(np.ceil(coverage_positions.min(axis=0) - .5), [0, 0]).astype(int)
        high = np.minimum(np.floor(coverage_positions.max(axis=0) - .5), [width - 1, height - 1]).astype(int)
        if np.any(high < low):
            continue
        for start in range(low[1], high[1] + 1, 32):
            y, x = np.mgrid[start:min(start + 32, high[1] + 1), low[0]:high[0] + 1]
            x, y = x + .5, y + .5
            edges = [edge(a=coverage_positions[a], b=coverage_positions[b], x=x, y=y) for a, b in ((1, 2), (2, 0), (0, 1))]
            inside = np.ones(x.shape, bool)
            for values, (a, b) in zip(edges, ((1, 2), (2, 0), (0, 1))):
                inside &= (values > 0) | ((values == 0) & inclusive_edge(a=coverage_positions[a], b=coverage_positions[b]))
            if not np.any(inside):
                continue
            gradient = edges
            if coverage_bits == 8:
                gradient = [edge(a=p[a], b=p[b], x=x, y=y) for a, b in ((1, 2), (2, 0), (0, 1))]
            weights = np.stack([values[inside] for values in gradient], axis=-1) / area
            source = weights @ t
            destination = np.column_stack((x[inside], y[inside]))
            maximum_displacement = max(maximum_displacement, float(np.linalg.norm(source - destination, axis=1).max()))
            output[start:start + len(y), low[0]:high[0] + 1][inside] = sampler(rgba=rgba, coordinates=source)
            owner[start:start + len(y), low[0]:high[0] + 1][inside] = triangle_index
    diagnostics = {"covered_pixel_count": int(np.count_nonzero(owner >= 0)),
                   "uncovered_pixel_count": int(np.count_nonzero(owner < 0)),
                   "changed_pixel_count": int(np.count_nonzero(np.any(output != rgba, axis=-1))) if output.shape == rgba.shape else None,
                   "degenerate_triangle_count": degenerate, "triangle_count": len(triangles),
                   "maximum_sampling_displacement_px": maximum_displacement,
                   "sampling": "pixel-center-linear-premultiplied-float-RGBA-clamp-to-edge" if premultiply
                       else "pixel-center-linear-straight-RGBA-clamp-to-edge",
                   "raster_state": "ordered-overwrite-no-depth-no-blending-no-culling",
                   "coverage_fraction_bits": coverage_bits}
    return output, diagnostics


def render_mesh(*, rgba, mesh):
    height, width = rgba.shape[:2]
    corners = np.array([[0, height], [0, 0], [width, height], [width, 0]], np.float32)
    result, diagnostics = rasterize(rgba=rgba, positions=np.vstack((mesh["positions"], corners)),
                                   uv=np.vstack((mesh["uv_pixels"], corners)), triangles=mesh["triangles"])
    if diagnostics["uncovered_pixel_count"]:
        raise ValueError("TotalFace mesh did not cover the output frame")
    return result, diagnostics
