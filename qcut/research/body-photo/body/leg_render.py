"""Render owned leg-width controls with the existing pose model and one photo sample."""
import hashlib
import json
import time

import numpy as np
from PIL import Image

if __package__:
    from .control_contract import LEG_CONTROLS, to_engine_controls
    from .leg_shape import build_leg_delta, resample_grid_delta, safe_leg_delta
else:
    from control_contract import LEG_CONTROLS, to_engine_controls
    from leg_shape import build_leg_delta, resample_grid_delta, safe_leg_delta


def run(*, engine, rgba, controls, runtime, output, report):
    from body_mesh_grid import make_grid, pack_vertices

    started = time.monotonic()
    networks = engine.load_networks(runtime=runtime)
    pose, perception = engine.still_pose(rgba=rgba, networks=networks)
    height, width = rgba.shape[:2]
    details = {"identity": True, "pose": pose, "perception": perception, "models": networks.provenance,
               "ownedExtension": "segment-local-leg-width-v1", "backgroundProtection": False,
               "reason": "no person detected" if pose is None else None}
    base, uv, triangles, _ = make_grid(width, height, 80, 80)
    previous = np.zeros_like(base)
    parts, state = {}, None
    if pose is not None:
        old_controls = to_engine_controls(controls=controls)
        targets = engine.internal_targets(values=old_controls)
        if any(targets.values()):
            state, faces = engine.still_frame(rgba=rgba, points=pose, algorithm_size=perception["algorithmSize"],
                                              targets=targets, runtime=runtime)
            previous = resample_grid_delta(delta=state["positions"] - state["base"], rows=80, cols=80)
            parts = engine.part_summary(result=state)
            details.update(faces=faces, updates=engine.STILL_UPDATES)
    eligible_pose = pose if perception.get("coarsePeople") == 1 else None
    requested = {name: controls[name] for name in LEG_CONTROLS}
    leg_delta, leg_parts = build_leg_delta(base=base, pose=eligible_pose,
        algorithm_size=perception.get("algorithmSize"), width=width, height=height, controls=requested)
    if pose is not None and eligible_pose is None:
        for item in leg_parts.values():
            if item["intensity"]:
                item["reason"] = "exactly one detected person is required"
    leg_delta, scale = safe_leg_delta(base=base, existing_delta=previous, leg_delta=leg_delta, triangles=triangles)
    for item in leg_parts.values():
        item["safetyScale"] = scale if item["moved"] else 0
        if item["moved"] and not scale:
            item.update(moved=False, reason="combined mesh would fold; leg width was not applied")
    parts.update(leg_parts)
    details.update(parts=parts, grid=[80, 80], legGeometry={"sampling": "single shared photo warp",
                   "range": [-50, 50], "negative": "narrow", "positive": "widen", "safetyScale": scale})
    result = rgba.copy()
    if state is not None and not np.any(leg_delta):
        base, uv, triangles = state["base"], state["uv"], state["tri"]
        positions = state["positions"]
        details["grid"] = list(engine.GRID)
    else:
        positions = base + previous + leg_delta
    if np.any(positions != base):
        vertices = pack_vertices(positions, uv, width, height)
        result, host = engine.draw_mesh(rgba=rgba, vertices=vertices, triangles=triangles, runtime=runtime)
        details.update(identity=False, metal=host)
    elif pose is not None:
        details["reason"] = "no body part applies to this pose"
    receipt = {"scope": "original-photo-smart-body-and-owned-leg-width-PNG", "controls": controls,
        "width": width, "height": height, **details, "independence": engine.process_images(),
        "privateAssetDependency": True, "fixedLandmarks": False, "nativeGeometryUsed": False,
        "videoVerified": False, "nativeProductParityVerified": False,
        "inputRgbaSha256": hashlib.sha256(rgba.tobytes()).hexdigest(),
        "outputRgbaSha256": hashlib.sha256(result.tobytes()).hexdigest(),
        "changedPixels": int(np.count_nonzero(np.any(result != rgba, axis=-1))),
        "milliseconds": round((time.monotonic() - started) * 1000)}
    Image.fromarray(result).save(output)
    report.write_text(json.dumps(engine.plain(receipt), indent=2, allow_nan=False) + "\n", encoding="utf-8")
    return receipt
