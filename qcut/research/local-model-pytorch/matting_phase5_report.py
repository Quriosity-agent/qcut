"""Recheck full outputs and independent feedback before handing parity to parent."""
import argparse
import json
from pathlib import Path
import re

import torch

from matting_cpu_boundary import metrics
from matting_cpu_export import FEEDBACK, digest, fresh_directory, read_tensor
from matting_phase5_torch import ORDERED_PROFILE
from matting_torch import (CPU_RUNTIME_SHA256, INPUT_SHAPES, ORDERED_CPU_FORMAT,
                           OUTPUT_SHAPES, SOURCE_SHA256)


def checked_report(*, path: Path, artifact_sha256: str | None = None) -> dict[str, object]:
    data = json.loads(path.read_text())
    if data.get("status") != "native-parity-passed" or data.get("tolerances") != {"atol": 1e-4, "rtol": 1e-4}:
        raise ValueError("passed fixed-tolerance report required")
    native = data["native"]
    if (native.get("status") != "completed" or native.get("forced_cpu") is not True or native.get("forward_type") != 0
            or native.get("runtime_sha256") != CPU_RUNTIME_SHA256):
        raise ValueError("completed pinned forced CPU reference required")
    if artifact_sha256 is not None and (data.get("artifact_sha256") != artifact_sha256 or data.get("source_sha256") != SOURCE_SHA256):
        raise ValueError("network report provenance mismatch")
    return data


def recheck_outputs(*, root: Path, report: dict[str, object], temporal: bool) -> list[dict[str, object]]:
    cases = report.get("cases", [])
    if not cases or len({case["case"] for case in cases}) != len(cases):
        raise ValueError("nonempty unique case set required")
    results = []
    previous = None
    for index, case in enumerate(cases):
        name = case["case"]
        if not re.fullmatch(r"case-[A-Za-z0-9-]+", name) or set(case.get("outputs", {})) != set(OUTPUT_SHAPES):
            raise ValueError("complete four-output case required")
        directory = root / name
        output_comparisons = {}
        for key, shape in OUTPUT_SHAPES.items():
            expected = read_tensor(path=directory / f"out-{key}.f32", shape=shape)
            actual = read_tensor(path=directory / f"pytorch-{key}.f32", shape=shape)
            output_comparisons[key] = metrics(actual=actual, expected=expected)
        input_checks = {}
        for key, shape in INPUT_SHAPES.items():
            supplied = read_tensor(path=directory / f"in-{key}.f32", shape=shape)
            applied = read_tensor(path=directory / f"applied-{key}.f32", shape=shape)
            echo = read_tensor(path=directory / f"echo-{key}.f32", shape=shape)
            if not torch.equal(applied, echo):
                raise ValueError("native input echo changed")
            if temporal and key in FEEDBACK and not case["reset"]:
                if previous is None:
                    raise ValueError("feedback without previous state")
                native_previous = read_tensor(path=previous / f"out-{FEEDBACK[key]}.f32", shape=shape)
                torch_previous = read_tensor(path=previous / f"pytorch-{FEEDBACK[key]}.f32", shape=shape)
                if not torch.equal(applied, native_previous) or not torch.equal(supplied, torch_previous):
                    raise ValueError("independent feedback chain changed")
            elif not torch.equal(supplied, applied):
                raise ValueError("native same-input mismatch")
            if temporal and key in FEEDBACK and case["reset"] and bool(torch.count_nonzero(supplied)):
                raise ValueError("reset must clear every recurrent state")
            input_checks[key] = {"echo_exact": True, "applied_sha256": digest(data=(directory / f"applied-{key}.f32").read_bytes())}
        if temporal:
            frames = report["sampled_frames"]
            if case["frame"] != index % frames or case["reset"] != (index % frames in report["reset_frames"]):
                raise ValueError("temporal case order/reset mismatch")
            if index >= frames:
                original = root / cases[index - frames]["case"]
                for prefix in ("out", "pytorch"):
                    if any((directory / f"{prefix}-{key}.f32").read_bytes() != (original / f"{prefix}-{key}.f32").read_bytes() for key in OUTPUT_SHAPES):
                        raise ValueError("complete replay changed")
        passed = case.get("passed") is True and all(row["passed"] for row in output_comparisons.values())
        results.append({"case": name, "scope": str(root), "passed": passed,
                        "outputs": output_comparisons, "input_checks": input_checks})
        previous = directory
    return results


