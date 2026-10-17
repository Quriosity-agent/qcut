"""Shoulder width: the shoulder displacement fused with its cached raw grid."""
import ctypes as C, math
import numpy as np
F = np.float32
libm = C.CDLL(None)
for n in ['cosf', 'sinf']:
    fn = getattr(libm, n)
    fn.argtypes = [C.c_float]
    fn.restype = C.c_float

def length(v):
    return F(np.sqrt(F(F(v[0] * v[0]) + F(v[1] * v[1]))))

def rotate(v, angle):
    c = F(libm.cosf(float(angle)))
    s = F(libm.sinf(float(angle)))
    return F([F(F(v[0] * c) - F(v[1] * s)), F(F(v[0] * s) + F(v[1] * c))])

def extended_unit(v):
    return F(v / F(float(length(v)) + 0.001))

def kernel(p, center, movement, movement_length, radius, strength, inside=True):
    distance = length(F(p - center))
    den = F(radius * (F(1) if inside else F(0.2)))
    ratio = F(distance / den)
    if ratio > F(1):
        return np.zeros(2, np.float32)
    out = F(F(movement * F(F(1) - ratio)) * F(strength))
    if inside:
        dv = F(p - center)
        dot = F(F(movement[0] * dv[0]) + F(movement[1] * dv[1]))
        with np.errstate(invalid='ignore', divide='ignore'):
            cosine = F(float(dot) / (float(F(movement_length)) * float(length(dv))))
        if float(cosine) > -0.3:
            out = F(out * F(float(F(F(1) - cosine)) / 1.3))
    return out

def raw_geometry(source, state):
    src = F(source)
    rows, cols = np.asarray(src.shape[:2]) - 1
    w, h = src[-1, -1]
    neck, left, right, elbow_l, elbow_r = F(state['points'])
    intensity = F(state['intensity'])
    delta = np.zeros_like(src)
    if not state['enabled'] or abs(float(intensity)) < 1e-06:
        return (False, delta, (0, 0, 0, 0))
    invalid = lambda p: bool(p[0] == F(-1) and p[1] == F(-1))
    if invalid(left) or invalid(right) or np.array_equal(left, right):
        return (False, delta, (0, 0, 0, 0))
    if state.get('segmentation', False):
        raise NotImplementedError('Segmentation mask mapping pending parity')
    v = F(left - right)
    factor = F(F(F(length(v) + length(v)) / F(F(w) + F(h))) + F(1e-06))
    scale = F(min(factor, F(0.33286)) / factor)
    if factor < F(0.2143):
        scale = F(scale * F(min(float(F(F(0.2143) - factor)) * 4.2 + 1, 1.5)))
    v = F(F(v * scale) * F(0.08))
    strength = intensity if intensity > 0 else F(float(intensity) * 0.6)
    flip = state['flip']
    angle = F(F(30) * F(0.01745329238474369))
    weight = [F(float(F(x)) / 1.8) for x in [0.7, 0.7, 0.6, 0.6, 0.4, 0.4, 0.2, 0.2, 0.1, 0.1, 0, 0]]
    xmin = ymin = 100000000
    xmax = ymax = -100000000
    dx = F(w / F(cols))
    dy = F(h / F(rows))
    for side, (shoulder, elbow, basev) in enumerate([(left, elbow_l, v), (right, elbow_r, F(-v))]):
        if invalid(elbow):
            continue
        radius = F(max(float(length(F(shoulder - elbow))) * 0.3499999940395355, float(length(F(left - right))) * 0.25))
        rotangle = angle if side == 0 and flip or (side == 1 and (not flip)) else F(-angle)
        start = F(shoulder + F(F(extended_unit(rotate(basev, rotangle)) * radius) * F(0.85)))
        end = F(elbow + F(F(extended_unit(basev) * radius) * F(0.3)))
        move = basev.copy()
        if intensity <= 0:
            sign = 1 if side == 0 and (not flip) or (side == 1 and flip) else -1
            c, s = (F(0.9961947202682495), F(sign * 0.08715573698282242))
            move = F([F(F(basev[0] * c) - F(basev[1] * s)), F(F(basev[0] * s) + F(basev[1] * c))])
        move_len = length(move)
        for i in range(10):
            center = F(start + F(F(F(end - start) * F(i)) / F(12)))
            minr = max(0, math.ceil(float(F(F(center[1] - radius) / dy))))
            maxr = min(rows, math.floor(float(F(F(center[1] + radius) / dy))))
            minc = max(0, math.ceil(float(F(F(center[0] - radius) / dx))))
            maxc = min(cols, math.floor(float(F(F(center[0] + radius) / dx))))
            xmin = min(xmin, minc)
            ymin = min(ymin, minr)
            xmax = max(xmax, maxc)
            ymax = max(ymax, maxr)
            for r in range(minr, maxr + 1):
                for c in range(minc, maxc + 1):
                    delta[r, c] = F(delta[r, c] + kernel(src[r, c], center, F(move * weight[i]), F(move_len * weight[i]), radius, strength))
    return (True, delta, (max(xmin - 2, 0), max(ymin - 2, 0), min(xmax + 2, cols + 1), min(ymax + 2, rows + 1)))

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
    on, raw, bounds = raw_geometry(source, state)
    if not state.get('history_invalid', True):
        raise NotImplementedError('Temporal history fusion requires independent previous-grid state')
    output = smooth(raw, bounds) if on else raw
    return (on, output if destination is None else F(F(destination) + output))

