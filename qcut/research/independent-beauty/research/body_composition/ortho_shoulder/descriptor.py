"""Independent NsShoulderDescriber Part10, orientation0 transform."""

import numpy as np

F = np.float32
KEYS = (1, 2, 3, 5, 6)


class ShoulderDescriptor:
    def __init__(self):
        self.points = np.full((5, 2), -1, np.float32)
        self.missed = 0

    def update(
        self, coords, visibility, width, height, status_valid=True, status_blocked=False
    ):
        p = F(np.asarray(coords, np.float32).reshape(18, 2) * F([width, height]))
        v = np.asarray(visibility, bool)
        valid = np.zeros(5, np.uint8)
        if not status_valid:
            self.missed += 1
        elif not status_blocked:
            for k, key in enumerate(KEYS):
                if v[key] and (not np.any(np.isnan(p[key]))):
                    old, new = (self.points[k], p[key])
                    self.points[k] = np.where(
                        np.abs(F(old + F(1))) > F(2 ** (-23)),
                        F(new + F(F(old - new) * F(0.5))),
                        new,
                    )
                    valid[k] = 1
            self.missed = 0
        if self.missed == 10:
            self.points[valid == 0] = F(-1)
            self.missed = 0
        return {
            "keys": KEYS,
            "points": self.points.copy(),
            "point_valid": valid,
            "missed_count": self.missed,
        }
