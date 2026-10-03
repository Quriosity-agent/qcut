"""Actual captured geometry + ONNX -> owned replay, without fitting final points."""
from __future__ import annotations

import argparse
import io
import json
from pathlib import Path

import numpy as np

from face_alignment_replay import LockedFiles, point_difference
from face_geometry import reorder_landmarks
from face_geometry_native import LIBRARY_SHA256
from face_host_geometry_contract import associate_inferences, validate_sequence
from face_host_sampling_inputs import build_inputs
import face_owned_replay_e2e as owned
import face_render_consumer_probe as consumer
import face_render_model_capture as capture
import face_render_model_parity as parity
import face_render_sequence_probe as sequence
from face_render_stability_probe import digest


def first_points(*, value):
    values = np.asarray(value, dtype=np.float32)
    if values.shape not in ((2, 106), (2, 280)) or not np.isfinite(values).all():
        raise ValueError("bounded native point rows required")
    return values[:, :106].T.copy()


def map_double(*, points, inverse):
    values, matrix = np.asarray(points), np.asarray(inverse)
    if (values.shape != (106, 2) or values.dtype != np.float32 or matrix.shape != (2, 3) or
            matrix.dtype != np.float32 or not np.isfinite(values).all() or not np.isfinite(matrix).all() or
            np.max(np.abs(matrix)) > 32768 or np.max(np.abs(values)) > 32768 or
            abs(float(np.linalg.det(matrix[:, :2]))) < 1e-8):
        raise ValueError("finite nonsingular actual affine mapping required")
    values, matrix = values.astype(np.float64), matrix.astype(np.float64)
    x = values[:, :1] * matrix[:, 0]
    y = values[:, 1:] * matrix[:, 1]
    result = (x + y + matrix[:, 2]).astype(np.float32)
    if not np.isfinite(result).all() or np.max(np.abs(result)) > 32768:
        raise ValueError("affine output exceeds bounded frame coordinates")
    return result


def decode_actual(*, raw, snapshot, face):
    raw = np.asarray(raw)
    if raw.dtype != np.float32 or raw.shape != (106, 2) or not np.isfinite(raw).all():
        raise ValueError("actual ONNX 106-pair float32 raw head required")
    mean = np.asarray(snapshot["tables"]["base"], np.float32).reshape(106, 2)
    order = np.asarray(snapshot["tables"]["order"], np.int32)
    decoded = reorder_landmarks(raw_pairs=raw, destinations=order)
    stage = (decoded.astype(np.float64) + mean.astype(np.float64) / 256 * 120).astype(np.float32)
    mapped = map_double(points=stage, inverse=np.asarray(face["inverse"], np.float32))
    return stage, mapped


def normalized(*, points, request):
    if not isinstance(request, list) or len(request) != 5:
        raise ValueError("actual geometry request required")
    width, height = request[1:3]
    if (any(type(side) is not int or not 1 <= side <= 4096 for side in (width, height)) or
            points.shape != (106, 2) or points.dtype != np.float32 or not np.isfinite(points).all()):
        raise ValueError("actual algorithm frame and finite points required")
    reciprocal = np.float32(1) / np.array([width, height], np.float32)
    result = np.empty_like(points)
    result[:, 0] = points[:, 0] * reciprocal[0]
    # The native converter rounds H-y before multiplication, not 1-y/H.
    result[:, 1] = (np.float32(height) - points[:, 1]) * reciprocal[1]
    if (result < 0).any() or (result > 1).any():
        raise ValueError("actual geometry leaves normalized frame; clipping prohibited")
    return result.astype(np.float32)


def active_face(*, snapshot):
    width, height = snapshot["request"][1:3]
    faces = [face for face in snapshot["faces"] if face.get("active") is True and len(face["stage1"][0]) == 106 and
             face["frame_size"] == [height, width]]
    if len(faces) != 1:
        raise ValueError("this diagnostic requires exactly one initialized active 106-point face")
    return faces[0]


