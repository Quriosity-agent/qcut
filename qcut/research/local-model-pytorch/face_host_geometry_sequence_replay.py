"""Dynamic actual RGBA -> owned sampling -> ONNX -> owned point payload.

Native detection, matrices, tables, acceptance and rendering remain required.
No-face windows publish no stale points, and multi-face routing stays closed.
"""
from __future__ import annotations

import argparse
import io
import json
from pathlib import Path

import numpy as np

from face_alignment_replay import LockedFiles, point_difference, strict_json
from face_host_geometry_contract import associate_inferences, validate_sequence
from face_host_geometry_output import output_layers
from face_host_geometry_replay import decode_actual, first_points, normalized
from face_host_sampling_inputs import build_inputs, initialized_warp
import face_host_geometry_sequence_probe as observed
import face_owned_replay_e2e as owned
import face_render_consumer_probe as consumer
import face_render_model_capture as capture
import face_render_model_parity as parity
import face_render_sequence_probe as sequence
import face_temporal_smoothing_replay as smoothing
import face_host_initialization as initialization
from face_render_stability_probe import digest


def decode_case(*, snapshot, raw, native_frame=None, require_exact=True, temporal=None, initialization_seed=None):
    if type(require_exact) is not bool:
        raise ValueError("typed dynamic geometry gate required")
    active = [face for face in snapshot["faces"] if face["active"]]
    if len(active) > 1:
        raise ValueError("dynamic multi-face output association is unresolved")
    case, generated = dict(prediction=snapshot["index"], checks={}), []
    if raw is not None and active:
        face = initialized_warp(snapshot=snapshot)
        stage, points = decode_actual(raw=raw, snapshot=snapshot, face=face)
        case["checks"]["stage1"] = point_difference(actual=stage, expected=first_points(value=face["stage1"]), tolerance=0)
        if face is not active[0]:
            raise ValueError("initialized warp is not the active face")
        case["checks"]["tracked"] = point_difference(actual=points, expected=first_points(value=face["tracked"]), tolerance=0)
        if temporal is not None:
            points, case["temporal_smoothing"] = temporal.apply(snapshot=snapshot, points=points, initialization_seed=initialization_seed)
        elif initialization_seed is not None:
            raise ValueError("owned initialization requires temporal replay")
        generated = [dict(id=face["id"], points=normalized(points=points, request=snapshot["request"]).tolist())]
    elif active:
        raise ValueError("active idle state reuse is unresolved; do not publish cached points")
    elif temporal is not None:
        _, case["temporal_smoothing"] = temporal.apply(snapshot=snapshot, points=None, initialization_seed=initialization_seed)
    if native_frame is not None:
        expected = native_frame["faces"]
        if len(expected) != len(generated):
            raise ValueError("actual dynamic consumer face count mismatch")
        for actual, reference in zip(generated, expected, strict=True):
            if type(reference.get("id")) is not int or actual["id"] != reference["id"]:
                raise ValueError("actual dynamic consumer face ID mismatch")
            case["checks"]["normalized"] = point_difference(actual=np.asarray(actual["points"], np.float32),
                expected=np.asarray(reference["points"], np.float32), tolerance=0)
        case["timestamp_us"] = native_frame["timestamp_us"]
    if require_exact and not all(check["within"] for check in case["checks"].values()):
        raise RuntimeError("dynamic geometry gate failed; no fitting or tolerance relaxation")
    case.update(active_faces=len(active), published_faces=len(generated), idle=raw is None)
    return case, generated


