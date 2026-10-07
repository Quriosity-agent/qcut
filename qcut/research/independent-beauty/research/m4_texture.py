"""Bounded, non-mip M4 RGBA8 linear sampling with 12-bit output colors.

The spatial profile was measured by QCut's independent-agfx-contract;
it is selected explicitly for the NH image path, not the ordinary CPU path.
"""
import numpy as np

from algorithm_frame import validate_frame

F = np.float32


def linear_samples(*, rgba, coordinates):
    validate_frame(frame=rgba, size=(1, 1))
    if (not isinstance(coordinates, np.ndarray) or coordinates.ndim != 2
            or coordinates.shape[1] != 2 or len(coordinates) > 262144
            or coordinates.dtype.kind != 'f' or not np.isfinite(coordinates).all()):
        raise ValueError('bounded finite floating-point M4 pixel coordinates required')
    height, width = rgba.shape[:2]
    dimensions = np.array([width, height], F)
    normalized = (coordinates / dimensions.astype(np.float64)).astype(F)
    magnitude = np.abs(normalized)
    if np.any(magnitude > 8) or np.any((magnitude > 0) & (magnitude < 2**-24)):
        raise ValueError('M4 coordinate profile excludes tiny nonzero and unbounded values')
    position = normalized * dimensions - F(.5)
    lower = np.floor(position).astype(np.int64)
    weight = np.floor((position - lower) * 256 + .5).astype(np.int64)
    upper = np.clip(lower + 1, [0, 0], [width - 1, height - 1])
    lower = np.clip(lower, [0, 0], [width - 1, height - 1])
    weight = np.where(lower == upper, 0, weight)
    total = np.zeros((len(position), 4), np.int64)
    for row in (0, 1):
        y = (lower if row == 0 else upper)[:, 1]
        beta = 256 - weight[:, 1] if row == 0 else weight[:, 1]
        for column in (0, 1):
            x = (lower if column == 0 else upper)[:, 0]
            alpha = 256 - weight[:, 0] if column == 0 else weight[:, 0]
            total += rgba[y, x] * (alpha * beta)[:, None]
    return ((total + 2048) // 4096).astype(F) / F(4080)


def resize_rgba(*, frame, size):
    validate_frame(frame=frame, size=size)
    height, width = frame.shape[:2]
    output = np.empty((size[1], size[0], 4), np.uint8)
    for start in range(0, size[1], 16):
        y, x = np.mgrid[start:min(start + 16, size[1]), :size[0]]
        coordinates = np.column_stack(((x.ravel() + .5) * width / size[0],
                                       (y.ravel() + .5) * height / size[1]))
        color = linear_samples(rgba=frame, coordinates=coordinates)
        # Preserve the sampled float32 color through the byte store's double scale.
        pixels = np.floor(color.astype(np.float64) * 255 + .5).astype(np.uint8)
        output[start:start + len(y)] = pixels.reshape(len(y), size[0], 4)
    return output
