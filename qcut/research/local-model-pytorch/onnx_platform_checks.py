"""Numerical qualification of authored fixtures through the deployment ONNX runner."""
import json
from pathlib import Path
import subprocess
import sys

import numpy as np

from onnx_infer import ONNXModel, digest, read_npz
from onnx_platform_fixtures import SCOPE, write_fixture

ATOL = 1e-6
RTOL = 1e-6


def compare(*, actual, expected):
    if set(actual) != set(expected):
        raise ValueError("output names differ from synthetic oracle")
    report = {}
    for name, reference in expected.items():
        value = actual[name]
        if value.shape != reference.shape or value.dtype != reference.dtype:
            raise ValueError(f"output schema differs from synthetic oracle: {name}")
        if not np.isfinite(value).all() or not np.isfinite(reference).all():
            raise ValueError(f"non-finite synthetic output: {name}")
        difference = np.abs(value.astype(np.float64) - reference.astype(np.float64))
        exact = value.dtype == np.dtype("int16") or value.shape == ()
        passed = value.tobytes() == reference.tobytes() if exact else np.all(difference <= ATOL + RTOL * np.abs(reference))
        report[name] = {"passed": bool(passed), "elements": int(value.size), "exact": exact,
                        "max_abs_error": float(difference.max(initial=0))}
    return report


def qualify_fixture(*, fixture, root):
    root = Path(root)
    contract = write_fixture(fixture=fixture, root=root)
    model = ONNXModel(contract_path=contract, threads=1, allow_unverified=True)
    cases, previous = [], {}
    for case in fixture["cases"]:
        values = {name: value.copy() for name, value in case["inputs"].items()}
        for input_name, output_name in fixture["feedback"].items():
            if previous:
                values[input_name] = previous[output_name]
        before = {name: value.tobytes() for name, value in values.items()}
        actual = model(values)
        if any(value.tobytes() != before[name] for name, value in values.items()):
            raise ValueError("runtime mutated a caller-owned tensor")
        checks = compare(actual=actual, expected=case["expected"])
        case_root = root / case["name"]
        case_root.mkdir()
        np.savez(case_root / "inputs.npz", **values)
        np.savez(case_root / "expected.npz", **case["expected"])
        np.savez(case_root / "actual.npz", **actual)
        cases.append({"name": case["name"], "passed": all(item["passed"] for item in checks.values()), "outputs": checks})
        previous = actual
    passed = bool(cases) and all(case["passed"] for case in cases)
    metadata = json.loads(contract.read_text(encoding="utf-8"))
    metadata["status"] = "onnx-runtime-parity-passed" if passed else "onnx-runtime-parity-failed"
    contract.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    return {"name": fixture["name"], "passed": passed, "artifact_sha256": digest(path=root / "model.onnx"),
            "case_count": len(cases), "cases": cases, "evidence_scope": SCOPE, "feedback": fixture["feedback"]}


def reload_and_reset(*, fixture, root):
    root = Path(root)
    model = ONNXModel(contract_path=root / "contract.json", threads=2)
    cases = fixture["cases"]
    checks = []
    for index in (len(cases) - 1, 0, min(1, len(cases) - 1), 0):
        case = cases[index]
        actual = model({name: value.copy() for name, value in case["inputs"].items()})
        outputs = compare(actual=actual, expected=case["expected"])
        checks.append({"name": case["name"], "passed": all(item["passed"] for item in outputs.values()), "outputs": outputs})
    return {"passed": all(item["passed"] for item in checks), "case_count": len(checks), "cases": checks}


def cli_roundtrip(*, fixture, root):
    root = Path(root).resolve()
    case = fixture["cases"][0]
    command = [sys.executable, str(Path(__file__).with_name("onnx_infer.py")), "--contract", str(root / "contract.json"),
               "--input", str(root / case["name"] / "inputs.npz"), "--out", str(root / "cli-output.npz"), "--threads", "1"]
    result = subprocess.run(command, capture_output=True, text=True, timeout=60, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"standalone ONNX runner failed: {result.stderr[-2000:]}")
    report = json.loads(result.stdout)
    outputs = compare(actual=read_npz(path=root / "cli-output.npz"), expected=case["expected"])
    if report.get("providers") != ["CPUExecutionProvider"] or report.get("passed") is not True:
        raise ValueError("standalone ONNX runner did not confirm CPU success")
    return {"passed": all(item["passed"] for item in outputs.values()), "outputs": outputs,
            "providers": report["providers"], "separate_process": True}
