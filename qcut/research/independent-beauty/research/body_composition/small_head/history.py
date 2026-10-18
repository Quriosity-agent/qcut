"""Independent persistent SmallHead intensity/state sequence for mode1/2."""

import copy
import numpy as np
from .state import prepare

F = np.float32
from ..temporal_intensity import approach


class SmallHeadSequence:
    def __init__(self):
        self.state = None
        self.step = F(2)

    def update(self, head, target=0.5, mode=1):
        fresh = prepare(head, 0)
        if self.state is None:
            self.state = fresh
        if fresh["valid"] and (not self.state["valid"] or mode != 2):
            old = self.state["intensity"]
            self.state = fresh
            self.state["intensity"] = old
        self.state["intensity"] = float(
            approach(
                self.state["intensity"], target if fresh["valid"] else 0.0, self.step
            )
        )
        self.step = F(0.05)
        return copy.deepcopy(self.state)
