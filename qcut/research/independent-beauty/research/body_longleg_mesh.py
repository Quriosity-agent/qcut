"""The long-leg mesh: a 30x30 grid whose vertices below the leg pivot move down.

QCut-owned float32 port of the measured mesh arithmetic. Grid vertices use the y-up
convention of the leg state; only their y changes. Above the pivot (towards the feet,
since y grows upward from the bottom edge) each row's weight is 1 - 1/(1 + strength)
times the vertex's distance from the pivot; between the pivot and the end height the
weight tapers to zero. The first vertex of a row decides the row's weight. The system
pass then pins the frame edges (vertices on the border may only move inwards) and adds
the deltas to the base grid. UVs stay on the regular grid, so drawing the moved grid
samples the source photo stretched over the legs.
"""
import numpy as np

F = np.float32
ZERO, ONE = F(0), F(1)
NEAR_ZERO = F(2 ** -23)
GRID_ROWS = GRID_COLS = 30


def make_grid(width, height, rows=GRID_ROWS, cols=GRID_COLS):
    """Base vertex positions (pixels, y up), UVs and triangles of a rows x cols grid."""
    if min(width, height, rows, cols) <= 0 or (rows + 1) * (cols + 1) > 4096 or rows * cols * 2 > 4096:
        raise ValueError('positive bounded dimensions and grid required')
    x = F(F(width) / F(cols)) * np.arange(cols + 1, dtype=np.float32)
    x[-1] = F(width)
    y = F(F(height) / F(rows)) * np.arange(rows + 1, dtype=np.float32)
    y[-1] = F(height)
    u = np.arange(cols + 1, dtype=np.float32) / F(cols)
    u[-1] = F(1)
    v = np.arange(rows + 1, dtype=np.float32) / F(rows)
    v[-1] = F(1)
    base = np.stack(np.meshgrid(x, y), axis=-1).astype(np.float32)
    uv = np.stack(np.meshgrid(u, v), axis=-1).astype(np.float32)
    triangles = []
    for row in range(rows):
        for col in range(cols):
            a = row * (cols + 1) + col
            b, c = a + 1, a + cols + 1
            triangles.extend([(a, c, c + 1), (a, c + 1, b)])
    return base, uv, np.array(triangles, np.uint32)


def _last_index(extent, dimension, count):
    q = F(F(extent) / F(F(dimension) / F(count)))
    if np.isnan(q) or q <= ZERO:
        return 0
    if q >= F(count):
        return count
    return int(np.floor(q))


def leg_deltas(grid, width, height, state):
    """Per-vertex (0, dy) displacement of the long-leg deformer; None when it does nothing."""
    src = np.asarray(grid, np.float32)
    rows, cols = src.shape[0] - 1, src.shape[1] - 1
    strength = F(state.intensity)
    if not state.active or np.abs(strength) < NEAR_ZERO:
        return None
    end, pivot = F(state.end), F(state.pivot)
    ax, ay = F(state.foot[0]), F(state.foot[1])
    out = np.zeros_like(src)
    with np.errstate(divide='ignore', invalid='ignore', over='ignore'):
        for row in range(_last_index(end, height, rows) + 1):
            weight = F(-1)
            for col in range(_last_index(state.width, width, cols) + 1):
                y = src[row, col, 1]
                if weight < ZERO:
                    if y <= pivot:
                        weight = F(ONE - F(ONE / F(strength + ONE)))
                        if state.strategy == 0x100 and not (ax == F(-1) and ay == F(-1)) and ay < pivot:
                            t = F(F(pivot - y) / pivot)
                            weight = F(weight * np.fmin(F(F(t * t) + F(t * F(ay / pivot))), ONE))
                    else:
                        weight = F(np.fmin(F(F(end - y) / F(end - pivot)), ONE) * strength)
                out[row, col, 1] = F(out[row, col, 1] + F(weight * F(y - pivot)))
    return out


def pin_edges(deltas):
    """Border vertices may only move inwards (bottom/left: not below 0; top/right: not above 0)."""
    d = np.array(deltas, dtype=np.float32, copy=True)
    d[0, :, 1] = np.fmin(d[0, :, 1], F(0))
    d[-1, :, 1] = np.where(d[-1, :, 1] <= F(0), F(0), d[-1, :, 1])
    d[:, 0, 0] = np.fmin(d[:, 0, 0], F(0))
    d[:, -1, 0] = np.where(d[:, -1, 0] <= F(0), F(0), d[:, -1, 0])
    return d


def ndc_vertices(positions, uv, width, height):
    """Interleaved (x, y, z, u, v) float32 vertices in normalized device coordinates."""
    p = np.asarray(positions, dtype=np.float32).reshape(-1, 2)
    t = np.asarray(uv, dtype=np.float32).reshape(-1, 2)
    norm = p / np.array([width, height], np.float32)
    out = np.empty((len(p), 5), np.float32)
    out[:, :2] = F(norm + norm) - F(1)
    out[:, 2] = F(0)
    out[:, 3:] = t
    return out


def leg_mesh(width, height, state):
    """Vertices and triangles of the long-leg warp, or None when the state changes nothing."""
    base, uv, triangles = make_grid(width, height)
    deltas = leg_deltas(base, width, height, state)
    if deltas is None:
        return None
    return ndc_vertices(base + pin_edges(deltas), uv, width, height), triangles
