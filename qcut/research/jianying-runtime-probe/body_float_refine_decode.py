"""Measure the public-joint impact of the independent float network residual."""
import argparse
import csv
import json
from pathlib import Path
import sys

import numpy as np

from body_float_refine_probe import compare, load_oracle, load_owned_input, read_json, verified_file, verify_producer_sources
from espresso_archive import sha256

ENGINE = Path(__file__).resolve().parents[1] / "independent-beauty/research"
sys.path.insert(0, str(ENGINE))
from body_skeleton_decode import (coco17_to_cpm18, crop_layout_and_roi, map_local_to_global,
    postprocess, refine_pose, refine_tensor, tracking_body_box)

JOINT_NAMES = ("nose", "neck", "right_shoulder", "right_elbow", "right_wrist", "left_shoulder",
    "left_elbow", "left_wrist", "right_hip", "right_knee", "right_ankle", "left_hip",
    "left_knee", "left_ankle", "right_eye", "left_eye", "right_ear", "left_ear")


def validate_points(*, points):
    if points.dtype != np.float32 or points.shape != (18, 4) or not np.isfinite(points).all():
        raise ValueError("finite Float32 public18 joints required")
    if not np.isin(points[:, 3], [0, 1]).all() or not np.equal(points[:, :2], np.trunc(points[:, :2])).all():
        raise ValueError("integer coordinates and binary validity required")


def decode_output(*, output, previous, roi, body_scale):
    validate_points(points=previous)
    if output.dtype != np.float32 or output.shape != (1, 24, 18, 34) or not np.isfinite(output).all():
        raise ValueError("finite Float32 NHWC refine output required")
    if len(roi) != 4 or not np.isfinite(roi).all() or min(roi[2:]) <= 0 or not np.isfinite(body_scale) or body_scale <= 0:
        raise ValueError("valid independently derived crop geometry required")
    # Float-network output already contains physical values; the integer /1024 adapter does not apply.
    heatmaps = output[0].transpose(2, 0, 1).tolist()
    local = postprocess(heatmaps, [], stride=4, coordinate_scale=2, paf_scale=1, single=True, joint_count=17)
    mapped = np.asarray(coco17_to_cpm18(map_local_to_global(local, (144, 192), roi)[0]), np.float32)
    public = np.asarray(refine_pose(heatmaps, roi, previous.tolist(), body_scale), np.float32)
    validate_points(points=public)
    return {"mappedBeforeThresholdAndSmoothing": mapped, "public": public}


def joint_metrics(*, actual, expected, source_scale):
    validate_points(points=actual)
    validate_points(points=expected)
    scale = np.asarray(source_scale, np.float64)
    if scale.shape != (2,) or not np.isfinite(scale).all() or np.min(scale) <= 0:
        raise ValueError("positive source-image scale required")
    coordinate_delta = actual[:, :2].astype(np.float64) - expected[:, :2].astype(np.float64)
    both_valid = (actual[:, 3] == 1) & (expected[:, 3] == 1)
    distance = np.linalg.norm(coordinate_delta[both_valid], axis=1)
    source_distance = np.linalg.norm(coordinate_delta[both_valid] * scale, axis=1)
    return {"public72": compare(actual=actual, expected=expected),
        "coordinates": compare(actual=actual[:, :2], expected=expected[:, :2]),
        "confidence": compare(actual=actual[:, 2], expected=expected[:, 2]),
        "validity": compare(actual=actual[:, 3], expected=expected[:, 3]),
        "jointCoordinatesExact": int(np.count_nonzero(np.all(coordinate_delta == 0, axis=1))),
        "sharedValidJoints": int(np.count_nonzero(both_valid)),
        "maximumJointDistanceAlgorithmPixels": float(distance.max(initial=0)),
        "maximumJointDistanceOriginalPixels": float(source_distance.max(initial=0)),
        "jointRows": [{"index": i, "name": name, "actual": actual[i].tolist(), "native": expected[i].tolist(),
            "coordinateDeltaAlgorithmPixels": coordinate_delta[i].tolist(),
            "coordinateDeltaOriginalPixels": (coordinate_delta[i] * scale).tolist(),
            "confidenceDelta": float(np.float64(actual[i, 2]) - np.float64(expected[i, 2])),
            "validityExact": bool(actual[i, 3] == expected[i, 3])} for i, name in enumerate(JOINT_NAMES)]}


