"""CPU-only body regions and skin, composed with the original photo once."""
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

if __package__:
    from . import leg_render
    from .edit_render import GeometryCapture, touches_person
    from .leg_shape import resample_grid_delta, safe_leg_delta
    from .local_shape import build_manual_positions
    from .photo_controls import REGION_CONTROLS, SKIN_CONTROLS, legacy_controls
    from .region_shape import build_region_delta
    from .body_skin import apply_body_skin
    from .glute_lift import build_glute_delta
    from .glute_analysis import analyze_contours
else:
    import leg_render
    from edit_render import GeometryCapture, touches_person
    from leg_shape import resample_grid_delta, safe_leg_delta
    from local_shape import build_manual_positions
    from photo_controls import REGION_CONTROLS, SKIN_CONTROLS, legacy_controls
    from region_shape import build_region_delta
    from body_skin import apply_body_skin
    from glute_lift import build_glute_delta
    from glute_analysis import analyze_contours


def _face_seeds(*, rgba, runtime):
    from body_face_sequence import BodyFaceSequence
    from body_skeleton_decode import algorithm_image

    sequence = BodyFaceSequence(model_root=runtime / "research")
    face = sequence.update(algorithm_image(rgba))
    if face is None:
        return None
    scale = np.array([rgba.shape[1] / sequence.size[0], rgba.shape[0] / sequence.size[1]])
    return {"landmarks": np.asarray(face["result"]["points"]) * scale,
            "box": np.asarray(sequence.detection["box"]) * np.tile(scale, 2),
            "score": sequence.detection["score"]}


def _warp_mask(*, engine, mask, vertices, triangles, runtime):
    pixels = np.repeat(mask[..., None], 4, axis=-1)
    pixels[..., 3] = 255
    warped, _ = engine.draw_mesh(rgba=pixels, vertices=vertices, triangles=triangles, runtime=runtime)
    return warped[..., 0]


