"""Replay exported ONNX cases on a target OS without torch or vendor runtimes."""
import argparse
import importlib.util
import json
from pathlib import Path
import platform
import sys

import numpy as np
import onnxruntime as ort

from onnx_infer import ONNXModel, digest, read_npz


def replay(*, root, out, require_no_torch=False):
    root, out = root.resolve(), out.resolve()
    if out == root or out.is_relative_to(root) or (out.exists() and any(out.iterdir())):
        raise ValueError("fresh separate replay directory required")
    torch_present = importlib.util.find_spec("torch") is not None
    if require_no_torch and torch_present:
        raise ValueError("this replay requires an environment without torch installed")
    out.mkdir(parents=True, exist_ok=True)
    reports = []
    for contract in sorted(root.glob("*/contract.json")):
        result = {"model": contract.parent.name, "passed": False, "cases": []}
        try:
            if contract.stat().st_size > 1024 * 1024:
                raise ValueError("contract exceeds size limit")
            metadata = json.loads(contract.read_text())
            if not isinstance(metadata, dict):
                raise ValueError("contract must be a dictionary")
            if metadata.get("status") != "onnx-runtime-parity-passed":
                continue
            result.update(artifact_sha256=metadata["artifact_sha256"], contract_sha256=digest(path=contract))
            model = ONNXModel(contract_path=contract)
            for inputs in sorted(contract.parent.glob("*/inputs.npz")):
                values = model(read_npz(path=inputs))
                expected = read_npz(path=inputs.with_name("pytorch.npz"))
                if set(values) != set(expected):
                    raise ValueError("output names differ from frozen PyTorch outputs")
                outputs = {}
                for key, reference in expected.items():
                    actual = values[key]
                    valid = actual.shape == reference.shape and actual.dtype == reference.dtype
                    exact = bool(valid and np.array_equal(actual, reference))
                    passed = bool(valid and (exact if actual.dtype == np.int16 else np.allclose(actual, reference, atol=1e-4, rtol=1e-4)))
                    outputs[key] = {"passed": passed, "exact": exact,
                                    "max_abs": float(np.max(np.abs(actual.astype(np.float64) - reference.astype(np.float64)))) if valid else None}
                directory = out / contract.parent.name / inputs.parent.name
                directory.mkdir(parents=True)
                np.savez(directory / "outputs.npz", **values)
                result["cases"].append({"case": inputs.parent.name, "input_sha256": digest(path=inputs),
                                        "passed": all(value["passed"] for value in outputs.values()), "outputs": outputs})
            result["passed"] = bool(result["cases"]) and all(case["passed"] for case in result["cases"])
        except Exception as error:
            result["error"] = f"{type(error).__name__}: {error}"
        reports.append(result)
        print(json.dumps({"model": result["model"], "passed": result["passed"], "cases": len(result["cases"])}), flush=True)
    report = {"passed": bool(reports) and all(item["passed"] for item in reports), "platform": platform.platform(),
              "machine": platform.machine(), "python": sys.version, "onnxruntime": ort.__version__,
              "numpy": np.__version__, "torch_installed": torch_present, "providers": ["CPUExecutionProvider"],
              "scope": "same frozen inputs versus PyTorch; no claim of fresh vendor execution on target OS", "models": reports}
    (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--require-no-torch", action="store_true")
    args = parser.parse_args()
    return int(not replay(root=args.root, out=args.out, require_no_torch=args.require_no_torch)["passed"])


if __name__ == "__main__":
    raise SystemExit(main())
