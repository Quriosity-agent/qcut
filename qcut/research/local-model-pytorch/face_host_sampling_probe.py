"""Compare actual host RGBA/Stage1 inputs with fixed affine sampling controls.

Completion means the diagnostic ran; sampling parity is a separate exact gate.
Post-prediction matrices do not by themselves prove the preprocessing call route.
"""
from __future__ import annotations

import argparse
import ctypes as ct
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageDraw

from face_alignment_replay import LockedFiles
from face_alignment_warp_native import validate_matrix
from face_geometry_native import mat_view
from face_host_geometry_contract import associate_inferences, validate_sequence
from face_host_geometry_replay import active_face
import face_render_model_capture as capture
import face_render_model_parity as parity
import face_render_sequence_probe as sequence
from face_render_stability_probe import digest


def recovered(*, tensor):
    if (tensor.dtype != np.int16 or tensor.shape != (1, 120, 120, 3) or
            (tensor < -128).any() or (tensor > 127).any()):
        raise ValueError("actual signed 120 BGR input required; clipping prohibited")
    return (tensor[0].astype(np.int32) + 128).astype(np.uint8)


def opencv_sample(*, frame, inverse, interpolation):
    import cv2

    if cv2.__version__ != "4.11.0":
        raise ValueError("sampling diagnostic requires OpenCV 4.11.0")
    matrix = validate_matrix(matrix=inverse)
    if (frame.dtype != np.uint8 or frame.ndim != 3 or frame.shape[2] != 4 or
            not all(1 <= value <= 4096 for value in frame.shape[:2]) or
            interpolation not in ("nearest", "linear")):
        raise ValueError("bounded RGBA affine sampling control required")
    mode = cv2.INTER_NEAREST if interpolation == "nearest" else cv2.INTER_LINEAR
    pixels = cv2.warpAffine(frame, matrix, (120, 120), flags=mode | cv2.WARP_INVERSE_MAP,
                           borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    return pixels[:, :, :3][:, :, ::-1].copy()


def difference(*, actual, expected):
    if actual.dtype != np.uint8 or expected.dtype != np.uint8 or actual.shape != (120, 120, 3) or expected.shape != actual.shape:
        raise ValueError("matching uint8 BGR sampling blocks required")
    delta = np.abs(actual.astype(np.int16) - expected.astype(np.int16))
    return dict(exact=bool(np.array_equal(actual, expected)), elements=int(delta.size),
                changed_elements=int(np.count_nonzero(delta)), changed_pixels=int(np.count_nonzero(delta.max(axis=2))),
                max_abs=int(delta.max()), mean_abs=float(delta.mean()))


def native_samples(*, warp, frame, face):
    forward, inverse = (validate_matrix(matrix=face[key]) for key in ("forward", "inverse"))
    warp.set_matrix(matrix=forward)
    borrowed = mat_view(array=inverse)
    warp.set_inverse(warp.transform, ct.byref(borrowed))
    if not all(np.array_equal(actual, expected) for actual, expected in zip(warp.matrices(), (forward, inverse), strict=True)):
        raise ValueError("recorded native sampling control matrix changed")
    return {"native-fallback": warp.prepare(frame=frame, mode="RGBA", size=(120, 120), fused=False),
            "native-fused": warp.prepare(frame=frame, mode="RGBA", size=(120, 120), fused=True)}


def visual(*, blocks, reference, output):
    width = 250 * (len(blocks) + 1)
    canvas = Image.new("RGB", (width, 560), "white")
    draw = ImageDraw.Draw(canvas)
    draw.text((8, 8), "Actual host input / fixed sampling controls; absolute grayscale x8", fill="black")
    for index, (name, block) in enumerate({"actual-network-input": reference, **blocks}.items()):
        x = index * 250 + 8
        canvas.paste(Image.fromarray(block[:, :, ::-1]).resize((240, 240)), (x, 50))
        gray = np.abs(block.astype(np.int16) - reference.astype(np.int16)).max(axis=2)
        canvas.paste(Image.fromarray(np.clip(gray * 8, 0, 255).astype(np.uint8)).resize((240, 240)), (x, 305))
        draw.text((x, 30), name, fill="black")
    canvas.save(output)


def finish_report(*, out, report, resources, original_error):
    cleanup_error = None
    for resource in resources:
        if resource is None:
            continue
        try:
            resource.close()
        except Exception as error:
            report["completed"] = False
            report["failures"].append(f"cleanup {type(error).__name__}: {error}")
            if cleanup_error is None:
                cleanup_error = error
    try:
        (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    except Exception as error:
        report["completed"] = False
        report["failures"].append(f"report {type(error).__name__}: {error}")
        if original_error is None:
            raise
    if original_error is None and cleanup_error is not None:
        raise cleanup_error


def run(*, args):
    out = sequence.fresh_output(path=args.out)
    locked = LockedFiles()
    report = dict(completed=False, sampling_parity=False, native_inference_called=False,
                  native_geometry_required=True, preprocessing_route_verified=False, cases=[], failures=[])
    native = None
    warp = None
    try:
        parity.no_torch()
        report["source_sha256"] = {name: digest(data=locked.read(path=Path(__file__).with_name(name)))
                                  for name in (Path(__file__).name, "face_host_geometry_contract.py",
                                               "face_host_geometry_replay.py", "face_render_model_parity.py",
                                               "face_alignment_warp_native.py", "face_alignment_input_native.py",
                                               "face_detector_native.py", "face_geometry_native.py", "espresso_oracle.py")}
        root = args.capture.resolve(strict=True)
        evidence = locked.json(path=root / "report.json")
        parity.validate_capture(captured=evidence)
        if evidence.get("geometry_observer_only") is not True or evidence.get("per_prediction_inference_association_verified") is not True:
            raise ValueError("associated actual geometry observer required")
        snapshots = validate_sequence(records=evidence.get("geometry_snapshots"))
        if capture.inventory(capture=root / "capture") != evidence["captures"]:
            raise ValueError("actual sampling tensors changed since capture")
        associations = associate_inferences(records=snapshots, networks=evidence["captures"]["networks"],
                                             metadata=[capture.metadata(path=path) for path in (root / "capture").glob("*.json")])
        if associations != evidence.get("prediction_inferences"):
            raise ValueError("actual sampling neural association changed")
        frames = evidence.get("algorithm_frames")
        if not isinstance(frames, list) or len(frames) != len(snapshots):
            raise ValueError("hashed actual algorithm frames required")
        if args.native_control:
            from face_alignment_input_native import NativeAlignmentInput
            from face_alignment_warp_native import BYTENN_SHA256, NativeAlignmentWarp
            from face_geometry_native import LIBRARY, LIBRARY_SHA256, MODEL, MODEL_SHA256

            for path, expected in ((LIBRARY, LIBRARY_SHA256), (MODEL, MODEL_SHA256),
                                   (LIBRARY.with_name("libbytenn.dylib"), BYTENN_SHA256)):
                locked.read(path=path, maximum=128 * 1024**2, expected=expected)
            native = NativeAlignmentInput(output=out / "native-control")
            warp = NativeAlignmentWarp(native=native)
        for snapshot, descriptor, association in zip(snapshots, frames, associations, strict=True):
            actual = locked.json(path=root / f"geometry/prediction-{snapshot['index']}.json")
            if actual != snapshot or descriptor.get("prediction") != snapshot["index"] or association.get("prediction") != snapshot["index"]:
                raise ValueError("actual sampling snapshot association changed")
            expected_name = f"frame-{snapshot['index']}.rgba"
            _, width, height, _, _ = snapshot["request"]
            if descriptor.get("file") != expected_name or type(descriptor.get("bytes")) is not int or descriptor["bytes"] != width * height * 4:
                raise ValueError("actual sampling frame descriptor mismatch")
            parity.require_sha256(value=descriptor.get("sha256"))
            data = locked.read(path=root / "geometry" / expected_name, maximum=width * height * 4,
                               expected=descriptor.get("sha256"))
            if len(data) != width * height * 4:
                raise ValueError("actual sampling frame truncated")
            frame = np.frombuffer(data, np.uint8).reshape(height, width, 4)
            selected = [item for item in association["inferences"] if item["size"] == 120]
            if len(selected) != 1:
                raise ValueError("one actual sampling 120 inference required")
            inference = selected[0]
            network = evidence["captures"]["networks"][inference["network"]]
            inputs = [item for item in network["inputs"] if item["inference"] == inference["inference"] and item["name"] == "data"]
            if len(inputs) != 1 or inputs[0]["raw"] != [2, 6]:
                raise ValueError("single actual 120 signed BGR tensor required")
            locked.read(path=Path(inputs[0]["path"]), expected=inputs[0]["sha256"], maximum=120 * 120 * 3 * 2)
            reference = recovered(tensor=parity.load_tensor(item=inputs[0]))
            face = active_face(snapshot=snapshot)
            blocks = {f"opencv-{mode}": opencv_sample(frame=frame, inverse=face["inverse"], interpolation=mode)
                      for mode in ("nearest", "linear")}
            if warp is not None:
                blocks.update(native_samples(warp=warp, frame=frame, face=face))
            report["cases"].append(dict(prediction=snapshot["index"], inference=inference["inference"],
                                       comparisons={name: difference(actual=block, expected=reference) for name, block in blocks.items()}))
            if snapshot["index"] == 0:
                visual(blocks=blocks, reference=reference, output=out / "comparison.png")
        locked.verify()
        if capture.inventory(capture=root / "capture") != evidence["captures"]:
            raise RuntimeError("actual sampling model inventory changed during control")
        parity.no_torch()
        report.update(completed=True, opencv_version="4.11.0", numpy_version=np.__version__,
                      native_control_called=args.native_control, fixture_sha256=locked.files,
                      sampling_parity=all(case["comparisons"]["opencv-linear"]["exact"] for case in report["cases"]))
    except Exception as error:
        report["failures"].append(f"{type(error).__name__}: {error}")
        raise
    finally:
        finish_report(out=out, report=report, resources=(warp, native), original_error=sys.exc_info()[1])
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("capture", "out"):
        parser.add_argument(f"--{name}", required=True, type=Path)
    parser.add_argument("--native-control", action="store_true")
    report = run(args=parser.parse_args())
    print(json.dumps(dict(completed=report["completed"], sampling_parity=report["sampling_parity"],
                          predictions=len(report["cases"]))))


if __name__ == "__main__":
    main()
