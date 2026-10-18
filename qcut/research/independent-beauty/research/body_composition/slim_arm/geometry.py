"""Independent SlimArm state -> grid deltas. No private library is loaded.
Input state is explicit, anatomically populated state; this module does not detect arms.
"""

import numpy as np
from .straight_limb import displace_limb as straight
from .bent_limb import displace_limb as bent


def deform(source, state, destination=None):
    src = np.asarray(source, np.float32)
    out = (
        np.zeros_like(src)
        if destination is None
        else np.array(destination, np.float32, copy=True)
    )
    if state.get("protection", False):
        raise NotImplementedError(
            "Native body protection constraints require a separate populated protection state"
        )
    if not state.get("enabled", True) or not state.get("valid", True):
        return (False, out)
    deltas = []
    active = False
    for index, name in enumerate(["left", "right"]):
        limb = state[name]
        if (
            not limb["flags"][0]
            or not limb["flags"][1]
            or abs(limb["intensity"]) < 2 ** (-23)
        ):
            deltas.append(np.zeros_like(src))
            continue
        if not limb["flags"][2] or limb["byte54"]:
            on, delta = straight(src, limb, state["global"], index)
        else:
            on, delta, _ = bent(src, limb, state["global"], index)
        active |= on
        deltas.append(delta)
    return (active, np.float32(out + np.float32(deltas[0] + deltas[1])))
