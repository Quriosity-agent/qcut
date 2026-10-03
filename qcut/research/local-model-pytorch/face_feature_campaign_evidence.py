"""Full-size PNG evidence for an audited owned-120/160 UI export."""
import io
import json
from pathlib import Path

from PIL import Image

from face_alignment_replay import LockedFiles
from face_live_validation_report import accepted_frames, difference
import face_preprocess_chain_audit as audit
import face_render_sequence_probe as sequence
from face_render_stability_probe import digest


def acceptance(*, candidate, rendered, proof):
    if (candidate.get("profile") != "actual-preprocess-owned-chain-v1"
            or rendered.get("profile") != "actual-preprocess-owned-chain-render-v1"
            or proof.get("profile") != "actual-preprocess-owned-chain-audit-v1"):
        raise ValueError("owned chain profiles required; temporal/native-only evidence is insufficient")
    audit.flags(evidence=candidate, positive=("passed", "completed", "geometry_exact", "final_consumer_parity",
        "independent_120_sampling_input_used", "independent_160_sampling_input_used", "owned_initialization_used",
        "owned_temporal_smoothing_used"), negative=("captured_tensor_input_used", "native_final_point_input_used",
        "native_160_sampling_input_required", "native_inference_called", "native_analysis_bypassed", "diagnostic_only",
        "product_parity_verified", "arbitrary_frame_backend_connected"))
    audit.flags(evidence=rendered, positive=("passed", "completed", "external_replay_verified", "pixel_parity_verified"),
                negative=("native_analysis_bypassed", "product_parity_verified", "arbitrary_frame_backend_connected"))
    audit.flags(evidence=proof, positive=("passed", "completed", "geometry_exact", "final_consumer_parity",
        "pixel_parity_verified", "external_replay_verified", "fixed_profile_only"),
        negative=("native_execution_performed", "inference_performed", "product_parity_verified",
                  "arbitrary_frame_backend_connected", "independent_full_frame_preprocessing"))


def frame_pngs(*, pixels, directory, index, width, height):
    size = width * height * 4
    if set(pixels) != {"original", "native", "candidate"} or any(len(data) != size for data in pixels.values()):
        raise ValueError("three exact RGBA images required")
    files, metrics = {}, {}
    for name, data in pixels.items():
        filename = f"frame-{index:02d}-{name}.png"
        Image.frombytes("RGBA", (width, height), data).save(directory / filename)
        files[name] = dict(path=filename, rgba_sha256=digest(data=data),
                           png_sha256=digest(data=(directory / filename).read_bytes()))
    for reference, actual in (("original", "native"), ("original", "candidate"), ("native", "candidate")):
        name = reference + "-" + actual
        values, gray = difference(actual=pixels[actual], reference=pixels[reference], width=width, height=height)
        filename = f"frame-{index:02d}-{name}-gain8.png"
        gray.save(directory / filename)
        metrics[name] = dict(**values, path=filename, png_sha256=digest(data=(directory / filename).read_bytes()))
    return dict(index=index, files=files, metrics=metrics)


def export_temporal_pngs(*, root, directory):
    locked = LockedFiles()
    evidence = accepted_frames(root=root, directory=directory, locked=locked)
    candidate = locked.json(path=root / "replay/report.json")
    rendered = locked.json(path=root / "render/report.json")
    audit.flags(evidence=candidate, positive=("passed", "completed", "geometry_exact", "independent_120_sampling_input_used",
                "owned_initialization_used", "owned_temporal_smoothing_used", "native_160_sampling_input_required"),
                negative=("independent_160_sampling_input_used", "diagnostic_only"))
    audit.flags(evidence=rendered, positive=("passed", "completed", "external_replay_verified", "pixel_parity_verified"),
                negative=("diagnostic_only",))
    rows = []
    for number in range(7):
        pixels = {role: locked.read(path=path, maximum=1448 * 1086 * 4) for role, path in (
            ("original", root / f"probe/input-{number:02d}.rgba"),
            ("native", root / f"probe/baseline/frame-{number:02d}.rgba"),
            ("candidate", root / f"render/frame-{number:02d}.rgba"))}
        row = frame_pngs(pixels=pixels, directory=directory, index=number, width=1448, height=1086)
        if row["metrics"]["native-candidate"]["changed_pixels"] != 0:
            raise ValueError("temporal candidate pixels differ")
        rows.append(row)
    locked.verify()
    return dict(**evidence, png_frames=rows, candidate_parity=False, native_only=False,
                bounded_native160_conditioned_render_parity=True, independent_160_sampling=False,
                product_parity_verified=False, arbitrary_frame_backend_connected=False,
                scope="owned120/ONNX/seed/smoothing/points; native160 tensor still required")


