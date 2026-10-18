"""Independent persistent SlimArm intensity/state sequence for mode1/2."""

import copy
import numpy as np
from .state import from_descriptor

F = np.float32
from ..temporal_intensity import approach


class SlimArmSequence:
    def __init__(self):
        self.state = None
        self.step = F(2)

    def update(self, part, width, height, target=0.5, mode=1):
        fresh = from_descriptor(part, width, height, 0)
        if self.state is None:
            self.state = fresh
        self.state["global"]["flip"] = fresh["global"]["flip"]
        if part["valid"] and (not self.state["valid"] or mode != 2):
            self.state["valid"] = True
            for name, key in [("left", "left_valid"), ("right", "right_valid")]:
                if part[key]:
                    old = self.state[name]["intensity"]
                    self.state[name] = fresh[name]
                    self.state[name]["intensity"] = old
        for name, key in [("left", "left_valid"), ("right", "right_valid")]:
            self.state[name]["intensity"] = float(
                approach(
                    self.state[name]["intensity"],
                    target if part[key] else 0.0,
                    self.step,
                )
            )
        self.step = F(0.1)
        return copy.deepcopy(self.state)