def validate_dynamic(*, evidence):
    frames = evidence.get("frames")
    if (not isinstance(frames, list) or not 1 <= len(frames) <= 24 or
            evidence.get("geometry_observer_only") is not True or
            evidence.get("observer_pixel_parity_verified") is not True or
            evidence.get("per_prediction_inference_association_verified") is not True or
            type(evidence.get("warmup_requests_per_host")) is not int or evidence["warmup_requests_per_host"] != 6 or
            type(evidence.get("seeks_per_request")) is not int or evidence["seeks_per_request"] != 2):
        raise ValueError("passed bounded neutral dynamic geometry capture required")
    parity.validate_capture(captured=evidence, expected_comparisons=len(frames))
    requests = 6 + len(frames)
    if evidence.get("predictions") != requests * 2:
        raise ValueError("two actual dynamic predictions per request required")
    runs = evidence.get("runs")
    if not isinstance(runs, list) or [run.get("name") for run in runs] != ["baseline", "observed"]:
        raise ValueError("both fresh dynamic hosts required")
    expected = ["QCUT\tREADY\t1", *(f"QCUT\tRESULT\twarmup-{i}\t0" for i in range(6)),
                *(f"QCUT\tRESULT\tframe-{i:02d}\t0" for i in range(len(frames)))]
    for run in runs:
        if (run.get("protocol_rows") != expected or run.get("reader_error") is not None or
                run.get("owned_face_conversions") != 2 * (requests - 1) or
                run.get("owned_face_restorations") != 2 * (requests - 1)):
            raise ValueError("dynamic protocol or ownership counts mismatch")
    return len(frames)