def export_pngs(*, root, directory, report_sha256):
    locked = LockedFiles()
    exported = json.loads(locked.read(path=root / "report.json", expected=report_sha256))
    audit.flags(evidence=exported, positive=("passed", "completed"),
                negative=("product_parity_verified", "arbitrary_frame_backend_connected"))
    audit.fixtures(evidence=exported, locked=locked)
    index = json.loads(locked.read(path=root / "index.json", expected=exported["index_sha256"]))
    if index.get("format") != "qcut-beauty-lab-owned-chain-v1" or len(index.get("frames", [])) != 7:
        raise ValueError("seven-frame independently audited export required")
    for name, expected in index["source_sha256"].items():
        source = sequence.PRIVATE.parents[1] / "research" / name
        if not source.resolve(strict=True).is_relative_to(Path(__file__).resolve().parents[1]):
            raise ValueError("declared source outside research")
        locked.read(path=source, expected=expected)
    reports = {key: json.loads(locked.read(path=root / "reports" / f"{key}.json", expected=index["reports"][key]))
               for key in ("candidate", "render", "model")}
    proof_paths = [Path(name) for name, expected in exported["fixture_sha256"].items()
                   if expected == exported["audit_sha256"]]
    if len(proof_paths) != 1:
        raise ValueError("unique hash-bound audit report required")
    proof = json.loads(locked.read(path=proof_paths[0], expected=exported["audit_sha256"]))
    acceptance(candidate=reports["candidate"], rendered=reports["render"], proof=proof)
    audit.fixtures(evidence=proof, locked=locked)
    for key in ("candidate", "render", "model"):
        audit.same(actual=index["reports"][key], expected=proof[f"{key}_report_sha256"], label=key + " report link")
    manifest = json.loads(locked.read(path=root / "manifest.json", expected=index["manifest_sha256"]))
    frames = sequence.validate_manifest(value=manifest, base=root)
    if len(frames) != 7:
        raise ValueError("complete comparison manifest required")
    directory.mkdir(mode=0o700)
    rows = []
    for number, (record, frame) in enumerate(zip(index["frames"], frames, strict=True)):
        audit.same(actual=record["index"], expected=number, label="frame index")
        original = locked.read(path=root / f"frames/input-{number:02d}.png", expected=record["input_png_sha256"])
        with Image.open(io.BytesIO(original)) as image:
            sequence.validate_dimensions(width=image.width, height=image.height, expected=(1448, 1086))
            rgba = image.convert("RGBA").tobytes()
        audit.same(actual=digest(data=rgba), expected=record["input_rgba_sha256"], label="original pixels")
        pixels = dict(original=rgba)
        for role in ("native", "candidate"):
            pixels[role] = locked.read(path=root / f"frames/{role}-{number:02d}.rgba",
                                      maximum=1448 * 1086 * 4, expected=record[f"{role}_rgba_sha256"])
        row = frame_pngs(pixels=pixels, directory=directory, index=number, width=1448, height=1086)
        if row["metrics"]["native-candidate"]["changed_pixels"] != 0:
            raise ValueError("candidate differs from native RGBA")
        if (row["metrics"]["original-native"]["changed_pixels"] > 0) != frame["expect_change"]:
            raise ValueError("nonzero effect or no-face/zero-effect control failed")
        rows.append(dict(**row, parameters=frame["parameters"], timestamp=frame["timestamp"], label=frame["label"]))
    locked.verify()
    return dict(candidate_parity=True, independent_120_sampling=True, independent_160_sampling=True,
                frames=rows, head_comparisons=proof["head_comparisons"], conversions=proof["normalized_conversions"],
                source_count=len(index["source_sha256"]), source_sha256=index["source_sha256"],
                audit_sha256=exported["audit_sha256"], export_report_sha256=report_sha256,
                diff="min(255, 8 * max(abs(delta RGB))); alpha separately measured; no normalization",
                product_parity_verified=False, arbitrary_frame_backend_connected=False,
                independent_full_frame_preprocessing=False, fixture_sha256=dict(locked.files))
