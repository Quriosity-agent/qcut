"""Run allowlisted public/synthetic owned-face CPU contracts, never native parity."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import importlib.util
import io
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time
import traceback
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "research/local-model-pytorch"), str(ROOT / "scripts/__tests__")]
sys.dont_write_bytecode = True

GROUPS = {
    "preprocessing": (
        "face_alignment_sampling_test.SamplingTests",
        "face_preprocess_replay_test.PrepareTests",
        "face_full_frame_quantization_test.SamplerTests",
        "face_full_frame_owned_test.OriginalProfileTests",
        "face_full_frame_owned_test.PipelineTests",
        "face_full_frame_owned_test.ModelBindingTests",
    ),
    "postprocess_state": (
        "face_host_geometry_output_test.OutputTests",
        "face_host_geometry_smoothing_test.SmoothingContractTests",
        "face_host_initialization_selection_test.SelectionTests",
        "face_live_candidate_test.ContractTests",
        "face_live_candidate_test.CoreTests",
        "face_live_candidate_test.HeadTests",
        "face_live_candidate_test.AuditTests",
    ),
    "persistent_worker_contract": (
        "face_live_worker_test.WorkerTests",
        "face_live_worker_protocol_test.FramingTests",
    ),
    "authored_onnx_process": (
        "face_cpu_platform_test.AuthoredOnnxTests",
        "face_cpu_platform_test.PersistentProtocolTests",
        "face_cpu_platform_test.RunnerTests",
    ),
}
POSIX_GROUPS = {
    "posix_unix_socket_service": ("face_live_worker_protocol_test.WorkerServiceTests",),
    "posix_optimized_smoothing": ("face_temporal_smoothing_test.TemporalSmoothingTests",),
}


def normalized_machine(*, value):
    value = value.lower()
    return {"amd64": "x86_64", "x64": "x86_64", "aarch64": "arm64"}.get(value, value)


def check_environment(*, expected_system=None, expected_machine=None):
    system, machine = platform.system(), normalized_machine(value=platform.machine())
    if system not in ("Linux", "Windows", "Darwin") or machine not in ("x86_64", "arm64"):
        raise ValueError("unsupported CPU contract platform")
    if expected_system and system != expected_system:
        raise ValueError("runner system does not match requested target")
    if expected_machine and machine != normalized_machine(value=expected_machine):
        raise ValueError("runner architecture does not match requested target")
    if "QCUT_FACE_LIVE_MODEL_ROOT" in os.environ:
        raise ValueError("private model environment is forbidden in this synthetic suite")
    if importlib.util.find_spec("torch") is not None or "torch" in sys.modules:
        raise ValueError("a Torch-free environment is required")
    return dict(system=system, machine=machine, python=platform.python_version())


def source_inventory(*, root):
    paths = [*sorted((root / "research/local-model-pytorch").glob("*.py")),
             root / "scripts/check_face_cpu_platform.py", root / "scripts/__tests__/face_cpu_platform_test.py",
             root / "scripts/requirements-face-cpu-platform.txt", root.parent / ".github/workflows/face-cpu-platform.yml"]
    return {path.relative_to(root.parent).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}


def check_sources(*, before, after):
    if not before or before != after:
        raise ValueError("source set or contents changed during CPU qualification")


def accepted(*, result, expected):
    return (expected > 0 and result.testsRun == expected and result.wasSuccessful()
            and not result.skipped and not result.expectedFailures)


def run_group(*, names, out):
    loader = unittest.TestLoader()
    suite = loader.loadTestsFromNames(names)
    count = suite.countTestCases()
    log = io.StringIO()
    started = time.monotonic()
    result = unittest.TextTestRunner(stream=log, verbosity=2).run(suite)
    out.write_text(log.getvalue(), encoding="utf-8")
    if not accepted(result=result, expected=count) or loader.errors:
        print(log.getvalue(), file=sys.stderr)
    return dict(passed=accepted(result=result, expected=count) and not loader.errors,
        tests=result.testsRun, failures=len(result.failures), errors=len(result.errors),
        skipped=[dict(test=str(test), reason=reason) for test, reason in result.skipped],
        expected_failures=len(result.expectedFailures), elapsed_seconds=time.monotonic() - started,
        selected_classes=list(names), failed_tests=[str(test) for test, _ in result.failures + result.errors])


def run_suite(*, out, expected_system=None, expected_machine=None):
    out = Path(out).resolve()
    out.mkdir(parents=True, exist_ok=False)
    report = dict(format="qcut-face-owned-cpu-contract-v1", passed=False,
        generated_at=datetime.now(timezone.utc).isoformat(),
        evidence_scope="public-synthetic-contracts-only", private_models_tested=0,
        native_execution_performed=False, native_renderer_platform_qualified=False,
        private_converted_model_parity=False, candidate_parity_verified=False,
        production_private_model_loader_tested=False, groups={}, authored_evidence=[])
    started = time.monotonic()
    try:
        before = source_inventory(root=ROOT)
        report["source_sha256"] = before
        report["source_count"] = len(before)
        report["git_head"] = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
        report["environment"] = check_environment(expected_system=expected_system, expected_machine=expected_machine)
        pins = {}
        for line in (ROOT / "scripts/requirements-face-cpu-platform.txt").read_text().splitlines():
            name, expected = line.split("==")
            actual = importlib.metadata.version(name)
            if actual != expected:
                raise ValueError(f"{name} version mismatch: expected {expected}, got {actual}")
            pins[name] = actual
        report["environment"].update(dependencies=pins, providers=["CPUExecutionProvider"],
                                      torch_installed=False, graph_optimization="disabled for authored graphs")
        groups = dict(GROUPS)
        posix = report["environment"]["system"] != "Windows"
        if posix:
            groups.update(POSIX_GROUPS)
        report["coverage_boundaries"] = dict(
            all_platforms="owned samplers; ordinary uncached state; production infer/heads; framing/dispatch over test TCP",
            unix_socket_service="synthetic service tested" if posix else "not qualified: production AF_UNIX/permissions",
            optimized_expf="host libm synthetic tests" if posix else "not qualified: current CDLL(None).expf route",
            cross_platform_bit_parity="not established; per-platform references and fingerprints only",
            native_renderer="not invoked on any runner; no Linux/Windows renderer claim",
            private_models="not read, copied, downloaded or uploaded; private parity remains local-only")
        import face_cpu_platform_test
        face_cpu_platform_test.EVIDENCE.clear()
        for name, names in groups.items():
            report["groups"][name] = run_group(names=names, out=out / f"{name}.log")
        report["authored_evidence"] = list(face_cpu_platform_test.EVIDENCE)
        report["tolerance"] = dict(authored_heads_atol=face_cpu_platform_test.ATOL,
                                    authored_heads_rtol=face_cpu_platform_test.RTOL,
                                    sampled_bytes="exact", persistent_points_vs_scalar_fixture="exact")
        check_sources(before=before, after=source_inventory(root=ROOT))
        report["source_guard_verified"] = True
        if "torch" in sys.modules:
            raise ValueError("unexpected Torch import during qualification")
        if (len(report["authored_evidence"]) != 2 or {row["kind"] for row in report["authored_evidence"]}
                != {"authored-onnx-arithmetic", "persistent-authored-onnx-worker"}):
            raise ValueError("both authored ONNX and persistent process evidence are required")
        report["passed"] = bool(report["groups"]) and all(row["passed"] for row in report["groups"].values())
    except Exception as error:
        report["error"] = f"{type(error).__name__}: {error}"
        (out / "error.log").write_text(traceback.format_exc(), encoding="utf-8")
    report["tests"] = sum(row["tests"] for row in report["groups"].values())
    report["elapsed_seconds"] = time.monotonic() - started
    (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--expected-system", choices=("Linux", "Windows", "Darwin"))
    parser.add_argument("--expected-machine", choices=("x86_64", "arm64"))
    args = parser.parse_args()
    report = run_suite(out=args.out, expected_system=args.expected_system, expected_machine=args.expected_machine)
    print(json.dumps({key: report[key] for key in ("passed", "tests", "elapsed_seconds", "evidence_scope")}
                     | {"report": str(args.out / "report.json"), "error": report.get("error")}, indent=2))
    raise SystemExit(0 if report["passed"] else 1)


if __name__ == "__main__":
    main()