def combine(*, run: Path, media: list[Path], primitives: Path, replay: Path,
            traces: list[Path], out: Path) -> dict[str, object]:
    base = checked_report(path=run / "report.json")
    artifact = Path(base["artifact"])
    sha = digest(data=artifact.read_bytes())
    if (sha != base["artifact_sha256"] or base["source_sha256"] != SOURCE_SHA256
            or base.get("arithmetic_profile") != ORDERED_PROFILE
            or base.get("fp16_decoder_proof", {}).get("passed") is not True):
        raise ValueError("ordered artifact or source/FP16 provenance mismatch")
    if len(media) != 2 or len(set(path.resolve() for path in media)) != 2:
        raise ValueError("two distinct temporal reports required")
    cases = recheck_outputs(root=run, report=base, temporal=False)
    media_reports = []
    references = [run / "report.json", primitives / "report.json", replay / "report.json"]
    for path in media:
        item = checked_report(path=path / "report.json", artifact_sha256=sha)
        if (item["sampled_frames"] != 60 or len(item["cases"]) != 120 or item["distinct_frames"] < 50
                or item["reset_frames"] != [0, 30] or not all(item[key] for key in
                    ("native_feedback_exact", "native_replay_exact", "torch_replay_exact"))):
            raise ValueError("complete 60-frame independent reset/replay evidence required")
        cases.extend(recheck_outputs(root=path, report=item, temporal=True))
        media_reports.append({key: item[key] for key in ("video", "video_sha256", "distinct_frames", "sampled_frames", "inferences")})
        references.append(path / "report.json")
    if len({item["video_sha256"] for item in media_reports}) != 2:
        raise ValueError("two distinct source clips required")
    primitive_report = checked_report(path=primitives / "report.json")
    primitive_cases = primitive_report["comparisons"]
    if len(primitive_cases) != 40 or not all(row["passed"] and row["input_echo_exact"] for row in primitive_cases):
        raise ValueError("complete standalone primitive proof required")
    replay_report = json.loads((replay / "report.json").read_text())
    if replay_report["status"] != "replay-passed" or replay_report["artifact_sha256"] != sha:
        raise ValueError("independent-process replay must pass")
    workers = replay_report["workers"]
    if ({row["threads"] for row in workers} != {1, 2, 4} or len(workers) != 3
            or any(len(row["cases"]) != 18 or row["returncode"] != 0 or not all(case["passed"] for case in row["cases"]) for row in workers)):
        raise ValueError("complete 1/2/4-thread replay required")
    if len(traces) != 2 or len(set(path.resolve() for path in traces)) != 2:
        raise ValueError("two distinct full retained-prefix traces required")
    for path in traces:
        trace = json.loads((path / "report.json").read_text())
        if (trace["artifact_sha256"] != sha or trace["source_sha256"] != SOURCE_SHA256
                or trace["native"]["status"] != "completed" or trace["native"]["runtime_sha256"] != CPU_RUNTIME_SHA256
                or trace["first_failure"] is not None or not trace["tensor_comparisons"]
                or not all(row["passed"] for row in trace["tensor_comparisons"])):
            raise ValueError("fresh retained-prefix comparison failed")
        references.append(path / "report.json")
    passed = len(cases) == 250 and all(case["passed"] for case in cases)
    source_files = sorted(Path(__file__).parent.glob("matting*.py")) + [Path(__file__).with_name("matting_cpu_oracle.mm")]
    report = {**base, "status": "native-parity-passed" if passed else "native-parity-failed", "cases": cases,
              "new_native_verified_networks": int(passed), "new_registered_networks": 0,
              "all_declared_outputs_verified": passed, "native_inferences": len(cases),
              "full_output_comparisons": len(cases) * 4,
              "bitwise_output_comparisons": sum(row["bitwise_equal"] for case in cases for row in case["outputs"].values()),
              "numerically_equal_output_comparisons": sum(row["max_abs"] == 0 for case in cases for row in case["outputs"].values()),
              "signed_zero_only_output_differences": sum(row["max_abs"] == 0 and not row["bitwise_equal"] for case in cases for row in case["outputs"].values()),
              "signed_zero_only_differing_values": sum(row["bitwise_differing_values"] for case in cases for row in case["outputs"].values() if row["max_abs"] == 0),
              "media": media_reports, "primitive_comparisons": 40, "independent_process_replay_cases": 54,
              "evidence": [{"path": str(path.resolve()), "sha256": digest(data=path.read_bytes())} for path in references],
              "source_code": {path.name: digest(data=path.read_bytes()) for path in source_files},
              "integration": {"format": ORDERED_CPU_FORMAT, "profile": ORDERED_PROFILE,
                              "loader": "matting_torch.load_model(path=..., expected_sha256=..., allow_unverified=True)",
                              "default_rejected": True, "registration_owner": "parent", "vendor_runtime_required_for_loading": False},
              "temporal_scope": "two source clips, independent state feedback, 0/30 reset, complete replay",
              "scope": "pinned arm64 CPU network parity; no ONNX/editor/GPU/production preprocessing claim",
              "unchanged_container_load_tested": False}
    out = fresh_directory(path=out)
    (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ("run", "primitives", "replay", "out"):
        parser.add_argument(f"--{flag}", type=Path, required=True)
    for flag in ("media", "traces"):
        parser.add_argument(f"--{flag}", type=Path, nargs="+", required=True)
    args = parser.parse_args()
    torch.set_num_threads(2)
    report = combine(run=args.run, media=args.media, primitives=args.primitives,
                     replay=args.replay, traces=args.traces, out=args.out)
    print(json.dumps({key: report[key] for key in ("status", "artifact_sha256", "native_inferences",
                                                 "bitwise_output_comparisons", "new_native_verified_networks")}))
    return 0 if report["status"] == "native-parity-passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
