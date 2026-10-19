"""Native sparse displacement-history arithmetic over a bounded dense grid.

Missing sparse keys contribute zero. A dense grid preserves the key-union
arithmetic without depending on the native unordered-map implementation.
"""

import numpy as np

F = np.float32


class VertexHistory:
    def __init__(self, *, degree):
        self.degree = F(degree)
        self.values = None
        self.initialized = False
        self.dirty = False

    def mark_dirty(self):
        self.dirty = True

    def reset_filter(self):
        self.initialized = False

    def update(self, *, current, width, height, reset=False):
        current = np.asarray(current, np.float32)
        if not self.initialized or self.dirty or reset:
            self.values = current.copy()
            self.initialized = True
            self.dirty = False
            return self.values
        difference = F(current - self.values)
        terms = F(np.abs(difference[..., 0]) + np.abs(difference[..., 1]))
        distance = float(np.sum(terms, dtype=np.float64)) / float(F(width + height))
        alpha = F(min(float(self.degree) / (distance + 1e-6), 1.0))
        blended = F(F(self.values * F(F(1) - alpha)) + F(current * alpha))
        square = F(F(blended[..., 0] * blended[..., 0]) + F(blended[..., 1] * blended[..., 1]))
        blended[square.astype(np.float64) < .001] = F(0)
        self.values = blended
        return self.values
