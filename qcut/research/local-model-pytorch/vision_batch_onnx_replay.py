"""Bounded ONNX replay of all 54 frozen vision cases; no torch or native execution."""
import argparse
import json
from pathlib import Path
import platform
import sys
import time

import numpy as np
import onnxruntime as ort

from onnx_infer import ONNXModel, check_values, digest, read_npz
from vision_batch_profiles import FORMAT, PROFILES

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / ".local/jianying-model-pytorch"
SELECTED = {"clip2m", "clip30m", "normal"}


def compare(*, actual, expected):
    if not actual or set(actual) != set(expected):
        raise ValueError("exact nonempty named outputs required")
    results = {}
    for name, reference in expected.items():
        value = actual[name]
        if (not isinstance(value, np.ndarray) or not isinstance(reference, np.ndarray)
                or value.dtype != np.float32 or reference.dtype != np.float32 or value.shape != reference.shape
                or not np.isfinite(value).all() or not np.isfinite(reference).all()):
            raise ValueError("output dtype, shape or finite-value mismatch")
        difference = np.abs(value.astype(np.float64) - reference.astype(np.float64))
        tolerance = 1e-4 + 1e-4 * np.abs(reference.astype(np.float64))
        failures = int(np.count_nonzero(difference > tolerance))
        results[name] = {"passed": failures == 0, "max_abs": float(difference.max()),
                         "mae": float(difference.mean()), "failing_elements": failures,
                         "compared_elements": int(value.size), "exact": bool(np.array_equal(value, reference))}
    return {"passed": all(item["passed"] for item in results.values()), "outputs": results}


def check_cases(*, entry, native_report):
    cases, references = entry.get("cases"), native_report.get("cases")
    if (not isinstance(cases, list) or not isinstance(references, list) or len(cases) != 18 or len(references) != 18
            or any(not isinstance(case, dict) for case in cases + references)):
        raise ValueError("exactly 18 frozen cases per profile required")
    names, reference_names = [c.get("case") for c in cases], [c.get("case") for c in references]
    if (any(not isinstance(name, str) or not name for name in names + reference_names)
            or len(set(names)) != 18 or set(names) != set(reference_names)
            or any(c.get("passed") is not True for c in references)):
        raise ValueError("missing, duplicate or unverified frozen cases")
    by_name = {c["case"]: c for c in references}
    for case in cases:
        path = Path(case["input"]).resolve()
        if path != Path(by_name[case["case"]]["input_npz"]).resolve() or not path.is_relative_to(PRIVATE.resolve()):
            raise ValueError("handoff input differs from the verified original case")
        if (Path(case["native_output"]).resolve() != path.with_name("native.npz")
                or Path(case["pytorch_output"]).resolve() != path.with_name("pytorch.npz")):
            raise ValueError("frozen reference paths do not belong to the input case")


def check_contract(*, metadata, entry):
    profile = PROFILES[entry["profile"]]
    inputs = {"data": {"shape": profile["input_shape"], "dtype": "float32"}}
    outputs = {name: {"shape": shape, "dtype": "float32"} for name, shape in profile["outputs"].items()}
    if (metadata.get("source_format") != FORMAT or metadata.get("source_bundle_sha256") != entry["artifact_sha256"]
            or metadata.get("network") is not None or metadata.get("inputs") != inputs or metadata.get("outputs") != outputs):
        raise ValueError("ONNX contract differs from the exact PyTorch source/schema")


def fresh_output(*, path, root):
    path, root = Path(path).resolve(), root.resolve()
    if path == root or not path.is_relative_to(root) or (path.exists() and any(path.iterdir())):
        raise ValueError("fresh separate private output directory required")
    path.mkdir(parents=True, exist_ok=True)
    return path


