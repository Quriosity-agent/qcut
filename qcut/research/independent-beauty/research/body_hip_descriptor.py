"""Hip descriptor: center, radii and bounds from the smoothed hips and the public measurements."""
import numpy as np
from body_hip_state import Part
f = np.float32

def ema(old, new, a=0.3):
    old, new, a = map(f, (old, new, a))
    return new if abs(f(old + f(1))) <= np.finfo(np.float32).eps else f(f(f(old - new) * a) + new)

class HipDescriptor:

    def __init__(self):
        self.radii = np.full(4, -1, np.float32)

    def update(self, public, hip_center, w, h, hip_count, strategy=65536, frontal=-1.0, side=True):
        if not hip_count:
            return Part(False)
        scale = f(public['scale'])
        hip = np.asarray(hip_center, np.float32)
        offset = f(0.1) if strategy == 257 else f(-0.108)
        center = np.minimum(np.maximum(hip + np.array([0, f(scale * offset)], np.float32), f(0)), np.array([w, h], np.float32))
        radius = f(scale * f(0.63))
        minor = f(radius * f(max(float(f(frontal)) - 0.5, 0.0) * 2.0))
        left, right = (minor, radius) if side else (radius, minor)
        bottom = f(scale * ema(0.3, 0.8, frontal))
        target = [left, right, bottom, f(scale * f(0.7 if strategy == 256 else 0.408))]
        self.radii = np.array([ema(x, y) for x, y in zip(self.radii, target)], np.float32)
        return Part(True, tuple(center), tuple(self.radii))
