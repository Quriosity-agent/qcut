"""Independent NsSlimWaist / NsSlimBody mesh leaf reconstruction (float32)."""

from dataclasses import dataclass
import math
import ctypes as C

_cosf = C.CDLL(None).cosf
_cosf.argtypes = [C.c_float]
_cosf.restype = C.c_float
import numpy as np

f = np.float32


@dataclass
class GridState:
    intensity: float = 0.35
    center: tuple = (72.0, 96.0)
    radii: tuple = (50.0, 50.0, 70.0, 70.0)
    bounds: tuple = (1.0, 143.0, 0.0, 192.0)
    strategy: int = 0
    sideways: bool = False
    flip: bool = False
    axis: tuple = (1.0, 0.0)
    perpendicular: tuple = (0.0, 1.0)
    enabled: bool = True
    active: bool = True


def regular_grid(width, height, rows, cols):
    out = np.empty((rows + 1, cols + 1, 2), np.float32)
    out[:, :, 0] = np.linspace(0, width, cols + 1, dtype=np.float32)[None]
    out[:, :, 1] = np.linspace(0, height, rows + 1, dtype=np.float32)[:, None]
    return out


def deform(src, state, kind="waist", width=None, height=None, destination=None):
    src = np.asarray(src, np.float32)
    dst = (
        src.copy()
        if destination is None
        else np.asarray(destination, np.float32).copy()
    )
    rows, cols = np.array(src.shape[:2]) - 1
    if dst.shape != src.shape:
        raise ValueError("destination must have same shape as source")
    width = f(src[0, -1, 0] if width is None else width)
    height = f(src[-1, 0, 1] if height is None else height)
    if (
        not state.enabled
        or not state.active
        or abs(f(state.intensity)) < f(np.finfo(np.float32).eps)
    ):
        return dst
    cx, cy = map(f, state.center)
    left, right, below, above = map(f, state.radii)
    xmin, xmax, ymin, ymax = map(f, state.bounds)
    s = f(state.intensity)
    xstep = f(width / f(cols))
    ystep = f(height / f(rows))
    x0 = max(0, math.ceil(float(f(xmin / xstep))))
    x1 = min(cols, math.floor(float(f(xmax / xstep))))
    y0 = max(0, math.ceil(float(f(ymin / ystep))))
    y1 = min(rows, math.floor(float(f(ymax / ystep))))
    rotated = (
        kind == "waist" and (not state.strategy & 65536) and (state.strategy == 257)
    )
    cache = {}
    for row in range(y0, y1 + 1):
        for col in range(x0, x1 + 1):
            x, y = map(f, src[row, col])
            dx = f(x - cx)
            dy = f(y - cy)
            if rotated:
                ax, ay = map(f, state.axis)
                px, py = map(f, state.perpendicular)
                vertical = f(f(dx * px) + f(dy * py))
                along = f(f(dx * ax) + f(dy * ay))
                key = math.floor(float(abs(vertical)) + 0.5)
                if key not in cache:
                    t = f(
                        min(f(abs(vertical) / (below if vertical < 0 else above)), f(1))
                    )
                    c = f(_cosf(f(float(t) * math.pi)))
                    cache[key] = f(
                        f(f(f(0.5 if vertical < 0 else 1.0) * f(c + f(1))) * f(0.5))
                    )
                yw = cache[key]
                t = f(min(f(abs(along) / (left if along < 0 else right)), f(1)))
                ww = f(min(f(yw * f(f(f(1) - t) * f(f(1) - f(t * t)))), f(0.6)))
                dst[row, col, 0] = f(dst[row, col, 0] - f(f(f(ax * along) * ww) * s))
                dst[row, col, 1] = f(dst[row, col, 1] - f(f(f(ay * along) * ww) * s))
            elif kind == "waist":
                t = f(min(f(abs(dy) / (below if y <= cy else above)), f(1)))
                c = f(_cosf(f(float(t) * math.pi)))
                yw = f(f(c + f(1)) * f(0.5))
                t = f(min(f(abs(dx) / (left if x < cx else right)), f(1)))
                ww = f(min(f(yw * f(f(f(1) - t) * f(f(1) - f(t * t)))), f(0.6)))
                dst[row, col, 0] = f(dst[row, col, 0] + f(s * f(f(cx - x) * ww)))
            elif not state.sideways or state.strategy & 65536:
                t = f(min(f(abs(dy) / (below if y <= cy else above)), f(1)))
                yw = f(1) if y <= cy else f(f(1) - f(t * t))
                t = f(min(f(abs(dx) / (left if x < cx else right)), f(1)))
                ww = f(min(f(yw * f(f(f(1) - t) * f(f(1) - f(t * t)))), f(0.3)))
                dst[row, col, 0] = f(dst[row, col, 0] + f(s * f(f(cx - x) * ww)))
            else:
                side = bool(x > cx) if not state.flip else bool(x < cx)
                t = f(min(f(abs(dx) / (left if side else right)), f(1)))
                xw = f(f(1) - f(t * t)) if side else f(1)
                denom = f((below if y <= cy else above) * f(0.6))
                t = f(min(f(abs(dy) / denom), f(1)))
                ww = f(min(f(xw * f(f(f(1) - t) * f(f(1) - f(t * t)))), f(0.2)))
                if y <= cy:
                    ww = f(ww * f(0.4))
                dst[row, col, 1] = f(dst[row, col, 1] + f(s * f(f(cy - y) * ww)))
    return dst