def load_context(*, evidence):
    owned_input, input_receipt = load_owned_input(evidence=evidence)
    verify_producer_sources(evidence=evidence, engine=ENGINE)
    report = read_json(path=evidence / "owned-comparison.json")
    previous_meta = report["rows"][0]["ownedPoints"]["cold"]
    previous_path = verified_file(root=evidence, name=previous_meta["file"], expected=previous_meta["sha256"])
    previous = np.load(previous_path, allow_pickle=False)
    validate_points(points=previous)
    raster_path = verified_file(root=evidence, name=input_receipt["algorithmFile"], expected=input_receipt["algorithmSha256"])
    raster_receipt = read_json(path=raster_path.with_suffix(".json"))
    width, height = raster_receipt["width"], raster_receipt["height"]
    raster = np.fromfile(raster_path, np.uint8).reshape(height, width, 4)
    box = tracking_body_box(previous.tolist(), (width, height))
    if box is None:
        raise ValueError("owned previous state has no tracking crop")
    layout, roi = crop_layout_and_roi(box)
    archive = evidence / input_receipt["ownedArchive"]["file"]
    with np.load(archive, allow_pickle=False) as tensors:
        reconstructed = refine_tensor(raster[..., :3], box)[None]
        if not np.array_equal(reconstructed, tensors["input"]):
            raise ValueError("crop reconstructed from owned previous joints does not match recorded inference")
        baseline = tensors["output_0"].astype(np.float32) / np.float32(1024)
    return {"input": owned_input, "inputReceipt": input_receipt, "previous": previous,
        "previousMetadata": previous_meta, "algorithmSize": [width, height], "baselineOutput": baseline,
        "box": box, "layout": layout, "roi": roi, "bodyScale": max(box[2:]), "cropInputExact": True}


