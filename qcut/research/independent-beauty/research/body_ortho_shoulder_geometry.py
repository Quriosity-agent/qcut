"""Square shoulders: the two-station radial displacement around each shoulder."""
import numpy as np, ctypes as C
from body_ortho_shoulder_radial import displace, Pair, norm
F = np.float32
_system = C.CDLL(None)
_system.__sincosf_stret.argtypes = [C.c_float]
_system.__sincosf_stret.restype = Pair

def rotate(v, a):
    sc = _system.__sincosf_stret(float(F(a)))
    s, c = (F(sc.x), F(sc.y))
    return F([F(F(v[0] * c) - F(v[1] * s)), F(F(v[0] * s) + F(v[1] * c))])

def raw_deform(source, state):
    if state.get('mask_enabled', False) or state.get('mask') is not None:
        raise NotImplementedError('Populated OrthoShoulder mask/protection is outside the verified no-mask profile')
    src = np.asarray(source, np.float32)
    out = np.zeros_like(src)
    rows, cols = np.array(src.shape[:2]) - 1
    W, H = src[-1, -1]
    xs, ys = (F(W / F(cols)), F(H / F(rows)))
    neck, left, right, el, er = np.asarray(state['points'], np.float32)
    if abs(state['intensity']) < 2 ** (-23) or np.all(neck == F(-1)):
        return (False, out, (0, 0, 0, 0))
    present = [not np.all(x == F(-1)) for x in [left, right]]
    common = F(norm(F(left - right)) / F(1.95)) if all(present) else F(-100000000.0)
    gain = F(0.156) if 0 < state['turn'] < 0.8 else F(0.12000000476837158)
    minrow, mincol = (10 ** 8, 10 ** 8)
    maxrow, maxcol = (-10 ** 8, -10 ** 8)
    for arm, shoulder in enumerate([left, right]):
        if not present[arm]:
            continue
        length = norm(F(neck - shoulder))
        unit = F(F(neck - shoulder) / length)
        L = F(F(common + length) * F(0.5)) if common > 0 else length
        theta = F((1 if (not state['status50']) ^ bool(arm) else -1) * F(1.919862151145935))
        vector = F(rotate(unit, theta) * F(gain * L))
        un = F(unit / norm(unit))
        if arm == 0:
            offset = F(F(F(un * L) * F(-0.1)) + F(1e-06))
        else:
            offset = F(F(1e-06) - F(F(L * un) * F(0.1)))
        co, si = (F(0.9396926164627075), F(0.3420201241970062))
        if arm == 0:
            offset = F([F(F(offset[0] * co) + F(offset[1] * si)), F(F(offset[1] * co) - F(offset[0] * si))])
        else:
            offset = F([F(F(offset[0] * co) - F(offset[1] * si)), F(F(offset[0] * si) + F(offset[1] * co))])
        start = F(shoulder + offset)
        radius = F(L * F(0.4))
        anchor = F(shoulder + F(neck - shoulder))
        for station, weight in enumerate([F(1), F(0.3)]):
            center = F(start + F(F(F(neck - start) * F(0.5)) * F(station)))
            lo = np.maximum(np.ceil(F(F(center - radius) / F([xs, ys]))).astype(int), 0)
            hi = np.minimum(np.floor(F(F(center + radius) / F([xs, ys]))).astype(int), [cols, rows])
            mincol = min(mincol, int(lo[0]))
            minrow = min(minrow, int(lo[1]))
            maxcol = max(maxcol, int(hi[0]))
            maxrow = max(maxrow, int(hi[1]))
            for row in range(int(lo[1]), int(hi[1]) + 1):
                for col in range(int(lo[0]), int(hi[0]) + 1):
                    out[row, col] = F(out[row, col] + displace(src[row, col], center, vector, anchor, radius, F(F(state['intensity']) * weight), (1 if state['status50'] else -1) * (-1 if arm else 1)))
    bounds = (max(mincol, 2) - 2, max(minrow, 2) - 2, min(maxcol + 2, cols + 1), min(maxrow + 2, rows + 1))
    return (True, out, bounds)

def smooth(raw, bounds):
    out = np.array(raw, np.float32, copy=True)
    rows, cols = np.asarray(out.shape[:2]) - 1
    l, t, right, bottom = bounds
    alpha = F(min(F(F(rows + cols) / F(200)), F(1)))
    den = F(F(alpha * F(8)) + F(1))

    def at(r, c):
        return out[min(max(r, 0), rows), min(max(c, 0), cols)]
    recip = F(F(1) / den)

    def calc(r, c, vectorized=False):
        total = F(at(r - 1, c - 1) + at(r - 1, c))
        for rr, cc in [(r - 1, c + 1), (r, c - 1), (r, c + 1), (r + 1, c - 1), (r + 1, c), (r + 1, c + 1)]:
            total = F(total + at(rr, cc))
        result = F(F(total * alpha) + at(r, c))
        return F(result * recip) if vectorized else F(result / den)
    for reverse in [False, True]:
        for r in range(bottom - 1, t - 1, -1) if reverse else range(t, bottom):
            if l == 0:
                out[r, 0] = calc(r, 0)
            if right == cols + 1:
                out[r, cols] = calc(r, cols)
            start = max(l, 1)
            end = min(right, cols)
            if not reverse:
                c = start
                while c + 1 < end:
                    first, second = (calc(r, c, True), calc(r, c + 1, True))
                    out[r, c] = first
                    out[r, c + 1] = second
                    c += 2
                while c < end:
                    out[r, c] = calc(r, c)
                    c += 1
            else:
                c = end - 2
                while c >= start:
                    first, second = (calc(r, c, True), calc(r, c + 1, True))
                    out[r, c] = first
                    out[r, c + 1] = second
                    c -= 2
                while c >= start:
                    out[r, c] = calc(r, c)
                    c -= 1
    return out

def deform(source, state, destination=None):
    on, raw, bounds = raw_deform(source, state)
    out = np.zeros_like(source, dtype=np.float32) if destination is None else np.array(destination, np.float32, copy=True)
    if not on:
        return (False, out)
    return (True, F(out + smooth(raw, bounds)))
