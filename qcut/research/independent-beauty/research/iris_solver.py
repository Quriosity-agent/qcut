"""Bounded four-variable float32 Jacobi solve for the two-point iris crop.

Equations cross-checked against OpenCV lapack.cpp; see vendor/LICENSE.opencv-svd.txt.
The pinned arm64 scalar path fuses rotations, unlike public OpenCV's SIMD path.
"""
import math

import numpy as np

from alignment_transform import system_fma
from facefitting_input import fma32

F = np.float32


def ordered_dot(*, left, right):
    result = 0.
    fma = system_fma()
    for a, b in zip(left, right, strict=True):
        result = fma(float(a), float(b), result)
    return result


def stable_hypot(*, left, right):
    a, b = abs(left), abs(right)
    if a > b:
        ratio = b/a
        return a*math.sqrt(system_fma()(ratio, ratio, 1))
    if b > 0:
        ratio = a/b
        return b*math.sqrt(system_fma()(ratio, ratio, 1))
    return 0.


def rotate(*, matrix, first, second, cosine, sine):
    left, right = matrix[first].copy(), matrix[second].copy()
    matrix[first] = [fma32(left=b, right=sine, addend=F(a*cosine))
        for a, b in zip(left, right, strict=True)]
    matrix[second] = [fma32(left=b, right=cosine, addend=-F(a*sine))
        for a, b in zip(left, right, strict=True)]


def solve(*, matrix, values):
    for array, shape in ((matrix, (4, 4)), (values, (4,))):
        if (not isinstance(array, np.ndarray) or array.dtype != np.float32 or array.shape != shape
                or not np.isfinite(array).all() or np.max(np.abs(array)) > 32768):
            raise ValueError('bounded float32 four-variable iris system required')
    rows, vectors = matrix.T.copy(), np.eye(4, dtype=F)
    weights = [ordered_dot(left=row, right=row) for row in rows]
    for iteration in range(30):
        changed = False
        for first in range(3):
            for second in range(first+1, 4):
                a, b = weights[first], weights[second]
                product = ordered_dot(left=rows[first], right=rows[second])
                if abs(product) <= 2**-22*math.sqrt(a*b):
                    continue
                product *= 2
                beta = a-b
                gamma = stable_hypot(left=product, right=beta)
                if beta < 0:
                    sine = F(math.sqrt((gamma-beta)*.5/gamma))
                    cosine = F(product/(gamma*float(sine)*2))
                else:
                    cosine = F(math.sqrt((gamma+beta)/(gamma*2)))
                    sine = F(product/(gamma*float(cosine)*2))
                for array in (rows, vectors):
                    rotate(matrix=array, first=first, second=second, cosine=cosine, sine=sine)
                for index in (first, second):
                    weights[index] = ordered_dot(left=rows[index], right=rows[index])
                changed = True
        if not changed:
            break
        if iteration == 29:
            raise ValueError('iris system exceeded Jacobi iteration budget')
    weights = [math.sqrt(ordered_dot(left=row, right=row)) for row in rows]
    if min(weights) < 1e-8 or max(weights)/min(weights) > 1e8:
        raise ValueError('singular or ill-conditioned iris system')
    for first in range(3):
        second = max(range(first, 4), key=lambda index: weights[index])
        if first != second:
            weights[first], weights[second] = weights[second], weights[first]
            rows[[first, second]] = rows[[second, first]]
            vectors[[first, second]] = vectors[[second, first]]
    for index in range(4):
        rows[index] *= F(1/weights[index])
    singular = np.array(weights, F)
    result = np.zeros(4, F)
    for index in range(4):
        projection = sum(float(F(a*b)) for a, b in zip(rows[index], values, strict=True))/float(singular[index])
        result = np.array([F(system_fma()(projection, float(v), float(x)))
            for x, v in zip(result, vectors[index], strict=True)], F)
    if not np.isfinite(result).all() or np.max(np.abs(result)) > 32768:
        raise ValueError('iris solution exceeds finite output budget')
    return result
