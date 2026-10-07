"""Bounded mouth-material hysteresis from the owned 248-point working mesh."""
import numpy as np


def mouth_texture(*, positions, previous_open=True):
    if (type(previous_open) is not bool or not isinstance(positions, np.ndarray)
            or positions.dtype != np.float32 or positions.shape != (248, 2)
            or not np.isfinite(positions).all() or np.max(np.abs(positions)) > 32768):
        raise ValueError('finite float32 mouth mesh and typed previous state required')

    def distance(*, first, second):
        delta = positions[first]-positions[second]
        return np.sqrt(delta[0]*delta[0]+delta[1]*delta[1])

    gap = distance(first=209, second=225)
    upper = distance(first=209, second=192)
    lower = distance(first=225, second=240)
    thickness = float(np.float32(upper+lower))*.5
    if thickness <= 0:
        raise ValueError('nondegenerate lip thickness required')
    ratio = float(gap)/thickness
    threshold = float(np.float32(.15)) if previous_open else .25
    opened = ratio > threshold
    return {'textureState': 'Open' if opened else 'Close', 'previousOpen': previous_open,
            'ratio': ratio, 'threshold': threshold, 'open': opened,
            'scope': 'owned-248-mouth-material-hysteresis'}