def run(*, args):
    out = sequence.fresh_output(path=args.out)
    locked = LockedFiles()
    report = dict(passed=False, completed=False, geometry_exact=False,
                  independent_120_sampling_input_used=False, native_inference_called=False,
                  native_analysis_bypassed=False, full_frame_geometry_independent=False,
                  native_160_sampling_input_required=True, per_face_inference_association_verified=False,
                  final_consumer_parity=False, cases=[], failures=[])
    try:
        parity.no_torch()
        owned_initialization = getattr(args, "owned_initialization", False)
        independent_160 = getattr(args, "independent_160_sampling", False)
        owned_smoothing = getattr(args, "owned_smoothing", False)
        if any(type(value) is not bool for value in (owned_initialization, independent_160, owned_smoothing)):
            raise ValueError("typed temporal producer policies required")
        if owned_initialization and not owned_smoothing or independent_160 and not owned_initialization:
            raise ValueError("owned initialization requires smoothing; independent 160 requires owned initialization")
        temporal = smoothing.TemporalReplay(owned_initialization=owned_initialization) if owned_smoothing else None
        root = args.capture.resolve(strict=True)
        evidence = locked.json(path=root / "report.json")
        count = validate_dynamic(evidence=evidence)
        manifest_path = Path(evidence["manifest"])
        expected_manifest = evidence["fixture_sha256"].get(str(manifest_path))
        parity.require_sha256(value=expected_manifest)
        manifest = locked.read(path=manifest_path, maximum=sequence.MANIFEST_LIMIT, expected=expected_manifest)
        manifest_frames = sequence.validate_manifest(value=strict_json(data=manifest), base=manifest_path.parent)
        if len(manifest_frames) != count:
            raise ValueError("dynamic manifest frame count changed since capture")
        for source, frame in zip(manifest_frames, evidence["frames"], strict=True):
            if any(frame.get(key) != value for key, value in source.items()):
                raise ValueError("dynamic manifest request differs from capture")
            locked.read(path=Path(frame["image"]), maximum=sequence.IMAGE_LIMIT, expected=frame["image_sha256"])
        report.update(capture_sha256=digest(data=locked.read(path=root / "report.json")),
                      source_sha256={"local-model-pytorch/" + name: digest(data=locked.read(path=Path(__file__).with_name(name))) for name in (
                          Path(__file__).name, "face_host_sampling_inputs.py", "face_alignment_sampling.py",
                          "face_host_geometry_contract.py", "face_host_geometry_replay.py",
                          "face_host_geometry_output.py",
                          "face_render_model_parity.py", "face_alignment_replay.py", "face_geometry.py",
                          "face_temporal_smoothing.py", "face_temporal_smoothing_replay.py", "face_host_initialization.py")})
        if independent_160:
            name = "face_host_sampling_160_inputs.py"
            report["source_sha256"]["local-model-pytorch/" + name] = digest(data=locked.read(path=Path(__file__).with_name(name)))
        snapshots = validate_sequence(records=evidence["geometry_snapshots"], temporal=True)
        actual = validate_sequence(records=[locked.json(path=path) for path in (root / "geometry").glob("prediction-*.json")], temporal=True)
        if actual != snapshots or len(actual) != evidence["predictions"]:
            raise ValueError("actual dynamic geometry changed since capture")
        inventory = capture.inventory(capture=root / "capture")
        if inventory != evidence["captures"]:
            raise ValueError("actual dynamic tensors changed since capture")
        observed.lock_inventory(inventory=inventory, directory=root / "capture", locked=locked)
        associations = associate_inferences(records=snapshots, networks=inventory["networks"], temporal=True,
            metadata=[capture.metadata(path=path) for path in (root / "capture").glob("*.json")])
        if associations != evidence["prediction_inferences"]:
            raise ValueError("actual dynamic neural window association changed")
        inputs, sampling = build_inputs(root=root, evidence=evidence, associations=associations, locked=locked, temporal=True)
        initialization_inputs = None
        if independent_160:
            from face_host_sampling_160_inputs import build_inputs as build_160_inputs

            initialization_inputs, report["initialization_sampling_cases"] = build_160_inputs(
                root=root, evidence=evidence, associations=associations, locked=locked, temporal=True)
        model = parity.run(args=argparse.Namespace(capture=root, root=args.root, out=out / "onnx"),
                           replacement_inputs=inputs, expected_comparisons=count, initialization_inputs=initialization_inputs)
        if (model.get("passed") is not True or model.get("independent_120_sampling_input_used") is not True or
                model.get("capture_sha256") != report["capture_sha256"]):
            raise ValueError("dynamic ONNX lacks independent sampling or capture provenance")
        if independent_160 and model.get("independent_160_sampling_input_used") is not True:
            raise ValueError("dynamic ONNX lacks independently sampled 160 inputs")
        trace = locked.read(path=root / "observed/records.jsonl", maximum=sequence.LOG_LIMIT,
                            expected=evidence["runs"][1]["records_sha256"])
        observed.exact_events(data=trace, count=len(snapshots) - 2)
        native = owned.capture_replay(events=[strict_json(data=line) for line in trace.splitlines()],
            width=evidence["width"], height=evidence["height"], image_hash=digest(data=manifest),
            maximum_timestamp_us=consumer.REPLAY_TIME_LIMIT_US)
        if len(native["frames"]) != len(snapshots) - 2:
            raise ValueError("exactly two cold setup predictions before conversions required")
        candidate = dict(native, frames=[])
        for snapshot, association in zip(snapshots, associations, strict=True):
            selected = [item for item in association["inferences"] if item["size"] == 120]
            raw = None
            seed, seed_proof = None, None
            if selected:
                inference = selected[0]["inference"]
                network = inventory["networks"][selected[0]["network"]]
                if network["graph_sha256"] != model["model_outputs"]["120"]["graph_sha256"]:
                    raise ValueError("actual dynamic predictor differs from ONNX graph")
                raw = np.load(io.BytesIO(locked.read(path=out / f"onnx/size-120-infer-{inference:03d}-fc_landmark_s1.npy",
                                                     maximum=1024**2)), allow_pickle=False).reshape(106, 2)
            selected_160 = [item for item in association["inferences"] if item["size"] == 160]
            if owned_initialization and selected_160:
                if len(selected_160) != 1:
                    raise ValueError("one actual 160 initialization inference required")
                inference_160 = selected_160[0]
                network = inventory["networks"][inference_160["network"]]
                if network["graph_sha256"] != model["model_outputs"]["160"]["graph_sha256"]:
                    raise ValueError("actual initialization predictor differs from ONNX graph")
                head = np.load(io.BytesIO(locked.read(path=out / f"onnx/size-160-infer-{inference_160['inference']:03d}-fc_landmark_s1.npy",
                                                      maximum=1024**2)), allow_pickle=False).reshape(106, 2)
                seed, seed_proof = initialization.decode_seed(raw=head, snapshot=snapshot)
                seed_proof.update(inference=inference_160["inference"], network=inference_160["network"])
            frame = native["frames"][snapshot["index"] - 2] if snapshot["index"] >= 2 else None
            case, faces = decode_case(snapshot=snapshot, raw=raw, native_frame=frame, require_exact=False,
                                      temporal=temporal, initialization_seed=seed)
            if seed_proof is not None:
                case["owned_initialization"] = seed_proof
            if "returned_result" in snapshot:
                case["native_output_layers"] = output_layers(snapshot=snapshot, native_frame=frame)
            report["cases"].append(case)
            if frame is not None:
                candidate["frames"].append(dict(timestamp_us=frame["timestamp_us"], faces=faces))
        consumer.validate_replay(value=candidate, width=evidence["width"], height=evidence["height"],
            image_hash=digest(data=manifest), maximum_timestamp_us=consumer.REPLAY_TIME_LIMIT_US)
        exact = all(check["within"] for case in report["cases"] for check in case["checks"].values())
        layers = [case["native_output_layers"] for case in report["cases"] if "native_output_layers" in case]
        observed_layers = [layer for layer in layers if layer["consumer_observed"]]
        report.update(returned_result_observed=len(layers) == len(snapshots),
                      returned_to_consumer_exact=(all(layer["returned_to_consumer_exact"] for layer in observed_layers)
                                                 if len(observed_layers) == len(native["frames"]) else None),
                      post_tracking_gap_predictions=[case["prediction"] for case in report["cases"]
                          if case.get("native_output_layers", {}).get("post_tracking_changed")])
        diagnostic = getattr(args, "diagnostic", False)
        if not exact and not diagnostic:
            raise RuntimeError("dynamic geometry gate failed; no fitting or tolerance relaxation")
        data = json.dumps(candidate, indent=2, allow_nan=False).encode() + b"\n"
        (out / ("replay.json" if exact else "diagnostic-replay.json")).write_bytes(data)
        locked.verify()
        if capture.inventory(capture=root / "capture") != inventory:
            raise RuntimeError("dynamic model capture mutated during production")
        parity.no_torch()
        report.update(passed=exact, completed=True, geometry_exact=exact, diagnostic_only=not exact,
                      owned_temporal_smoothing_used=temporal is not None,
                      owned_initialization_used=owned_initialization,
                      independent_160_sampling_input_used=independent_160,
                      native_160_sampling_input_required=not independent_160,
                      native_smoothing_seed_required=temporal is not None and not owned_initialization,
                      native_smoothing_initialization_required=temporal is not None,
                      native_smoothing_seed_predictions=[case["prediction"] for case in report["cases"]
                          if case.get("temporal_smoothing", {}).get("native_seed_used")],
                      owned_smoothing_seed_predictions=[case["prediction"] for case in report["cases"]
                          if case.get("temporal_smoothing", {}).get("owned_seed_used")],
                      head_comparisons=model["head_comparisons"], replay_sha256=digest(data=data),
                      independent_120_sampling_input_used=True, sampling_cases=sampling, manifest_frames=count,
                      per_active_face_id_association_verified=True, fixture_sha256=dict(locked.files))
    except Exception as error:
        report["failures"].append(f"{type(error).__name__}: {error}")
        raise
    finally:
        (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("capture", "root", "out"):
        parser.add_argument(f"--{name}", required=True, type=Path)
    parser.add_argument("--diagnostic", action="store_true")
    parser.add_argument("--owned-smoothing", action="store_true")
    parser.add_argument("--owned-initialization", action="store_true")
    parser.add_argument("--independent-160-sampling", action="store_true")
    report = run(args=parser.parse_args())
    print(json.dumps(dict(passed=report["passed"], predictions=len(report["cases"]), head_comparisons=report["head_comparisons"])))


if __name__ == "__main__":
    main()
