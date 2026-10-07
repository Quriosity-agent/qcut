"""Bounded CPU BGR affine sampling with separate Q10 tables and Q5 weights."""
import numpy as np

from algorithm_frame import validate_frame
from alignment_sampling import inverse_forward


def sample_bgr(*, frame, forward, size):
    validate_frame(frame=frame, size=size)
    if max(size) > 640:
        raise ValueError('linear affine destination exceeds CPU sampling budget')
    inverse_forward(forward=forward)
    matrix = forward.astype(np.float64)
    determinant = matrix[0, 0]*matrix[1, 1]-matrix[0, 1]*matrix[1, 0]
    reciprocal = 1/determinant
    inverse = np.array([[matrix[1, 1], -matrix[0, 1], 0],
        [-matrix[1, 0], matrix[0, 0], 0]], np.float64)*reciprocal
    inverse[:, 2] = -inverse[:, 0]*matrix[0, 2]-inverse[:, 1]*matrix[1, 2]
    x = np.arange(size[0], dtype=np.float64)[None]
    y = np.arange(size[1], dtype=np.float64)[:, None]
    coordinates = []
    for row in range(2):
        horizontal = np.rint(inverse[row, 0]*x*1024).astype(np.int64)
        vertical = np.rint((inverse[row, 1]*y+inverse[row, 2])*1024).astype(np.int64)+16
        coordinates.append((horizontal+vertical) >> 5)
    source_x, source_y = coordinates
    low_x, low_y = source_x >> 5, source_y >> 5
    fraction_x, fraction_y = source_x & 31, source_y & 31
    result = np.zeros((size[1], size[0], 3), np.int64)
    height, width = frame.shape[:2]
    for row in (0, 1):
        sy = low_y+row
        beta = fraction_y if row else 32-fraction_y
        for column in (0, 1):
            sx = low_x+column
            alpha = fraction_x if column else 32-fraction_x
            valid = (sx >= 0) & (sx < width) & (sy >= 0) & (sy < height)
            weight = (alpha*beta*valid)[..., None]
            result += frame[np.clip(sy, 0, height-1), np.clip(sx, 0, width-1), :3][..., ::-1]*weight
    return ((result+512) >> 10).astype(np.uint8)
