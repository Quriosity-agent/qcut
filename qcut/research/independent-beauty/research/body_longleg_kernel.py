"""Long legs: vertical mesh displacement around the pivot, tapering to the end height."""
from dataclasses import dataclass
import numpy as np
F = np.float32
ZERO, ONE = (F(0), F(1))
NEAR_ZERO = F(2 ** (-23))

@dataclass(frozen=True)
class LongLegState:
    intensity: float = 0.35
    enabled: bool = True
    valid: bool = True
    extent_x: float = 144.0
    end_y: float = 192.0
    pivot_y: float = 128.0
    lower_multiplier: float = 1.0
    strategy: int = 0
    auxiliary_x: float = -1.0
    auxiliary_y: float = -1.0

def regular_grid(width, height, rows, cols):
    """Convenience input only: vertex coordinates from inclusive linear spacing."""
    if min(width, height, rows, cols) <= 0:
        raise ValueError('positive width, height, rows and cols required')
    g = np.empty((rows + 1, cols + 1, 2), dtype=np.float32)
    g[..., 0] = np.linspace(0, width, cols + 1, dtype=np.float32)[None, :]
    g[..., 1] = np.linspace(0, height, rows + 1, dtype=np.float32)[:, None]
    return g

def _last_index(extent, dimension, count):
    q = F(F(extent) / F(F(dimension) / F(count)))
    if np.isnan(q) or q <= ZERO:
        return 0
    if q >= F(count):
        return count
    return int(np.floor(q))

def displace(source, width, height, state, destination=None):
    """Return (changed_state, float32 output), without mutating inputs.

    source is the immutable reference mesh, destination can already contain other
    deformations. Only output Y receives a delta. Nonnegative row weight is reused
    across a row, a behavior observable on meshes deformed by earlier effects.
    changed_state is the native function's 0/1 result, not a pixel-change claim.
    """
    src = np.asarray(source)
    if src.dtype != np.float32 or src.ndim != 3 or src.shape[-1] != 2:
        raise ValueError('source must be float32 [rows+1, cols+1, 2]')
    rows, cols = (src.shape[0] - 1, src.shape[1] - 1)
    if min(width, height, rows, cols) <= 0:
        raise ValueError('positive dimensions and at least one grid cell required')
    out = np.array(src if destination is None else destination, dtype=np.float32, copy=True)
    if out.shape != src.shape:
        raise ValueError('destination and source shapes differ')
    strength = F(state.intensity)
    if not state.enabled or not state.valid or np.abs(strength) < NEAR_ZERO:
        return (False, out)
    end, pivot = (F(state.end_y), F(state.pivot_y))
    ay, ax = (F(state.auxiliary_y), F(state.auxiliary_x))
    last_row = _last_index(end, height, rows)
    last_col = _last_index(state.extent_x, width, cols)
    with np.errstate(divide='ignore', invalid='ignore', over='ignore'):
        for row in range(last_row + 1):
            weight = F(-1)
            for col in range(last_col + 1):
                y = src[row, col, 1]
                if weight < ZERO:
                    if y <= pivot:
                        weight = F(ONE - F(ONE / F(strength + ONE)))
                        if state.strategy == 256 and (not (ax == F(-1) and ay == F(-1))) and (ay < pivot):
                            t = F(F(pivot - y) / pivot)
                            attenuation = np.fmin(F(F(t * t) + F(t * F(ay / pivot))), ONE)
                            weight = F(weight * attenuation)
                    else:
                        taper = np.fmin(F(F(end - y) / F(end - pivot)), ONE)
                        weight = F(F(taper * strength) * F(state.lower_multiplier))
                delta = F(weight * F(y - pivot))
                out[row, col, 1] = F(out[row, col, 1] + delta)
    return (True, out)
