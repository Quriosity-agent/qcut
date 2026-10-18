"""Persistent shoulder raw-grid fusion with an explicitly owned history counter."""

import numpy as np
from .geometry import raw_geometry
from ..shoulder_smoothing import smooth

F = np.float32


class HistoryCounter:
    def __init__(self):
        self.value = 0


class WidenHistory:
    """Independent native cached-raw-grid fusion; caller owns shared counter."""

    def __init__(self, counter=None):
        self.raw = None
        self.bounds = None
        self.counter = counter if counter is not None else HistoryCounter()
        self.alpha = None

    def step(self, source, state, destination=None):
        on, raw, bounds = raw_geometry(source, state)
        rows, cols = np.asarray(raw.shape[:2]) - 1
        if self.raw is None or state.get("history_invalid", True):
            self.raw = raw.copy()
            self.bounds = bounds
            self.alpha = None
        else:
            old = self.raw
            ol, ot, orr, ob = self.bounds
            l, t, right, bottom = bounds
            if not on:
                l, t, right, bottom = ol, ot, orr, ob
            bounds = (
                max(min(l, ol), 0),
                max(min(t, ot), 0),
                min(max(right, orr), cols + 1),
                min(max(bottom, ob), rows + 1),
            )
            l, t, right, bottom = bounds
            lanes = np.zeros(4, np.float32)
            tail = F(0)
            for r in range(t, bottom):
                c = l
                while c + 1 < right:
                    values = np.abs(F(raw[r, c : c + 2] - old[r, c : c + 2])).reshape(4)
                    lanes = F(lanes + values)
                    c += 2
                if c < right:
                    d = np.abs(F(raw[r, c] - old[r, c]))
                    tail = F(tail + F(d[0] + d[1]))
            total = F(F(F(lanes[0] + lanes[1]) + lanes[2]) + lanes[3])
            total = F(tail + total)
            mean = F(
                F(F(total / F((rows + 1) * (cols + 1))) * F(10201))
                / F(F(source[-1, -1, 0]) + F(source[-1, -1, 1]))
            )
            alpha = F(min(0.25 / (float(mean) + 1e-6), 1.0))
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
                        if a > F(1e-6) or b > F(1e-6):
                            xmin = min(xmin, c)
                            xmax = max(xmax, c + 1)
                            ymin = min(ymin, r)
                            ymax = max(ymax, r)
                        c += 2
                    if c < right and F(abs(raw[r, c, 0]) + abs(raw[r, c, 1])) > F(1e-6):
                        xmin = min(xmin, c)
                        xmax = max(xmax, c)
                        ymin = min(ymin, r)
                        ymax = max(ymax, r)
                bounds = (
                    max(xmin - 2, 0),
                    max(ymin - 2, 0),
                    min(ymax + 3, rows + 1),
                    min(xmax + 3, cols + 1),
                )
                # Serialized native order differs; public bounds stay(left,top,right,bottom).
                bounds = (bounds[0], bounds[1], bounds[3], bounds[2])
            self.bounds = bounds
        result = (
            smooth(raw, self.bounds)
            if self.bounds[2] > self.bounds[0] and self.bounds[3] > self.bounds[1]
            else raw
        )
        if on:
            state["history_invalid"] = False
        return on, result if destination is None else F(F(destination) + result)
