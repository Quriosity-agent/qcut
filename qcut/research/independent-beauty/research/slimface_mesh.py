"""Independent TotalFace 106-to-311 mesh math, with local reference data assets."""
import numpy as np

from slimface_geometry import validate_intensity
from face_shape_controls import mesh_degrees
from face_shape_contour import reshape_contour
from slimface_mesh_landmarks import F, deform, distance, prepare
from slimface_mesh_organs import eyes, mouth, nose, space_eyes
from youtai_organs import transform_eyes, transform_mouth, transform_nose

GROUPS = {"contour": (0, 120), "eyes": (120, 198), "nose": (198, 226),
          "mouth": (226, 287), "boundary": (287, 300), "eye_anchors": (300, 310),
          "center": (310, 311)}


def outward(*, points, center, step):
    radial = points - center
    lengths = np.sqrt(np.sum(radial * radial, axis=-1, dtype=np.float32))
    if np.any(lengths < F(1e-6)):
        raise ValueError("degenerate mesh support")
    return points + radial * (F(step) / lengths)[..., None]


def contour(*, source, target, size, yaw, pitch, degrees=None, shape_assets=None):
    size = np.asarray(size, np.float32)
    angle = F(F(abs(yaw)) * F(3.1415) / F(180))
    cosine = F(np.cos(angle))
    stretch = F(min(1 / float(cosine + F(.001)), 10))
    axis = (source[77] - source[74]) * F(.25) * stretch
    x, y = map(float, axis)
    left_shift = np.array([x * .534509 + y * .294071,
                           -x * .294071 + y * .534509], np.float64)
    right_correction = np.array([x * -.534452 + y * .294038,
                                 -x * .294038 + y * -.534452], np.float64)
    right_shift = right_correction * .8
    for values in (source, target):
        values[:16] = values[:16].astype(np.float64) - left_shift
        values[17:33] = values[17:33].astype(np.float64) - right_shift
    left = distance(a=source[45] / size, b=source[4] / size)
    right = distance(a=source[45] / size, b=source[28] / size)
    sine = F(np.sin(angle))
    chin_step = F(float(sine) * .02 + .0111868)
    center_delta = np.array([axis[1], -axis[0]], np.float32) * chin_step
    correction = F(0)
    for index in range(33):
        candidate = correction if index == 16 else F(0)
        if index < 16:
            candidate = F((float(right) * .4 - float(left)) * 4) * F(1.5)
        if left < float(right) * .4:
            correction = candidate
        if float(left) * .4 > right:
            candidate = F((float(left) * .4 - float(right)) * 4) * F(1.5)
            if index < 16:
                candidate = F(0)
        else:
            candidate = correction
        if index != 16:
            shift = np.asarray((left_shift if index < 16 else right_correction) * float(candidate), np.float32)
            source[index] -= shift
            target[index] -= shift
            correction = candidate
        source[16] -= center_delta
        target[16] -= center_delta
    nose_to_top = distance(a=source[46], b=source[43])
    nose_to_chin = distance(a=source[46], b=source[16])
    if nose_to_chin < nose_to_top:
        amount = F(float(nose_to_top - nose_to_chin) * .01)
        delta = np.array([axis[1], -axis[0]], np.float32) * amount
        source[:33, 0] -= delta[0]
        target[:33, 1] -= delta[1]
    uv, position = np.zeros((120, 2), np.float32), np.zeros((120, 2), np.float32)
    uv[:33], position[:33] = source[:33], target[:33]
    if degrees is not None and (degrees[8] != 0 or degrees[18] != 0):
        if shape_assets is None:
            raise ValueError("private contour coefficients are required")
        position[:33] = reshape_contour(target=target, axis=axis, chin=degrees[8],
                                       sharp=degrees[18], assets=shape_assets)
    center = target[46].copy()
    uv[33:35] = center + (source[[66, 69]] - center) * F(2)
    position[33:35] = center + (target[[66, 69]] - center) * F(2)
    uv[35] = center + ((source[37] + source[38]) * F(.5) - center) * F(2.1)
    position[35] = center + ((target[37] + target[38]) * F(.5) - center) * F(2.1)
    depth = F((max(pitch, 15) - 15) / 30)
    lift = depth * F(.3) + F(1.4)
    uv[36] = center + (source[64] + (source[65] - source[64]) * depth - center) * lift
    uv[37] = center + (source[71] + (source[70] - source[71]) * depth - center) * lift
    position[36] = center + (target[64] + (target[65] - target[64]) * depth - center) * lift
    position[37] = center + (target[71] + (target[70] - target[71]) * depth - center) * lift
    if degrees is not None and degrees[9] != 0:
        forehead = F(1 + float(degrees[9]) * .1)
        for index in range(33, 38):
            position[index] = center + (position[index] - center) * forehead
    for values, points in ((uv, source), (position, target)):
        values[38] = points[0] + (points[0] - points[1])
        values[39] = points[32] + (points[32] - points[31])
    eye_width = distance(a=source[74], b=source[77])
    step = F(float(eye_width) * 3.5 * float(stretch))
    for ring in (1, 2):
        radius = F((ring * .125) ** 1.85 * float(step))
        start = ring * 40
        uv[start:start + 40] = outward(points=uv[:40], center=source[46],
                                      step=radius * F(-1.5 if ring == 1 else -1))
        support_positions = np.vstack((target[:33], position[33:40]))
        position[start:start + 40] = outward(points=support_positions, center=target[46],
                                            step=radius * F(-1.5 if ring == 1 else 2))
    boundary_indices = [46, 30, 27, 24, 21, 18, 15, 12, 9, 6, 3]
    source[boundary_indices] /= size
    support = np.vstack((uv[35:38] / size, source[[30, 27, 24, 21, 18, 15, 12, 9, 6, 3]]))
    boundary = outward(points=support, center=source[46], step=2) * size
    uv[80:120] = position[80:120]
    return uv, position, boundary


