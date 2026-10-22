"""Connect file-backed ONNX perception to the existing owned body geometry."""
import hashlib
from pathlib import Path

if __package__:
    from . import cpu_raster, leg_render, edit_render
    from .runtime_paths import runtime_root
    from .import_engine import ASSETS, regular_bytes, verify_source
    from .portable_models import load_skeleton, verify_models
    from .onnx_mask import verified_model_bytes, get_person_mask, MODEL_SHA256
    from .native_inventory import get_native_inventory
    from .portable_pose import evaluate_long_leg
    from .portable_leg import adjust_long_leg
    from .portable_background import protect_background
    from .photo_controls import EXTRA_RANGES, legacy_controls
else:
    from runtime_paths import runtime_root
    import cpu_raster
    import leg_render
    import edit_render
    from import_engine import ASSETS, regular_bytes, verify_source
    from portable_models import load_skeleton, verify_models
    from onnx_mask import verified_model_bytes, get_person_mask, MODEL_SHA256
    from native_inventory import get_native_inventory
    from portable_pose import evaluate_long_leg
    from portable_leg import adjust_long_leg
    from portable_background import protect_background
    from photo_controls import EXTRA_RANGES, legacy_controls


def verify_portable(*, body_root):
    runtime = runtime_root(body_root=body_root)
    face_files = {name: pin for name, pin in ASSETS.items() if not name.endswith("body-skeleton-v1.npz")}
    for name, (size, digest) in face_files.items():
        data = regular_bytes(root=runtime / "body", name=name)
        if len(data) != size or hashlib.sha256(data).hexdigest() != digest:
            raise ValueError("portable face data integrity failed: " + name)
    mask = verified_model_bytes(path=runtime / "body-portable" / "models"
                                / "human_segmentation_pphumanseg_2023mar.onnx")
    return {"verified": True, **verify_source(body_root=body_root),
            "faceFiles": len(face_files), "skeleton": verify_models(runtime=runtime / "body-portable"),
            "personMask": {"bytes": len(mask), "sha256": MODEL_SHA256},
            "skeletonNpzRequired": False}


class PortableEngine:
    def __init__(self, *, engine, body_root):
        self.engine = engine
        self.portable_runtime = runtime_root(body_root=body_root) / "body-portable"
        self.pose_perception = None

    def __getattr__(self, name):
        return getattr(self.engine, name)

    def load_networks(self, *, runtime):
        return load_skeleton(runtime=self.portable_runtime)

    def draw_mesh(self, **arguments):
        return cpu_raster.draw_mesh(**arguments)

    def process_images(self):
        return get_native_inventory()

    def still_pose(self, **arguments):
        pose, perception = self.engine.still_pose(**arguments)
        self.pose_perception = perception
        return pose, perception

    def still_frame(self, *, rgba, points, algorithm_size, targets, runtime):
        height, width = rgba.shape[:2]
        requested = targets.get("LongLeg", 0)
        if not requested:
            return self.engine.still_frame(rgba=rgba, points=points, algorithm_size=algorithm_size,
                                           targets=targets, runtime=runtime)
        eligibility = evaluate_long_leg(pose=points, perception=self.pose_perception,
                                        width=width, height=height)
        effective = dict(targets)
        if not eligibility["eligible"]:
            effective["LongLeg"] = 0
        state, faces = self.engine.still_frame(rgba=rgba, points=points,
            algorithm_size=algorithm_size, targets=effective, runtime=runtime)
        if eligibility["eligible"]:
            state, geometry = adjust_long_leg(state=state, eligibility=eligibility,
                                               target=requested, width=width, height=height)
        else:
            state = dict(state)
            geometry = {"moved": False, "reason": eligibility["reason"]}
        state["portableLongLeg"] = {"eligibility": eligibility, "geometry": geometry}
        return state, faces

    def part_summary(self, *, result):
        summary = self.engine.part_summary(result=result)
        safety = result.get("portableLongLeg")
        if safety is not None:
            summary = {name: dict(detail) for name, detail in summary.items()}
            leg = summary.setdefault("LongLeg", {})
            geometry = safety["geometry"]
            leg.update(portableSafety=True, moved=geometry.get("moved", False),
                       reason=geometry.get("reason"), **safety)
        return summary

    def run(self, *, rgba, controls, runtime, output, report, edits=None):
        if any(controls.get(name, 0) for name in EXTRA_RANGES) or edits and edits.get("autoButtocks", False):
            if __package__:
                from .region_render import run
            else:
                from region_render import run
            return run(engine=self, rgba=rgba, controls=controls, runtime=runtime,
                output=output, report=report, edits=edits or {"backgroundProtection": False, "strokes": []},
                mask_provider=get_person_mask, background_compositor=protect_background)
        if set(controls) & EXTRA_RANGES.keys():
            controls = legacy_controls(values=controls)
        arguments = {"engine": self, "rgba": rgba, "controls": controls,
                     "runtime": runtime, "output": output, "report": report}
        if edits is not None or not any(controls.values()):
            return edit_render.run(**arguments,
                edits=edits or {"backgroundProtection": False, "strokes": []},
                mask_provider=get_person_mask, background_compositor=protect_background)
        return leg_render.run(**arguments)
