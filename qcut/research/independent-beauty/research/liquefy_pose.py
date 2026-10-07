"""Pose-dependent left/right strength compensation for local face deformation."""
import math

import numpy as np

from liquefy_geometry import finite_array

F = np.float32


def adjust_strength(*, points, steps, parameters, exponent):
    points = finite_array(value=points, shape=(106, 2), name='pose landmarks')
    parameters = finite_array(value=parameters, shape=(8,), name='side parameters')
    yaw, width, height, onset, boundary, first, second, multiplier = parameters
    if not 0 <= onset < boundary < 90 or not 0 < width <= 4096 or not 0 < height <= 4096:
        raise ValueError('bounded side compensation parameters required')
    if not math.isfinite(exponent) or not 0 < exponent <= 4:
        raise ValueError('bounded side compensation exponent required')
    strength = np.asarray(steps['strength'], np.float32).copy()
    if abs(yaw) < onset:
        return strength
    amount = F(F(abs(yaw) - onset) / F(F(90) - onset))
    amount = F(math.pow(float(amount), float(exponent)))
    offsets = np.array([first, second] if yaw > 0 else [second, first], np.float32) * amount
    if abs(yaw) > boundary:
        offsets *= multiplier
    factors = offsets + F(1)
    facial_axis = (points[[43, 49, 87, 93, 16]] * np.array([width, height], np.float32)).astype(np.float64)
    mean = facial_axis.mean(axis=0)
    centered = facial_axis - mean
    xx = centered[:, 0] @ centered[:, 0]
    yy = centered[:, 1] @ centered[:, 1]
    xy = centered[:, 0] @ centered[:, 1]
    angle = .5 * math.atan2(2 * xy, xx - yy)
    direction = np.array([math.cos(angle), math.sin(angle)], np.float32)
    if abs(direction[0]) < F(1e-8):
        raise ValueError('vertical side compensation axis is unsupported')
    slope = F(direction[1] / direction[0])
    intercept = F(F(mean[1]) - F(slope * F(mean[0])))
    denominator = F(np.sqrt(F(slope * slope + F(1))))
    signs = []
    for coords in (steps['start'], steps['end']):
        signs.append((intercept + (slope * coords[:, 0] - coords[:, 1])) / denominator)
    negative = (signs[0] + signs[1]) < 0
    low, high = factors[::-1] if slope < 0 else factors
    return strength * np.where(negative, low, high).astype(np.float32)
