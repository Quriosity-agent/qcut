"""Two eye corners to an owned 48-pixel iris crop and decoded 20-point pupil."""
import numpy as np

from alignment_sampling import inverse_forward
from alignment_transform import inverse_mapping
from iris_solver import solve
from facefitting_input import fma32
from makeup_geometry import points_array

F = np.float32


def eye_crop(*, controls, stage2_forward, mirrored):
    points_array(value=controls, count=2)
    inverse_forward(forward=stage2_forward)
    if type(mirrored) is not bool or float(np.linalg.norm(controls[1]-controls[0])) < 1e-4:
        raise ValueError('distinct iris eye corners and explicit mirror profile required')
    p, q = controls
    matrix = np.array([[p[0], p[1], 1, 0], [p[1], -p[0], 0, 1],
        [q[0], q[1], 1, 0], [q[1], -q[0], 0, 1]], F)
    a, b = solve(matrix=matrix, values=np.array([0, 100, 100, 100], F))[:2]
    scale = F(np.sqrt(float(F(F(a*a)+F(b*b)))))
    linear = np.array([[a, b], [-b, a]], F)*F(1/float(scale))
    shift = F(12)-controls.mean(axis=0)
    translation = np.empty(2, F)
    for row in range(2):
        canonical = fma32(left=linear[row, 1], right=F(12), addend=F(linear[row, 0]*F(12)))
        rotated = fma32(left=linear[row, 1], right=shift[1], addend=F(linear[row, 0]*shift[0]))
        translation[row] = F(F(12)-canonical)+rotated
    transform = np.column_stack((linear, translation))*F(2)
    if mirrored:
        transform[0] *= F(-1)
        transform[0, 2] += F(47)
    forward = np.empty((2, 3), F)
    for row in range(2):
        for column in range(3):
            forward[row, column] = fma32(left=transform[row, 1], right=stage2_forward[1, column],
                addend=F(transform[row, 0]*stage2_forward[0, column]))
        forward[row, 2] += transform[row, 2]
    inverse_forward(forward=forward)
    return {'eye_forward': transform, 'eye_inverse': inverse_mapping(forward=transform), 'forward': forward}


def map_points(*, points, matrix):
    points_array(value=points, count=20)
    inverse_forward(forward=matrix)
    values, transform = points.astype(np.float64), matrix.astype(np.float64)
    result = (values[:, :1]*transform[:, 0]+values[:, 1:]*transform[:, 1]+transform[:, 2]).astype(F)
    points_array(value=result, count=20)
    return result


def decode_pupil(*, raw, mean, crop, stage2_inverse, mirrored):
    points_array(value=raw, count=20)
    points_array(value=mean, count=20)
    if type(mirrored) is not bool:
        raise ValueError('explicit iris mirror profile required')
    part = map_points(points=raw+mean, matrix=crop['eye_inverse'])
    points = map_points(points=part, matrix=stage2_inverse)
    return points[np.r_[0, 1, np.arange(19, 1, -1)]] if mirrored else points
