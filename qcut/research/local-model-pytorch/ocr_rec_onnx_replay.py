"""Replay all 20 frozen OCR v4 cases with NumPy/ORT; never rerun PT or native."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import re
import sys
import time

import numpy as np

from onnx_infer import ONNXModel, check_values, digest, read_npz

PRIVATE = (Path(__file__).resolve().parent / "../../.local/jianying-model-pytorch").resolve()
SOURCE_FORMAT = "qcut-private-ocr-recognizer-logits-pytorch-v4"
SOURCE_SHA256 = "d158975a0f2e1cacf95cb88a6f83343143af5f5dbf4cc850eff92aeba3bf7bac"
BUNDLE_SHA256 = "74a35a9cbde6bdcdb0f8dacdebf85071ac4927f03aafb7bea44f0e18845534ff"
INPUTS = {"data": {"shape": [1, 3, 32, 512], "dtype": "float32"}}
OUTPUTS = {"embedding": {"shape": [1, 10537, 1, 128], "dtype": "float32"}}


def private_path(*, path, root):
    root, value = Path(root).resolve(), Path(path).resolve()
    if root == Path(root.anchor) or value == root or not value.is_relative_to(root):
        raise ValueError("replay files must remain beneath the private or explicitly mounted root")
    return value


def check_source_report(*, report):
    if (not isinstance(report, dict) or report.get("format") != SOURCE_FORMAT
            or report.get("source_sha256") != SOURCE_SHA256 or report.get("artifact_sha256") != BUNDLE_SHA256
            or report.get("status") != "native-parity-passed" or report.get("all_declared_outputs_verified") is not True):
        raise ValueError("expected the passing hash-pinned OCR v4 native report")
    cases = report.get("cases")
    if not isinstance(cases, list) or len(cases) != 20:
        raise ValueError("exactly all 20 frozen OCR cases are required")
    names = []
    for case in cases:
        if (not isinstance(case, dict) or case.get("passed") is not True or not isinstance(case.get("case"), str)
                or not re.fullmatch(r"[A-Za-z0-9-]+", case["case"])):
            raise ValueError("invalid or failed frozen OCR case")
        names.append(case["case"])
    if len(set(names)) != len(names):
        raise ValueError("duplicate frozen OCR cases")


def compare_all(*, actual, expected):
    if (not isinstance(actual, np.ndarray) or not isinstance(expected, np.ndarray)
            or actual.dtype != np.float32 or expected.dtype != np.float32
            or actual.shape != expected.shape or actual.ndim != 4 or not actual.size
            or not np.isfinite(actual).all() or not np.isfinite(expected).all()):
        raise ValueError("complete finite FP32 terminal tensors of equal shape required")
    delta = np.abs(actual.astype(np.float64) - expected.astype(np.float64))
    allowed = 1e-4 + 1e-4 * np.abs(expected.astype(np.float64))
    outside = delta > allowed
    actual_ids, expected_ids = actual.argmax(axis=1), expected.argmax(axis=1)
    mismatches = np.argwhere(actual_ids != expected_ids)
    return {"passed": not bool(outside.any()), "shape": list(actual.shape), "elements": actual.size,
            "outside_tolerance": int(outside.sum()), "max_abs": float(delta.max()), "mae": float(delta.mean()),
            "max_tolerance_ratio": float((delta / allowed).max()), "bitwise_equal": actual.tobytes() == expected.tobytes(),
            "argmax": {"axis": 1, "diagnostic_only": True, "positions": actual_ids.size,
                       "mismatches": len(mismatches), "equal": len(mismatches) == 0,
                       "first_mismatches": [{"position": point.tolist(), "actual": int(actual_ids[tuple(point)]),
                                              "expected": int(expected_ids[tuple(point)])} for point in mismatches[:16]]}}


def forbidden_modules():
    prefixes = ("torch", "ocr_rec_torch", "bytenn", "container_scan", "model_containers")
    return sorted(name for name in sys.modules if any(name == prefix or name.startswith(prefix + ".") for prefix in prefixes))


def replay_case(*, case, run, out, root, model):
    directory = private_path(path=run / f"case-{case['case']}", root=root)
    paths = {"input": directory / "inputs.npz", "native": directory / "native-outputs.npz",
             "pytorch": directory / "pytorch-outputs.npz"}
    paths = {name: private_path(path=path, root=root) for name, path in paths.items()}
    hashes = {name: digest(path=path) for name, path in paths.items()}
    values = read_npz(path=paths["input"])
    check_values(values=values, schema=INPUTS)
    raw_sha = hashlib.sha256(values["data"].transpose(0, 2, 3, 1).astype("<f4", copy=False).tobytes()).hexdigest()
    if raw_sha != case["input_sha256"]:
        raise ValueError("frozen NCHW input differs from original native NHWC content hash")
    references = {name: read_npz(path=paths[name]) for name in ("native", "pytorch")}
    for reference in references.values():
        check_values(values=reference, schema=OUTPUTS)
    started = time.perf_counter()
    outputs = model(values)
    elapsed = time.perf_counter() - started
    check_values(values=outputs, schema=OUTPUTS)
    destination = out / f"case-{case['case']}"
    destination.mkdir()
    np.savez(destination / "onnx-outputs.npz", **outputs)
    comparisons = {name: {key: compare_all(actual=value, expected=reference[key]) for key, value in outputs.items()}
                   for name, reference in references.items()}
    passed = all(item["passed"] for reference in comparisons.values() for item in reference.values())
    if any(digest(path=path) != hashes[name] for name, path in paths.items()):
        raise ValueError("frozen fixture changed during replay")
    return {"case": case["case"], "passed": passed, "inference_seconds": elapsed,
            "input_nhwc_content_sha256": raw_sha, "file_sha256": hashes,
            "files": {name: str(path) for name, path in paths.items()}, "comparisons": comparisons,
            "output": str(destination / "onnx-outputs.npz"), "output_sha256": digest(path=destination / "onnx-outputs.npz")}


def replay(*, run, contract, out, private_root=PRIVATE, threads=2):
    run, contract, out = [private_path(path=path, root=private_root) for path in (run, contract, out)]
    if out.exists() and any(out.iterdir()):
        raise ValueError("fresh empty ONNX replay output directory required")
    out.mkdir(parents=True, exist_ok=True)
    result = {"status": "running", "cases": [], "native_rerun": False, "pytorch_rerun": False,
              "scope": "all frozen OCR v4 terminal values versus native AND PT references; model-level ONNX only",
              "platform": platform.platform(), "machine": platform.machine(), "python": platform.python_version(),
              "numpy": np.__version__, "onnxruntime": sys.modules["onnxruntime"].__version__, "cpu_threads": threads,
              "tolerance": {"atol": 1e-4, "rtol": 1e-4}, "argmax_is_diagnostic_only": True,
              "source_sha256": SOURCE_SHA256, "source_bundle_sha256": BUNDLE_SHA256}
    report_path = out / "report.json"

    def save():
        report_path.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")

    try:
        source_report = private_path(path=run / "report.json", root=private_root)
        if source_report.stat().st_size > 1024 * 1024:
            raise ValueError("oversized frozen native report")
        report = json.loads(source_report.read_text())
        check_source_report(report=report)
        result.update(source_report=str(source_report), source_report_sha256=digest(path=source_report),
                      contract=str(contract), contract_sha256=digest(path=contract))
        if forbidden_modules():
            raise ValueError("unexpected PT or vendor modules imported")
        started = time.perf_counter()
        model = ONNXModel(contract_path=contract, threads=threads)
        result["session_load_seconds"] = time.perf_counter() - started
        metadata = model.metadata
        if (metadata.get("source_format") != SOURCE_FORMAT or metadata.get("source_bundle_sha256") != BUNDLE_SHA256
                or model.inputs != INPUTS or model.outputs != OUTPUTS):
            raise ValueError("ONNX contract differs from frozen recognizer v4")
        result.update(artifact_sha256=metadata["artifact_sha256"], providers=model.session.get_providers(), optimization="disabled")
        save()
        for case in report["cases"]:
            try:
                entry = replay_case(case=case, run=run, out=out, root=private_root, model=model)
            except Exception as error:
                entry = {"case": case["case"], "passed": False, "error": f"{type(error).__name__}: {error}"}
            result["cases"].append(entry)
            save()
            print(json.dumps({"case": entry["case"], "passed": entry["passed"], "seconds": entry.get("inference_seconds")}), flush=True)
        result["forbidden_modules_loaded"] = forbidden_modules()
        result["evidence_hashes_unchanged"] = (digest(path=source_report) == result["source_report_sha256"]
                                                and digest(path=contract) == result["contract_sha256"]
                                                and digest(path=contract.parent / metadata["artifact"]) == result["artifact_sha256"])
        passed = (len(result["cases"]) == 20 and all(case["passed"] for case in result["cases"])
                  and not result["forbidden_modules_loaded"] and result["evidence_hashes_unchanged"])
        result.update(status="onnx-frozen-replay-passed" if passed else "verification-failed",
                      cases_passed=sum(case["passed"] for case in result["cases"]), cases_total=len(result["cases"]))
    except Exception as error:
        result.update(status="verification-failed", error=f"{type(error).__name__}: {error}")
    finally:
        save()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--contract", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--private-root", type=Path, default=PRIVATE, help="ignored root or explicitly mounted target-OS private root")
    parser.add_argument("--threads", type=int, default=2)
    args = parser.parse_args()
    report = replay(run=args.run, contract=args.contract, out=args.out, private_root=args.private_root, threads=args.threads)
    print(json.dumps({key: report.get(key) for key in ("status", "cases_passed", "cases_total", "error")}))
    return int(report["status"] != "onnx-frozen-replay-passed")


if __name__ == "__main__":
    raise SystemExit(main())
