"""Owned reconstruction of the observed float body-network input conversion."""
import numpy as np


def normalize_body_coreml_input(*, bgr):
    if not isinstance(bgr, np.ndarray) or bgr.dtype != np.uint8 or bgr.ndim != 3 or bgr.shape[-1] != 3:
        raise ValueError("uint8 HWC BGR pixels required")
    if not bgr.size or bgr.size > 4 * 1024 * 1024:
        raise ValueError("bounded nonempty body tensor required")
    # uint8 times binary32 is exact in binary64; the final cast reproduces fused rounding.
    return (bgr.astype(np.float64) * float(np.float32(4 / 255)) - 2).astype(np.float32)
