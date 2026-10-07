"""Build the eye, nose and mouth supports used by the 311-vertex face mesh."""
import numpy as np

from slimface_mesh_landmarks import F, distance


def eyes(*, points, reference, assets):
    result = np.zeros((78, 2), np.float32)
    left = [74, 52, 53, 72, 54, 55, 56, 73, 57]
    right = [77, 58, 59, 75, 60, 61, 62, 76, 63]
    result[:9] = points[left]
    result[33:42] = points[right]
    order = assets["left_eye_midpoints"] - 1
    result[9:17] = (result[order[:-1]] + result[order[1:]]) * F(.5)
    order = assets["right_eye_midpoints"] - 1
    result[42:50] = (points[order[:-1]] + points[order[1:]]) * F(.5)
    for start in (0, 33):
        result[start + 17:start + 33] = (result[start + 1:start + 17]
                                        + (result[start + 1:start + 17] - result[start]) * F(-.1))
    result[66] = result[5] + (points[78] - result[5]) / F(3)
    result[67] = result[34] + (points[79] - result[34]) / F(3)
    for start, center in ((0, points[74]), (33, points[77])):
        result[start + 2] = points[left[2] if start == 0 else right[2]]
        result[start + 2] -= (center - result[start + 2]) * F(.3)
        result[start + 3] -= (center - result[start + 3]) * F(.6)
        result[start + 9] = (result[start + 1] + result[start + 2]) * F(.5)
        result[start + 10:start + 12] -= (center - result[start + 10:start + 12]) * F(.6)
        result[start + 4] -= (center - result[start + 4]) * F(.4)
        result[start + 12] = (result[start + 4] + result[start + 5]) * F(.5)
    result[68:76] = points[[33, 64, 65, 66, 69, 70, 71, 42]]
    result[76] = reference[33] + (reference[33] - reference[64]) * F(.5)
    result[77] = reference[42] + (reference[42] - reference[71]) * F(.5)
    delta = reference[77] - reference[74]
    for index, weight in zip(range(68, 76), (.06, .06, .03, .03, -.03, -.03, -.06, -.06)):
        result[index] += delta * F(weight)
    return result


def space_eyes(*, source, target, intensity, assets, spacing_degree=None):
    eye_width = F(float(distance(a=source[0], b=source[33])) * .8)
    radius = abs(eye_width + eye_width)
    if radius <= 1e-5:
        raise ValueError("degenerate eye support")
    axis = (target[33] - target[0]) * F(.5)
    degree = F(.08) * F(intensity / 100) if spacing_degree is None else spacing_degree
    strength = F(float(degree) * .2)
    for center, direction, name in ((0, 1, "left_eye_spacing"), (33, -1, "right_eye_spacing")):
        for index in assets[name]:
            radial = distance(a=target[center], b=target[index])
            weight = F(np.clip(F(1) - radial / radius, 0, 1))
            target[index] += axis * (weight * strength) * F(direction)
    return target


def nose(*, points):
    result = np.zeros((28, 2), np.float32)
    eye = (points[77] - points[74]) * F(.2)
    result[0:2] = points[[44, 45]] + eye
    result[2:11] = points[[81, 83, 51, 50, 49, 48, 47, 82, 80]]
    result[11:13] = points[[45, 44]] - eye
    result[13:17] = (result[:4] + result[1:5]) * F(.5)
    result[17:21] = (result[8:12] + result[9:13]) * F(.5)
    result[21:24] = points[[44, 45, 46]]
    result[24] = (points[48] + points[46]) * F(.5)
    result[25] = (points[50] + points[46]) * F(.5)
    result[26] = result[23] + (result[9] - result[23]) / F(3)
    result[27] = result[23] + (result[3] - result[23]) / F(3)
    return result


def mouth(*, points):
    result = np.zeros((61, 2), np.float32)
    center = (points[98] + points[102]) * F(.5)
    result[0] = center
    result[1:13] = points[84:96] + (points[84:96] - center) * F(.1)
    boundary = points[np.r_[84:96, 84]]
    mids = (boundary[:-1] + boundary[1:]) * F(.5)
    result[13:25] = mids + (mids - center) * F(.1)
    result[25:49] = result[1:25] + (center - result[1:25]) * F(.3)
    result[49] = points[96]
    result[53] = points[100]
    top = points[[86, 87, 88]]
    bottom = points[[94, 93, 92]]
    result[50:53] = top + (bottom - top) * F(.4)
    result[54:57] = bottom[::-1] + (top[::-1] - bottom[::-1]) * F(.4)
    result[57] = (result[50] + result[51]) * F(.5)
    result[58] = (result[51] + result[52]) * F(.5)
    result[59] = (result[55] + result[56]) * F(.5)
    result[60] = (result[55] + result[54]) * F(.5)
    return result