def run(*, args):
    out = sequence.fresh_output(path=args.out)
    locked = LockedFiles()
    report = dict(passed=False, native_inference_called=False, native_analysis_bypassed=False,
                  native_geometry_required=True, final_consumer_parity=False, cases=[], failures=[])
    try:
        parity.no_torch()
        source_names = (Path(__file__).name, "face_host_geometry_contract.py", "face_alignment_replay.py",
                        "face_geometry.py", "face_render_model_parity.py", "face_alignment_sampling.py",
                        "face_host_sampling_inputs.py")
        report["source_sha256"] = {name: digest(data=locked.read(path=Path(__file__).with_name(name)))
                                  for name in source_names}
        root = args.capture.resolve(strict=True)
        evidence = locked.json(path=root / "report.json")
        parity.validate_capture(captured=evidence)
        if (evidence.get("geometry_observer_only") is not True or evidence.get("lens_sha256") != LIBRARY_SHA256 or
                evidence.get("per_prediction_inference_association_verified") is not True):
            raise ValueError("passed actual geometry observer with neural association required")
        snapshots = validate_sequence(records=evidence.get("geometry_snapshots"))
        files = list((root / "geometry").glob("prediction-*.json"))
        actual = validate_sequence(records=[locked.json(path=path) for path in files])
        if actual != snapshots or capture.inventory(capture=root / "capture") != evidence["captures"]:
            raise ValueError("actual geometry or tensors changed since neutral capture")
        associations = associate_inferences(records=snapshots, networks=evidence["captures"]["networks"],
                                             metadata=[capture.metadata(path=path) for path in (root / "capture").glob("*.json")])
        if associations != evidence.get("prediction_inferences"):
            raise ValueError("actual prediction/inference association changed")
        replacement_inputs = None
        if getattr(args, "independent_sampling", False):
            replacement_inputs, report["sampling_cases"] = build_inputs(
                root=root, evidence=evidence, associations=associations, locked=locked)
        model = parity.run(args=argparse.Namespace(capture=root, root=args.root, out=out / "onnx"),
                           replacement_inputs=replacement_inputs)
        if model.get("passed") is not True or model.get("capture_sha256") != digest(data=locked.read(path=root / "report.json")):
            raise ValueError("actual ONNX execution lacks geometry capture provenance")
        trace = locked.read(path=root / "observed/records.jsonl", maximum=sequence.LOG_LIMIT)
        events = [json.loads(line) for line in trace.splitlines()]
        native = owned.capture_replay(events=events, width=evidence["width"], height=evidence["height"],
                                     image_hash=evidence["image_sha256"])
        if len(native["frames"]) != len(snapshots) - 2:
            raise ValueError("expected two setup seeks before owned conversions")
        replay = dict(native, frames=[])
        for snapshot, association in zip(snapshots, associations, strict=True):
            face = active_face(snapshot=snapshot)
            selected = [item for item in association["inferences"] if item["size"] == 120]
            inference = selected[0]["inference"]
            item = model["model_outputs"]["120"]
            network = evidence["captures"]["networks"][selected[0]["network"]]
            if network["graph_sha256"] != item["graph_sha256"]:
                raise ValueError("actual selected geometry predictor differs from ONNX graph")
            path = out / f"onnx/size-120-infer-{inference:03d}-fc_landmark_s1.npy"
            raw = np.load(io.BytesIO(locked.read(path=path, maximum=1024**2)), allow_pickle=False).reshape(106, 2)
            stage, points = decode_actual(raw=raw, snapshot=snapshot, face=face)
            checks = dict(stage1=point_difference(actual=stage, expected=first_points(value=face["stage1"]), tolerance=0),
                          tracked=point_difference(actual=points, expected=first_points(value=face["tracked"]), tolerance=0))
            case = dict(prediction=snapshot["index"], inference=inference, checks=checks)
            if snapshot["index"] >= 2:
                frame = native["frames"][snapshot["index"] - 2]
                if len(frame["faces"]) != 1:
                    raise ValueError("single native consumer face required")
                if frame["faces"][0]["id"] != face["id"]:
                    raise ValueError("actual prediction/consumer face ID mismatch")
                coordinates = normalized(points=points, request=snapshot["request"])
                expected = np.asarray(frame["faces"][0]["points"], np.float32)
                checks["normalized"] = point_difference(actual=coordinates, expected=expected, tolerance=0)
                case.update(timestamp_us=frame["timestamp_us"], id=frame["faces"][0]["id"])
                replay["frames"].append(dict(timestamp_us=frame["timestamp_us"],
                                             faces=[dict(id=case["id"], points=coordinates.tolist())]))
            report["cases"].append(case)
        if not all(check["within"] for case in report["cases"] for check in case["checks"].values()):
            raise RuntimeError("actual geometry stage gates failed; no fitting or threshold relaxation")
        consumer.validate_replay(value=replay, width=evidence["width"], height=evidence["height"],
                                 image_hash=evidence["image_sha256"])
        locked.verify()
        if capture.inventory(capture=root / "capture") != evidence["captures"]:
            raise RuntimeError("actual model tensors changed during decode")
        parity.no_torch()
        report.update(passed=True, head_comparisons=model["head_comparisons"],
                      independent_120_sampling_input_used=model["independent_120_sampling_input_used"],
                      frame_width=evidence["width"], frame_height=evidence["height"],
                      algorithm_request=snapshots[0]["request"], fixture_sha256=locked.files,
                      per_prediction_inference_association_verified=True,
                      per_face_id_association_verified=True,
                      normalized_exact=all(case["checks"].get("normalized", {}).get("exact", True) for case in report["cases"]),
                      replay_sha256=digest(data=json.dumps(replay, indent=2, allow_nan=False).encode() + b"\n"))
        (out / "replay.json").write_text(json.dumps(replay, indent=2, allow_nan=False) + "\n")
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
    parser.add_argument("--independent-sampling", action="store_true")
    report = run(args=parser.parse_args())
    print(json.dumps(dict(passed=report["passed"], predictions=len(report["cases"]),
                          normalized_exact=report["normalized_exact"])))


if __name__ == "__main__":
    main()