class HistoryCounter:

    def __init__(self):
        self.value = 0
GLOBAL_HISTORY_COUNTER = HistoryCounter()

class WidenHistory:
    """Independent native cached-raw-grid fusion; caller owns shared counter."""

    def __init__(self, counter=None):
        self.raw = None
        self.bounds = None
        self.counter = counter if counter is not None else GLOBAL_HISTORY_COUNTER
        self.alpha = None

    def step(self, source, state, destination=None):
        on, raw, bounds = raw_geometry(source, state)
        rows, cols = np.asarray(raw.shape[:2]) - 1
        if self.raw is None or state.get('history_invalid', True):
            self.raw = raw.copy()
            self.bounds = bounds
            self.alpha = None
        else:
            old = self.raw
            ol, ot, orr, ob = self.bounds
            l, t, right, bottom = bounds
            if not on:
                l, t, right, bottom = (ol, ot, orr, ob)
            bounds = (max(min(l, ol), 0), max(min(t, ot), 0), min(max(right, orr), cols + 1), min(max(bottom, ob), rows + 1))
            l, t, right, bottom = bounds
            lanes = np.zeros(4, np.float32)
            tail = F(0)
            for r in range(t, bottom):
                c = l
                while c + 1 < right:
                    values = np.abs(F(raw[r, c:c + 2] - old[r, c:c + 2])).reshape(4)
                    lanes = F(lanes + values)
                    c += 2
                if c < right:
                    d = np.abs(F(raw[r, c] - old[r, c]))
                    tail = F(tail + F(d[0] + d[1]))
            total = F(F(F(lanes[0] + lanes[1]) + lanes[2]) + lanes[3])
            total = F(tail + total)
            mean = F(F(F(total / F((rows + 1) * (cols + 1))) * F(10201)) / F(F(source[-1, -1, 0]) + F(source[-1, -1, 1])))
            alpha = F(min(0.25 / (float(mean) + 1e-06), 1.0))
            self.alpha = float(alpha)
            inv = F(F(1) - alpha)
            for r in range(t, bottom):
                for c in range(l, right):
                    raw[r, c] = F(F(old[r, c] * inv) + F(raw[r, c] * alpha))
            self.raw = raw.copy()
            self.counter.value += 1
            if self.counter.value % 15 == 0:
                xmin = ymin = 100000000
                xmax = ymax = -100000000
                for r in range(t, bottom):
                    c = l
                    while c + 1 < right:
                        a = F(abs(raw[r, c, 0]) + abs(raw[r, c, 1]))
                        b = F(abs(raw[r, c + 1, 0]) + abs(raw[r, c + 1, 1]))
                        if a > F(1e-06) or b > F(1e-06):
                            xmin = min(xmin, c)
                            xmax = max(xmax, c + 1)
                            ymin = min(ymin, r)
                            ymax = max(ymax, r)
                        c += 2
                    if c < right and F(abs(raw[r, c, 0]) + abs(raw[r, c, 1])) > F(1e-06):
                        xmin = min(xmin, c)
                        xmax = max(xmax, c)
                        ymin = min(ymin, r)
                        ymax = max(ymax, r)
                bounds = (max(xmin - 2, 0), max(ymin - 2, 0), min(ymax + 3, rows + 1), min(xmax + 3, cols + 1))
                bounds = (bounds[0], bounds[1], bounds[3], bounds[2])
            self.bounds = bounds
        result = smooth(raw, self.bounds) if self.bounds[2] > self.bounds[0] and self.bounds[3] > self.bounds[1] else raw
        if on:
            state['history_invalid'] = False
        return (on, result if destination is None else F(F(destination) + result))
