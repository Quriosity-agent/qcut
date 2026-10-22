"""Run the genuine embedded float body model from a verified owned crop.

Native captures are opened only after candidate inference and saved as comparison
references. This one-pass diagnostic does not change the production sequence.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import platform
import time

import numpy as np
import torch

from body_coreml_normalization import normalize_body_coreml_input
from body_float_refine_model import BodyFloatRefine
from espresso_archive import extract_coreml, read_archive, sha256

MODEL_SHA256 = "734f9e41b6fd4b3ffbe5485b4ec592835e5b4cc18cd7dc8f33047fd486e41ff1"


def read_json(*, path):
    return json.loads(path.read_text())


def verified_file(*, root, name, expected):
    path = root / name
    if not path.resolve().is_relative_to(root.resolve()) or sha256(path=path) != expected:
        raise ValueError(f"evidence identity mismatch: {name}")
    return path


def load_owned_input(*, evidence):
    provenance = read_json(path=evidence / "provenance.json")
    report = read_json(path=evidence / "owned-comparison.json")
    if report.get("nativePointsUsedAsInput") is not False or report.get("nativeAlgorithmUsedAsInput") is not False:
        raise ValueError("owned input must be independently produced")
    row = report["rows"][1]
    if row["call"] != 1:
        raise ValueError("expected the first float refine call")
    source = Path(row["source"])
    expected_source = provenance["inputs"][str(source)]
    if sha256(path=source) != expected_source:
        raise ValueError("original RGBA identity mismatch")
    if source.stat().st_size != provenance["width"] * provenance["height"] * 4:
        raise ValueError("original RGBA size mismatch")
    raster = verified_file(root=evidence, name=row["ownedAlgorithmFile"], expected=row["ownedAlgorithmSha256"])
    raster_receipt = read_json(path=raster.with_suffix(".json"))
    if raster_receipt.get("privateNativeImages") != [] or raster.stat().st_size != raster_receipt["pixelBytes"]:
        raise ValueError("invalid independent raster receipt")
    metadata = row["ownedPoints"]["cold"]["inferences"][0]
    if metadata["network"] != "refine" or metadata["file"] != "owned/cold-001-pass0.npz":
        raise ValueError("expected the independently cropped first float refine input")
    archive = verified_file(root=evidence, name=metadata["file"], expected=metadata["sha256"])
    with np.load(archive, allow_pickle=False) as tensors:
        integer = tensors["input"]
        stored = tensors["owned_coreml_input"]
        if integer.dtype != np.int16 or integer.shape != (1, 192, 144, 3):
            raise ValueError("unexpected owned integer crop")
        if integer.min() < -128 or integer.max() > 127:
            raise ValueError("owned crop is not centered byte pixels")
        bgr = (integer[0].astype(np.int32) + 128).astype(np.uint8)
        reconstructed = normalize_body_coreml_input(bgr=bgr)[None]
        if stored.dtype != np.float32 or not np.array_equal(stored, reconstructed):
            raise ValueError("owned float input disagrees with source-derived BGR normalization")
    receipt = {"source": str(source), "sourceSha256": expected_source,
        "algorithmFile": row["ownedAlgorithmFile"], "algorithmSha256": row["ownedAlgorithmSha256"],
        "ownedArchive": metadata, "inputKey": "owned_coreml_input",
        "inputReconstructedFromOwnedIntegerPixels": True,
        "inputSha256": hashlib.sha256(reconstructed.tobytes()).hexdigest(),
        "inputLayout": "NHWC", "inputShape": list(reconstructed.shape),
        "modelSha256": report["networkProvenance"]["source"]["modelSha256"],
        "evidenceFiles": {name: sha256(path=evidence / name) for name in ("provenance.json", "owned-comparison.json")}}
    return reconstructed, receipt


def verify_producer_sources(*, evidence, engine):
    report = read_json(path=evidence / "owned-comparison.json")
    for name, expected in report["candidateSources"].items():
        verified_file(root=engine, name=name, expected=expected)
    for name, expected in report["probeSources"].items():
        verified_file(root=Path(__file__).parent, name=name, expected=expected)
    return {"engineFiles": len(report["candidateSources"]), "probeFiles": len(report["probeSources"])}


def compare(*, actual, expected):
    if actual.shape != expected.shape or not np.isfinite(actual).all() or not np.isfinite(expected).all():
        raise ValueError("incompatible or non-finite comparison tensors")
    delta = np.abs(actual.astype(np.float64) - expected.astype(np.float64))
    return {"shape": list(actual.shape), "exact": bool(np.array_equal(actual, expected)),
        "different": int(np.count_nonzero(delta)), "total": int(actual.size),
        "maximum": float(delta.max(initial=0)), "mean": float(delta.mean()),
        "allcloseAtol1e-4Rtol1e-4": bool(np.allclose(actual, expected, atol=1e-4, rtol=1e-4))}


def load_oracle(*, evidence, profile):
    directory = evidence / profile
    trace = read_json(path=directory / "trace.json")
    stage = trace["calls"][1]["passes"][0]
    if stage["network"] != "refine":
        raise ValueError("native oracle is not a refine pass")
    result = {}
    for direction in ("input", "output"):
        entries = stage[direction + "Tensors"]
        if len(entries) != 1:
            raise ValueError("unexpected native tensor arity")
        metadata = entries[0]
        if metadata["storage"] != 4 or metadata["fraction"] != 0 or metadata["layout"] != 1:
            raise ValueError("native oracle must be float32 NHWC")
        path = verified_file(root=directory, name=metadata["file"], expected=metadata["sha256"])
        result[direction] = np.fromfile(path, dtype="<f4").reshape(metadata["shape"])
        result[direction + "Metadata"] = metadata
    result["traceSha256"] = sha256(path=directory / "trace.json")
    return result


def run_probe(*, evidence, model_path, engine, label):
    if evidence.parent.name != "body-default-profile-20261023" or evidence.parent.parent.name != ".local":
        raise ValueError("private float artifacts must stay under .local/body-default-profile-20261023")
    if not label or Path(label).name != label or label in {".", ".."}:
        raise ValueError("output label must be a directory basename")
    model_hash = sha256(path=model_path)
    owned_input, input_receipt = load_owned_input(evidence=evidence)
    if model_hash != MODEL_SHA256 or model_hash != input_receipt["modelSha256"]:
        raise ValueError("body model differs from the pinned source package")
    source_verification = verify_producer_sources(evidence=evidence, engine=engine)
    spec, blobs, prefix = read_archive(path=model_path)
    if spec["inputs"] != {"x_1": {"shape": [1, 3, 192, 144], "allowed_shapes": []}} or spec["outputs"] != ["output_0"]:
        raise ValueError("unexpected embedded body network schema")
    destination = evidence.parent / label
    destination.mkdir(exist_ok=False)
    extracted = extract_coreml(path=model_path, destination=destination / "private-model.mlmodelc")
    metadata = read_json(path=extracted / "metadata.json")[0]
    torch.set_num_threads(1)
    inputs = {"x_1": torch.from_numpy(owned_input.transpose(0, 3, 1, 2).copy())}
    outputs = {}
    candidates = {}
    for precision in ("float32", "float16"):
        model = BodyFloatRefine(spec=spec, blobs=blobs, precision=precision).eval()
        started = time.monotonic()
        with torch.inference_mode():
            output = model(inputs)["output_0"].numpy().transpose(0, 2, 3, 1).copy()
        if not np.isfinite(output).all():
            raise ValueError("non-finite owned float inference")
        path = destination / (precision + ".npz")
        np.savez_compressed(path, input=owned_input, output=output)
        outputs[precision] = output
        candidates[precision] = {"file": path.name, "sha256": sha256(path=path),
            "elapsedSeconds": time.monotonic() - started, "parameters": sum(p.numel() for p in model.parameters()),
            "compute": "PyTorch CPU " + precision,
            "precisionSemantics": "Inputs, convolution parameters and intermediate tensors use " + precision + "; outputs cast to Float32; accumulation follows PyTorch CPU kernels",
            "outputExactlyFloat16Representable": bool(np.array_equal(output, output.astype(np.float16).astype(np.float32)))}
    oracle = load_oracle(evidence=evidence, profile="default")
    if not np.array_equal(owned_input, oracle["input"]):
        raise ValueError("owned input does not match first native float pass; comparison invalid")
    with np.load(evidence / input_receipt["ownedArchive"]["file"], allow_pickle=False) as cpu:
        baseline = cpu["output_0"].astype(np.float32) / np.float32(1024)
    for precision, output in outputs.items():
        candidates[precision]["vsNativeDefault"] = compare(actual=output, expected=oracle["output"])
        candidates[precision]["vsOwnedIntegerBaseline"] = compare(actual=output, expected=baseline)
    layers = spec["layers"]
    sources = [Path(__file__), Path(__file__).with_name("body_float_refine_model.py"),
        Path(__file__).with_name("body_coreml_normalization.py"), Path(__file__).parents[1] / "local-model-pytorch/espresso_archive.py"]
    report = {"scope": "First asynchronous float refine pass; genuine model, owned pixels, no sequence or final-pixel parity claim",
        "model": {"source": str(model_path), "sha256": model_hash, "archivePrefix": prefix,
            "metadata": metadata, "layerCounts": dict(Counter(layer["type"] for layer in layers)),
            "weightLayouts": dict(Counter("u8-per-channel" if layer.get("weights") else "float32" for layer in layers if layer["type"] == "convolution")),
            "extractedFiles": {str(path.relative_to(extracted)): sha256(path=path) for path in sorted(extracted.rglob("*")) if path.is_file()},
            "weightDequantization": spec["quantization_profile"]},
        "input": input_receipt, "producerSourcesVerified": source_verification,
        "nativeCapturedTensorUsedAsInput": False, "nativeRuntimeLoadedForInference": False,
        "oracle": {"traceSha256": oracle["traceSha256"], "input": oracle["inputMetadata"], "output": oracle["outputMetadata"],
            "openedAfterCandidateInference": True, "outputExactlyFloat16Representable": bool(np.array_equal(oracle["output"], oracle["output"].astype(np.float16).astype(np.float32)))},
        "baselineVsNative": compare(actual=baseline, expected=oracle["output"]), "candidates": candidates,
        "limitations": ["One source-derived crop at the first native float pass; later crops diverge with tracking state",
            "Same source package contains separate integer and CoreML graphs; integer arenas are not a float-model substitute",
            "Float16 metadata does not establish native fusion, accumulation order, or intermediate rounding",
            "Neither tested precision is bit-exact or within allclose atol=rtol=1e-4; no default or production change"],
        "sources": {str(path): sha256(path=path) for path in sources},
        "environment": {"python": platform.python_version(), "torch": torch.__version__, "numpy": np.__version__, "platform": platform.platform()}}
    (destination / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--engine", type=Path, required=True)
    parser.add_argument("--label", required=True)
    args = parser.parse_args()
    report = run_probe(evidence=args.evidence.resolve(), model_path=args.model.resolve(), engine=args.engine.resolve(), label=args.label)
    print(json.dumps({"baseline": report["baselineVsNative"], "candidates": report["candidates"]}, indent=2))


if __name__ == "__main__":
    main()
