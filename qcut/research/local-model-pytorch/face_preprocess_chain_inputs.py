"""Bind independently prepared 160 pixels to the actual lifecycle inference.

Native caller parameters remain inputs; captured pixels are comparison only.
No tensor is returned unless every associated oracle passes an exact gate.
"""
from pathlib import Path

import numpy as np

from face_alignment_input_verify import difference
from face_host_geometry_contract import validate_sequence
from face_host_sampling_inputs import algorithm_frame
from face_full_frame_owned import OwnedAlgorithmFrames
from face_preprocess_probe import validate_trace
from face_preprocess_replay import oracle_blob, prepare
import face_render_model_parity as parity
from face_render_stability_probe import digest


def validate_associations(*, associations, snapshots):
    if not isinstance(associations, list) or len(associations) != len(snapshots):
        raise ValueError("one ordered neural association per prediction required")
    lower = 0
    for snapshot, row in zip(snapshots, associations, strict=True):
        upper = snapshot["bytenn_sequence"]
        if (not isinstance(row, dict) or type(row.get("prediction")) is not int or
                row["prediction"] != snapshot["index"] or not isinstance(row.get("inferences"), list) or
                len(row["inferences"]) > 12 or not isinstance(row.get("neural_window"), list) or
                len(row["neural_window"]) != 2 or any(type(value) is not int for value in row["neural_window"]) or
                row["neural_window"] != [lower, upper]):
            raise ValueError("neural association order/window differs from actual predictions")
        for item in row["inferences"]:
            if (not isinstance(item, dict) or type(item.get("size")) is not int or item["size"] not in (120, 160) or
                    type(item.get("inference")) is not int or not 0 <= item["inference"] <= 128 or
                    type(item.get("record_index")) is not int or not 0 <= item["record_index"] <= 4095 or
                    not lower <= item["record_index"] < upper or not isinstance(item.get("network"), str) or
                    item["network"] != str(snapshot["predictors"][0 if item["size"] == 120 else 1]["network"])):
                raise ValueError("typed bounded actual neural association required")
        lower = upper


def build_inputs(*, root, evidence, associations, locked, owned_frames=None):
    if not isinstance(evidence, dict):
        raise ValueError("actual preprocessing evidence required")
    if owned_frames is not None and type(owned_frames) is not OwnedAlgorithmFrames:
        raise ValueError("exact-gated owned algorithm frame set required")
    snapshots = validate_sequence(records=evidence.get("geometry_snapshots"), temporal=True)
    validate_associations(associations=associations, snapshots=snapshots)
    cases = validate_trace(trace=evidence.get("trace"), records=snapshots, associations=associations)
    if (not isinstance(cases, list) or len(cases) != 2 or
            [case.get("prediction") for case in cases] != [0, 20] or evidence.get("cases") != cases):
        raise ValueError("two exact actual preprocessing lifecycle cases required")
    descriptors = evidence.get("algorithm_frames")
    if not isinstance(descriptors, list) or len(descriptors) != len(snapshots):
        raise ValueError("all actual algorithm frame descriptors required")
    expected = {(row["prediction"], item["network"], item["inference"])
                for row in associations for item in row["inferences"] if item["size"] == 160}
    selected = {(case["prediction"], str(case["event"]["network"]), case["inference"]) for case in cases}
    if expected != selected or sum(item["size"] == 160 for row in associations
                                    for item in row["inferences"]) != len(cases):
        raise ValueError("all actual 160 inferences must have one preprocessing case")
    inputs, results = {}, []
    for case in cases:
        prediction, event = case["prediction"], case["event"]
        if owned_frames is None:
            frame = algorithm_frame(root=root, snapshot=snapshots[prediction],
                                    descriptor=descriptors[prediction], locked=locked)
        else:
            frame = owned_frames.frame(snapshot=snapshots[prediction], descriptor=descriptors[prediction])
        produced = prepare(frame=frame, call=event["call"])
        checks = {stage: difference(actual=produced[stage], expected=oracle_blob(
            capture_dir=root, prediction=prediction, stage=stage, row=event[stage], locked=locked))
            for stage in ("source", "crop", "resized")}
        checks["post_crop_rect"] = dict(exact=produced["post_crop_rect"] == event["post_crop_rect"]["values"])
        key = (160, case["inference"])
        if key in inputs:
            raise ValueError("160 inference reused across lifecycle cases")
        network = evidence["captures"]["networks"][str(event["network"])]
        descriptor = parity.stage1_input(network=network, size=160, inference=key[1])
        tensor = produced["tensor"]
        if (type(tensor) is not np.ndarray or tensor.dtype != np.int8 or
                tensor.shape != (1, 160, 160, 3)):
            raise ValueError("independently generated int8 160 tensor required")
        locked.read(path=Path(descriptor["path"]), maximum=tensor.nbytes, expected=descriptor["sha256"])
        checks["tensor"] = difference(actual=tensor, expected=parity.load_tensor(item=descriptor))
        if not all(row["exact"] for row in checks.values()):
            raise RuntimeError("independent 160 chain input differs; native fallback forbidden")
        frozen = tensor.copy(order="C")
        frozen.setflags(write=False)
        inputs[key] = frozen
        results.append(dict(prediction=prediction, face_id=case["face_id"], inference=key[1],
                            network=str(event["network"]), neural_window=case["neural_window"],
                            record_index=case["record_index"], checks=checks, passed=True,
                            algorithm_frame_sha256=descriptors[prediction]["sha256"],
                            generated_tensor_sha256=digest(data=frozen.tobytes())))
    return inputs, results
