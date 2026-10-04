"""Detached, JSON-only stage diagnostics for one owned candidate face.

No inference, native capture or file I/O occurs here. Filters are ordered
first33, last73; fresh/reset histories stay empty rather than inventing values.
The caller owns persistence and must return None to accept the prediction.
"""
from __future__ import annotations

import json


SCHEMA = "face-live-candidate-stages-v1"


def filter_snapshot(*, state):
    return dict(current_xy=state.current.reshape(-1).tolist(),
                previous_xy=state.previous.reshape(-1).tolist(),
                delta_x=state.delta[:, 0].tolist(), delta_y=state.delta[:, 1].tolist(),
                first=bool(state.first), alpha=float(state.alpha), scale=float(state.scale))


def stage_snapshot(*, packet, result, seed, decoded, mapped, smoothed, normalized, state):
    face = packet["face"]
    if face is None:
        raise ValueError("stage diagnostics require exactly one face")
    snapshot = dict(schema=SCHEMA, prediction=packet["prediction"],
        timestamp_us=packet["timestamp_us"], source_key=packet["source_key"],
        algorithm_rgba_sha256=result["algorithm_rgba_sha256"], backend_version=result["backend_version"],
        width=packet["width"], height=packet["height"], face_id=face["id"], alignment=face["alignment"],
        route=result["primary_smoothing"]["route"], source=result["source"],
        native_final_point_input_used=False, product_parity_verified=False,
        stages=dict(seed_160=None if seed is None else seed.tolist(), decoded_120=decoded.tolist(),
                    mapped_120=mapped.tolist(), smoothed=smoothed.tolist(), normalized=normalized.tolist(),
                    filters=[filter_snapshot(state=state.first33), filter_snapshot(state=state.last73)]))
    # Strict JSON both detaches the callback's object graph and rejects nonfinite diagnostics.
    return json.loads(json.dumps(snapshot, allow_nan=False))
