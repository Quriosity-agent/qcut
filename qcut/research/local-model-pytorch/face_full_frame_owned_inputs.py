"""Original RGBA -> exact algorithm RGBA -> owned 120/160 replacement tensors.

The returned maps plug directly into face_render_model_parity.run. Native warp,
caller Rect/flags and inference identities remain required recorded contracts.
"""
from pathlib import Path

import numpy as np

from face_alignment_sampling import signed_input
from face_full_frame_owned import build_frames
from face_host_geometry_contract import validate_sequence
from face_host_sampling_inputs import initialized_warp
from face_preprocess_chain_inputs import build_inputs as build_160, validate_associations
import face_render_model_parity as parity
from face_render_stability_probe import digest


def build_120(*, evidence, associations, frames, locked):
    inputs, cases = {}, []
    snapshots = validate_sequence(records=evidence["geometry_snapshots"], temporal=True)
    validate_associations(associations=associations, snapshots=snapshots)
    descriptors = evidence.get("algorithm_frames")
    if not isinstance(descriptors, list) or len(descriptors) != len(snapshots):
        raise ValueError("one exact algorithm descriptor per prediction required")
    for snapshot, descriptor, association in zip(snapshots, descriptors, associations, strict=True):
        frame = frames.frame(snapshot=snapshot, descriptor=descriptor)
        selected = [item for item in association["inferences"] if item["size"] == 120]
        if not selected:
            if any(face["active"] for face in snapshot["faces"]):
                raise ValueError("idle 120 inference requires explicit no-face window")
            cases.append(dict(prediction=snapshot["index"], idle=True))
            continue
        if len(selected) != 1:
            raise ValueError("single 120 inference per observation required")
        inference, face = selected[0], initialized_warp(snapshot=snapshot)
        key = (120, inference["inference"])
        if key in inputs:
            raise ValueError("120 inference reused across predictions")
        tensor = signed_input(frame=frame, forward=np.asarray(face["forward"], np.float32))
        if (type(tensor) is not np.ndarray or tensor.dtype != np.int16 or
                tensor.shape != (1, 120, 120, 3) or (tensor < -128).any() or (tensor > 127).any()):
            raise ValueError("bounded independently generated int16 120 tensor required")
        network = evidence["captures"]["networks"][inference["network"]]
        record = parity.stage1_input(network=network, size=120, inference=key[1])
        raw = locked.read(path=Path(record["path"]), expected=record["sha256"], maximum=tensor.nbytes)
        if len(raw) != tensor.nbytes:
            raise ValueError("120 input oracle truncated")
        reference = np.frombuffer(raw, np.int16).reshape(1, 120, 120, 3)
        if not np.array_equal(tensor, reference):
            raise RuntimeError("original-pixel owned 120 input differs; native fallback/correction forbidden")
        frozen = np.frombuffer(tensor.tobytes(), np.int16).reshape(tensor.shape)
        inputs[key] = frozen
        cases.append(dict(prediction=snapshot["index"], inference=key[1], slot=face["slot"],
                          active=face["active"], sampling_exact=True, input_sha256=digest(data=frozen.tobytes()),
                          algorithm_frame_sha256=descriptor["sha256"], input_source="original-rgba-staged-q11"))
    if not inputs:
        raise ValueError("nonempty owned 120 input profile required")
    return inputs, cases


def build_inputs(*, context, locked):
    frames, proof = build_frames(context=context, locked=locked)
    evidence, associations = context["evidence"], context["associations"]
    inputs, sampling = build_120(evidence=evidence, associations=associations, frames=frames, locked=locked)
    seeds, initialization = build_160(root=context["root"], evidence=evidence,
                                     associations=associations, locked=locked, owned_frames=frames)
    if not seeds:
        raise ValueError("nonempty original-pixel owned 160 input profile required")
    locked.verify()
    proof.update(sampling_cases=sampling, initialization_sampling_cases=initialization,
                 generated_120_inputs=len(inputs), generated_160_inputs=len(seeds),
                 captured_tensor_input_used=False, original_rgba_input_used=True)
    return inputs, seeds, proof