def run(*, engine, rgba, controls, edits, runtime, output, report, mask_provider, background_compositor):
    from body_mesh_grid import make_grid, pack_vertices

    height, width = rgba.shape[:2]
    base, uv, triangles, _ = make_grid(width, height, 80, 80)
    positions = base.copy()
    capture = GeometryCapture(engine=engine)
    details = leg_render.run(engine=capture, rgba=rgba, controls=legacy_controls(values=controls),
                             runtime=runtime, output=output, report=report)
    if capture.mesh is not None:
        vertices, _ = capture.mesh
        side = int(round(np.sqrt(len(vertices))))
        if side * side != len(vertices):
            raise ValueError("expected a regular body grid")
        size = np.array([width, height], np.float32)
        old_base = (vertices[:, 3:] * size).reshape(side, side, 2)
        old_positions = ((vertices[:, :2] + 1) * .5 * size).reshape(side, side, 2)
        positions += resample_grid_delta(delta=old_positions - old_base, rows=80, cols=80)
    pose, perception = details.get("pose"), details.get("perception", {})
    eligible_pose = pose if perception.get("coarsePeople") == 1 else None
    selection = edits.get("buttocks")
    automatic = edits.get("autoButtocks", False) and selection is None
    mask, segmentation, mask_error = None, None, None
    detection = None
    if automatic:
        try:
            mask, segmentation = mask_provider(rgba=rgba, work=Path(output).parent)
        except (ValueError, OSError, RuntimeError) as error:
            mask_error = str(error)
        detection = analyze_contours(rgba=rgba, person_mask=mask, pose=pose,
            perception=perception, mask_error=mask_error)
        selection = detection.get("selection") if detection["available"] else None
    region_controls = {**controls, "ButtLift": 0} if selection or automatic else controls
    delta, parts = build_region_delta(base=base, pose=eligible_pose,
        algorithm_size=perception.get("algorithmSize"), width=width, height=height, controls=region_controls)
    if selection:
        lift, parts["ButtLift"] = build_glute_delta(base=base, width=width, height=height,
            intensity=controls.get("ButtLift", 0), selection=selection)
        delta += lift
    if automatic:
        parts["ButtLift"].update(anchorSource="automatic-pose-silhouette-contour",
            contourLandmarksDetected=bool(detection["available"]), anatomicalLandmarksDetected=False,
            automaticDetection=detection)
        if not detection["available"] and controls.get("ButtLift"):
            parts["ButtLift"].update(intensity=controls["ButtLift"] / 100, reason=detection["reason"])
    delta, scale = safe_leg_delta(base=base, existing_delta=positions - base,
                                 leg_delta=delta, triangles=triangles)
    for name, item in parts.items():
        item["safetyScale"] = scale if item["moved"] else 0
        if item["moved"] and not scale:
            item.update(moved=False, reason="combined mesh would fold")
        if controls.get(name) and eligible_pose is None and not (name == "ButtLift" and selection):
            item.update(moved=False, reason="exactly one reliably detected person is required")
    positions += delta
    region_moved = bool(np.any(np.abs(delta) > 1e-4))
    automatic_moved = bool(np.any(np.abs(positions - base) > 1e-4))
    skin_requested = any(controls.get(name, 0) for name in SKIN_CONTROLS)
    manual_requested = any(stroke["start"] != stroke["end"] for stroke in edits["strokes"])
    if mask is None and (skin_requested or edits["backgroundProtection"] and (automatic_moved or manual_requested)):
        try:
            mask, segmentation = mask_provider(rgba=rgba, work=Path(output).parent)
        except (ValueError, OSError, RuntimeError) as error:
            if edits["backgroundProtection"] and (automatic_moved or manual_requested):
                raise ValueError("background protection: " + str(error)) from error
            mask_error = str(error)
    source = rgba
    if skin_requested:
        faces = None
        if eligible_pose is not None and mask is not None:
            try:
                faces = _face_seeds(rgba=rgba, runtime=runtime)
            except (ValueError, OSError, RuntimeError) as error:
                mask_error = "face skin seeds unavailable: " + str(error)
        if mask is not None and eligible_pose is not None:
            source, skin_parts = apply_body_skin(rgba=rgba, person_mask=mask, pose=pose,
                algorithm_size=perception.get("algorithmSize"), controls=controls, faces=faces)
        else:
            skin_parts = {name: {"intensity": controls.get(name, 0) / 100, "moved": False,
                "reason": mask_error or "one reliable person and exposed skin are required"}
                for name in SKIN_CONTROLS}
        parts.update(skin_parts)
    manual = {"moved": False, "strokes": []}
    if edits["strokes"]:
        guard_mask = mask
        if edits["backgroundProtection"] and mask is not None and automatic_moved:
            vertices = pack_vertices(positions, uv, width, height)
            guard_mask = np.maximum(mask, _warp_mask(engine=engine, mask=mask, vertices=vertices,
                                                     triangles=triangles, runtime=runtime))
        eligible = [not edits["backgroundProtection"] or guard_mask is None
                    or touches_person(stroke=stroke, mask=guard_mask) for stroke in edits["strokes"]]
        selected = [stroke if enabled else {**stroke, "end": stroke["start"]}
                    for stroke, enabled in zip(edits["strokes"], eligible)]
        positions, manual = build_manual_positions(base=positions, strokes=selected, width=width, height=height)
        for item, enabled in zip(manual["strokes"], eligible):
            if not enabled:
                item["reason"] = "brush lies wholly on protected background"
    moved = bool(np.any(np.abs(positions - base) > 1e-4))
    result = source.copy()
    background = {"requested": edits["backgroundProtection"], "applied": False, "reason": "no deformation"}
    grid = [80, 80]
    if moved:
        if capture.mesh is not None and not region_moved and not edits["strokes"]:
            vertices, triangles = capture.mesh
            side = int(round(np.sqrt(len(vertices)))) - 1
            grid = [side, side]
        else:
            vertices = pack_vertices(positions, uv, width, height)
        result, host = engine.draw_mesh(rgba=source, vertices=vertices, triangles=triangles, runtime=runtime)
        details["metal"] = host
    if edits["backgroundProtection"] and np.any(result != rgba):
        try:
            warped_mask = (_warp_mask(engine=engine, mask=mask, vertices=vertices,
                                     triangles=triangles, runtime=runtime) if moved else mask)
            result, protected = background_compositor(original=rgba, warped=result,
                source_mask=mask, warped_mask=warped_mask)
            background = {"requested": True, "applied": True, **protected, "segmentation": segmentation}
        except (ValueError, OSError, RuntimeError) as error:
            raise ValueError("background protection: " + str(error)) from error
    changed = int(np.count_nonzero(np.any(result != rgba, axis=-1)))
    manual["appliedCount"] = sum(item.get("affectedVertices", 0) > 0 and item.get("scale", 0) > 0
                                 for item in manual.get("strokes", [])) if changed else 0
    receipt = {**details, "controls": controls, "parts": {**details.get("parts", {}), **parts},
        "edits": edits, "photoEdits": {"manual": manual, "backgroundProtection": background,
            **({"buttocksDetection": detection} if detection is not None else {})},
        "scope": "static-photo-owned-regions-and-body-skin", "grid": grid,
        "sampling": "skin on original before one shared photograph warp", "identity": not changed,
        "regionGeometry": {"safetyScale": scale, "controls": list(REGION_CONTROLS)},
        "independence": engine.process_images(), "nativeGeometryUsed": False, "fixedLandmarks": False,
        "nativeProductParityVerified": False, "videoVerified": False,
        "inputRgbaSha256": hashlib.sha256(rgba.tobytes()).hexdigest(),
        "outputRgbaSha256": hashlib.sha256(result.tobytes()).hexdigest(), "changedPixels": changed}
    Image.fromarray(result).save(output)
    report.write_text(json.dumps(engine.plain(receipt), indent=2, allow_nan=False) + "\n", encoding="utf-8")
    return receipt
