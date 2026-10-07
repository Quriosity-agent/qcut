"""Build the local warp's adaptive 2,270-vertex support from normalized Base106."""
import math
from numbers import Real

import numpy as np

from liquefy_geometry import finite_array
from slimface_mesh_landmarks import distance

F = np.float32


def generate_support(*, points, yaw_radians, assets):
    source = finite_array(value=points, shape=(106, 2), name="landmarks").copy()
    if (isinstance(yaw_radians, (bool, np.bool_)) or not isinstance(yaw_radians, Real)
            or not math.isfinite(yaw_radians) or abs(yaw_radians) > math.pi / 2):
        raise ValueError("bounded support yaw required")
    center = source[45].copy()
    for index in (49, 80, 81, 82, 83):
        center += source[index]
    source[46] = center / F(6)
    cosine = F(F(math.cos(float(F(yaw_radians)))) + F(.001))
    basis = ((source[77] - source[74]) * F(.25)) * F(min(1 / float(cosine), 10))
    left = distance(a=source[45], b=source[4])
    right = distance(a=source[45], b=source[28])
    ratio, horizontal, yaw_correction, outer_radius, vertical = assets["correction"]
    left_shift = np.array([-horizontal * basis[0] + vertical * basis[1],
                           -horizontal * basis[1] - vertical * basis[0]], np.float32)
    right_shift = np.array([horizontal * basis[0] + vertical * basis[1],
                            -vertical * basis[0] + horizontal * basis[1]], np.float32)
    left_limit, right_limit = right * ratio, left * ratio
    left_shift *= (left_limit - left) * F(5)
    right_shift *= (right_limit - right) * F(5)
    chin_delta = basis * F(F(math.sin(abs(float(F(yaw_radians))))) * yaw_correction)
    for index in range(33):
        if left < left_limit and index < 16:
            source[index] -= left_shift
        elif right < right_limit and index > 16:
            source[index] -= right_shift
        # This correction is inside the contour loop, so the chin receives 33 stores.
        source[16] += np.array([chin_delta[1], -chin_delta[0]], np.float32)
    values = [point.copy() for point in source[:104]]
    for first, second in zip(source[:32], source[1:33]):
        delta = second - first
        values.extend((first + delta / F(3), first + (delta + delta) / F(3)))
    for indices in ((4, 57, 82), (28, 62, 83)):
        values.append((source[indices[0]] + source[indices[1]] + source[indices[2]]) / F(3))
    for index, scale in ((66, 1.8), (69, 1.8), (43, 2.9), (64, 1.4), (71, 1.4)):
        values.append(source[46] + (source[index] - source[46]) * F(scale))
    for name, offset in (("left_eye", -1), ("right_eye", -1), ("left_brow", 0), ("right_brow", 0)):
        indices = assets[name] + offset
        values.extend((source[first] + source[second]) * F(.5) for first, second in zip(indices[:-1], indices[1:]))
    if len(values) != 209:
        raise ValueError("invalid local support partition")
    for triangle in assets["base_triangles"]:
        if triangle.min() < 0 or triangle.max() >= len(values):
            raise ValueError("support centroid references an unavailable vertex")
        first, second, third = (values[index] for index in triangle)
        values.append((first + second + third) / F(3))
    radius = F(float(distance(a=source[74], b=source[77])) * 3.5)
    ring_source = [*source[:33], *values[104:168], *values[170:175]]
    if radius < F(1e-5):
        raise ValueError("degenerate support anchors")
    for ring in range(8):
        amount = outer_radius if ring == 7 else F(math.pow((ring + 1) * .125, float(assets["ring_power"])) * float(radius))
        for point in ring_source:
            radial = distance(a=point, b=source[46])
            if radial < F(1e-5):
                raise ValueError("degenerate support ring")
            values.append(point + ((point - source[46]) * amount) / radial)
    uv = np.asarray(values, np.float32)
    if uv.shape != (2270, 2) or not np.isfinite(uv).all():
        raise ValueError("invalid local support output")
    positions = np.zeros((2270, 3), np.float32)
    positions[:, :2] = uv * F(2) - F(1)
    return {"uv": uv, "positions": positions}
