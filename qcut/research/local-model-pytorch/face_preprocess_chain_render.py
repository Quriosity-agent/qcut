"""Consume the independently sampled ONNX point replay in the actual renderer.

Native analysis stays active; this is bounded replay consumption, not a live
candidate driver or evidence that the native runtime can be removed.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from face_alignment_replay import LockedFiles, point_difference, strict_json
import face_host_geometry_sequence_render as render
import face_preprocess_chain_capture as capture
import face_preprocess_chain_replay as chain
from face_preprocess_chain_replay import finish, sources
import face_owned_replay_e2e as owned
import face_render_consumer_probe as consumer
import face_render_sequence_probe as sequence
from face_render_stability_probe import digest

MODEL_SOURCES = ("face_render_model_parity.py", "face_render_model_capture.py",
                 "face_alignment_heads_parity.py", "face_alignment_replay.py",
                 "espresso_onnx_runtime.py", "espresso_graph.py", "espresso_oracle.py",
                 "face_render_sequence_probe.py", "face_render_consumer_probe.py",
                 "face_render_stability_probe.py")


def model_sources(*, model, locked):
    values = model.get("source_sha256")
    if not isinstance(values, dict) or set(values) != set(MODEL_SOURCES):
        raise ValueError("complete model source inventory required")
    render.sources(locked=locked, evidence=dict(source_sha256={
        "local-model-pytorch/" + name: expected for name, expected in values.items()}))


def verify_original_points(*, path, evidence, context, value, locked):
    directory = path.parent / "onnx"
    chain.parity.require_sha256(value=evidence.get("model_report_sha256"))
    model = locked.json(path=directory / "report.json", expected=evidence["model_report_sha256"])
    model_sources(model=model, locked=locked)
    for size in (120, 160):
        for case in model["model_outputs"][str(size)]["cases"]:
            head = directory / f"size-{size}-infer-{case['inference']:03d}-fc_landmark_s1.npy"
            expected = evidence["fixture_sha256"].get(str(head))
            # Never backfill an omitted producer identity with a hash of today's file.
            chain.parity.require_sha256(value=expected)
            locked.array(path=head, shape=(1, 1, 1, 212), dtype="float32", expected=expected)
    produced, cases = chain.produce(context=context, model=model, directory=directory, locked=locked)
    for actual, expected, label in ((value, produced, "owned normalized replay"),
                                    (evidence.get("cases"), cases, "owned geometry/smoothing")):
        if json.dumps(actual, sort_keys=True, allow_nan=False) != json.dumps(expected, sort_keys=True, allow_nan=False):
            raise ValueError(f"{label} differs from recomputed original-frame heads")
    locked.verify()


def load_candidate(*, path, context, locked, original_frames=False):
    evidence = locked.json(path=path.with_name("report.json"))
    required = ("passed", "completed", "geometry_exact", "final_consumer_parity",
                "independent_120_sampling_input_used", "independent_160_sampling_input_used",
                "owned_initialization_used", "owned_temporal_smoothing_used")
    forbidden = ("captured_tensor_input_used", "native_final_point_input_used", "native_smoothing_seed_required",
                 "native_analysis_bypassed", "product_parity_verified", "arbitrary_frame_backend_connected")
    if (evidence.get("profile") != chain.profile(original_frames=original_frames) or
            any(evidence.get(key) is not True for key in required) or
            any(evidence.get(key) is not False for key in forbidden) or
            evidence.get("capture_sha256") != locked.files[str(context["root"] / "report.json")] or
            evidence.get("owned_smoothing_seed_predictions") != [0, 20] or
            evidence.get("native_smoothing_seed_predictions") != []):
        raise ValueError("passed independently sampled chain bound to this capture required")
    fixtures = evidence.get("fixture_sha256")
    if not isinstance(fixtures, dict) or not 1 <= len(fixtures) <= 4096:
        raise ValueError("bounded candidate fixture identities required")
    for name, expected in fixtures.items():
        if not isinstance(name, str) or not Path(name).is_absolute():
            raise ValueError("absolute candidate fixture identity required")
        render.hashed(locked=locked, path=Path(name), expected=expected)
    render.sources(locked=locked, evidence=evidence)
    if original_frames:
        expected_sources = {"local-model-pytorch/" + name for name in chain.ORIGINAL_SOURCE_NAMES}
        if set(evidence["source_sha256"]) != expected_sources:
            raise ValueError("complete original-frame producer source inventory required")
        for name, expected in evidence["source_sha256"].items():
            if fixtures.get(str((render.SOURCE_ROOT / name).resolve(strict=True))) != expected:
                raise ValueError("original-frame source must also be a pinned producer fixture")
        chain.verify_original_inputs(evidence=evidence, context=context, directory=path.parent, locked=locked)
    data = render.hashed(locked=locked, path=path, expected=evidence.get("replay_sha256"), maximum=owned.REPLAY_LIMIT)
    value = strict_json(data=data)
    reference = context["native"]
    payload = consumer.validate_replay(value=value, width=1448, height=1086, image_hash=reference["image_sha256"],
                                      maximum_timestamp_us=consumer.REPLAY_TIME_LIMIT_US)
    if len(value["frames"]) != 24:
        raise ValueError("exact 24 owned conversion payloads required")
    for actual, expected in zip(value["frames"], reference["frames"], strict=True):
        if (actual["timestamp_us"] != expected["timestamp_us"] or
                [face["id"] for face in actual["faces"]] != [face["id"] for face in expected["faces"]]):
            raise ValueError("candidate conversion timestamps or face identities differ")
        for face, oracle in zip(actual["faces"], expected["faces"], strict=True):
            if not point_difference(actual=np.asarray(face["points"], np.float32),
                                    expected=np.asarray(oracle["points"], np.float32), tolerance=0)["exact"]:
                raise ValueError("candidate normalized points differ; diagnostic rendering is not accepted")
    if original_frames:
        verify_original_points(path=path, evidence=evidence, context=context, value=value, locked=locked)
    return value, payload


def input_view(*, directory, context, locked):
    directory.mkdir(mode=0o700)
    for index, frame in enumerate(context["frames"]):
        source = frame["input"]
        target = directory / f"input-{index:02d}.rgba"
        target.symlink_to(source)
        locked.read(path=target, maximum=1448 * 1086 * 4, expected=locked.files[str(source)])
    (directory / "baseline").symlink_to(context["root"] / "baseline", target_is_directory=True)
    return directory


def run(*, args):
    out, locked = sequence.fresh_output(path=args.out), LockedFiles()
    report = dict(profile="actual-preprocess-owned-chain-render-v1", passed=False, completed=False,
                  native_analysis_bypassed=False, independent_inference_verified=False,
                  product_parity_verified=False, arbitrary_frame_backend_connected=False,
                  external_replay_verified=False, pixel_parity_verified=False,
                  comparisons=[], runs=[], failures=[])
    try:
        original_frames = getattr(args, "original_frames", False)
        report["profile"] = chain.profile(stage="render", original_frames=original_frames)
        if original_frames:
            report.update(chain.original_claims(completed=False))
        root = args.capture.resolve(strict=True)
        context = capture.load(root=root, locked=locked)
        path = args.candidate.resolve(strict=True)
        mode = dict(original_frames=True) if original_frames else {}
        value, payload = load_candidate(path=path, context=context, locked=locked, **mode)
        if original_frames:
            report.update(chain.original_claims(completed=True),
                          candidate_report_sha256=locked.files[str(path.with_name("report.json"))])
        (out / "replay.bin").write_bytes(payload)
        locked.read(path=out / "replay.bin", maximum=owned.REPLAY_LIMIT)
        view = input_view(directory=out / "input-view", context=context, locked=locked)
        report.update(capture=str(root), capture_sha256=locked.files[str(root / "report.json")],
                      candidate=str(path), replay_sha256=locked.files[str(path)],
                      runtime=str(context["runtime"]), package=str(context["package"]),
                      host_sha256=locked.files[str(context["host"])], width=1448, height=1086,
                      frames=[{key: item for key, item in frame.items() if key != "input"} for frame in context["frames"]],
                      source_sha256=sources(names=(*chain.source_names(original_frames=original_frames),
                                                   "face_preprocess_chain_render.py"), locked=locked),
                      warmup_requests_per_host=6, seeks_per_request=2)
        entry = dict(name="candidate")
        report["runs"].append(entry)
        if original_frames:
            locked.verify()
        render.render_host(entry=entry, out=out, capture=view, frames=context["frames"], value=value,
                           host_path=context["host"], runtime=context["runtime"], package=context["package"], locked=locked)
        report["external_replay_verified"] = True
        render.compare_outputs(report=report, out=out, capture=view, locked=locked)
        consumer.verify_library(runtime=context["runtime"])
        report.update(passed=True, completed=True, pixel_parity_verified=True)
    except Exception as error:
        report["failures"].append(f"{type(error).__name__}: {error}")
        raise
    finally:
        finish(out=out, report=report, locked=locked)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("capture", "candidate", "out"):
        parser.add_argument(f"--{name}", required=True, type=Path)
    parser.add_argument("--original-frames", action="store_true", help="require the original-frame owned producer")
    report = run(args=parser.parse_args())
    print(json.dumps({key: report[key] for key in ("passed", "pixel_parity_verified", "external_replay_verified")}))


if __name__ == "__main__":
    main()
