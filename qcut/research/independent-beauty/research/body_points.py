"""Skeleton points in algorithm-image pixels to normalized coordinates with y up.

Keeps the float32 reciprocal-multiply order the effect converts them with."""
import numpy as np

def normalize_joints(points, width, height):
    p = np.asarray(points, dtype=np.float32)
    if p.ndim != 2 or p.shape[1] < 2:
        raise ValueError('points must be Nx2 or Nx4 (x,y,score,visible)')
    w, h = (np.float32(width), np.float32(height))
    if w <= 0 or h <= 0:
        raise ValueError('positive dimensions required')
    rw = np.float32(np.float32(1) / w)
    rh = np.float32(np.float32(1) / h)
    xy = np.empty((len(p), 2), np.float32)
    xy[:, 0] = p[:, 0] * rw
    xy[:, 1] = (h - p[:, 1]) * rh
    return {'points': xy, 'scores': p[:, 2].copy() if p.shape[1] > 2 else None, 'visibility': p[:, 3].astype(np.uint8) if p.shape[1] > 3 else None}
