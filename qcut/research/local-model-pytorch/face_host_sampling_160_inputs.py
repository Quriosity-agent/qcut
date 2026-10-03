"""Exact-gated detection-forward sampling candidate for observed 160 inputs.

build_inputs returns {(160, inference): owned int8 [1,160,160,3]}, selected
cases only. It never returns partial replacements or captured tensor values.
The recorded detection transform is not proof of a preprocessing route:
pinned FaceAlignmentDet calls ProcessDetectionImage at 0x2d5f2c/0x2d5fd0
before constructing that transform at 0x2d6030..0x2d60d4. R10 fails the direct
signed_input candidate. No alternate matrix, resize rule or numeric fit is used.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from face_alignment_replay import LockedFiles
from face_alignment_sampling import inverse_forward, signed_input
from face_host_geometry_contract import associate_inferences, integer, validate_sequence
from face_host_geometry_sequence_replay import validate_dynamic
from face_host_sampling_inputs import algorithm_frame, initialized_warp
import face_host_geometry_sequence_probe as observed
import face_render_model_capture as capture
import face_render_model_parity as parity
import face_render_sequence_probe as sequence
from face_render_stability_probe import digest


SOURCE_ROOT = Path(__file__).resolve().parents[1]
SOURCE_NAMES = (Path(__file__).name, "face_host_sampling_inputs.py", "face_alignment_sampling.py",
                "face_alignment_replay.py", "face_host_geometry_contract.py",
                "face_host_geometry_sequence_probe.py", "face_host_geometry_sequence_replay.py",
                "face_render_model_capture.py", "face_render_model_parity.py")


class SamplingMismatch(RuntimeError):
    def __init__(self, *, cases):
        super().__init__("160 sampling differs from actual input; no correction or captured-input fallback")
        self.cases = cases


def lock_sources(*, sources, locked):
    if not isinstance(sources, dict) or not 1 <= len(sources) <= 128:
        raise ValueError("bounded capture source hashes required")
    for name, expected in sources.items():
        if (not isinstance(name, str) or Path(name).is_absolute() or
                not name or ".." in Path(name).parts):
            raise ValueError("capture source must remain beneath research")
        parity.require_sha256(value=expected)
        path = SOURCE_ROOT / name
        if not path.resolve(strict=True).is_relative_to(SOURCE_ROOT.resolve()):
            raise ValueError("capture source escaped research")
        locked.read(path=path, maximum=1024**2, expected=expected)


def _windows(*, snapshots, associations):
    if not isinstance(associations, list) or len(associations) != len(snapshots):
        raise ValueError("one typed neural association per prediction required")
    lower, seen, records = 0, set(), set()
    for snapshot, association in zip(snapshots, associations, strict=True):
        if (not isinstance(association, dict) or type(association.get("prediction")) is not int or
                association["prediction"] != snapshot["index"]):
            raise ValueError("160 prediction association mismatch")
        window = association.get("neural_window")
        if (not isinstance(window, list) or len(window) != 2 or
                any(type(value) is not int for value in window) or
                window != [lower, snapshot["bytenn_sequence"]]):
            raise ValueError("160 neural window changed")
        items = association.get("inferences")
        if not isinstance(items, list) or len(items) > 20:
            raise ValueError("bounded actual inference list required")
        for item in items:
            if not isinstance(item, dict) or type(item.get("size")) is not int or item["size"] not in (120, 160):
                raise ValueError("typed actual 120/160 inference required")
            inference = integer(value=item.get("inference"), maximum=128)
            index = integer(value=item.get("record_index"), maximum=4095)
            network = item.get("network")
            predictor = snapshot["predictors"][0 if item["size"] == 120 else 1]
            if type(network) is not str or network != str(predictor["network"]):
                raise ValueError("160 sampling predictor identity mismatch")
            if not lower <= index < window[1] or index in records or (network, inference) in seen:
                raise ValueError("inference reused or outside actual prediction window")
            records.add(index)
            seen.add((network, inference))
        lower = window[1]


def build_inputs(*, root, evidence, associations, locked, temporal=True):
    if not isinstance(evidence, dict):
        raise ValueError("capture evidence object required")
    snapshots = validate_sequence(records=evidence.get("geometry_snapshots"), temporal=temporal)
    _windows(snapshots=snapshots, associations=associations)
    descriptors = evidence.get("algorithm_frames")
    if not isinstance(descriptors, list) or len(descriptors) != len(snapshots):
        raise ValueError("one actual algorithm frame per prediction required")
    inventory = evidence.get("captures")
    networks = inventory.get("networks") if isinstance(inventory, dict) else None
    network_id = str(snapshots[0]["predictors"][1]["network"])
    network = networks.get(network_id) if isinstance(networks, dict) else None
    successes = network.get("successful_inferences") if isinstance(network, dict) else None
    if (not isinstance(successes, list) or not 1 <= len(successes) <= 129 or
            any(type(value) is not int for value in successes) or successes != list(range(len(successes)))):
        raise ValueError("contiguous successful 160 inference inventory required")
    records = network.get("inputs")
    if not isinstance(records, list) or len(records) != len(successes):
        raise ValueError("one actual input for every 160 inference required")
    for record in records:
        parity.validate_capture_tensor(item=record)
        if (record["name"] != "data" or record["inference"] not in successes or
                record["raw"] != [1, 6] or record["dims_nwhc"] != [1, 160, 160, 3]):
            raise ValueError("actual signed int8 160 BGR input required")
    if len({record["inference"] for record in records}) != len(records):
        raise ValueError("duplicate actual 160 input")
    inputs, cases, previous = {}, [], None
    for snapshot, descriptor, association in zip(snapshots, descriptors, associations, strict=True):
        selected = [item for item in association["inferences"] if item["size"] == 160]
        if not selected:
            previous = snapshot
            continue
        if len(selected) != 1:
            raise ValueError("160 multi-inference face routing is unresolved")
        inference = selected[0]
        if inference["inference"] not in successes:
            raise ValueError("160 inference has no completed network result")
        face = initialized_warp(snapshot=snapshot)
        active = [item for item in snapshot["faces"] if item["active"]]
        if not face["active"] or len(active) != 1 or face is not active[0]:
            raise ValueError("160 initialization requires one active observed warp; no retained no-face input")
        if previous is not None and (any(item["active"] for item in previous["faces"]) or
                face["id"] in {item["id"] for item in previous["faces"] if item["id"] >= 0}):
            raise ValueError("160 cold/new identity initialization required; stale warp reuse rejected")
        forward = np.asarray(face["detection_forward"], np.float32)
        inverse = np.asarray(face["detection_inverse"], np.float32)
        if not np.array_equal(inverse_forward(forward=forward), inverse):
            raise ValueError("observed detection forward/inverse mismatch")
        frame = algorithm_frame(root=Path(root), snapshot=snapshot, descriptor=descriptor, locked=locked)
        generated = signed_input(frame=frame, forward=forward, size=(160, 160))
        if (not isinstance(generated, np.ndarray) or generated.dtype != np.int16 or
                generated.shape != (1, 160, 160, 3) or
                generated.min() < -128 or generated.max() > 127):
            raise ValueError("bounded signed sampler output required before int8 storage conversion")
        tensor = generated.astype(np.int8)
        key = (160, inference["inference"])
        record = next(item for item in records if item["inference"] == key[1])
        path = Path(record["path"])
        if not path.resolve(strict=True).is_relative_to((Path(root) / "capture").resolve(strict=True)):
            raise ValueError("160 input escaped actual capture directory")
        data = locked.read(path=path, maximum=tensor.nbytes, expected=record["sha256"])
        if len(data) != tensor.nbytes:
            raise ValueError("actual 160 input truncated")
        actual = np.frombuffer(data, np.int8).reshape(tensor.shape)
        difference = np.abs(tensor.astype(np.int16) - actual.astype(np.int16))
        exact = tensor.tobytes() == data
        inputs[key] = tensor
        cases.append(dict(prediction=snapshot["index"], inference=key[1], slot=face["slot"],
            active=face["active"], sampling_exact=exact, input_sha256=digest(data=tensor.tobytes()),
            algorithm_frame_sha256=descriptor["sha256"], network=network_id,
            network_source_role="observed_160_initialization_predictor",
            input_source="independently_sampled_detection_forward", native_input_sha256=record["sha256"],
            detection_forward=face["detection_forward"], detection_inverse=face["detection_inverse"],
            different_values=int(np.count_nonzero(difference)), maximum_difference=int(difference.max())))
        previous = snapshot
    if {key[1] for key in inputs} != set(successes):
        raise ValueError("every actual 160 inference must have one current geometry window")
    locked.verify()
    if not all(case["sampling_exact"] for case in cases):
        raise SamplingMismatch(cases=cases)
    return inputs, cases


def run(*, args):
    out = sequence.fresh_output(path=args.out)
    locked = LockedFiles()
    report = dict(passed=False, completed=False, independent_160_sampling_input_used=False,
                  independent_160_sampling_inputs_generated=False,
                  native_inference_called=False, native_capture_called=False,
                  preprocessing_route_verified=False, per_face_inference_association_verified=False,
                  cases=[], failures=[])
    try:
        parity.no_torch()
        root = args.capture.resolve(strict=True)
        evidence = locked.json(path=root / "report.json")
        validate_dynamic(evidence=evidence)
        lock_sources(sources=evidence.get("source_sha256"), locked=locked)
        report.update(capture_sha256=digest(data=locked.read(path=root / "report.json")),
                      source_sha256={name: digest(data=locked.read(path=Path(__file__).with_name(name)))
                                     for name in SOURCE_NAMES})
        snapshots = observed.snapshots(directory=root / "geometry", locked=locked)
        if snapshots != evidence["geometry_snapshots"]:
            raise ValueError("actual 160 geometry changed since capture")
        inventory = capture.inventory(capture=root / "capture")
        if inventory != evidence["captures"]:
            raise ValueError("actual 160 tensors changed since capture")
        observed.lock_inventory(inventory=inventory, directory=root / "capture", locked=locked)
        associations = associate_inferences(records=snapshots, networks=inventory["networks"], temporal=True,
            metadata=[capture.metadata(path=path) for path in (root / "capture").glob("*.json")])
        if associations != evidence["prediction_inferences"]:
            raise ValueError("actual 160 neural association changed")
        try:
            inputs, report["cases"] = build_inputs(root=root, evidence=evidence, associations=associations,
                                                 locked=locked, temporal=True)
        except SamplingMismatch as error:
            report.update(cases=error.cases, diagnostic_only=True)
            report["failures"].append(str(error))
            if not getattr(args, "diagnostic", False):
                raise
            inputs = None
        locked.verify()
        if capture.inventory(capture=root / "capture") != inventory:
            raise RuntimeError("actual 160 inventory changed during sampling")
        parity.no_torch()
        if inputs is not None:
            for (_, inference), tensor in inputs.items():
                np.save(out / f"size-160-infer-{inference:03d}.npy", tensor, allow_pickle=False)
        report.update(completed=True, passed=inputs is not None,
                      independent_160_sampling_inputs_generated=inputs is not None,
                      exact_inferences=sum(case["sampling_exact"] for case in report["cases"]),
                      actual_160_inferences=len(report["cases"]), locked_sha256=dict(locked.files))
    except Exception as error:
        report["failures"].append(f"{type(error).__name__}: {error}")
        raise
    finally:
        (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("capture", "out"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    parser.add_argument("--diagnostic", action="store_true")
    report = run(args=parser.parse_args())
    print(json.dumps({key: report[key] for key in ("passed", "completed", "exact_inferences", "actual_160_inferences")}))


if __name__ == "__main__":
    main()
