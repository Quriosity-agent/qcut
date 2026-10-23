"""Bounded CPU compositing for the coarse ONNX person silhouette."""
import hashlib
import math

import numpy as np
from PIL import Image, ImageFilter

if __package__:
    from .background import MASK_THRESHOLD, _opaque_photo, _person_mask
else:
    from background import MASK_THRESHOLD, _opaque_photo, _person_mask


MASK_GRID_SIDE = 192


def _dilate(*, support, radius):
    size = radius * 2 + 1
    horizontal = np.pad(support, ((0, 0), (radius, radius)))
    sums = np.pad(np.cumsum(horizontal, axis=1, dtype=np.uint32), ((0, 0), (1, 0)))
    horizontal = sums[:, size:] > sums[:, :-size]
    vertical = np.pad(horizontal, ((radius, radius), (0, 0)))
    sums = np.pad(np.cumsum(vertical, axis=0, dtype=np.uint32), ((1, 0), (0, 0)))
    return sums[size:] > sums[:-size]


def protection_alpha(*, source_mask, warped_mask):
    if (not isinstance(source_mask, np.ndarray) or source_mask.ndim != 2
            or min(source_mask.shape) < 32 or max(source_mask.shape) > 4096
            or source_mask.size > 8_294_400):
        raise ValueError("source mask must be a bounded two-dimensional photo mask")
    shape = source_mask.shape
    source_stats = _person_mask(value=source_mask, shape=shape, name="source mask")
    warped_stats = _person_mask(value=warped_mask, shape=shape, name="warped mask")
    support = np.maximum(source_mask, warped_mask) >= MASK_THRESHOLD
    cell = max(shape) / MASK_GRID_SIDE
    padding = max(4, min(64, math.ceil(cell * 3)))
    feather = max(4, min(64, math.ceil(cell * 3)))
    # Coarse labels can omit shoe edges by several network pixels. Restoring the
    # source inside that uncertainty band would restore the old person outline.
    core = _dilate(support=support, radius=padding)
    expanded = _dilate(support=support, radius=padding + feather)
    matte = Image.fromarray(expanded.astype(np.uint8) * 255)
    alpha = np.array(matte.filter(ImageFilter.BoxBlur(feather)), dtype=np.uint8, copy=True)
    alpha[core] = 255
    if not np.any(alpha == 0):
        raise ValueError("insufficient distant background for bounded protection")
    return alpha, {
        "sourceMask": source_stats,
        "warpedMask": warped_stats,
        "maskThreshold": MASK_THRESHOLD,
        "dilationPixels": padding + feather,
        "featherPixels": feather,
        "fullWarpMarginPixels": padding,
        "maskGridSide": MASK_GRID_SIDE,
        "maxBoundaryCorridorPixels": padding + feather * 2,
    }


def protect_background(*, original, warped, source_mask, warped_mask):
    _opaque_photo(value=original, name="original")
    _opaque_photo(value=warped, name="warped")
    if (original.shape != warped.shape or not isinstance(source_mask, np.ndarray)
            or source_mask.shape != original.shape[:2]):
        raise ValueError("photo and person-mask dimensions must match")
    alpha, mask_details = protection_alpha(source_mask=source_mask, warped_mask=warped_mask)
    weight = alpha.astype(np.uint32)[..., None]
    result = ((original.astype(np.uint32) * (255 - weight)
               + warped.astype(np.uint32) * weight + 127) // 255).astype(np.uint8)
    protected = alpha == 0
    unchanged = int(np.count_nonzero(np.any(result[protected] != original[protected], axis=-1)))
    if unchanged:
        raise RuntimeError("background preservation invariant failed")
    return result, {
        **mask_details,
        "enabled": True,
        "applied": True,
        "method": "coarse-person-union-bounded-corridor-v2",
        "protectedPixels": int(protected.sum()),
        "editablePixels": int(np.count_nonzero(alpha)),
        "changedProtectedPixels": unchanged,
        "blendMaskSha256": hashlib.sha256(alpha.tobytes()).hexdigest(),
        "backgroundReconstruction": False,
        "boundaryCorridorMayMove": True,
        "limitation": "bounded silhouette uncertainty corridor uses warped background; "
                      "missed subject parts outside it and complex revealed background remain unverified",
    }
