"""Hip turn and frontal measure that follow the shared head-turn update."""
import numpy as np
from body_hip_descriptor import ema
f = np.float32

class PublicHipAux:

    def __init__(self):
        self.yaw = f(-1)
        self.frontal = f(-1)

    def update(self, seq, basis, shoulder_count, hip_count, has_head_position=True):
        if shoulder_count != 2 or hip_count != 2 or (not has_head_position) or (seq.scale <= 0):
            return self.frontal
        ratio = f(f(1) - f(min(f(basis.hip_width / seq.scale), f(0.4)) / f(0.4)))
        ratio = f(-ratio) if seq.yaw < 0 else ratio
        alpha = f(min(float(seq.signvar) * 5.0, 0.9))
        self.yaw = ema(self.yaw, ratio, alpha)
        target = ema(seq.turnvar, f(f(1) - f(abs(self.yaw))), seq.turnvar)
        self.frontal = ema(self.frontal, target, 0.55)
        return self.frontal
