"""Sliding float32 grid smoothing with native edge weights and sum order."""
import numpy as np

F = np.float32


def smooth(*, a):
    b = a.copy()
    rows, cols = a.shape[:2]
    for y in range(1, rows - 1):
        top, mid, bot = a[y - 1:y + 2]
        sums = F(F(F(F(F(top[0] + top[1]) + top[2]) + F(0)) + F(F(mid[0] + mid[1]) + mid[2])) + F(F(bot[0] + bot[1]) + bot[2]))
        b[y, 1] = F(F(F(mid[1] * F(3)) + sums) * F(1 / 12))
        for x in range(2, cols - 1):
            old = F(F(top[x - 2] + mid[x - 2]) + bot[x - 2])
            new = F(F(top[x + 1] + mid[x + 1]) + bot[x + 1])
            sums = F(F(sums - old) + new)
            b[y, x] = F(F(sums + F(mid[x] * F(3))) * F(1 / 12))
        for x, nbr in [(0, 1), (cols - 1, cols - 2)]:
            z = F(F(F(top[x, 0] + F(0)) + mid[x, 0]) + bot[x, 0])
            b[y, x, 0] = F(F(mid[x, 0] * F(3)) + z) / F(6)
            z = F(F(top[x, 1] + top[nbr, 1]) + F(0))
            z = F(z + F(mid[x, 1] + mid[nbr, 1]))
            z = F(z + F(bot[x, 1] + bot[nbr, 1]))
            b[y, x, 1] = F(F(mid[x, 1] * F(3)) + z) / F(9)
    for y, nbr in [(0, 1), (rows - 1, rows - 2)]:
        for x in range(1, cols - 1):
            z = F(F(F(a[y, x - 1, 0] + a[y, x, 0]) + a[y, x + 1, 0]) + F(0))
            adjacent = F(F(a[nbr, x - 1, 0] + a[nbr, x, 0]) + a[nbr, x + 1, 0])
            z = F(z + adjacent)
            b[y, x, 0] = F(F(a[y, x, 0] * F(3)) + z) / F(9)
            z = F(F(F(a[y, x, 1] * F(3)) + a[y, x - 1, 1]) + a[y, x, 1])
            z = F(F(z + a[y, x + 1, 1]) + F(0))
            b[y, x, 1] = z / F(6)
    return b
