"""The body mesh: vertices, UVs and triangles, NDC packing and pinned boundaries."""
import numpy as np
F = np.float32

def make_grid(width, height, rows, cols):
    if min(width, height, rows, cols) <= 0 or (rows + 1) * (cols + 1) > 4096 or rows * cols * 2 > 4096:
        raise ValueError('positive bounded dimensions/grid required')
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
    lines = []
    for row in range(rows):
        for col in range(cols):
            a = row * (cols + 1) + col
            b = a + 1
            c = a + cols + 1
            d = c + 1
            triangles.extend([(a, c, d), (a, d, b)])
            lines.extend([a, b, a, c, c, d, b, d])
    return (base, uv, np.array(triangles, np.int32), np.array(lines, np.int32))

def pack_vertices(positions, uv, width, height):
    p = np.asarray(positions, dtype=np.float32).reshape(-1, 2)
    uv = np.asarray(uv, dtype=np.float32).reshape(-1, 2)
    if p.shape != uv.shape or min(width, height) <= 0:
        raise ValueError('geometry mismatch')
    norm = p / np.array([width, height], np.float32)
    out = np.empty((len(p), 5), np.float32)
    out[:, :2] = F(norm + norm) - F(1)
    out[:, 2] = F(0)
    out[:, 3:] = uv
    return out

def pin_boundary_deltas(deltas):
    d = np.array(deltas, dtype=np.float32, copy=True)
    d[0, :, 1] = np.fmin(d[0, :, 1], F(0))
    d[-1, :, 1] = np.where(d[-1, :, 1] <= F(0), F(0), d[-1, :, 1])
    d[:, 0, 0] = np.fmin(d[:, 0, 0], F(0))
    d[:, -1, 0] = np.where(d[:, -1, 0] <= F(0), F(0), d[:, -1, 0])
    return d
