"""Square shoulders across frames: the state and its cached displacement."""
import copy, ctypes as C
import numpy as np
from body_ortho_shoulder_state import prepare
from body_ortho_shoulder_geometry import raw_deform, smooth
F = np.float32
lib = C.CDLL(None)
lib.powf.argtypes = [C.c_float, C.c_float]
lib.powf.restype = C.c_float

def approach(old, target, step):
    old, target, step = map(F, (old, target, step))
    delta = F(old - target)
    if abs(delta) < F(1e-06):
        return target
    power = F(max(F(lib.powf(float(step), float(F(abs(delta) + F(1))))), F(0.02)))
    return F(max(target, F(old - F(power * step)))) if target <= old else F(min(target, F(F(power * step) + old)))

class OrthoSequence:

    def __init__(self, initial_turn=0):
        self.geometry = OrthoGeometry()
        self.state = {'intensity': 0.0, 'points': np.zeros((5, 2), F).tolist(), 'flags': [0] * 5, 'status50': False, 'turn': float(F(initial_turn)), 'dirty': True}

    def update(self, part, public, target=0.5, status50=False, step=2.0, mode=1):
        fresh = prepare(part, public, 0, status50, self.state['turn'])
        old = F(self.state['intensity'])
        dirty = bool(self.state['dirty'])
        self.state = fresh
        self.state['intensity'] = float(approach(old, target, step))
        self.state['dirty'] = dirty or old != F(target)
        return copy.deepcopy(self.state)

    def deform(self, source, state=None, destination=None):
        state = self.state if state is None else state
        result = self.geometry.deform(source, state, destination)
        self.state = state
        return result

class OrthoGeometry:
    """Raw delta cache; counter corresponds to native process-global stable calls."""

    def __init__(self, counter=0):
        self.cache = None
        self.bounds = (99999998, 99999998, -99999998, -99999998)
        self.counter = counter

    def deform(self, source, state, destination=None):
        src = np.asarray(source, F)
        on, raw, bounds = raw_deform(src, state)
        rows, cols = np.array(src.shape[:2]) - 1
        W, H = src[-1, -1]
        dst = np.zeros_like(src) if destination is None else np.array(destination, F, copy=True)
        if self.cache is not None and self.cache.shape != src.shape:
            raise NotImplementedError('Grid resize requires explicit OrthoGeometry reset')
        if state['dirty'] or self.cache is None:
            self.cache = raw.copy()
            self.bounds = bounds if on else (99999998, 99999998, -99999998, -99999998)
        else:
            left, top, right, bottom = bounds if on else (99999998, 99999998, -99999998, -99999998)
            ol, ot, orr, ob = self.bounds
            left = max(0, min(left, ol))
            top = max(0, min(top, ot))
            right = min(cols + 1, max(right, orr))
            bottom = min(rows + 1, max(bottom, ob))
            right = min(cols + 1, max(bounds[2] if on else -100000000, orr))
            bottom = min(rows + 1, max(bounds[3] if on else -100000000, ob))
            sums = np.zeros(4, F)
            tail = F(0)
            for r in range(top, bottom):
                c = left
                while c + 1 < right:
                    d = abs(F(raw[r, c:c + 2] - self.cache[r, c:c + 2])).reshape(4)
                    sums = F(sums + d)
                    c += 2
                while c < right:
                    d = abs(F(raw[r, c] - self.cache[r, c]))
                    tail = F(tail + F(d[0] + d[1]))
                    c += 1
            total = F(tail + F(sums[3] + F(sums[2] + F(sums[0] + sums[1]))))
            mean = F(F(F(total / F((rows + 1) * (cols + 1))) * F(10201)) / F(F(W) + F(H)))
            weight = F(min(0.25 / (float(mean) + 1e-06), 1.0))
            fresh = raw.copy()
            fresh[top:bottom, left:right] = F(F(raw[top:bottom, left:right] * weight) + F(self.cache[top:bottom, left:right] * F(F(1) - weight)))
            self.cache[top:bottom, left:right] = fresh[top:bottom, left:right]
            self.counter += 1
            if self.counter % 15 == 0:
                minc, minr, maxc, maxr = (100000000, 100000000, -100000000, -100000000)
                for r in range(top, bottom):
                    c = left
                    while c + 1 < right:
                        if F(abs(fresh[r, c]).sum(dtype=F)) > F(1e-06) or F(abs(fresh[r, c + 1]).sum(dtype=F)) > F(1e-06):
                            minc = min(minc, c)
                            maxc = max(maxc, c + 1)
                            minr = min(minr, r)
                            maxr = max(maxr, r)
                        c += 2
                    while c < right:
                        if F(abs(fresh[r, c]).sum(dtype=F)) > F(1e-06):
                            minc = min(minc, c)
                            maxc = max(maxc, c)
                            minr = min(minr, r)
                            maxr = max(maxr, r)
                        c += 1
                left = max(minc, 2) - 2
                top = max(minr, 2) - 2
                right = min(maxc + 3, cols + 1)
                bottom = min(maxr + 3, rows + 1)
            self.bounds = (left, top, right, bottom)
            raw = fresh
        if on:
            state['dirty'] = False
        self.last_raw = self.cache.copy()
        self.last_weight = locals().get('weight', F(1))
        smoothed = smooth(raw, self.bounds)
        left, top, right, bottom = self.bounds
        dst[top:bottom, left:right] = F(dst[top:bottom, left:right] + smoothed[top:bottom, left:right])
        return (on, dst)
