"""Coordinate tables for the ordinary alignment warp's fused float32 arithmetic."""
import numpy as np

from facefitting_input import fma32


def coordinate_tables(*, forward, size):
    a, b, tx, c, d, ty = forward.reshape(-1)
    determinant = fma32(left=d, right=a, addend=-np.float32(c * b))
    if not np.isfinite(determinant) or abs(float(determinant)) < 1e-8:
        raise ValueError('nonsingular sampling transform required')
    reciprocal = np.float32(1.0 / float(determinant))
    p, q = np.float32(d * reciprocal), np.float32(-reciprocal * b)
    r, s = np.float32(-reciprocal * c), np.float32(a * reciprocal)
    columns = np.float32(np.arange(size[0], dtype=np.float32) - tx)
    x_offset, y_offset = -np.float32(q * ty), -np.float32(s * ty)
    # The native ordinary path subtracts translation before the fused product.
    x_columns = np.asarray([fma32(left=p, right=x, addend=x_offset)
                            for x in columns], np.float32)[None, :]
    y_columns = np.asarray([fma32(left=r, right=x, addend=y_offset)
                            for x in columns], np.float32)[None, :]
    rows = np.arange(size[1], dtype=np.float32)[:, None]
    return x_columns, np.float32(q * rows), y_columns, np.float32(s * rows)