def generate_mesh(*, points, intensity, size, assets, yaw=0, pitch=0, controls=None, shape_assets=None):
    degrees = mesh_degrees(values={"TotalFace": intensity} if controls is None else controls)
    return generate_degree_mesh(points=points, intensity=intensity, size=size, assets=assets,
                                yaw=yaw, pitch=pitch, degrees=degrees, shape_assets=shape_assets)


def generate_degree_mesh(*, points, intensity, size, assets, degrees, yaw=0, pitch=0,
                         shape_assets=None, organ_assets=None):
    intensity = validate_intensity(intensity=intensity)
    if (not isinstance(degrees, np.ndarray) or degrees.dtype != np.float32 or degrees.shape != (23,)
            or not np.isfinite(degrees).all() or np.abs(degrees).max() > 5 or degrees[20] != 2 or degrees[22] != 0):
        raise ValueError("bounded float32 eye-type-two mesh degrees required")
    if len(size) != 2 or any(isinstance(v, bool) or not isinstance(v, (int, np.integer)) for v in size):
        raise ValueError("expected integer width and height")
    if min(size) < 1 or max(size) > 4096:
        raise ValueError("unsupported mesh image dimensions")
    angles = (yaw, pitch)
    if any(isinstance(v, (bool, np.bool_)) or not isinstance(v, (int, float, np.integer, np.floating)) for v in angles):
        raise ValueError("expected numeric yaw and pitch")
    if not np.isfinite(angles).all() or abs(yaw) > 50 or not 0 <= pitch <= 50:
        raise ValueError("mesh supports yaw -50..50 and pitch 0..50 degrees")
    source = prepare(points=points, assets=assets)
    target = deform(source=source, intensity=intensity, yaw=yaw, assets=assets,
                    degrees=degrees, shape_assets=shape_assets)
    prepared_source, deformed_landmarks = source.copy(), target.copy()
    uv_eyes = eyes(points=source, reference=source, assets=assets)
    position_eyes = (eyes(points=target, reference=source, assets=assets) if organ_assets is None
                     else transform_eyes(source=source, target=target, degrees=degrees, pitch=pitch,
                                         mesh_assets=assets, assets=organ_assets))
    if degrees[19] != 0:
        temple = degrees[19]
        position_eyes[76] -= (target[64] - target[33]) * temple * F(.25)
        position_eyes[77] -= (target[71] - target[42]) * temple * F(.25)
    if organ_assets is None:
        position_eyes = space_eyes(source=uv_eyes, target=position_eyes, intensity=intensity,
                                 assets=assets, spacing_degree=degrees[0])
    uv_nose = nose(points=source)
    position_nose = (nose(points=target) if organ_assets is None
                     else transform_nose(source=source, target=target, degrees=degrees, yaw=yaw, assets=organ_assets))
    uv_mouth = mouth(points=source)
    position_mouth = (mouth(points=target) if organ_assets is None
                      else transform_mouth(target=target, degrees=degrees, assets=organ_assets))
    uv_contour, position_contour, boundary = contour(source=source, target=target, size=size,
        yaw=yaw, pitch=pitch, degrees=degrees, shape_assets=shape_assets)
    anchors = np.asarray(points, np.float32)[[33, 64, 65, 66, 67, 68, 69, 70, 71, 42]].copy()
    for index in range(10):
        center = np.asarray(points, np.float32)[74 if index < 5 else 77]
        weight = F(.6 if index in (4, 5) else 1)
        if index in (3, 6):
            weight *= F(.9)
        anchors[index] += (anchors[index] - center) * F(-.3) * weight
    center = source[43:44]
    positions = np.vstack((position_contour, position_eyes, position_nose, position_mouth, boundary, anchors, center))
    uv = np.vstack((uv_contour, uv_eyes, uv_nose, uv_mouth, boundary, anchors, center))
    if positions.shape != (311, 2) or not np.isfinite(positions).all() or not np.isfinite(uv).all():
        raise ValueError("nonfinite mesh result")
    corners = np.array([[0, size[1]], [0, 0], [size[0], size[1]], [size[0], 0]], np.float32)
    all_positions = np.vstack((positions, corners))
    all_uv = np.vstack((uv, corners))
    scale = np.asarray(size, np.float32)
    normalized = all_positions / scale
    clip = np.zeros((315, 3), np.float32)
    clip[:, 0] = normalized[:, 0].astype(np.float64) * 2 - 1
    flipped = F(1) - normalized[:, 1]
    clip[:, 1] = flipped.astype(np.float64) * 2 - 1
    texcoords = all_uv / scale
    texcoords[:, 1] = F(1) - texcoords[:, 1]
    triangles = np.vstack((np.array([[311, 312, 313], [314, 313, 312]], np.uint16), assets["triangles"]))
    return {"positions": positions, "uv_pixels": uv, "clip_positions": clip,
            "texcoords": texcoords, "triangles": triangles, "prepared_source": prepared_source,
            "deformed_landmarks": deformed_landmarks}
