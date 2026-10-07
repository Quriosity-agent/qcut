"""Prepare the jawline renderer's 238 support points from owned Extra106."""
import ctypes
from functools import lru_cache
import math

import numpy as np

F = np.float32


def length(*, vector):
    return F(np.sqrt(F(vector[0]*vector[0]+vector[1]*vector[1])))


@lru_cache(maxsize=3)
def system_function(*, name):
    if name not in ('sinf', 'cosf', 'atanf'):
        raise ValueError('bounded system trigonometric function required')
    function = getattr(ctypes.CDLL(None), name)
    function.argtypes = [ctypes.c_float]
    function.restype = ctypes.c_float
    return function


def adjust_yaw(*, points, size, yaw):
    points = points.copy()
    width, height = map(F, size)
    points[:, 0] /= width
    points[:, 1] = (height-points[:, 1])/height
    angle = F(F(abs(F(yaw))*F(math.pi))/F(180))
    sine = F(system_function(name='sinf')(float(angle)))
    cosine = F(system_function(name='cosf')(float(angle)))
    gain = F(min(F(1)/F(cosine+F(.001)), F(10)))
    axis = F(F(points[77]-points[74])*F(.25))*gain
    asymmetry = F(F(abs(F(F(length(vector=points[45]-points[28])-length(vector=points[45]-points[4]))*F(yaw))))*F(6))
    left = np.array([F(axis[0]*F(.534452)+axis[1]*F(.294038)),
                     F(axis[1]*F(.534452)-axis[0]*F(.294038))], F)
    right = np.array([F(axis[1]*F(.294038)-axis[0]*F(.534452)),
                      F(axis[0]*F(-.294038)-axis[1]*F(.534452))], F)
    shift = F(axis*F(sine*F(.023)))[::-1]
    for index in range(33):
        if yaw > 0 and index < 16:
            points[index] -= F(left*asymmetry)
        if yaw < 0 and index > 16:
            points[index] -= F(right*asymmetry)
        # The native loop updates the chin once per contour point.
        points[16, 0] -= shift[0]
        points[16, 1] += shift[1]
    points[:, 0] *= width
    points[:, 1] = height-points[:, 1]*height
    return points


def prepare(*, points, size, yaw, pitch, assets):
    if (not isinstance(points, np.ndarray) or points.dtype != F or points.shape != (106, 2)
            or not np.isfinite(points).all() or np.abs(points).max() > 32768
            or len(size) != 2 or any(type(value) is not int or not 1 <= value <= 1280 for value in size)
            or not np.isfinite([yaw, pitch]).all() or abs(yaw) > math.pi or not 0 <= pitch <= math.pi):
        raise ValueError('bounded Extra106 and nonnegative consumer pitch required; negative-pitch correction is unverified')
    points = adjust_yaw(points=points, size=size, yaw=yaw)
    center = np.zeros(2, F)
    for index in assets['center_indices']:
        center += points[index]
    center /= F(11)
    left = F(center+F(points[66]-center)+F(points[66]-center))
    right = F(center+F(points[69]-center)+F(points[69]-center))
    supports = list(points)
    supports.extend([left, right,
        F(center+F(F(F(points[37]+points[38])*F(.5))-center)*F(2.1)),
        F(center+F(F(F(points[0]+left)*F(.5))-center)*F(1.1)),
        F(center+F(F(F(points[32]+right)*F(.5))-center)*F(1.1))])
    points = np.asarray(supports, F)
    average = np.zeros(2, F)
    for point in points[:33]:
        average += point
    fade = F(min(abs(float(F(yaw)))/1.4, float(assets['center_fade'][0])))
    center = F(F(points[43]*F(F(1)-fade))+F(F(F(points[43]+F(average/F(33)))*F(.5))*fade))
    radius = max(length(vector=point-center) for point in points[:33])
    for index in [*range(33), *range(106, 111)]:
        delta = F(points[index]-center)
        distance = length(vector=delta)
        if distance < 1e-6:
            raise ValueError('degenerate jawline support radius')
        supports.append(F(points[index]+F(F(F(delta*radius)+F(delta*radius))/distance)))
    points = np.asarray(supports, F)
    for first, last in [(0, 109), (32, 110), (111, 147), (143, 148)]:
        for fraction in (F(.25), F(.5), F(.75)):
            supports.append(F(points[first]+F(F(points[last]-points[first])*fraction)))
    points = np.asarray(supports, F)
    extensions = [(104, 52, 1), (105, 61, 1),
        *[(64+i, 34+i, .6 if i == 0 else .75 if i == 7 else 1) for i in range(8)],
        (86, 95, .75), (86, 94, .75), (87, 93, .75), (88, 92, .75), (88, 91, .75)]
    for first, last, gain in extensions:
        supports.append(F(points[last]+F(F(points[last]-points[first])*F(gain))))
    points = np.asarray(supports, F)
    for corner, first, last in [(84, 97, 103), (90, 99, 101)]:
        midpoint = F(F(points[first]+points[last])*F(.5))
        supports.append(F(points[corner]+F(F(points[corner]-midpoint)*F(.8))))
    points = np.asarray(supports, F)
    for first, last in [(84, 161), (90, 162)]:
        for step in (1, 2):
            supports.append(F(points[first]+F(F(F(points[last]-points[first])*F(step))/F(3))))
    points = np.asarray(supports, F)
    for first, last in [(110, 107), (107, 108), (108, 106), (106, 109)]:
        for fraction in (F(.25), F(.5), F(.75)):
            supports.append(F(points[first]+F(F(points[last]-points[first])*fraction)))
    points = np.asarray(supports, F)
    for index in assets['outer_indices']:
        delta = F(points[index]-center)
        distance = length(vector=delta)
        if distance < 1e-6:
            raise ValueError('degenerate outer jawline support')
        supports.append(F(points[index]+F(F(F(delta*radius)*F(.5))/distance)))
    points = np.asarray(supports, F)
    average = np.zeros(2, F)
    for index in [45, 47, 48, 49, 50, 51, 80, 81, 82, 83]:
        average += points[index]
    amount = F(abs(F(yaw)))
    points[46] = F(F(F(average*F(.1))*amount)+F(points[46]*F(F(1)-amount)))
    if points.shape != (238, 2) or not np.isfinite(points).all():
        raise ValueError('invalid jawline support output')
    return points


def shadow_opacity(*, extra, yaw, pitch, strength):
    points = np.asarray(extra, F)
    if points.shape != (240, 2) or not np.isfinite(points).all():
        raise ValueError('finite Extra240 required for shadow roll')
    eyes = F(F(points[55]+points[58])/F(2))
    mouth = F(F(points[84]+points[90])/F(2))
    delta = F(mouth-eyes)
    if length(vector=delta) < 1e-6:
        raise ValueError('degenerate roll axis')
    angle = F(math.pi/2) if delta[0] == 0 else F(system_function(name='atanf')(float(F(delta[1]/delta[0]))))
    roll = F(math.atan2(float(delta[0]), float(delta[1]))) if delta[0] == 0 else F(
        math.pi/2-float(angle) if delta[0] >= 0 else -math.pi/2-float(angle))
    roll = F(float(F(roll*F(180)))/math.pi)
    radians = F(roll*F(.017453294))
    return float(strength)*(1-min(abs(float(yaw))*180/math.pi, 65)/65)*(
        1-min(abs(float(pitch))*180/math.pi, 65)/65)*(1-min(abs(float(radians))*180/math.pi, 60)/60)
