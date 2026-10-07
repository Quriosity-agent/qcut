"""Bounded float32 affine moving least squares for makeup coordinates."""
import numpy as np

from makeup_geometry import points_array

F = np.float32


def affine_point(*, source, target, query):
    if not isinstance(source, np.ndarray) or not 3 <= len(source) <= 248:
        raise ValueError('bounded affine landmark basis required')
    points_array(value=source, count=len(source))
    points_array(value=target, count=len(source))
    if not isinstance(query, np.ndarray) or query.shape != (2,):
        raise ValueError('one affine query required')
    points_array(value=query.reshape(1, 2), count=1)
    weights = []
    total = F(0)
    source_center = np.zeros(2, np.float32)
    target_center = np.zeros(2, np.float32)
    for origin, destination in zip(source, target):
        delta = query-origin
        distance_squared = F(F(delta[0]*delta[0])+F(delta[1]*delta[1]))
        if F(np.sqrt(distance_squared)) < F(1e-6):
            return destination.copy()
        weight = F(1)/distance_squared
        weights.append(weight)
        total = F(total+weight)
        source_center = source_center+origin*weight
        target_center = target_center+destination*weight
    if not np.isfinite(total) or total <= 0:
        raise ValueError('finite positive affine weights required')
    source_center /= total
    target_center /= total
    xx, xy, yy, ux, uy, vx, vy = [F(0)]*7
    for origin, destination, weight in zip(source-source_center, target-target_center, weights):
        x, y = origin
        u, v = destination
        xx = F(xx+F(F(x*x)*weight))
        xy = F(xy+F(F(x*y)*weight))
        yy = F(yy+F(F(y*y)*weight))
        ux = F(ux+F(F(u*x)*weight))
        uy = F(uy+F(F(u*y)*weight))
        vx = F(vx+F(F(v*x)*weight))
        vy = F(vy+F(F(v*y)*weight))
    determinant = F(F(yy*xx)-F(xy*xy))
    if not np.isfinite(determinant) or determinant <= 0:
        raise ValueError('noncollinear affine source basis required')
    inverse_xx, inverse_xy, inverse_yy = yy/determinant, -xy/determinant, xx/determinant
    x, y = query-source_center
    output = []
    for cross_x, cross_y, center in ((ux, uy, target_center[0]), (vx, vy, target_center[1])):
        first = F(F(F(cross_x*inverse_xx)+F(cross_y*inverse_xy))*x)
        second = F(F(F(cross_x*inverse_xy)+F(cross_y*inverse_yy))*y)
        output.append(F(center+F(first+second)))
    result = np.array(output, np.float32)
    points_array(value=result.reshape(1, 2), count=1)
    return result
