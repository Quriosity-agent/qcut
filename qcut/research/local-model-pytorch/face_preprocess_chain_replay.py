"""Own 160/120 pixels -> ONNX -> owned seeds/smoothing -> normalized face replay.

Legacy mode requires native algorithm RGBA. --original-frames instead generates
it from pinned originals; native pixels are equality oracles only. Detector
geometry, tables and routing remain required in both fixed profiles.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from face_alignment_replay import LockedFiles
import face_full_frame_owned_inputs as original
from face_host_geometry_output import output_layers
from face_host_geometry_sequence_replay import decode_case
from face_host_initialization import decode_seed
from face_host_sampling_inputs import build_inputs as build_120
from face_preprocess_chain_inputs import build_inputs as build_160
import face_preprocess_chain_capture as capture
import face_owned_replay_e2e as owned
import face_render_consumer_probe as consumer
import face_render_model_capture as models
import face_render_model_parity as parity
import face_render_sequence_probe as sequence
from face_render_stability_probe import digest
from face_temporal_smoothing_replay import TemporalReplay

SOURCE_NAMES = ("face_preprocess_chain_replay.py", "face_preprocess_chain_capture.py",
                "face_preprocess_chain_inputs.py", "face_preprocess_replay.py")
ORIGINAL_SOURCE_NAMES = (*SOURCE_NAMES, "face_full_frame_owned.py", "face_full_frame_owned_inputs.py",
                         "face_full_frame_quantization.py", "face_full_frame_quantization_probe.py",
                         "face_alignment_sampling.py", "face_host_sampling_inputs.py")


def profile(*, stage="replay", original_frames=False):
    if type(original_frames) is not bool or stage not in ("replay", "render", "audit"):
        raise ValueError("explicit boolean original-frame mode and known chain stage required")
    prefix = "original-rgba-owned-chain" if original_frames else "actual-preprocess-owned-chain"
    return prefix + ("" if stage == "replay" else "-" + stage) + "-v1"


def source_names(*, original_frames=False):
    profile(original_frames=original_frames)
    return ORIGINAL_SOURCE_NAMES if original_frames else SOURCE_NAMES


def original_claims(*, completed):
    return dict(original_rgba_input_used=completed, native_algorithm_rgba_required=False,
                native_algorithm_rgba_input_used=False, native_algorithm_rgba_oracle_required=True,
                independent_full_frame_preprocessing=completed, fixed_profile_only=True)


def sampling_inputs(*, context, locked, original_frames=False):
    profile(original_frames=original_frames)
    if original_frames:
        return original.build_inputs(context=context, locked=locked)
    root, evidence, associations = context["root"], context["evidence"], context["associations"]
    inputs, sampling = build_120(root=root, evidence=evidence, associations=associations, locked=locked, temporal=True)
    seeds, initialization = build_160(root=root, evidence=evidence, associations=associations, locked=locked)
    return inputs, seeds, dict(sampling_cases=sampling, initialization_sampling_cases=initialization)


def verify_original_inputs(*, evidence, context, directory, locked):
    if (any(evidence.get(key) is not value for key, value in original_claims(completed=True).items()) or
            evidence.get("failures") != []):
        raise ValueError("exact original-frame producer/oracle claims required")
    # Isolate reads so unrelated audit fixtures cannot hide missing producer identities.
    proof_lock = LockedFiles()
    inputs, seeds, proof = original.build_inputs(context=context, locked=proof_lock)
    for key, value in (("preprocessing", proof), ("sampling_cases", proof["sampling_cases"]),
                       ("initialization_sampling_cases", proof["initialization_sampling_cases"])):
        if json.dumps(evidence.get(key), sort_keys=True, allow_nan=False) != json.dumps(value, sort_keys=True, allow_nan=False):
            raise ValueError(f"original-frame {key} differs from recomputed evidence")
    parity.require_sha256(value=evidence.get("model_report_sha256"))
    model = proof_lock.json(path=directory / "onnx/report.json", expected=evidence["model_report_sha256"])
    if (model.get("passed") is not True or model.get("capture_sha256") != evidence.get("capture_sha256") or
            model.get("native_inference_called") is not False or model.get("native_analysis_bypassed") is not False):
        raise ValueError("original-frame ONNX execution must be bound to this capture")
    original.model_input_proof(model=model, inputs=inputs, seeds=seeds)
    fixtures = evidence.get("fixture_sha256")
    for name, expected in proof_lock.files.items():
        if not isinstance(fixtures, dict) or fixtures.get(name) != expected:
            raise ValueError("original-frame producer fixture missing or changed")
        locked.read(path=Path(name), maximum=128 * 1024**2, expected=expected)
    proof_lock.verify()
    return inputs, seeds, proof


def sources(*, names, locked):
    return {"local-model-pytorch/" + name: digest(data=locked.read(
        path=Path(__file__).with_name(name), maximum=1024**2)) for name in names}


def landmark_head(*, size, association, inventory, model, directory, locked):
    if type(size) is not int or size not in (120, 160):
        raise ValueError("typed 120/160 landmark profile required")
    selected = [item for item in association["inferences"] if item["size"] == size]
    if not selected:
        return None, None
    if len(selected) != 1:
        raise ValueError("one landmark inference per profile/prediction required")
    item = selected[0]
    if (type(item.get("inference")) is not int or not 0 <= item["inference"] <= 128 or
            inventory["networks"][item["network"]]["graph_sha256"] != model["model_outputs"][str(size)]["graph_sha256"]):
        raise ValueError("actual landmark network/inference differs from ONNX profile")
    path = directory / f"size-{size}-infer-{item['inference']:03d}-fc_landmark_s1.npy"
    data = locked.read(path=path, maximum=1024**2)
    head = locked.array(path=path, shape=(1, 1, 1, 212), dtype="float32", expected=digest(data=data))
    return head.reshape(106, 2), item


def produce(*, context, model, directory, locked):
    native, evidence = context["native"], context["evidence"]
    snapshots, associations = context["snapshots"], context["associations"]
    temporal = TemporalReplay(owned_initialization=True)
    candidate, cases, seeds = dict(native, frames=[]), [], []
    for snapshot, association in zip(snapshots, associations, strict=True):
        raw, _ = landmark_head(size=120, association=association, inventory=evidence["captures"],
                               model=model, directory=directory, locked=locked)
        head, item = landmark_head(size=160, association=association, inventory=evidence["captures"],
                                   model=model, directory=directory, locked=locked)
        seed, proof = None, None
        if head is not None:
            seed, proof = decode_seed(raw=head, snapshot=snapshot)
            proof.update(inference=item["inference"], network=item["network"])
            seeds.append(snapshot["index"])
        frame = native["frames"][snapshot["index"] - 2] if snapshot["index"] >= 2 else None
        case, faces = decode_case(snapshot=snapshot, raw=raw, native_frame=frame,
                                 temporal=temporal, initialization_seed=seed)
        if proof is not None:
            case["owned_initialization"] = proof
        case["native_output_layers"] = output_layers(snapshot=snapshot, native_frame=frame)
        cases.append(case)
        if frame is not None:
            candidate["frames"].append(dict(timestamp_us=frame["timestamp_us"], faces=faces))
    if (seeds != [0, 20] or len(cases) != 26 or len(candidate["frames"]) != 24 or
            any(case["temporal_smoothing"]["native_seed_used"] for case in cases) or
            [case["prediction"] for case in cases if case["temporal_smoothing"]["owned_seed_used"]] != seeds):
        raise ValueError("both owned lifecycle seeds and all exact conversion points required")
    consumer.validate_replay(value=candidate, width=1448, height=1086, image_hash=native["image_sha256"],
                             maximum_timestamp_us=consumer.REPLAY_TIME_LIMIT_US)
    return candidate, cases


def finish(*, out, report, locked):
    active_error = sys.exc_info()[1]
    try:
        locked.verify()
    except Exception as error:
        for key in ("passed", "completed", "geometry_exact", "final_consumer_parity",
                    "pixel_parity_verified", "external_replay_verified", "original_rgba_input_used",
                    "independent_full_frame_preprocessing"):
            if key in report:
                report[key] = False
        report["failures"].append(f"guard {type(error).__name__}: {error}")
        if active_error is None:
            raise
    finally:
        report["fixture_sha256"] = dict(locked.files)
        (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")


def run(*, args):
    out, locked = sequence.fresh_output(path=args.out), LockedFiles()
    report = dict(profile="actual-preprocess-owned-chain-v1", passed=False, completed=False,
                  native_inference_called=False, native_analysis_bypassed=False,
                  captured_tensor_input_used=False, native_final_point_input_used=False,
                  native_algorithm_rgba_required=True, native_caller_parameters_required=True,
                  independent_full_frame_preprocessing=False, arbitrary_frame_backend_connected=False,
                  product_parity_verified=False, independent_120_sampling_input_used=False,
                  independent_160_sampling_input_used=False, geometry_exact=False, final_consumer_parity=False,
                  owned_initialization_used=False, owned_temporal_smoothing_used=False,
                  cases=[], failures=[])
    try:
        original_frames = getattr(args, "original_frames", False)
        report["profile"] = profile(original_frames=original_frames)
        if original_frames:
            report.update(original_claims(completed=False), cpu_only=True, native_render_performed=False,
                          full_render_verified=False)
        parity.no_torch()
        root = args.capture.resolve(strict=True)
        context = capture.load(root=root, locked=locked)
        evidence = context["evidence"]
        report.update(capture=str(root), capture_sha256=locked.files[str(root / "report.json")],
                      source_sha256=sources(names=source_names(original_frames=original_frames), locked=locked))
        inputs, seeds, proof = sampling_inputs(context=dict(context, root=root), locked=locked, original_frames=original_frames)
        report.update(sampling_cases=proof["sampling_cases"], initialization_sampling_cases=proof["initialization_sampling_cases"])
        if original_frames:
            report["preprocessing"] = proof
        model = parity.run(args=argparse.Namespace(capture=root, root=args.root, out=out / "onnx"),
                           replacement_inputs=inputs, initialization_inputs=seeds, expected_comparisons=7)
        if (model.get("passed") is not True or model.get("independent_120_sampling_input_used") is not True or
                model.get("independent_160_sampling_input_used") is not True or
                model.get("capture_sha256") != report["capture_sha256"]):
            raise ValueError("ONNX must consume both independently generated input profiles")
        if locked.json(path=out / "onnx/report.json") != model:
            raise ValueError("ONNX execution report differs from returned result")
        if original_frames:
            original.model_input_proof(model=model, inputs=inputs, seeds=seeds)
        model_root = args.root.resolve(strict=True)
        parity.require_sha256(value=model["export_summary_sha256"])
        locked.read(path=model_root / "summary.json", maximum=16 * 1024**2, expected=model["export_summary_sha256"])
        for size, output in model["model_outputs"].items():
            parity.require_sha256(value=output["onnx_sha256"])
            locked.read(path=model_root / f"align-{size}/artifacts/model.onnx", maximum=128 * 1024**2,
                        expected=output["onnx_sha256"])
        report["model_report_sha256"] = locked.files[str(out / "onnx/report.json")]
        candidate, report["cases"] = produce(context=context, model=model, directory=out / "onnx", locked=locked)
        data = json.dumps(candidate, indent=2, allow_nan=False).encode() + b"\n"
        (out / "replay.json").write_bytes(data)
        locked.read(path=out / "replay.json", maximum=owned.REPLAY_LIMIT)
        if models.inventory(capture=root / "capture") != evidence["captures"]:
            raise RuntimeError("actual preprocessing neural inventory mutated during replay")
        parity.no_torch()
        report.update(passed=True, completed=True, geometry_exact=True, final_consumer_parity=True,
                      independent_120_sampling_input_used=True, independent_160_sampling_input_used=True,
                      owned_initialization_used=True, owned_temporal_smoothing_used=True,
                      native_160_sampling_input_required=False, native_smoothing_seed_required=False,
                      native_smoothing_initialization_required=True, owned_smoothing_seed_predictions=[0, 20],
                      native_smoothing_seed_predictions=[], head_comparisons=model["head_comparisons"],
                      manifest_frames=7, replay_sha256=digest(data=data), diagnostic_only=False)
        if original_frames:
            report.update(original_claims(completed=True))
    except Exception as error:
        report["failures"].append(f"{type(error).__name__}: {error}")
        raise
    finally:
        finish(out=out, report=report, locked=locked)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("capture", "root", "out"):
        parser.add_argument(f"--{name}", required=True, type=Path)
    parser.add_argument("--original-frames", action="store_true", help="produce algorithm RGBA from pinned original frames")
    report = run(args=parser.parse_args())
    print(json.dumps({key: report[key] for key in ("passed", "head_comparisons", "geometry_exact", "final_consumer_parity")}))


if __name__ == "__main__":
    main()
