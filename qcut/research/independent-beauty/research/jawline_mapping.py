"""Native-order affine mapping with distinct adaptive-grid and pixel lookups."""
import numpy as np

F = np.float32


def affine(*, source, target):
    ax, bx, cx = source[:, 0]
    ay, by, cy = source[:, 1]
    u0, u1, u2 = target[:, 0]
    v0, v1, v2 = target[:, 1]
    dy, ya, dx, xc = F(cy-by), F(ay-by), F(ax-bx), F(cx-bx)
    first = F(F(dx*dy)-F(ya*xc))
    second = F(F(ya*xc)-F(dx*dy))
    if abs(first) < 1e-6:
        first = F(float(first)+1e-6)
    if abs(second) < 1e-6:
        second = F(float(second)+1e-6)
    a = F(F(F(dy*F(u0-u1))-F(ya*F(u2-u1)))/first)
    b = F(F(F(xc*F(u0-u1))-F(dx*F(u2-u1)))/second)
    d = F(F(F(dy*F(v0-v1))-F(ya*F(v2-v1)))/first)
    e = F(F(F(xc*F(v0-v1))-F(dx*F(v2-v1)))/second)
    c = F(u0-F(F(ax*a)+F(ay*b)))
    f = F(v0-F(F(ax*d)+F(ay*e)))
    return np.array([[a, b, c], [d, e, f]], F)


def scanline_bounds(*, triangle, rows):
    intersections, valid = [], []
    for first, last in [(0, 1), (1, 2), (0, 2)]:
        dy = F(triangle[last, 1]-triangle[first, 1])
        inside = (rows >= min(triangle[first, 1], triangle[last, 1])) & (
            rows <= max(triangle[first, 1], triangle[last, 1]))
        if abs(dy) < 1e-6:
            intersections.append(np.zeros(len(rows), F))
            valid.append(np.zeros(len(rows), bool))
            continue
        ratio = F(F(rows-triangle[first, 1])/dy)
        intersections.append(F(triangle[first, 0]+F(F(triangle[last, 0]-triangle[first, 0])*ratio)))
        valid.append(inside)
    values, validity = np.stack(intersections), np.stack(valid)
    left = np.min(np.where(validity, values, np.inf), axis=0)
    right = np.max(np.where(validity, values, -np.inf), axis=0)
    return left, right, np.sum(validity, axis=0) >= 2


def triangle_ids(*, points, source, triangles, pixel_lookup):
    result = np.full(len(points), -1, np.int32)
    if pixel_lookup:
        columns = np.trunc(F(points[:, 0]+F(.5))).astype(np.int32)
        rows = np.trunc(F(points[:, 1]+F(.5))).astype(F)
    else:
        columns, rows = points[:, 0], points[:, 1]
    for index, triangle in enumerate(triangles):
        left, right, valid = scanline_bounds(triangle=source[triangle], rows=rows)
        if pixel_lookup:
            mask = valid & (columns >= np.trunc(left.astype(np.float64)+.5)) & (
                columns <= np.trunc(right)) & (columns >= 0) & (columns < 1280) & (rows >= 0) & (rows < 1280)
        else:
            # Adaptive-grid coverage expands each scanline by 0.2 pixels.
            mask = valid & (columns > F(left-F(.2))) & (columns <= F(right+F(.2)))
        result[mask] = index
    return result


def map_points(*, points, source, target, triangles, pixel_lookup):
    chosen = triangle_ids(points=points, source=source, triangles=triangles, pixel_lookup=pixel_lookup)
    result = points.copy()
    for index, triangle in enumerate(triangles):
        mask = chosen == index
        matrix = affine(source=source[triangle], target=target[triangle])
        result[mask] = F(F(F(points[mask, 0, None]*matrix[:, 0])+F(points[mask, 1, None]*matrix[:, 1]))+matrix[:, 2])
    return result, chosen
