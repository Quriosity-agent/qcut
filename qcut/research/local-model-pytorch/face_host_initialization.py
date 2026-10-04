"""160 detection-coordinate head -> owned Base filter initialization seed.

Native detection matrices and destination order remain required. Native filter
previous points are strict parity references, never the candidate seed source.
"""
from __future__ import annotations

import numpy as np

from face_alignment_replay import point_difference
from face_geometry import reorder_landmarks
from face_host_geometry_contract import integer, validate_snapshot, smoothing_states
from face_host_geometry_replay import map_double


def initialization_required(*, snapshot, prior_identity):
    validate_snapshot(row=snapshot)
    active = [face for face in snapshot["faces"] if face["active"]]
    if len(active) > 1:
        raise ValueError("single-face initialization routing required")
    if not active:
        return False
    face = active[0]
    states = face.get("smoothing")
    smoothing_states(value=states)
    first = [state["first"] for state in states]
    if any(first) != all(first):
        raise ValueError("partial initialization signal rejected")
    identity = (face["slot"], face["alignment"], face["id"])
    return identity != prior_identity and not all(first)


def select_initialization(*, snapshot, association):
    """Select by causal order only; numerical seed equality is a later gate."""
    if (not isinstance(association, dict) or type(association.get("prediction")) is not int or
            association["prediction"] != snapshot["index"]):
        raise ValueError("initialization prediction association mismatch")
    window = association.get("neural_window")
    if not isinstance(window, list) or len(window) != 2:
        raise ValueError("initialization neural window required")
    lower, upper = [integer(value=value, maximum=4096) for value in window]
    if upper != snapshot["bytenn_sequence"] or lower >= upper:
        raise ValueError("initialization neural window mismatch")
    items = association.get("inferences")
    if not isinstance(items, list) or not 1 <= len(items) <= 20:
        raise ValueError("bounded initialization inference list required")
    records, identities = set(), set()
    for item in items:
        if not isinstance(item, dict) or type(item.get("size")) is not int or item["size"] not in (120, 160):
            raise ValueError("typed Stage1 inference required")
        position = integer(value=item.get("record_index"), maximum=4095)
        inference = integer(value=item.get("inference"), maximum=128)
        network = item.get("network")
        expected = str(snapshot["predictors"][0 if item["size"] == 120 else 1]["network"])
        if (type(network) is not str or network != expected or not lower <= position < upper or
                position in records or (network, inference) in identities):
            raise ValueError("initialization inference ownership/window mismatch")
        records.add(position)
        identities.add((network, inference))
    tracking = [item for item in items if item["size"] == 120]
    if len(tracking) != 1:
        raise ValueError("one actual tracking inference required for initialization")
    preceding = [item for item in items if item["size"] == 160 and
                 item["record_index"] < tracking[0]["record_index"]]
    if len(preceding) != 1:
        raise ValueError("one actual 160 inference before tracking required; ambiguous seeds rejected")
    selected = preceding[0]
    proof = dict(association_mode="single-face-pretracking-160",
                 seed_record_index=selected["record_index"],
                 tracking_record_index=tracking[0]["record_index"],
                 tracking_inference=tracking[0]["inference"],
                 excluded_160_inferences=[item["inference"] for item in items
                     if item["size"] == 160 and item is not selected])
    return selected, proof


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
