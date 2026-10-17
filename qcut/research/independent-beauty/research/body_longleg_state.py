"""From a body pose to the long-leg state: normalized joints, body descriptor, leg state.

QCut-owned NumPy port of the measured float32 arithmetic (orientation 0, no head
auxiliary, no 3D reliability flags). A pose in algorithm-image pixels is normalized
with y up; the descriptor smooths the shoulder, hip and knee centres and the body scale
(unset values take their first measurement; the base height starts at zero); the leg
state takes the end and pivot
heights below which the legs are stretched, and ramps its intensity toward the target.
A reset state (step 2) reaches the target on its first frame.

A still frame updates the descriptor STILL_UPDATES times with the same pose. This is fitted,
not derived: a single update (the component's first frame, base starting at zero) leaves
the leg region far below native still renders, and taking the measurement directly puts
the pivot about 2% too high; eight updates (base at 98.3% of the measurement) came
closest on native renders of four frame sizes (mean difference 0.9-3.0 levels against
native effects of 5-10). The exact production mechanism is still open.
"""
from dataclasses import dataclass

import numpy as np

f = np.float32
STILL_UPDATES = 8


def ema(old, new, a):
    old, new, a = map(f, (old, new, a))
    return new if abs(f(old + f(1))) <= np.finfo(np.float32).eps else f(f(f(old - new) * a) + new)


def normalize(points, width, height):
    """Pose pixels to [0, 1] coordinates with y up (float32 reciprocal multiply)."""
    p = np.asarray(points, dtype=np.float32)
    w, h = np.float32(width), np.float32(height)
    rw, rh = np.float32(np.float32(1) / w), np.float32(np.float32(1) / h)
    xy = np.empty((len(p), 2), np.float32)
    xy[:, 0] = p[:, 0] * rw
    xy[:, 1] = (h - p[:, 1]) * rh
    return xy, p[:, 3].astype(np.uint8)


@dataclass
class Part4:
    valid: bool
    end: float
    pivot: float
    left_valid: bool = False
    left: tuple = (-1., -1.)
    right_valid: bool = False
    right: tuple = (-1., -1.)


@dataclass
class State:
    mode: int = 1
    active: bool = False
    width: float = 0.
    end: float = -1.
    pivot: float = -1.
    strategy: int = 0
    foot: tuple = (-1., -1.)
    target: float = .35
    intensity: float = 0.
    step: float = 2.


class BodyDescriptor:
    """Shoulder/hip/knee smoothing, body scale and the leg end/pivot heights (pixels, y up)."""

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

    def update(self, coords, visibility, width, height):
        p = np.asarray(coords, np.float32).reshape(18, 2) * np.array([width, height], np.float32)
        v = np.array(visibility, bool)
        bounds = np.all((p > 0) & (p < np.array([width, height], np.float32)), axis=1)

        def group(ids):
            return p[[i for i in ids if v[i] and bounds[i]]]

        shoulder, hip, knee = [group(ids) for ids in ([2, 5], [8, 11], [9, 12])]

        def mean(a):
            return np.mean(a, axis=0, dtype=np.float32) if len(a) else np.array([-1, -1], np.float32)

        sh, hh, kk = map(mean, (shoulder, hip, knee))
        if len(hip):
            self.rawhip = hh
        if len(knee):
            self.rawknee = kk

        def vecema(old, new, a):
            return np.array([ema(x, y, a) for x, y in zip(old, new)], np.float32)

        smooth_weight = f(np.clip(f(f(1) - self.cc), f(.2), f(.95))) if self.cc > 0 else f(.2)
        if len(shoulder) == 2:
            self.sh_smooth = vecema(self.sh_smooth, sh, smooth_weight)
            distance = f(np.sqrt(np.sum((shoulder[0] - shoulder[1]) ** 2, dtype=np.float32)))
            self.width = ema(self.width, distance, .7)
        if len(hip) == 2:
            self.hip_smooth = vecema(self.hip_smooth, hh, smooth_weight)
        rawsh = sh
        if len(shoulder) and v[1]:
            # No 3D reliability flags: shoulder and neck weigh equally.
            rawsh = p[1] * f(f(1) - f(.5)) + sh * f(.5)
        if len(shoulder) and len(hip):
            self.center = vecema(self.center, (rawsh + hh) * f(.5), .3)
            a, b = (self.sh_smooth, self.hip_smooth) if len(shoulder) == 2 and len(hip) == 2 else (rawsh, hh)
            distance = f(np.sqrt(np.sum((a - b) ** 2, dtype=np.float32)))
            self.scale = ema(self.scale, distance, .8)
        if np.all(self.hip_smooth != f(-1)):
            x = f(f(self.hip_smooth[0] * f(.7)) + f(self.center[0] * f(.3)))
            y = f(max(f(self.hip_smooth[1] + f(self.scale * f(-.9))), f(0))) if self.scale > 0 else self.hip_smooth[1]
            self.base[0] = ema(self.base[0], x, .3)
            self.base[1] = ema(self.base[1], y, .6)
        valid = bool(len(hip) and len(knee) and self.rawknee[1] < self.rawhip[1] and self.scale > 0)
        if valid:
            self.endpivot = np.array([f(self.base[1] + f(self.scale * f(a))) for a in (1.3, .75)], np.float32)
        return {'scale': float(self.scale), 'center': self.center.copy(), 'hip': self.hip_smooth.copy(),
                'base': self.base.copy(), 'valid': valid, 'end_pivot': self.endpivot.copy()}


