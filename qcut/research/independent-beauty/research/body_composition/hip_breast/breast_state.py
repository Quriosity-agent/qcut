"""Independent Breast bit16 state preparation from Part6 and explicit Public basis/turn auxiliaries."""

from dataclasses import dataclass, field, replace
import numpy as np
from .breast_descriptor import clip_radius
from .hip_geometry import smooth
from .hip_state import State as HipState, Part as HipPart, prepare as hip_prepare

f = np.float32


@dataclass
class State:
    active: bool = False
    mode: int = 1
    intensity: float = 0.0
    target: float = 0.35
    step: float = 2.0
    modifier: float = 0.5
    axis: tuple = (1.0, 0.0)
    perpendicular: tuple = (0.0, -1.0)
    extra: float = 0.0
    lobes: list = field(
        default_factory=lambda: [
            {
                "valid": False,
                "center": (0.0, 0.0),
                "radii": (0.0, 0.0, 0.0, 0.0),
                "bounds": (0.0, 0.0, 0.0, 0.0),
                "weight": 1.0,
            }
            for _ in range(2)
        ]
    )


def lobe(center, axis, perp, shift, left, right, up, down, w, h, side):
    center = np.asarray(center, np.float32)
    axis = np.asarray(axis, np.float32)
    perp = np.asarray(perp, np.float32)
    point = f(center - f(axis * shift)) if side else f(center + f(axis * shift))
    point = np.maximum(
        np.minimum(point, np.array([f(w) - f(1), f(h) - f(1)], np.float32)), f(0)
    )
    rleft = f(left - shift) if side else shift
    rright = shift if side else f(right - shift)
    dirs = [-axis, axis, -perp, perp]
    radii = np.array(
        [
            clip_radius(d, r, point, w, h)
            for d, r in zip(dirs, [rleft, rright, up, down])
        ],
        np.float32,
    )
    ends = np.array([f(point + f(d * r)) for d, r in zip(dirs, radii)], np.float32)
    bounds = (min(ends[:, 0]), max(ends[:, 0]), min(ends[:, 1]), max(ends[:, 1]))
    return {
        "valid": True,
        "center": tuple(point),
        "radii": tuple(radii),
        "bounds": tuple(bounds),
        "weight": f(1),
    }


def prepare(
    s,
    part,
    w,
    h,
    axis=(1.0, 0.0),
    perp=(0.0, -1.0),
    confidence=1.0,
    side=False,
    turnvar=1.0,
):
    s = replace(s, lobes=[dict(x) for x in s.lobes])
    confidence = f(confidence)
    modifier = f(s.modifier)
    side = bool(side)
    if part is None:
        return s
    if part["valid"] and (not s.active or s.mode != 2):
        s.active = True
        s.axis = tuple(map(f, axis))
        s.perpendicular = tuple(map(f, perp))
        left, right, up, down = map(f, part["radii"])
        center = part["center"]
        weights = (smooth(confidence), f(1)) if side else (f(1), smooth(confidence))
        for j, r in enumerate([left, right]):
            far = side if j == 0 else not side
            valid = bool(turnvar >= f(0.53)) if far else True
            if valid:
                if far:
                    shift = f(f(r * modifier) * confidence)
                else:
                    base = f(r * modifier)
                    rest = f(r * f(f(1) - modifier))
                    shift = f(base + f(rest * f(f(1) - confidence)))
                s.lobes[j] = lobe(
                    center, axis, perp, shift, left, right, up, down, w, h, j == 0
                )
            s.lobes[j]["valid"] = valid
            s.lobes[j]["weight"] = weights[j]
    cold = hip_prepare(
        HipState(
            active=True, mode=2, intensity=s.intensity, target=s.target, step=s.step
        ),
        HipPart(part["valid"]),
        w,
        h,
    )
    s.intensity = cold.intensity
    s.step = f(0.1)
    s.extra = f(f(s.intensity) * confidence)
    return s
