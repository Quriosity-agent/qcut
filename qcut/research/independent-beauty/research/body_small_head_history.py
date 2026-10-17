"""Small head across frames: the intensity ramp and the state carried between updates."""
import ctypes as C, numpy as np, copy
from body_small_head_state import prepare
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

class SmallHeadSequence:

    def __init__(self):
        self.state = None
        self.step = F(2)

    def update(self, head, target=0.5, mode=1):
        fresh = prepare(head, 0)
        if self.state is None:
            self.state = fresh
        if fresh['valid'] and (not self.state['valid'] or mode != 2):
            old = self.state['intensity']
            self.state = fresh
            self.state['intensity'] = old
        self.state['intensity'] = float(approach(self.state['intensity'], target if fresh['valid'] else 0.0, self.step))
        self.step = F(0.05)
        return copy.deepcopy(self.state)
