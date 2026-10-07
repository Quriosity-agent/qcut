"""Sparse canonical jawline deformation to an owned adaptive Metal mesh."""
import numpy as np

from jawline_mapping import map_points
from jawline_smooth import smooth
from jawline_support import length, prepare

F = np.float32


def adaptive_axis(*, lower, upper, extent):
    values = [F(0)]
    start = F(lower)
    if lower > 0:
        values.extend(F(F(lower/F(8))*F(step)) for step in range(1, 9))
        start = values[-1]
    core = F(F(upper-lower)/F(56))
    values.extend(F(start+F(core*F(step))) for step in range(1, 57))
    start = values[-1]
    if extent > upper:
        values.extend(F(start+F(F(F(extent-upper)/F(8))*F(step))) for step in range(1, 9))
    result = np.asarray(values, F)
    if len(result) != 73 or np.any(np.diff(result) <= 0):
        raise ValueError('interior face with 73 distinct grid coordinates required')
    return result, core


def push_contour(*, source, magnitude):
    source = source.copy()
    center = F(F(F(source[43]+source[44])+source[45])/F(3))
    for index in range(33):
        step = index if index <= 16 else 32-index
        delta = F(source[index]-center)
        distance = length(vector=delta)
        if distance < 1e-6:
            raise ValueError('degenerate jawline contour')
        if index <= 16:
            movement = F(F(F(delta*magnitude)*F(F(step)*F(.0625)))/distance)
        else:
            movement = F(F(F(F(delta*magnitude)*F(step))*F(.0625))/distance)
        source[index] += movement
    return source


def sparse_warp(*, points, covered, strength, assets):
    if (not isinstance(covered, np.ndarray) or covered.dtype != np.bool_
            or covered.shape != (len(points),)):
        raise ValueError('one coverage flag per jawline grid point required')
    xs, ys = assets['x_axis'], assets['y_axis']
    grid = np.stack(np.meshgrid(xs, ys), -1).astype(F)
    warped = grid.copy()
    warped.reshape(-1, 2)[assets['positions']] = F(warped.reshape(-1, 2)[assets['positions']]+F(assets['offsets']*F(strength)))
    active = np.zeros(grid.shape[:2], bool)
    active.reshape(-1)[assets['positions']] = True
    cells = active[:-1, :-1] | active[1:, :-1] | active[:-1, 1:] | active[1:, 1:]
    x = np.clip(np.searchsorted(xs, points[:, 0], side='right')-1, 0, len(xs)-2)
    y = np.clip(np.searchsorted(ys, points[:, 1], side='right')-1, 0, len(ys)-2)
    # Unmapped image margins retain image coordinates, not canonical coordinates.
    mask = covered & cells[y, x]
    xx, yy = x[mask], y[mask]
    tx = F(F(points[mask, 0]-xs[xx])/F(xs[xx+1]-xs[xx]))[:, None]
    ty = F(F(points[mask, 1]-ys[yy])/F(ys[yy+1]-ys[yy]))[:, None]
    top = F(F(warped[yy, xx]*F(1-tx))+F(warped[yy, xx+1]*tx))
    bottom = F(F(warped[yy+1, xx]*F(1-tx))+F(warped[yy+1, xx+1]*tx))
    result = points.copy()
    result[mask] = F(F(top*F(1-ty))+F(bottom*ty))
    return result, mask


def build_mesh(*, points, size, yaw, pitch, strength, assets):
    source = prepare(points=points, size=size, yaw=yaw, pitch=pitch, assets=assets)
    lower, upper = source[:111].min(0), source[:111].max(0)
    margin = F(F(upper-lower)*F(.15))
    lower = np.maximum(F(lower-margin), F(0))
    upper = np.minimum(F(upper+margin), np.asarray(size, F))
    ax, sx = adaptive_axis(lower=lower[0], upper=upper[0], extent=size[0])
    ay, sy = adaptive_axis(lower=lower[1], upper=upper[1], extent=size[1])
    original = np.stack(np.meshgrid(ax, ay), -1).astype(F).reshape(-1, 2)
    source = push_contour(source=source, magnitude=F(max(sx, sy)*F(1.2)))
    canonical = prepare(points=assets['base'], size=(1280, 1280), yaw=0, pitch=0, assets=assets)
    mapped, ids = map_points(points=original, source=source, target=canonical, triangles=assets['triangles'], pixel_lookup=False)
    covered = ids >= 0
    deformed, active = sparse_warp(points=mapped, covered=covered, strength=strength, assets=assets)
    mapped, ids = map_points(points=deformed, source=canonical, target=source, triangles=assets['triangles'], pixel_lookup=True)
    if np.any(ids[active] < 0):
        raise ValueError('active jawline warp requires complete inverse coverage')
    result = original.copy()
    result[active] = mapped[active]
    positions = np.pad(smooth(a=result.reshape(73, 73, 2)), ((1, 1), (1, 1), (0, 0)), mode='edge')
    uv = np.pad(smooth(a=original.reshape(73, 73, 2)), ((1, 1), (1, 1), (0, 0)), mode='edge')
    uv[1:-1, 0, 0], uv[1:-1, -1, 0] = 0, size[0]
    uv[0, 1:-1, 1], uv[-1, 1:-1, 1] = 0, size[1]
    positions, uv = positions.reshape(-1, 2), uv.reshape(-1, 2)
    vertices = np.zeros((5625, 5), F)
    vertices[:, 0] = F(F(positions[:, 0]/F(size[0]))*F(2))-F(1)
    flipped_y = F(1)-F(positions[:, 1]/F(size[1]))
    vertices[:, 1] = F(flipped_y*F(2))-F(1)
    vertices[:, 3] = uv[:, 0]/F(size[0])
    vertices[:, 4] = F(1)-F(uv[:, 1]/F(size[1]))
    corner = (np.arange(74, dtype=np.uint32)[:, None]*75+np.arange(74, dtype=np.uint32)).ravel()
    triangles = np.stack([corner, corner+76, corner+75, corner, corner+1, corner+76], 1).reshape(-1, 3).astype(np.uint16)
    # The native allocation retains 296 zero-area triangles after the active grid.
    triangles = np.vstack([triangles, np.zeros((296, 3), np.uint16)])
    coverage = {'gridPoints': len(original), 'mappedPoints': int(np.count_nonzero(covered)),
        'identityMarginPoints': int(np.count_nonzero(~covered)),
        'activePoints': int(np.count_nonzero(active)), 'activeInverseMisses': 0}
    return {'name': 'Jawline', 'vertices': vertices, 'triangles': triangles}, coverage
