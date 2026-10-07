"""Eye support anchors that contract less when an upward eye move is active."""
import numpy as np
from numbers import Real

from slimface_mesh_organs import space_eyes
from youtai_organs import transform_eyes, transform_mouth

F = np.float32
ANCHOR_INDICES = (33, 64, 65, 66, 67, 68, 69, 70, 71, 42)


def eye_support_anchors(*, points, height_degree):
    if (not isinstance(points, np.ndarray) or points.dtype != np.float32
            or points.shape != (106, 2) or not np.isfinite(points).all()
            or isinstance(height_degree, (bool, np.bool_)) or not isinstance(height_degree, Real)
            or not np.isfinite(height_degree) or not -float(F(.3)) <= float(height_degree) <= float(F(.3))):
        raise ValueError('finite 106 float32 points and bounded eye height degree required')
    factor = F(float(height_degree) * 2.8 + 1) if height_degree < 0 else F(1)
    result = points[list(ANCHOR_INDICES)].copy()
    for index in range(10):
        weight = F(float(factor) * .6) if index in (4, 5) else factor
        if index in (3, 6):
            weight = F(float(weight) * .9)
        center = points[74 if index < 5 else 77]
        result[index] += (result[index] - center) * F(-.3) * weight
    return result


def apply_eye_support(*, mesh, points, degrees, size):
    anchors = eye_support_anchors(points=points, height_degree=degrees[3])
    mesh['positions'][300:310] = anchors
    mesh['uv_pixels'][300:310] = anchors
    normalized = anchors / np.asarray(size, np.float32)
    mesh['clip_positions'][300:310, 0] = normalized[:, 0].astype(np.float64) * 2 - 1
    mesh['clip_positions'][300:310, 1] = (F(1) - normalized[:, 1]).astype(np.float64) * 2 - 1
    mesh['texcoords'][300:310, 0] = normalized[:, 0]
    mesh['texcoords'][300:310, 1] = F(1) - normalized[:, 1]
    return mesh


def mouth_corner_landmarks(*, source, target, degree, assets):
    if any(not isinstance(value, np.ndarray) or value.dtype != np.float32
           or value.shape != (106, 2) or not np.isfinite(value).all() for value in (source, target)):
        raise ValueError('finite float32 mouth-corner landmarks required')
    if (isinstance(degree, (bool, np.bool_)) or not isinstance(degree, Real)
            or not np.isfinite(degree) or not -float(F(.12)) <= degree <= 0):
        raise ValueError('bounded nonpositive mouth-corner degree required')
    result = target.copy()
    if abs(float(degree)) <= .001:
        return result
    coefficients = assets['mouth_corner']
    if (not isinstance(coefficients, np.ndarray) or coefficients.dtype != np.float32
            or coefficients.shape != (20, 3) or not np.isfinite(coefficients).all()
            or not np.array_equal(coefficients[:, 0], np.arange(84, 104, dtype=np.float32))):
        raise ValueError('twenty ordered mouth-corner coefficients required')
    axis = (source[77] - source[74]) * F(.25)
    amount = F(degree) * F(5)
    for index, horizontal, vertical in coefficients:
        delta = np.array([axis[0] * horizontal + axis[1] * vertical,
                          -axis[0] * vertical + axis[1] * horizontal], np.float32)
        result[int(index)] += delta * amount
    return result


def corner_eye_support(*, source, positions, uv_pixels, degree, mesh_assets):
    if (isinstance(degree, (bool, np.bool_)) or not isinstance(degree, Real)
            or not np.isfinite(degree) or not -float(F(.4)) <= degree <= 0):
        raise ValueError('bounded nonpositive corner-eye degree required')
    for value, shape in ((source, (106, 2)), (positions, (78, 2)), (uv_pixels, (78, 2))):
        if (not isinstance(value, np.ndarray) or value.dtype != np.float32
                or value.shape != shape or not np.isfinite(value).all()):
            raise ValueError('finite float32 corner-eye geometry required')
    positions, uv_pixels = positions.copy(), uv_pixels.copy()
    if abs(float(degree)) <= .001:
        return positions, uv_pixels
    amount = F(degree) * F(-3.5)
    delta = (source[77] - source[74]) * F(.25) * F(.05) * amount
    # Corner expansion changes UV supports before the second position-spacing pass.
    uv_pixels[[12, 28, 5, 21]] -= delta
    uv_pixels[[42, 58, 34, 50]] += delta
    spacing_degree = F(float(amount) * .1)
    positions = space_eyes(source=positions, target=positions, intensity=0,
                           assets=mesh_assets, spacing_degree=spacing_degree)
    return positions, uv_pixels


def update_mesh_coordinates(*, mesh, size, start, positions, uv_pixels):
    end = start + len(positions)
    mesh['positions'][start:end], mesh['uv_pixels'][start:end] = positions, uv_pixels
    normalized = positions / np.asarray(size, np.float32)
    mesh['clip_positions'][start:end, 0] = normalized[:, 0].astype(np.float64) * 2 - 1
    mesh['clip_positions'][start:end, 1] = (F(1) - normalized[:, 1]).astype(np.float64) * 2 - 1
    normalized_uv = uv_pixels / np.asarray(size, np.float32)
    mesh['texcoords'][start:end, 0] = normalized_uv[:, 0]
    mesh['texcoords'][start:end, 1] = F(1) - normalized_uv[:, 1]


def apply_feature_geometry(*, mesh, points, degrees, size, mesh_assets, organ_assets,
                           corner_assets=None, pitch=0):
    if abs(float(degrees[16])) > .001:
        positions, uv_pixels = corner_eye_support(source=mesh['prepared_source'],
            positions=mesh['positions'][120:198], uv_pixels=mesh['uv_pixels'][120:198],
            degree=degrees[16], mesh_assets=mesh_assets)
        update_mesh_coordinates(mesh=mesh, size=size, start=120,
                                positions=positions, uv_pixels=uv_pixels)
    if abs(float(degrees[15])) > .001:
        if corner_assets is None:
            raise ValueError('private mouth-corner coefficients required')
        target = mesh['deformed_landmarks'].copy()
        transform_eyes(source=mesh['prepared_source'], target=target, degrees=degrees,
                       pitch=pitch, mesh_assets=mesh_assets, assets=organ_assets)
        target = mouth_corner_landmarks(source=mesh['prepared_source'], target=target,
                                        degree=degrees[15], assets=corner_assets)
        positions = transform_mouth(target=target, degrees=degrees, assets=organ_assets)
        update_mesh_coordinates(mesh=mesh, size=size, start=226,
                                positions=positions, uv_pixels=mesh['uv_pixels'][226:287])
    return apply_eye_support(mesh=mesh, points=points, degrees=degrees, size=size)
