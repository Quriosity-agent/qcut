"""Independent orientation0 Public/Part4 descriptor sequence.
Optional head size/position are supported; flags are Status per-bone motion
markers (record offset+1), not body3D flags. Scope is pinned by oracle reports.
"""

import numpy as np
import math


def point_distance(a, b):
    """Native4c642c: two FP32 subtracts/muls, FP32 add, correctly rounded sqrt.
    Explicit operations avoid numpy reduction/power implementation differences.
    """
    dx = np.float32(np.float32(a[0]) - np.float32(b[0]))
    dy = np.float32(np.float32(a[1]) - np.float32(b[1]))
    square = np.float32(np.float32(dx * dx) + np.float32(dy * dy))
    return np.float32(math.sqrt(float(square)))


from .longleg_state import f, ema


class DescriptorSequence:
    def __init__(self):
        self.sh_smooth = np.array([-1, -1], np.float32)
        self.hip_smooth = self.sh_smooth.copy()
        self.scale = f(-1)
        self.center = self.sh_smooth.copy()
        self.base = np.zeros(2, np.float32)
        self.endpivot = np.zeros(2, np.float32)
        self.rawhip = self.sh_smooth.copy()
        self.rawknee = self.sh_smooth.copy()
        self.cc = f(-1)
        self.width = f(-1)
        self.sign = f(-1)
        self.signvar = f(-1)
        self.yaw = f(-1)
        self.turnvar = f(-1)

    def update(
        self,
        coords,
        visibility,
        width,
        height,
        head_size=None,
        flags=None,
        head_position=None,
        status_valid=True,
        status_blocked=False,
        status_swapped=False,
    ):
        p = np.asarray(coords, np.float32).reshape(18, 2) * np.array(
            [width, height], np.float32
        )
        v = np.array(visibility, bool)
        if not status_valid:
            return self.snapshot(False)
        if status_blocked:
            self.advance_leg_base()
            return self.snapshot(False)
        bounds = np.all((p > 0) & (p < np.array([width, height], np.float32)), axis=1)

        def group(ids):
            return p[[i for i in ids if v[i] and bounds[i]]]

        shoulder, hip, knee = [group(ids) for ids in ([2, 5], [8, 11], [9, 12])]
        mean = lambda a: (
            np.mean(a, axis=0, dtype=np.float32)
            if len(a)
            else np.array([-1, -1], np.float32)
        )
        sh, hh, kk = map(mean, (shoulder, hip, knee))
        if len(hip):
            self.rawhip = hh
        if len(knee):
            self.rawknee = kk
        vecema = lambda old, new, a: np.array(
            [ema(x, y, a) for x, y in zip(old, new)], np.float32
        )
        smooth_weight = (
            f(np.clip(f(f(1) - self.cc), f(0.2), f(0.95))) if self.cc > 0 else f(0.2)
        )
        if len(shoulder) == 2:
            self.sh_smooth = vecema(self.sh_smooth, sh, smooth_weight)
            distance = point_distance(shoulder[0], shoulder[1])
            self.width = ema(self.width, distance, 0.7)
        if len(hip) == 2:
            self.hip_smooth = vecema(self.hip_smooth, hh, smooth_weight)
        flags = flags or {}
        shrel = f((bool(flags.get(81, False)) + bool(flags.get(201, False))) * 0.5)
        hiprel = f((bool(flags.get(321, False)) + bool(flags.get(441, False))) * 0.5)
        rawsh = sh
        if len(shoulder) and v[1]:
            neckrel = f(bool(flags.get(41, False)))
            weight = (
                f(0.5)
                if abs(f(shrel + neckrel)) < f(1e-06)
                else f(float(f(neckrel / f(shrel + neckrel))) ** 3)
            )
            rawsh = p[1] * f(f(1) - weight) + sh * weight
        if len(shoulder) and len(hip):
            self.center = vecema(self.center, (rawsh + hh) * f(0.5), 0.3)
            a, b = (
                (self.sh_smooth, self.hip_smooth)
                if len(shoulder) == 2 and len(hip) == 2
                else (rawsh, hh)
            )
            distance = point_distance(a, b)
            if head_size is not None and (len(shoulder) != 2 or len(hip) != 2):
                distance = f(f(head_size) * f(2.2))
            reliable = lambda rel: (
                not (
                    self.scale > 0
                    and rel > f(self.scale * f(0.1))
                    or rel > f(min(width, height) * f(0.1))
                )
            )
            self.scale = ema(
                self.scale,
                distance,
                0.8 if reliable(shrel) and reliable(hiprel) else 0.99,
            )
        elif head_size is not None:
            self.scale = ema(self.scale, f(f(head_size) * f(2.2)), 0.98)
        if (
            len(shoulder) == 2
            and head_position is not None
            and (tuple(head_position) != (-1.0, -1.0))
            and (self.scale > 0)
        ):
            a, b = (shoulder[0], shoulder[1])
            if a[0] > b[0]:
                direction = np.array([f(a[0] - b[0]), f(a[1] - b[1])], np.float32)
            else:
                direction = np.array([f(b[0] - a[0]), f(b[1] - a[1])], np.float32)
            rel = np.asarray(head_position, np.float32) - self.sh_smooth
            side = bool(f(rel[1] * f(-direction[1])) > f(direction[0] * rel[0]))
            sign = f(side)
            self.sign = ema(self.sign, sign, 0.55)
            self.signvar = ema(self.signvar, f(abs(f(self.sign - sign))), 0.55)
            ratio = f(f(1) - f(min(f(self.width / self.scale), f(0.57)) / f(0.57)))
            if side:
                ratio = f(-ratio)
            self.yaw = ema(self.yaw, ratio, min(f(self.signvar * f(5)), f(0.9)))
            q = f(f(1) - f(abs(self.yaw)))
            self.turnvar = ema(self.turnvar, q, 0.55)
            target = f(max(f(f(q * f(0.57)) + f(-0.2)), f(0)) / f(0.37))
            self.cc = ema(self.cc, target, 0.55)
        self.advance_leg_base()
        valid = bool(
            len(hip)
            and len(knee)
            and (self.rawknee[1] < self.rawhip[1])
            and (self.scale > 0)
        )
        if valid:
            self.endpivot = np.array(
                [f(self.base[1] + f(self.scale * f(a))) for a in (1.3, 0.75)],
                np.float32,
            )
        return self.snapshot(valid)

    def snapshot(self, valid):
        return {
            "scale": float(self.scale),
            "center": self.center.copy(),
            "hip": self.hip_smooth.copy(),
            "base": self.base.copy(),
            "valid": valid,
            "end_pivot": self.endpivot.copy(),
        }

    def advance_leg_base(self):
        if np.all(self.hip_smooth != f(-1)):
            x = f(f(self.hip_smooth[0] * f(0.7)) + f(self.center[0] * f(0.3)))
            y = (
                f(max(f(self.hip_smooth[1] + f(self.scale * f(-0.9))), f(0)))
                if self.scale > 0
                else self.hip_smooth[1]
            )
            self.base[0] = ema(self.base[0], x, 0.3)
            self.base[1] = ema(self.base[1], y, 0.6)


def to_part4(
    result, coords, visibility, width, height, status_swapped=False, status_valid=True
):
    from .longleg_state import Part4

    p = np.asarray(coords, np.float32).reshape(18, 2) * np.array(
        [width, height], np.float32
    )
    v = np.asarray(visibility, bool)
    leftkeys, rightkeys = ((11, 12), (8, 9)) if status_swapped else ((8, 9), (11, 12))
    left = bool(status_valid and v[leftkeys[0]] and v[leftkeys[1]])
    right = bool(status_valid and v[rightkeys[0]] and v[rightkeys[1]])
    return Part4(
        result["valid"],
        float(result["end_pivot"][0]),
        float(result["end_pivot"][1]),
        left,
        tuple(p[leftkeys[1]]) if left else (-1.0, -1.0),
        right,
        tuple(p[rightkeys[1]]) if right else (-1.0, -1.0),
    )
