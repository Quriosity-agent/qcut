"""Reuse the owned body's grid and boundary arithmetic for all ten parts."""

from body_mesh_grid import make_grid as shared_grid, pin_boundary_deltas


def make_grid(width, height, rows=30, cols=30):
    base, uv, triangles, _ = shared_grid(width, height, rows, cols)
    return base, uv, triangles.astype("uint32")


def compose_positions(*, base, delta):
    # The installed bit16 profile skips global smoothing; each shoulder leaf
    # has already performed its own ordered smoothing before accumulation.
    return base + pin_boundary_deltas(delta)
