"""Independent linked eye, nose and mouth deformation for the small-face profile."""
import math

import numpy as np

from slimface_mesh_landmarks import F, distance
from slimface_mesh_organs import eyes, mouth, nose, space_eyes


def transform_eyes(*, source, target, degrees, pitch, mesh_assets, assets):
    axis = (source[77] - source[74]) * F(.25)
    zoom = degrees[1]
    if abs(float(zoom)) > .001:
        for index, horizontal, vertical in assets['eye_zoom']:
            delta = np.array([horizontal * axis[0] - vertical * axis[1],
                              vertical * axis[0] + horizontal * axis[1]], np.float32)
            target[int(index)] = source[int(index)] - delta * zoom
        axis = (target[77] - target[74]) * F(.25)
        amount = zoom * F(4.5)
        for index, horizontal, vertical in assets['eye_expand']:
            delta = np.array([horizontal * axis[0] + vertical * axis[1],
                              -vertical * axis[0] + horizontal * axis[1]], np.float32)
            target[int(index)] -= delta * amount
    rotation = degrees[2]
    if abs(float(rotation)) > .001:
        angle = float(rotation) * float(assets['constants'][0])
        sine, cosine = math.sin(angle), math.cos(angle)
        for name, center_index, sign in (('eye_rotate_left', 74, 1), ('eye_rotate_right', 77, -1)):
            center = target[center_index].copy()
            for index in assets[name]:
                delta = target[index] - center
                target[index, 0] = float(center[0]) + float(delta[0]) * cosine + sign * float(delta[1]) * sine
                # Rotation stores X before reading it again for Y.
                horizontal = F(target[index, 0] - center[0])
                target[index, 1] = float(center[1]) + float(delta[1]) * cosine - sign * float(horizontal) * sine
    result = eyes(points=target, reference=source, assets=mesh_assets)
    amount = F(F(max(0, 1 - max(0, pitch - 20) / 20)) * degrees[3])
    amount = F(float(amount) * float(assets['constants'][1]))
    if abs(float(amount)) > .001:
        delta = (result[0] - result[33]) * F(.25) * amount
        result[:68] += np.array([delta[1], -delta[0]], np.float32)
    return space_eyes(source=eyes(points=source, reference=source, assets=mesh_assets),
                      target=result, intensity=0, assets=mesh_assets, spacing_degree=degrees[0])


def transform_nose(*, source, target, degrees, yaw, assets):
    result = nose(points=target)
    axis = (source[77] - source[74]) * F(.2)
    for sign in (1, -1):
        strength = degrees[4] * F(2)
        if yaw * sign < -20:
            strength = F(float(strength) - (abs(float(yaw)) - 20) * float(F(strength / F(30))))
        delta = axis * strength
        if sign == 1:
            for index in (2, 3, 15, 16):
                result[index] += delta
            for index, weight in ((1, .8), (14, .8), (0, .4), (13, .7), (25, .2), (27, .4)):
                result[index] += delta * F(weight)
            result[4] += (result[4] - result[5]) * F(1.1) * strength
            result[5] += (result[4] - result[5]) * F(1.1) * strength
            continue
        for index in (9, 10, 18, 19, 17):
            result[index] -= delta
        for index, weight in ((12, .4), (20, .7), (11, .8), (24, .2), (26, .4)):
            result[index] -= delta * F(weight)
        result[7] -= (result[7] - result[8]) * F(1.1) * strength
        result[8] -= (result[7] - result[8]) * F(1.1) * strength
    amount = F(float(degrees[5]) * float(assets['constants'][2]))
    result += (result[21] - result[22]) * F(.8) * amount
    return result


def transform_mouth(*, target, degrees, assets):
    size, height = degrees[7], degrees[6]
    right_clearance = distance(a=target[90], b=target[24])
    left_clearance = distance(a=target[84], b=target[8])
    if float(right_clearance) < float(left_clearance) * .5:
        size = F(F(right_clearance * size) / left_clearance)
    if float(left_clearance) < float(right_clearance) * .5:
        size = F(F(left_clearance * size) / right_clearance)
    if abs(float(size)) > .001:
        center = (target[84] + target[90]) * F(.5)
        left = distance(a=target[98], b=target[84])
        right = distance(a=target[98], b=target[90])
        if min(left, right) <= F(1e-5):
            raise ValueError('degenerate mouth width')
        weights = [F(float(size) * float(assets['constants'][3]))] * 2
        if float(right) < float(left) * .4:
            weights[0] = F(F(right * size) / left)
        if float(left) < float(right) * .4:
            weights[1] = F(F(left * size) / right)
        for name, weight in zip(('mouth_left', 'mouth_right'), weights):
            for index in assets[name]:
                target[index] += (target[index] - center) * weight
    if abs(float(height)) > .001:
        delta = (target[77] - target[74]) * F(.15) * height
        for index in assets['mouth_move']:
            target[index] += np.array([-delta[1], delta[0]], np.float32)
    amount = degrees[17] * F(5)
    if abs(float(amount)) > .001:
        axis = (target[77] - target[74]) * F(.25)
        for index, horizontal, vertical in assets['lip_coefficients']:
            delta = np.array([horizontal * axis[0] + vertical * axis[1],
                              -vertical * axis[0] + horizontal * axis[1]], np.float32)
            target[int(index)] += delta * amount
    return mouth(points=target)
