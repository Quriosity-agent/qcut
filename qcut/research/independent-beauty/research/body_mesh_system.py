"""System mesh post-processing: optional two-sweep smoothing, pinned boundaries and rotation.
The deltas must already be in the rotation-adjusted grid."""
import numpy as np
from body_mesh_grid import pin_boundary_deltas
F = np.float32

def smooth_deltas(deltas):
    out = np.array(deltas, np.float32, copy=True)
    rows, cols = np.array(out.shape[:2]) - 1
    alpha = F(min(F(F(rows + cols) / F(200)), F(1)))
    denominator = F(F(alpha * F(8)) + F(1))

    def at(row, col):
        return out[min(max(row, 0), rows), min(max(col, 0), cols)]
    for reverse in [False, True]:
        ys = range(rows, -1, -1) if reverse else range(rows + 1)
        xs = range(cols, -1, -1) if reverse else range(cols + 1)
        for r in ys:
            for c in xs:
                total = F(at(r - 1, c - 1) + at(r - 1, c))
                for rr, cc in [(r - 1, c + 1), (r, c - 1), (r, c + 1), (r + 1, c - 1), (r + 1, c), (r + 1, c + 1)]:
                    total = F(total + at(rr, cc))
                total = F(total * alpha)
                total = F(total + at(r, c))
                out[r, c] = F(total / denominator)
    return out

def apply_system_deltas(base, deltas, rotation=0, skip_smoothing=False):
    """Matches system postprocess only, not full per-body interaction/grouping."""
    base = np.asarray(base, np.float32)
    rows, cols = np.array(base.shape[:2]) - 1
    expected = (cols + 1, rows + 1, 2) if rotation in (1, 3) else base.shape
    if rotation not in range(4) or deltas.shape != expected:
        raise ValueError('rotation/grid shape mismatch')
    delta = pin_boundary_deltas(deltas if skip_smoothing else smooth_deltas(deltas))
    out = base.copy()
    for r in range(delta.shape[0]):
        for c in range(delta.shape[1]):
            x, y = delta[r, c]
            if rotation == 0:
                rr, cc, dx, dy = (r, c, x, y)
            elif rotation == 1:
                rr, cc, dx, dy = (c, cols - r, F(-y), x)
            elif rotation == 2:
                rr, cc, dx, dy = (rows - r, cols - c, F(-x), F(-y))
            else:
                rr, cc, dx, dy = (rows - c, r, y, F(-x))
            out[rr, cc] = F(base[rr, cc] + np.array([dx, dy], np.float32))
    return out
