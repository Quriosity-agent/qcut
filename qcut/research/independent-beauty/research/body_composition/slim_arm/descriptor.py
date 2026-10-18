"""Independent Arm Part9 descriptor for native strategy bit16, orientation0.
Consumes the independent Public descriptor's scale/yaw/turn state. Optional independent Status supplies present/stability gating and swap state.
"""

import numpy as np

F = np.float32


class ArmDescriptor:
    def __init__(self):
        self.points = np.full((6, 2), -1, np.float32)
        self.radius = F(0)

    def update(
        self, coords, visibility, width, height, public, public_result, status=None
    ):
        p = F(np.asarray(coords, np.float32).reshape(18, 2) * F([width, height]))
        vis = np.asarray(visibility, bool)
        valid = np.zeros(6, np.uint8)
        status = {} if status is None else status
        flip = bool(status.get("status50", False))
        if not status.get("present", True) or status.get("status48", False):
            self.points[:] = F(-1)
            return {
                "valid": False,
                "left_valid": False,
                "right_valid": False,
                "radius": float(self.radius),
                "points": self.points.copy(),
                "point_valid": valid,
                "status50": flip,
            }
        valid_status = np.asarray(status.get("visibility", vis), bool)
        transitions = np.asarray(status.get("transition", np.zeros(18, np.uint8)), bool)
        self.radius = F(F(public_result["scale"]) * F(0.2))
        for start in [2, 5]:
            for key in range(start, start + 3):
                if not valid_status[key] or transitions[key]:
                    break
                k = key - 2
                old = self.points[k]
                new = p[key]
                self.points[k] = np.where(
                    np.abs(F(old + F(1))) > F(2 ** (-23)),
                    F(new + F(F(old - new) * F(0.5))),
                    new,
                )
                valid[k] = 1
        left = bool(valid[0] and valid[1])
        right = bool(valid[3] and valid[4])
        if public.turnvar < F(0.7):
            if public.yaw < F(0):
                left = False
            else:
                right = False
        self.points[valid == 0] = F(-1)
        return {
            "valid": left or right,
            "left_valid": left,
            "right_valid": right,
            "radius": float(self.radius),
            "points": self.points.copy(),
            "point_valid": valid,
            "status50": flip,
        }
