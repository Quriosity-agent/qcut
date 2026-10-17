"""Small head: the radial displacement around the head."""
import numpy as np, ctypes as C, math
F = np.float32
lib = C.CDLL(None)
lib.powf.argtypes = [C.c_float, C.c_float]
lib.powf.restype = C.c_float
lib.cosf.argtypes = [C.c_float]
lib.cosf.restype = C.c_float

def deform(source, state, destination=None):
    src = np.asarray(source, np.float32)
    dst = np.zeros_like(src) if destination is None else np.array(destination, np.float32, copy=True)
    if state.get('protection'):
        raise NotImplementedError('Separate populated protection constraint is required')
    intensity = F(state['intensity'])
    if not state['enabled'] or not state['valid'] or abs(intensity) < F(2 ** (-23)):
        return (False, dst)
    rows, cols = np.array(src.shape[:2]) - 1
    W, H = src[-1, -1]
    xs, ys = (F(W / F(cols)), F(H / F(rows)))
    left, right, bottom, top = map(F, state['bounds'])
    cx, cy = map(F, state['center'])
    rl, rr, rb, rt = map(F, state['radii'])
    cap, gain = map(F, [state['limit'], state['gain']])
    ri0 = max(0, int(np.ceil(F(bottom / ys))))
    ri1 = min(rows, int(np.floor(F(top / ys))))
    ci0 = max(0, int(np.ceil(F(left / xs))))
    ci1 = min(cols, int(np.floor(F(right / xs))))
    for row in range(ri0, ri1 + 1):
        v = F(-1)
        for col in range(ci0, ci1 + 1):
            x, y = src[row, col]
            if v < F(0):
                with np.errstate(divide='ignore', invalid='ignore'):
                    v = F(np.fmin(F(abs(F(y - cy)) / (rb if y <= cy else rt)), F(1)))
                narrow = F(lib.powf(float(F(F(1) - v)), float(F(0.3)))) if y <= cy else F(1)
                vertical = F(F(1) - F(v * v))
            with np.errstate(divide='ignore', invalid='ignore'):
                u = F(np.fmin(F(abs(F(x - cx)) / F(narrow * (rl if x < cx else rr))), F(1)))
            cosine = F(lib.cosf(float(F(float(u) * math.pi))))
            wx = F(np.fmin(F(vertical * F(F(1) - u)), cap))
            wy = F(np.fmin(F(F(F(1) - v) * F(F(cosine + F(1)) * F(0.5))), cap))
            dx = F(gain * F(intensity * F(F(cx - x) * F(wx * F(0.8)))))
            dy = F(gain * F(intensity * F(F(cy - y) * wy)))
            dst[row, col] = F(dst[row, col] + F([dx, dy]))
    return (True, dst)
