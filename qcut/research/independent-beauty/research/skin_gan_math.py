"""Owned control-vector contract for the bounded three-channel skin network."""
import numpy as np

from youtai_render import validate_intensity

CONTROL_KEYS = ('face_adjust_yunfu', 'face_adjust_fuling', 'face_adjust_lunkuopinghua')


def controls(*, yunfu=0, fuling=0, contour=0):
    strengths = [validate_intensity(intensity=value) for value in (yunfu, fuling, contour)]
    vector = np.asarray([value/100 for value in strengths], dtype=np.float32)
    return dict(zip(CONTROL_KEYS, strengths)), vector, strengths[2] > 0
