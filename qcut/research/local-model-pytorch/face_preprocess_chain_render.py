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
from face_preprocess_chain_replay import SOURCE_NAMES, finish, sources
import face_owned_replay_e2e as owned
import face_render_consumer_probe as consumer
import face_render_sequence_probe as sequence
from face_render_stability_probe import digest


def load_candidate(*, path, context, locked):
    evidence = locked.json(path=path.with_name("report.json"))
    required = ("passed", "completed", "geometry_exact", "final_consumer_parity",
                "independent_120_sampling_input_used", "independent_160_sampling_input_used",
                "owned_initialization_used", "owned_temporal_smoothing_used")
    forbidden = ("captured_tensor_input_used", "native_final_point_input_used", "native_smoothing_seed_required",
                 "native_analysis_bypassed", "product_parity_verified", "arbitrary_frame_backend_connected")
    if (evidence.get("profile") != "actual-preprocess-owned-chain-v1" or
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
        root = args.capture.resolve(strict=True)
        context = capture.load(root=root, locked=locked)
        path = args.candidate.resolve(strict=True)
        value, payload = load_candidate(path=path, context=context, locked=locked)
        (out / "replay.bin").write_bytes(payload)
        locked.read(path=out / "replay.bin", maximum=owned.REPLAY_LIMIT)
        view = input_view(directory=out / "input-view", context=context, locked=locked)
        report.update(capture=str(root), capture_sha256=locked.files[str(root / "report.json")],
                      candidate=str(path), replay_sha256=locked.files[str(path)],
                      runtime=str(context["runtime"]), package=str(context["package"]),
                      host_sha256=locked.files[str(context["host"])], width=1448, height=1086,
                      frames=[{key: item for key, item in frame.items() if key != "input"} for frame in context["frames"]],
                      source_sha256=sources(names=(*SOURCE_NAMES, "face_preprocess_chain_render.py"), locked=locked),
                      warmup_requests_per_host=6, seeks_per_request=2)
        entry = dict(name="candidate")
        report["runs"].append(entry)
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
    report = run(args=parser.parse_args())
    print(json.dumps({key: report[key] for key in ("passed", "pixel_parity_verified", "external_replay_verified")}))


if __name__ == "__main__":
    main()