def run_decode(*, evidence, candidate_directory, label):
    if evidence.parent.name != "body-default-profile-20261023" or evidence.parent.parent.name != ".local":
        raise ValueError("private decode artifacts must stay under .local/body-default-profile-20261023")
    if not label or Path(label).name != label or label in {".", ".."}:
        raise ValueError("output label must be a directory basename")
    context = load_context(evidence=evidence)
    candidate_report = read_json(path=candidate_directory / "report.json")
    if candidate_report["nativeCapturedTensorUsedAsInput"] is not False:
        raise ValueError("candidate must use independent input")
    if candidate_report["input"]["inputSha256"] != context["inputReceipt"]["inputSha256"]:
        raise ValueError("candidate belongs to a different source-derived crop")
    for path, expected in candidate_report["sources"].items():
        if sha256(path=Path(path)) != expected:
            raise ValueError("candidate source identity mismatch")
    outputs = {"integer_baseline": context["baselineOutput"]}
    candidate_receipts = {}
    for precision in ("float32", "float16"):
        metadata = candidate_report["candidates"][precision]
        path = verified_file(root=candidate_directory, name=metadata["file"], expected=metadata["sha256"])
        with np.load(path, allow_pickle=False) as tensors:
            if not np.array_equal(tensors["input"], context["input"]):
                raise ValueError("candidate input mismatch")
            outputs[precision] = tensors["output"].copy()
        candidate_receipts[precision] = {"file": str(path), "sha256": metadata["sha256"]}
    decoded = {name: decode_output(output=output, previous=context["previous"], roi=context["roi"], body_scale=context["bodyScale"])
               for name, output in outputs.items()}
    destination = evidence.parent / label
    destination.mkdir(exist_ok=False)
    for name, stages in decoded.items():
        np.savez_compressed(destination / (name + ".npz"), **stages)
    # This separate oracle-only decode checks the decoder, never the independent inference input.
    oracle = load_oracle(evidence=evidence, profile="default")
    native_trace = read_json(path=evidence / "default/trace.json")
    call = native_trace["calls"][1]
    if call["orientation"] != 0 or [call["width"], call["height"]] != context["algorithmSize"]:
        raise ValueError("unexpected native orientation or algorithm geometry")
    native = np.asarray(call["public"][0], np.float32)
    validate_points(points=native)
    oracle_decode = decode_output(output=oracle["output"], previous=context["previous"], roi=context["roi"], body_scale=context["bodyScale"])
    decoder_validation = compare(actual=oracle_decode["public"], expected=native)
    raw_validation = compare(actual=oracle_decode["mappedBeforeThresholdAndSmoothing"], expected=np.asarray(call["passes"][0]["people"][0][:18], np.float32))
    previous_validation = compare(actual=context["previous"], expected=np.asarray(native_trace["calls"][0]["public"][0], np.float32))
    if not decoder_validation["exact"] or not raw_validation["exact"] or not previous_validation["exact"]:
        raise ValueError("decoder or previous-state native validation failed")
    provenance = read_json(path=evidence / "provenance.json")
    source_size = [provenance["width"], provenance["height"]]
    scale = [source_size[i] / context["algorithmSize"][i] for i in range(2)]
    metrics = {name: joint_metrics(actual=stages["public"], expected=native, source_scale=scale) for name, stages in decoded.items()}
    np.save(destination / "native-public.npy", native, allow_pickle=False)
    with (destination / "joint-comparison.csv").open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["candidate", "index", "joint", "x", "y", "score", "valid", "native_x", "native_y", "native_score", "native_valid", "dx_algorithm", "dy_algorithm", "dscore"])
        for name, result in metrics.items():
            for row in result["jointRows"]:
                writer.writerow([name, row["index"], row["name"], *row["actual"], *row["native"], *row["coordinateDeltaAlgorithmPixels"], row["confidenceDelta"]])
    report = {"scope": "Same first float refine pass only; no temporal continuation or final-render parity claim",
        "input": context["inputReceipt"], "previousOwnedPoints": context["previousMetadata"],
        "crop": {key: context[key] for key in ("box", "layout", "roi", "bodyScale", "algorithmSize", "cropInputExact")},
        "sourceSize": source_size, "algorithmToOriginalScale": scale,
        "decoderValidation": {"nativeRawTensorToNativePublic72": decoder_validation, "nativeRawTensorToNativeDetector72": raw_validation,
            "previousOwnedPointsVsNativePublic72": previous_validation, "oracleTraceSha256": oracle["traceSha256"]},
        "candidateInputsContainNativePointsOrTensors": False,
        "nativeOutputDecodedOnlyForDecoderValidation": True,
        "thresholds": {"tracked": 0.2, "missing": 0.5, "smoothingSigma": 0.035, "source": "existing native-verified refine_pose defaults; unchanged"},
        "candidateReportSha256": sha256(path=candidate_directory / "report.json"), "candidateFiles": candidate_receipts,
        "results": metrics,
        "sources": {str(path): sha256(path=path) for path in [Path(__file__), *(ENGINE / name for name in ("body_skeleton_decode.py", "body_skeleton_kernels.py", "body_skeleton_preprocess.py"))]},
        "artifacts": {path.name: sha256(path=path) for path in sorted(destination.iterdir())}}
    (destination / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence", required=True, type=Path)
    parser.add_argument("--candidates", required=True, type=Path)
    parser.add_argument("--label", required=True)
    args = parser.parse_args()
    report = run_decode(evidence=args.evidence.resolve(), candidate_directory=args.candidates.resolve(), label=args.label)
    print(json.dumps({name: {key: value for key, value in result.items() if key != "jointRows"} for name, result in report["results"].items()}, indent=2))


if __name__ == "__main__":
    main()
