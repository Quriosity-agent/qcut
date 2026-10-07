"""TotalFace landmark preparation and compound face deformation in float32."""
import numpy as np

F = np.float32


def distance(*, a, b):
    delta = a - b
    return np.sqrt(np.sum(delta * delta, axis=-1, dtype=np.float32))


def prepare(*, points, assets):
    original = np.asarray(points, np.float32)
    if original.shape != (106, 2) or not np.isfinite(original).all() or np.abs(original).max() > 1e6:
        raise ValueError("expected 106 finite image landmarks")
    if distance(a=original[74], b=original[77]) < 1 or distance(a=original[3], b=original[29]) < 1:
        raise ValueError("degenerate eyes or contour")
    source = original.copy()
    eye = (original[77] - original[74]) * F(.11)
    source[[81, 83]] += eye
    source[[82, 80]] -= eye
    source[51] += eye * F(.3)
    source[50] += eye * F(.2)
    source[49] += (original[49] - original[46]) * F(.8) * F(.25)
    source[48] -= eye * F(.2)
    source[47] -= eye * F(.3)
    eye = (original[77] - original[74]) * F(.15)
    source[[54, 55, 58, 59]] = original[[54, 55, 58, 59]] + eye
    for index, landmark in enumerate((52, 53, 72, 54, 55, 58, 59, 75, 60, 61)):
        endpoints = (52, 55, 72, 73) if index < 5 else (58, 61, 75, 76)
        a, b, c, d = endpoints
        denominator = distance(a=original[a], b=original[b])
        if denominator < F(1e-5):
            raise ValueError("degenerate eye landmarks")
        ratio = distance(a=original[c], b=original[d]) / denominator
        delta = eye * F(.5) * ratio
        source[landmark] = original[landmark] + np.array([-delta[1], delta[0]], np.float32)
    eye_open = distance(a=source[46], b=source[43])
    face_depth = distance(a=source[46], b=source[16])
    if eye_open > .001 and eye_open * 5 < face_depth:
        ratio = F(min(float(face_depth) / (float(eye_open) * 5), 5))
        eye = (source[77] - source[74]) * F(.25)
        perpendicular = np.array([eye[1], -eye[0]], np.float32)
        for index, landmark in enumerate(assets["opening_indices"]):
            weight = ratio
            if index == 40:
                weight *= F(.3)
            if index == 41:
                weight *= F(.2)
            if index == 42:
                weight *= F(.01)
            source[landmark] += perpendicular * weight
    return source


def coefficient_delta(*, eye, horizontal, vertical):
    return np.array([eye[0] * horizontal + eye[1] * vertical,
                     -eye[0] * vertical + eye[1] * horizontal], np.float32)


def apply_coefficients(*, target, eye, coefficients, strength, side_strengths=None):
    for landmark, horizontal, vertical in coefficients:
        index = int(landmark)
        scaled = strength if side_strengths is None else strength * side_strengths[int(index >= 16)]
        target[index] += coefficient_delta(eye=eye, horizontal=horizontal, vertical=vertical) * scaled


def deform(*, source, intensity, yaw, assets, degrees=None, shape_assets=None, jaw_asymmetry=True):
    target = source.copy()
    fraction = F(intensity / 100)
    eye = (source[77] - source[74]) * F(.25)
    zoom = (F(-.2) * fraction if degrees is None else degrees[10]) * F(5)
    if float(abs(zoom)) > .001:
        apply_coefficients(target=target, eye=eye, coefficients=assets["weights"], strength=zoom)
    if degrees is not None:
        for index, name, scale in ((11, "cut", 2.5), (14, "cheek", 5), (13, "jaw", 5), (21, "vface", 1)):
            if float(abs(degrees[index])) > .0001:
                if shape_assets is None:
                    raise ValueError("private face coefficient assets are required")
                apply_coefficients(target=target, eye=eye, coefficients=shape_assets[name],
                                   strength=degrees[index] * F(scale),
                                   side_strengths=jaw_strengths(yaw=yaw) if name == "jaw" and jaw_asymmetry else None)
    small_face = F(-.01) * fraction if degrees is None else degrees[12]
    if float(abs(small_face)) > .001:
        a, b = source[3], source[29]
        normal = np.array([b[1] - a[1], a[0] - b[0]], np.float32)
        constant = a[1] * b[0] - b[1] * a[0]
        squared = np.sum(normal * normal, dtype=np.float32)
        eye_width = distance(a=source[77], b=source[74])
        strength = F((np.cos(abs(yaw) * 3.1415 / 180) * .5 + .5) * (4 / float(eye_width)))
        for landmark in assets["small_face_indices"]:
            x, y = target[landmark]
            nx, ny = normal
            projection = np.array([(ny * ny * x - ny * nx * y - nx * constant) / squared,
                                   (nx * nx * y - ny * nx * x - ny * constant) / squared], np.float32)
            radial = distance(a=source[landmark], b=projection)
            target[landmark, 0] -= eye[1] * radial * small_face * strength
            target[landmark, 1] += eye[0] * radial * small_face * strength
    for values in (source, target):
        values[8] = (values[7] + values[9]) * F(.5)
        values[24] = (values[23] + values[25]) * F(.5)
    target[[64, 71]] = source[[64, 71]]
    return target


def jaw_strengths(*, yaw):
    fade = F(1) - F(min(abs(yaw), 14)) / F(14)
    return (F(1), fade) if yaw < 0 else (fade, F(1))
