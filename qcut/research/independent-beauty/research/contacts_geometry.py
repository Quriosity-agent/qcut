"""Owned iris40 points to two weighted 39-vertex pupil meshes."""
import numpy as np

from eye_support import distance_ratio
from makeup_geometry import points_array

F = np.float32


def pupil_mesh(*, extra, pupil):
    points_array(value=extra, count=240)
    points_array(value=pupil, count=40)
    result = np.zeros((78, 3), F)
    for side in range(2):
        eye = extra[196+22*side:218+22*side].copy()
        eye[:, 1] = F(1)-eye[:, 1]
        top = eye[5]*F(.5)+eye[6]*F(.5)
        bottom = eye[16]*F(.5)+eye[17]*F(.5)
        opening = distance_ratio(numerator=top-bottom, denominator=eye[0]-eye[11])
        points = pupil[20*side:20*(side+1)]
        mesh = result[39*side:39*(side+1)]
        mesh[:20, :2] = points
        mesh[:20, 2] = opening+opening
        mesh[20:, :2] = points[1:]-(points[0]-points[1:])*F(.1)
    return result
