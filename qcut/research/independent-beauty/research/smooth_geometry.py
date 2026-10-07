"""Owned 106-to-145 smoothing mask geometry in original image coordinates."""
import numpy as np

from alignment_transform import points106

F = np.float32


def positions(*, normalized, size, forehead):
    points106(points=normalized)
    if (normalized.dtype != F or (normalized < 0).any() or (normalized > 1).any()
            or not isinstance(size, (tuple, list)) or len(size) != 2
            or any(type(value) is not int or not 1 <= value <= 1280 for value in size)
            or not isinstance(forehead, np.ndarray) or forehead.dtype != F or forehead.shape != (11, 2)
            or not np.isfinite(forehead).all() or np.abs(forehead).max() > 4):
        raise ValueError('normalized float32 landmarks, bounded frame and forehead coefficients required')
    primary = np.empty((106, 2), F)
    primary[:, 0] = normalized[:, 0]*F(size[0])
    primary[:, 1] = F(size[1])-normalized[:, 1]*F(size[1])
    left = primary[74]*F(.5)+primary[0]*F(.5)
    right = primary[77]*F(.5)+primary[32]*F(.5)
    delta = right-left
    head = np.empty((11, 2), F)
    height = forehead[:, 1]*F(.85)
    head[:, 0] = (left[0]+delta[0]*forehead[:, 0])-delta[1]*height
    head[:, 1] = (left[1]+delta[1]*forehead[:, 0])+delta[0]*height
    center = (primary[43]+primary[46])*F(.5)
    edge = primary[:33:2]
    outer = edge+(center-edge)*F(-.4)
    outer_head = head+(primary[43]-head)*F(-.4)
    return np.vstack((primary, head, outer, outer_head)).astype(F)


def face_mesh(*, normalized, size, assets):
    uv = assets['uv']
    if (uv.dtype != F or uv.shape != (145, 2) or not np.isfinite(uv).all()
            or (uv < 0).any() or (uv > 1).any()):
        raise ValueError('unit float32 smoothing pigment coordinates required')
    xy = positions(normalized=normalized, size=size, forehead=assets['forehead'])
    return {'vertices': np.column_stack((xy, uv)).astype(F), 'indices': assets['indices']}
