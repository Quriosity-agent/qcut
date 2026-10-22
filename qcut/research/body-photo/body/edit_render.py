"""Compose automatic and manual geometry, then protect the original background."""
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

if __package__:
    from . import leg_render
    from .background import MASK_THRESHOLD, get_person_mask, protect_background
    from .leg_shape import resample_grid_delta
    from .local_shape import build_manual_positions
else:
    import leg_render
    from background import MASK_THRESHOLD, get_person_mask, protect_background
    from leg_shape import resample_grid_delta
    from local_shape import build_manual_positions


def touches_person(*, stroke, mask):
    height, width = mask.shape
    center = np.array(stroke["start"]) * [width, height]
    radius = stroke["radius"] * min(width, height)
    left, top = np.maximum(0, np.floor(center - radius)).astype(int)
    right, bottom = np.minimum([width, height], np.ceil(center + radius + 1)).astype(int)
    yy, xx = np.mgrid[top:bottom, left:right]
    inside = (xx - center[0]) ** 2 + (yy - center[1]) ** 2 < radius ** 2
    return bool(np.any(inside & (mask[top:bottom, left:right] >= MASK_THRESHOLD)))


class GeometryCapture:
    """Reuse the pinned solver without sampling the photograph before local edits."""

    def __init__(self, *, engine):
        self.engine = engine
        self.mesh = None

    def __getattr__(self, name):
        return getattr(self.engine, name)

    def draw_mesh(self, *, rgba, vertices, triangles, runtime):
        self.mesh = (vertices.copy(), triangles.copy())
        return rgba.copy(), {"geometryCaptured": True}


def run(*, engine, rgba, controls, edits, runtime, output, report, mask_provider=None,
        background_compositor=None):
    from body_mesh_grid import make_grid, pack_vertices

    height, width = rgba.shape[:2]
    base, uv, triangles, _ = make_grid(width, height, 80, 80)
    positions = base.copy()
    details = {"parts": {}, "reason": "zero"}
    if any(controls.values()):
        capture = GeometryCapture(engine=engine)
        details = leg_render.run(engine=capture, rgba=rgba, controls=controls, runtime=runtime,
                                 output=output, report=report)
        if capture.mesh is not None:
            vertices, triangles = capture.mesh
            side = int(round(np.sqrt(len(vertices))))
            if side * side != len(vertices):
                raise ValueError("expected a regular body grid")
            size = np.array([width, height], np.float32)
            base = (vertices[:, 3:] * size).reshape(side, side, 2)
            uv = vertices[:, 3:].reshape(side, side, 2)
            positions = ((vertices[:, :2] + 1) * .5 * size).reshape(side, side, 2)
            if edits["strokes"]:
                delta = resample_grid_delta(delta=positions - base, rows=80, cols=80)
                base, uv, triangles, _ = make_grid(width, height, 80, 80)
                positions = base + delta
    source_mask, segmentation = None, None
    automatic_moved = bool(np.any(np.abs(positions - base) > 1e-4))
    manual_requested = any(stroke["start"] != stroke["end"] for stroke in edits["strokes"])
    if edits["backgroundProtection"] and (manual_requested or automatic_moved):
        try:
            provider = get_person_mask if mask_provider is None else mask_provider
            source_mask, segmentation = provider(rgba=rgba, work=Path(output).parent)
        except (ValueError, OSError, RuntimeError) as error:
            raise ValueError("background protection: " + str(error)) from error
    manual = {"moved": False, "strokes": []}
    if edits["strokes"]:
        guard_mask = source_mask
        if source_mask is not None and automatic_moved:
            mask_rgba = np.repeat(source_mask[..., None], 4, axis=-1)
            mask_rgba[..., 3] = 255
            before_manual, _ = engine.draw_mesh(rgba=mask_rgba,
                vertices=pack_vertices(positions, uv, width, height), triangles=triangles, runtime=runtime)
            guard_mask = np.maximum(source_mask, before_manual[..., 0])
        eligible = [guard_mask is None or touches_person(stroke=stroke, mask=guard_mask)
                    for stroke in edits["strokes"]]
        candidate, manual = build_manual_positions(base=positions, strokes=edits["strokes"], width=width, height=height)
        if not all(eligible):
            selected = [stroke if enabled else {**stroke, "end": stroke["start"]}
                        for stroke, enabled in zip(edits["strokes"], eligible)]
            candidate, manual = build_manual_positions(base=positions, strokes=selected, width=width, height=height)
        positions = candidate
        for item, enabled in zip(manual["strokes"], eligible):
            if not enabled:
                item["reason"] = "brush lies wholly on protected background"
    moved = bool(np.any(np.abs(positions - base) > 1e-4))
    background = {"requested": edits["backgroundProtection"], "applied": False,
                  "reason": "no deformation"}
    result = rgba.copy()
    if moved:
        vertices = pack_vertices(positions, uv, width, height)
        result, host = engine.draw_mesh(rgba=rgba, vertices=vertices, triangles=triangles, runtime=runtime)
        details["metal"] = host
        if edits["backgroundProtection"]:
            try:
                mask_rgba = np.repeat(source_mask[..., None], 4, axis=-1)
                mask_rgba[..., 3] = 255
                warped_rgba, mask_host = engine.draw_mesh(rgba=mask_rgba, vertices=vertices,
                                                          triangles=triangles, runtime=runtime)
                composite = protect_background if background_compositor is None else background_compositor
                result, protected = composite(original=rgba, warped=result,
                    source_mask=source_mask, warped_mask=warped_rgba[..., 0])
                background = {"requested": True, "applied": True,
                              **protected, "segmentation": segmentation, "maskMetal": mask_host}
            except (ValueError, OSError, RuntimeError) as error:
                raise ValueError("background protection: " + str(error)) from error
    changed = int(np.count_nonzero(np.any(result != rgba, axis=-1)))
    manual["appliedCount"] = sum(item.get("affectedVertices", 0) > 0 and item.get("scale", 0) > 0
                                 for item in manual.get("strokes", [])) if changed else 0
    receipt = {**details, "controls": controls, "edits": edits,
        "photoEdits": {"manual": manual, "backgroundProtection": background},
        "scope": "static-photo-body-local-reshape-background",
        "sampling": "one photograph warp; person mask uses identical mesh",
        "identity": not changed, "independence": engine.process_images(),
        "nativeGeometryUsed": False, "fixedLandmarks": False, "videoVerified": False,
        "nativeProductParityVerified": False,
        "inputRgbaSha256": hashlib.sha256(rgba.tobytes()).hexdigest(),
        "outputRgbaSha256": hashlib.sha256(result.tobytes()).hexdigest(),
        "changedPixels": changed}
    Image.fromarray(result).save(output)
    report.write_text(json.dumps(engine.plain(receipt), indent=2, allow_nan=False) + "\n", encoding="utf-8")
    return receipt
