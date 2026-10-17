"""Slim arms across frames: the intensity ramp and the state carried between updates."""
import ctypes as C, numpy as np, copy
from body_arm_state import from_descriptor
F = np.float32
lib = C.CDLL(None)
lib.powf.argtypes = [C.c_float, C.c_float]
lib.powf.restype = C.c_float

def approach(old, target, step):
    old, target, step = map(F, (old, target, step))
    delta = F(old - target)
    if abs(delta) < F(1e-06):
        return target
    power = F(max(F(lib.powf(float(step), float(F(abs(delta) + F(1))))), F(0.02)))
    return F(max(target, F(old - F(power * step)))) if target <= old else F(min(target, F(F(power * step) + old)))

class SlimArmSequence:

    def __init__(self):
        self.state = None
        self.step = F(2)

    def update(self, part, width, height, target=0.5, mode=1):
        fresh = from_descriptor(part, width, height, 0)
        if self.state is None:
            self.state = fresh
        self.state['global']['flip'] = fresh['global']['flip']
        if part['valid'] and (not self.state['valid'] or mode != 2):
            self.state['valid'] = True
            for name, key in [('left', 'left_valid'), ('right', 'right_valid')]:
                if part[key]:
                    old = self.state[name]['intensity']
                    self.state[name] = fresh[name]
                    self.state[name]['intensity'] = old
        for name, key in [('left', 'left_valid'), ('right', 'right_valid')]:
            self.state[name]['intensity'] = float(approach(self.state[name]['intensity'], target if part[key] else 0.0, self.step))
        self.step = F(0.1)
        return copy.deepcopy(self.state)
