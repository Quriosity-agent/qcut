"""Shared shoulder two-sweep SIMD-order smoothing; operation order is significant."""

import numpy as np

F = np.float32


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
        for rr, cc in [
            (r - 1, c + 1),
            (r, c - 1),
            (r, c + 1),
            (r + 1, c - 1),
            (r + 1, c),
            (r + 1, c + 1),
        ]:
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
