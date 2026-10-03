"""Rebuild actual Stage1 input from locked RGBA and a single initialized warp.

Input equality is a gate, not a way to select a face or fit a transform.
Inactive retained geometry may explain a rejected inference, never a face ID.
"""
from pathlib import Path

import numpy as np

from face_alignment_sampling import inverse_forward, signed_input
from face_host_geometry_contract import validate_sequence
import face_render_model_parity as parity
from face_render_stability_probe import digest


def algorithm_frame(*, root, snapshot, descriptor, locked):
    index = snapshot["index"]
    _, width, height, _, _ = snapshot["request"]
    name, count = f"frame-{index}.rgba", width * height * 4
    if (not isinstance(descriptor, dict) or type(descriptor.get("prediction")) is not int or
            descriptor["prediction"] != index or descriptor.get("file") != name or
            type(descriptor.get("bytes")) is not int or descriptor["bytes"] != count):
        raise ValueError("actual algorithm frame descriptor mismatch")
    parity.require_sha256(value=descriptor.get("sha256"))
    data = locked.read(path=root / "geometry" / name, maximum=count, expected=descriptor["sha256"])
    if len(data) != count:
        raise ValueError("actual algorithm RGBA frame truncated")
    return np.frombuffer(data, np.uint8).reshape(height, width, 4)


def initialized_warp(*, snapshot):
    width, height = snapshot["request"][1:3]
    faces = [face for face in snapshot["faces"] if face["frame_size"] == [height, width] and
             len(face["stage1"][0]) == 106]
    if len(faces) != 1:
        raise ValueError("one initialized warp required; multi-face selection is not inferred")
    inverse_forward(forward=np.asarray(faces[0]["forward"], np.float32))
    return faces[0]


def build_inputs(*, root, evidence, associations, locked, temporal=False):
    snapshots = validate_sequence(records=evidence.get("geometry_snapshots"), temporal=temporal)
    descriptors = evidence.get("algorithm_frames")
    if (not isinstance(descriptors, list) or len(descriptors) != len(snapshots) or
            not isinstance(associations, list) or len(associations) != len(snapshots)):
        raise ValueError("one actual algorithm frame and association per prediction required")
    inputs, cases = {}, []
    for snapshot, descriptor, association in zip(snapshots, descriptors, associations, strict=True):
        if association.get("prediction") != snapshot["index"]:
            raise ValueError("sampling prediction association mismatch")
        frame = algorithm_frame(root=root, snapshot=snapshot, descriptor=descriptor, locked=locked)
        selected = [item for item in association["inferences"] if item["size"] == 120]
        if not selected:
            if not temporal or any(face["active"] for face in snapshot["faces"]):
                raise ValueError("idle sampling requires an explicit temporal no-face window")
            cases.append(dict(prediction=snapshot["index"], idle=True))
            continue
        if len(selected) != 1:
            raise ValueError("single inference sampling profile required; shared-face routing unresolved")
        inference = selected[0]
        if inference["network"] != str(snapshot["predictors"][0]["network"]):
            raise ValueError("sampling predictor identity mismatch")
        face = initialized_warp(snapshot=snapshot)
        tensor = signed_input(frame=frame, forward=np.asarray(face["forward"], np.float32))
        key = (120, inference["inference"])
        if key in inputs:
            raise ValueError("sampling inference reused across predictions")
        network = evidence["captures"]["networks"][inference["network"]]
        records = [item for item in network["inputs"] if item["name"] == "data" and item["inference"] == key[1]]
        if len(records) != 1 or records[0]["raw"] != [2, 6] or records[0]["dims_nwhc"] != [1, 120, 120, 3]:
            raise ValueError("one actual signed 120 BGR input required")
        locked.read(path=Path(records[0]["path"]), expected=records[0]["sha256"], maximum=tensor.nbytes)
        actual = parity.load_tensor(item=records[0])
        if not np.array_equal(tensor, actual):
            raise RuntimeError("own sampling differs from actual input; no correction or clipping")
        inputs[key] = tensor
        cases.append(dict(prediction=snapshot["index"], inference=key[1], slot=face["slot"],
                          active=face["active"], sampling_exact=True, input_sha256=digest(data=tensor.tobytes()),
                          algorithm_frame_sha256=descriptor["sha256"]))
    if not inputs:
        raise ValueError("at least one independently sampled input required")
    return inputs, cases
