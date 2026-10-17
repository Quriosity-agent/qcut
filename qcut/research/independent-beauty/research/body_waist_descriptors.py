"""Slim waist and slim body descriptors from the public measurements."""
import numpy as np
from body_waist_geometry import f
from body_waist_state import Part

def ema(old, new, a):
    old, new, a = map(f, (old, new, a))
    return new if abs(f(old + f(1))) <= np.finfo(np.float32).eps else f(f(f(old - new) * a) + new)

class WaistBodyDescriptors:

    def __init__(self):
        self.waist_center = np.array([-1, -1], np.float32)
        self.waist_radius = np.full(4, -1, np.float32)
        self.body_radius = np.full(4, -1, np.float32)

    def update(self, public, shoulder_center, hip_center, strategy=0, image_height=1280, shoulder_count=2, hip_count=2):
        scale = f(public['scale'])
        sh = np.asarray(shoulder_center, np.float32)
        hip = np.asarray(hip_center, np.float32)
        shvalid = not np.array_equal(sh, [-1, -1])
        hipvalid = not np.array_equal(hip, [-1, -1])
        valid = bool((shvalid or hipvalid) and scale > 0)
        if not valid:
            return (Part(False), Part(False))
        if shvalid and hipvalid:
            center = sh * f(0.3) + hip * f(0.7)
            if strategy == 257 and hip_count == 2:
                center = sh * f(0.25) + hip * f(0.75)
        elif shvalid:
            center = sh + np.array([0, f(scale * f(-0.7))], np.float32)
        else:
            center = hip + np.array([0, f(scale * f(0.3))], np.float32)
        self.waist_center = np.array([ema(x, y, 0.2) for x, y in zip(self.waist_center, center)], np.float32)
        target = [f(float(scale) * a) for a in (0.6, 0.6, 0.4, 0.4)]
        self.waist_radius = np.array([ema(x, y, 0.3) for x, y in zip(self.waist_radius, target)], np.float32)
        waist = Part(True, tuple(self.waist_center), tuple(self.waist_radius))
        radius = f(scale * f(0.8))
        target = [radius, radius, f(image_height), radius]
        self.body_radius = np.array([ema(x, y, 0.5) for x, y in zip(self.body_radius, target)], np.float32)
        center = self.waist_center.copy()
        side = False
        flip = False
        if not strategy & 65536:
            if shoulder_count:
                dx = f(center[0] - sh[0])
                dy = f(center[1] - sh[1])
                flip = bool(sh[0] < center[0])
                angle = np.arctan2(abs(float(dy)), abs(float(dx)))
                side = bool(angle < float(f(0.5235999822616577)))
                if side:
                    center[1] = min(center[1], sh[1])
                else:
                    center[0] = f(f(center[0] + sh[0]) * f(0.5))
        return (waist, Part(True, tuple(center), tuple(self.body_radius), side, flip))