def to_part4(descriptor, coords, visibility, width, height):
    p = np.asarray(coords, np.float32).reshape(18, 2) * np.array([width, height], np.float32)
    v = np.asarray(visibility, bool)
    left, right = bool(v[8] and v[9]), bool(v[11] and v[12])
    return Part4(descriptor['valid'], float(descriptor['end_pivot'][0]), float(descriptor['end_pivot'][1]),
                 left, tuple(p[9]) if left else (-1., -1.), right, tuple(p[12]) if right else (-1., -1.))


def intensity_update(old, target, step):
    old, target, step = map(f, (old, target, step))
    delta = f(old - target)
    if abs(delta) < f(1e-6):
        return target
    power = max(f(np.power(step, f(abs(delta) + f(1)))), f(.02))
    return f(max(target, f(old - f(power * step)))) if target <= old else f(min(target, f(f(power * step) + old)))


def prepare(state, part4, width, height, strategy=0):
    """One frame of the leg state; a missing descriptor keeps the state unchanged."""
    s = State(**vars(state))
    if part4 is None:
        return s
    if part4.valid and (not s.active or s.mode != 2):
        s.active = True
        if s.mode == 1:
            s.width = f(width)
            s.end = f(min(f(part4.end), f(height)))
            s.pivot = f(min(f(part4.pivot), s.end))
        else:
            s.width = f(width)
            s.end = f(min(ema(s.end, part4.end, .7), f(height)))
            s.pivot = f(min(ema(s.pivot, part4.pivot, .95), s.end))
        s.strategy = strategy
        s.foot = (-1., -1.)
        if part4.left_valid:
            s.foot = tuple(map(f, part4.left))
        if part4.right_valid:
            if not part4.left_valid or s.foot == (-1., -1.):
                s.foot = tuple(map(f, part4.right))
            else:
                s.foot = tuple(f(f(f(x) + f(y)) * f(.5)) for x, y in zip(s.foot, part4.right))
    s.intensity = intensity_update(s.intensity, s.target if part4.valid else 0., s.step)
    s.step = f(.05)
    return s


def still_leg_state(*, points, algorithm_size, frame_size, target):
    """The leg state of a still frame from its pose (first frame of a reset component)."""
    width, height = frame_size
    coords, visibility = normalize(np.asarray(points, np.float32), *algorithm_size)
    body = BodyDescriptor()
    for _ in range(STILL_UPDATES):
        descriptor = body.update(coords, visibility, width, height)
    part = to_part4(descriptor, coords, visibility, width, height)
    state = prepare(State(mode=1, target=target, intensity=0, step=2.), part, width, height, strategy=0)
    return state, descriptor, part
