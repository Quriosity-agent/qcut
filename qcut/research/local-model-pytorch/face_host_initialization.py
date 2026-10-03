"""160 detection-coordinate head -> owned Base filter initialization seed.

Native detection matrices and destination order remain required. Native filter
previous points are strict parity references, never the candidate seed source.
"""
from __future__ import annotations

import numpy as np

from face_alignment_replay import point_difference
from face_geometry import reorder_landmarks
from face_host_geometry_contract import validate_snapshot, smoothing_states
from face_host_geometry_replay import map_double


def decode_seed(*, raw, snapshot):
    validate_snapshot(row=snapshot)
    if (not isinstance(raw, np.ndarray) or raw.dtype != np.float32 or raw.shape != (106, 2)
            or not np.isfinite(raw).all() or np.max(np.abs(raw)) > 32768):
        raise ValueError("bounded owned float32 160-profile landmark head required")
    active = [face for face in snapshot["faces"] if face["active"]]
    if len(active) != 1:
        raise ValueError("one actual active initialization face required")
    face = active[0]
    states = face.get("smoothing")
    smoothing_states(value=states)
    if any(state["first"] or len(state["previous_xy"]) != state["count"] * 2 for state in states):
        raise ValueError("observed post-update initialization reference required")
    order = np.asarray(snapshot["tables"]["order"], np.int32)
    # Detection coordinates are absolute; the 120 residual baseline must not be added.
    stage = reorder_landmarks(raw_pairs=raw, destinations=order)
    seed = map_double(points=stage, inverse=np.asarray(face["detection_inverse"], np.float32))
    expected = np.concatenate([np.asarray(state["previous_xy"], np.float32).reshape(-1, 2) for state in states])
    check = point_difference(actual=seed, expected=expected, tolerance=0)
    if not check["exact"]:
        raise RuntimeError("owned 160 initialization differs; no native seed correction")
    return seed, dict(prediction=snapshot["index"], id=face["id"], slot=face["slot"],
                      passed=True, source="onnx-160-detection-backmap", check=check,
                      native_point_seed_used=False, native_detection_geometry_required=True)
