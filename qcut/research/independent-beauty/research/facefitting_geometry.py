"""Decode the pinned morphable model and reconstruct its unposed geometry."""
from dataclasses import dataclass
import struct

import numpy as np

from facefitting_input import load_model_bytes

MM_OFFSET = 2_396_638
MM_SIZE = 956_966


@dataclass(frozen=True)
class MorphableModel:
    basis: np.ndarray
    landmark_basis: np.ndarray
    point_weights: np.ndarray
    coefficient_weights: np.ndarray
    triangles: np.ndarray
    uv: np.ndarray
    expression_names: tuple[str, ...]
    auxiliary_vertices: np.ndarray
    auxiliary_triangles: np.ndarray
    auxiliary_uv: np.ndarray


def _readonly(*, values):
    values.setflags(write=False)
    return values


def decode_morphable_model(*, payload):
    if len(payload) != MM_SIZE or payload[:2] != b'\0\0':
        raise ValueError('unsupported morphable-model envelope')
    data = memoryview(payload)[2:]
    header = struct.unpack_from('<9If', data)
    if header != (956964, 3, 1834, 221, 30, 51, 9168, 82, 1, 2800.0):
        raise ValueError('unsupported morphable-model layout')
    cursor = 40

    def read(*, dtype, shape):
        nonlocal cursor
        count = int(np.prod(shape))
        size = count * np.dtype(dtype).itemsize
        if cursor + size > len(data):
            raise ValueError('truncated morphable-model array')
        result = np.frombuffer(data, dtype=dtype, count=count, offset=cursor).reshape(shape).copy()
        cursor += size
        if np.issubdtype(result.dtype, np.floating) and not np.isfinite(result).all():
            raise ValueError('nonfinite morphable-model array')
        return result

    quantized = read(dtype='<i2', shape=(82, 1834, 3))
    # The conversion kernel casts its double scale to float32 before multiplication.
    basis = quantized.astype(np.float32) * np.float32(1 / 2800.0)
    point_weights = read(dtype='<f4', shape=(221,))
    eigenvalues = read(dtype='<f4', shape=(30,))
    basis[1:31] *= eigenvalues[:, None, None]
    triangles = read(dtype='<u2', shape=(3056, 3))
    names = read(dtype='u1', shape=(52, 50))
    try:
        expression_names = tuple(bytes(row).split(b'\0', 1)[0].decode('ascii') for row in names)
    except UnicodeDecodeError as error:
        raise ValueError('invalid expression name') from error
    uv = read(dtype='<f4', shape=(1613, 2))
    if struct.unpack_from('<5I', data, cursor) != (1612, 1611, 790, 20, 4416):
        raise ValueError('unsupported auxiliary geometry')
    cursor += 20
    auxiliary_vertices = read(dtype='<i2', shape=(790, 3)).astype(np.float32) * np.float32(1 / 2800.0)
    auxiliary_triangles = read(dtype='<u2', shape=(1472, 3))
    auxiliary_uv = read(dtype='<f4', shape=(770, 2))
    if cursor != len(data):
        raise ValueError('unsupported landmark partition or trailing data')
    if np.any(point_weights <= 0) or np.any(eigenvalues <= 0):
        raise ValueError('invalid model weights')
    if triangles.max() >= 1613 or auxiliary_triangles.max() >= 790:
        raise ValueError('triangle index outside geometry')
    point_weights = np.sqrt(np.float32(point_weights * np.float32(0.5) * np.float32(1 / 221)))
    coefficient_weights = np.r_[np.float32(0), np.full(30, np.sqrt(np.float32(0.5 / 30)), np.float32),
                                 np.full(51, np.sqrt(np.float32(5 / 51)), np.float32)]
    return MorphableModel(**{key: _readonly(values=value) for key, value in {
        'basis': basis, 'landmark_basis': basis[:, -221:].copy(), 'point_weights': point_weights,
        'coefficient_weights': coefficient_weights, 'triangles': triangles, 'uv': uv,
        'auxiliary_vertices': auxiliary_vertices, 'auxiliary_triangles': auxiliary_triangles,
        'auxiliary_uv': auxiliary_uv}.items()}, expression_names=expression_names)


def load_morphable_model(*, model):
    data = load_model_bytes(model=model)
    return decode_morphable_model(payload=data[MM_OFFSET:MM_OFFSET + MM_SIZE])


def reconstruct(*, model, coefficients):
    coefficients = np.asarray(coefficients)
    if coefficients.dtype != np.float32 or coefficients.shape != (82,) or not np.isfinite(coefficients).all():
        raise ValueError('expected 82 finite float32 coefficients including the neutral coefficient')
    if coefficients[0] != 1 or np.abs(coefficients[1:]).max() > 100:
        raise ValueError('invalid neutral or unbounded fitting coefficients')
    vertices = (coefficients.astype(np.float64) @ model.basis.reshape(82, -1).astype(np.float64)).astype(np.float32).reshape(1834, 3)
    if not np.isfinite(vertices).all():
        raise ValueError('geometry overflow')
    return {'vertices': vertices, 'landmarks': vertices[-221:].copy()}
