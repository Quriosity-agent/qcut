"""MattingResult byte-mask input and its native shoulder-grid sampling."""

import numpy as np


MAX_MASK_AXIS = 16384
MAX_MASK_PIXELS = 16777216
F = np.float32


def validate_mask_size(*, width, height):
    if not (0 < width <= MAX_MASK_AXIS and 0 < height <= MAX_MASK_AXIS
            and width * height <= MAX_MASK_PIXELS):
        raise ValueError("segmentation_mask exceeds the mask size limits")


def validate_segmentation_mask(*, mask):
    if mask is None:
        return None
    if (
        not isinstance(mask, np.ndarray)
        or mask.dtype != np.uint8
        or mask.ndim != 2
    ):
        raise ValueError("segmentation_mask must be a nonempty 2D uint8 array within the mask size limits")
    validate_mask_size(width=mask.shape[1], height=mask.shape[0])
    return np.array(mask, dtype=np.uint8, order="C", copy=True)


def sample_grid_mask(*, mask, rows, cols):
    height, width = mask.shape
    columns = np.arange(cols + 1, dtype=np.float32)
    row_indices = np.arange(rows + 1, dtype=np.float32)
    x = np.floor(F(F(columns / F(F(cols) + F(1.01))) * F(F(width) + F(-0.01)))).astype(np.intp)
    y = np.floor(F(F(F(1) - F(row_indices / F(F(rows) + F(1.01)))) * F(F(height) + F(-0.01)))).astype(np.intp)
    # The mesh is y-up; MattingResult bytes are top-down. Any nonzero byte is inside.
    sampled = mask[y[:, None], x[None, :]] != 0
    expanded = sampled.copy()
    expanded[1:] |= sampled[:-1]
    expanded[:-1] |= sampled[1:]
    expanded[:, 1:] |= sampled[:, :-1]
    expanded[:, :-1] |= sampled[:, 1:]
    return expanded
