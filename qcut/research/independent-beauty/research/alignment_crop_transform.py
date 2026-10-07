"""Float32 four-endpoint crop mapping with pivoted elimination and fused updates."""
import numpy as np

from facefitting_input import fma32


def _solve_endpoints(*, matrix, target):
    coefficients, solution = matrix.copy(), target.copy()
    for column in range(4):
        pivot = column + int(np.argmax(np.abs(coefficients[column:, column])))
        if abs(coefficients[pivot, column]) < np.float32(10 * np.finfo(np.float32).eps):
            raise ValueError("degenerate crop endpoint system")
        coefficients[[column, pivot], column:] = coefficients[[pivot, column], column:]
        solution[[column, pivot]] = solution[[pivot, column]]
        reciprocal = np.float32(1) / coefficients[column, column]
        for row in range(column + 1, 4):
            multiplier = -coefficients[row, column] * reciprocal
            for index in range(column + 1, 4):
                coefficients[row, index] = fma32(left=coefficients[column, index], right=multiplier,
                                                  addend=coefficients[row, index])
            solution[row] = fma32(left=solution[column], right=multiplier, addend=solution[row])
    for row in range(3, -1, -1):
        value = solution[row]
        for index in range(row + 1, 4):
            value = fma32(left=-solution[index], right=coefficients[row, index], addend=value)
        solution[row] = value / coefficients[row, row]
    return solution


def crop_matrices(*, rect, network_size):
    if (not isinstance(rect, (list, tuple)) or len(rect) != 4
            or any(type(value) is not int for value in rect)
            or any(abs(value) > 32768 for value in rect[:2])
            or any(not 2 <= side <= 32768 for side in rect[2:])
            or not isinstance(network_size, (list, tuple)) or len(network_size) != 2
            or any(type(side) is not int or not 2 <= side <= 32768 for side in network_size)):
        raise ValueError("bounded integer crop and network endpoints required")
    x, y, width, height = (np.float32(value) for value in rect)
    right, bottom = x + width - np.float32(1), y + height - np.float32(1)
    matrix = np.array([[x, 0, 1, 0], [0, y, 0, 1], [right, 0, 1, 0], [0, bottom, 0, 1]], np.float32)
    target = np.array([0, 0, network_size[0] - 1, network_size[1] - 1], np.float32)
    sx, sy, tx, ty = _solve_endpoints(matrix=matrix, target=target)
    if not np.isfinite([sx, sy, tx, ty]).all() or sx <= 0 or sy <= 0:
        raise ValueError("invalid solved crop scale")
    forward = np.array([[sx, 0, tx], [0, sy, ty]], np.float32)
    # Crop inversion rounds reciprocal first, then uses a separate float32 multiply.
    ix, iy = np.float32(1 / float(sx)), np.float32(1 / float(sy))
    inverse = np.array([[ix, 0, -ix * tx], [0, iy, -iy * ty]], np.float32)
    if not np.isfinite(inverse).all():
        raise ValueError("invalid crop inverse")
    return forward, inverse