def replay(*, handoff, contracts, out, tensor_out):
    out = fresh_output(path=out, root=PRIVATE)
    tensor_out = fresh_output(path=tensor_out, root=PRIVATE)
    entries = json.loads(handoff.read_text())
    if (not isinstance(entries, list) or len(entries) != 3 or any(not isinstance(e, dict) for e in entries)
            or {e.get("profile") for e in entries} != SELECTED):
        raise ValueError("exactly the three selected profiles required")
    report = {"format": "qcut-private-vision-onnx-frozen-replay-v1", "passed": False,
              "handoff": str(handoff.resolve()), "handoff_sha256": digest(path=handoff),
              "platform": platform.platform(), "machine": platform.machine(), "python": sys.version,
              "onnxruntime": ort.__version__, "numpy": np.__version__, "providers": ["CPUExecutionProvider"],
              "optimization": "disabled", "tolerance": {"atol": 1e-4, "rtol": 1e-4},
              "native_executions": 0, "pytorch_executions": 0,
              "scope": "actual ONNX versus frozen native and PyTorch outputs; no new native/source run",
              "authored_code_sha256": {name: digest(path=Path(__file__).with_name(name))
                                       for name in ("vision_batch_onnx_replay.py", "onnx_infer.py", "vision_batch_profiles.py")},
              "models": []}
    for entry in entries:
        profile = entry["profile"]
        record = {"profile": profile, "source_sha256": entry["source_sha256"], "network_id": "main",
                  "passed": False, "cases": []}
        report["models"].append(record)
        try:
            native_path = Path(entry["report"])
            native_report = json.loads(native_path.read_text())
            if (native_report["status"] != "native-parity-passed" or native_report["profile"] != profile
                    or entry["source_sha256"] != PROFILES[profile]["source_sha256"]
                    or native_report["source_sha256"] != entry["source_sha256"]
                    or native_report["artifact_sha256"] != entry["artifact_sha256"]
                    or digest(path=entry["artifact"]) != entry["artifact_sha256"]):
                raise ValueError("source report or PyTorch bundle provenance mismatch")
            check_cases(entry=entry, native_report=native_report)
            contract = contracts / f"vision-{profile}" / "contract.json"
            contract_sha = digest(path=contract)
            model = ONNXModel(contract_path=contract, threads=2)
            check_contract(metadata=model.metadata, entry=entry)
            model_path = contract.parent / model.metadata["artifact"]
            record.update(contract=str(contract.resolve()), contract_sha256=contract_sha,
                          onnx_model=str(model_path.resolve()), onnx_model_sha256=model.metadata["artifact_sha256"],
                          source_bundle_sha256=entry["artifact_sha256"], native_report=str(native_path),
                          native_report_sha256=digest(path=native_path), inputs=model.inputs, outputs=model.outputs)
            for index, case in enumerate(entry["cases"]):
                paths = {key: Path(case[key]) for key in ("input", "native_output", "pytorch_output")}
                hashes = {key: digest(path=path) for key, path in paths.items()}
                result = {"case": case["case"], "passed": False, "paths": {k: str(v) for k, v in paths.items()},
                          "hashes": hashes}
                record["cases"].append(result)
                try:
                    inputs = read_npz(path=paths["input"])
                    native = read_npz(path=paths["native_output"])
                    pytorch = read_npz(path=paths["pytorch_output"])
                    check_values(values=native, schema=model.outputs)
                    check_values(values=pytorch, schema=model.outputs)
                    start = time.perf_counter()
                    actual = model(inputs)
                    result["inference_ms"] = (time.perf_counter() - start) * 1000
                    result["onnx_vs_native"] = compare(actual=actual, expected=native)
                    result["onnx_vs_pytorch"] = compare(actual=actual, expected=pytorch)
                    result["frozen_pytorch_vs_native"] = compare(actual=pytorch, expected=native)
                    target = tensor_out / profile / f"output-{index:02d}.npz"
                    target.parent.mkdir(parents=True, exist_ok=True)
                    np.savez(target, **actual)
                    result.update(output=str(target), output_sha256=digest(path=target))
                    if hashes != {key: digest(path=path) for key, path in paths.items()}:
                        raise ValueError("frozen input or reference changed during inference")
                    result["passed"] = all(result[key]["passed"] for key in
                                           ("onnx_vs_native", "onnx_vs_pytorch", "frozen_pytorch_vs_native"))
                except Exception as error:
                    result["error"] = f"{type(error).__name__}: {error}"
            if digest(path=contract) != contract_sha or digest(path=model_path) != record["onnx_model_sha256"]:
                raise ValueError("contract/model changed during replay")
            record["passed"] = len(record["cases"]) == 18 and all(c["passed"] for c in record["cases"])
        except Exception as error:
            record["error"] = f"{type(error).__name__}: {error}"
        print(json.dumps({"profile": profile, "passed": record["passed"], "cases": len(record["cases"])}), flush=True)
        (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    cases = [case for model in report["models"] for case in model["cases"]]
    report.update(passed=len(cases) == 54 and all(m["passed"] for m in report["models"]),
                  cases=len(cases), passed_cases=sum(c["passed"] for c in cases),
                  onnx_vs_native_passed=sum(c.get("onnx_vs_native", {}).get("passed", False) for c in cases),
                  onnx_vs_pytorch_passed=sum(c.get("onnx_vs_pytorch", {}).get("passed", False) for c in cases),
                  torch_imported="torch" in sys.modules)
    (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--handoff", type=Path, default=PRIVATE / "vision-batch-phase4-replay-final/handoff.json")
    parser.add_argument("--contracts", type=Path, default=PRIVATE / "onnx-phase4")
    parser.add_argument("--out", type=Path, default=PRIVATE / "vision-batch-phase4-onnx-replay")
    parser.add_argument("--tensor-out", type=Path, default=PRIVATE / "vision-batch-phase4-onnx-replay")
    args = parser.parse_args()
    result = replay(handoff=args.handoff, contracts=args.contracts, out=args.out, tensor_out=args.tensor_out)
    print(json.dumps({key: result[key] for key in ("passed", "cases", "onnx_vs_native_passed", "onnx_vs_pytorch_passed", "torch_imported")}))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
