"""Run public synthetic ONNX portability tests; never consume a private model path."""
import argparse
from datetime import datetime, timezone
import importlib.util
import io
import json
from pathlib import Path
import platform
import sys
import traceback
import unittest

import numpy as np
import onnx
import onnxruntime as ort

from onnx_platform_checks import ATOL, RTOL, cli_roundtrip, qualify_fixture, reload_and_reset
from onnx_platform_fixtures import SCOPE, fixtures


def normalized_machine(*, machine):
    return {"amd64": "x86_64", "x64": "x86_64", "aarch64": "arm64"}.get(machine.lower(), machine.lower())


def environment():
    return {"system": platform.system(), "platform": platform.platform(), "machine": platform.machine(),
            "normalized_machine": normalized_machine(machine=platform.machine()), "python": platform.python_version(),
            "numpy": np.__version__, "onnx": onnx.__version__, "onnxruntime": ort.__version__,
            "torch_installed": importlib.util.find_spec("torch") is not None, "torch_imported": "torch" in sys.modules,
            "providers": ["CPUExecutionProvider"], "graph_optimization": "disabled"}


def run_unit_tests(*, root):
    output = io.StringIO()
    suite = unittest.TestLoader().discover(str(Path(__file__).parent), pattern="onnx_platform_test.py")
    result = unittest.TextTestRunner(stream=output, verbosity=2).run(suite)
    (root / "unittest.log").write_text(output.getvalue(), encoding="utf-8")
    if not result.wasSuccessful():
        print(output.getvalue(), file=sys.stderr)
    return {"passed": result.wasSuccessful() and result.testsRun > 0 and not result.skipped,
            "tests": result.testsRun, "failures": len(result.failures), "errors": len(result.errors),
            "skipped": [{"test": str(test), "reason": reason} for test, reason in result.skipped]}


def run_suite(*, out, require_no_torch=False, expected_system=None, expected_machine=None):
    out = Path(out).resolve()
    out.mkdir(parents=True, exist_ok=False)
    report = {"format": "qcut-onnx-platform-synthetic-v1", "evidence_scope": SCOPE, "private_models_tested": 0,
              "generated_at": datetime.now(timezone.utc).isoformat(), "environment": environment(), "passed": False,
              "tolerance": {"float32_atol": ATOL, "float32_rtol": RTOL, "int16": "bit-exact", "scalar": "bit-exact"},
              "graphs": []}
    try:
        if require_no_torch and (report["environment"]["torch_installed"] or report["environment"]["torch_imported"]):
            raise ValueError("platform qualification requires an environment without torch")
        if expected_system and report["environment"]["system"] != expected_system:
            raise ValueError("runner OS differs from the requested qualification target")
        if expected_machine and report["environment"]["normalized_machine"] != normalized_machine(machine=expected_machine):
            raise ValueError("runner architecture differs from the requested qualification target")
        report["unit_tests"] = run_unit_tests(root=out)
        authored = fixtures()
        for fixture in authored:
            root = out / "graphs" / fixture["name"]
            try:
                result = qualify_fixture(fixture=fixture, root=root)
                if result["passed"]:
                    result["reload_reset"] = reload_and_reset(fixture=fixture, root=root)
                    result["cli"] = cli_roundtrip(fixture=fixture, root=root)
                    result["passed"] = result["reload_reset"]["passed"] and result["cli"]["passed"]
                report["graphs"].append(result)
            except Exception as error:
                report["graphs"].append({"name": fixture["name"], "passed": False, "error": f"{type(error).__name__}: {error}"})
                (out / f"{fixture['name']}-error.log").write_text(traceback.format_exc(), encoding="utf-8")
        complete = bool(authored) and len(report["graphs"]) == len(authored)
        report["passed"] = report["unit_tests"]["passed"] and complete and all(item["passed"] for item in report["graphs"])
    except Exception as error:
        report["error"] = f"{type(error).__name__}: {error}"
        (out / "error.log").write_text(traceback.format_exc(), encoding="utf-8")
    report["graph_count"] = len(report["graphs"])
    report["numeric_cases"] = sum(item.get("case_count", 0) for item in report["graphs"])
    report["reload_reset_cases"] = sum(item.get("reload_reset", {}).get("case_count", 0) for item in report["graphs"])
    report["cli_cases"] = sum("cli" in item for item in report["graphs"])
    report["environment"]["torch_imported"] = "torch" in sys.modules
    if report["environment"]["torch_imported"]:
        report["passed"] = False
        report.setdefault("error", "platform harness unexpectedly imported torch")
    (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--require-no-torch", action="store_true")
    parser.add_argument("--expected-system", choices=("Linux", "Darwin", "Windows"))
    parser.add_argument("--expected-machine", choices=("x86_64", "arm64"))
    args = parser.parse_args()
    report = run_suite(out=args.out, require_no_torch=args.require_no_torch,
                       expected_system=args.expected_system, expected_machine=args.expected_machine)
    print(json.dumps({key: value for key, value in report.items() if key != "graphs"}, indent=2))
    raise SystemExit(0 if report["passed"] else 1)


if __name__ == "__main__":
    main()
