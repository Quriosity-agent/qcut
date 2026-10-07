"""Ordinary fresh-photo 120 heads to the TotalFace consumer ABI."""
import math
from numbers import Real

import numpy as np

SOURCE = "owned-ordinary-120-to-TotalFace"
DEGREE_TO_RADIAN = np.float32(0.017453294)


def total_face_pose(*, raw_yaw, raw_pitch):
    for value in (raw_yaw, raw_pitch):
        if isinstance(value, (bool, np.bool_)) or not isinstance(value, Real) or not math.isfinite(value) or abs(value) > 360:
            raise ValueError("finite bounded raw pose heads required")
    # The ABI coefficient is one float32 ULP above rounded pi/180.
    radians = np.float32(-np.float32(raw_yaw) * DEGREE_TO_RADIAN)
    yaw = np.float32(float(radians) / math.pi * 180.0)
    return {"yaw": float(yaw), "pitch": 0.0, "yaw_radians": float(radians),
            "source": SOURCE, "pitch_policy": "TotalFace-caller-constant-zero"}
