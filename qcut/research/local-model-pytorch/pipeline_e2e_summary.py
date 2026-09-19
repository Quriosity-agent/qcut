#!/usr/bin/env python3
"""Consolidate media E2E evidence without deleting failed attempts or blocked scope."""
import argparse
from collections import Counter
import json
import pathlib

from espresso_archive import sha256
from pipeline_e2e_run import PRIVATE


def summarize(*, suites, output):
    output = output.resolve()
    if not output.is_relative_to(PRIVATE.resolve()) or output.suffix != ".json" or output.exists():
        raise ValueError("summary must be a new private JSON file")
    attempts, failures, blocked = [], [], []
    selected = {}
    for suite in suites:
        data = json.loads(suite.read_text())
        for case in data["cases"]:
            attempt = {"suite": str(suite.resolve()), "backend": data["backend"], **case}
            attempts.append(attempt)
            if not case["passed"]:
                continue
            report_path = pathlib.Path(case["case_report"])
            report = json.loads(report_path.read_text())
            required = (report["passed"], report["media"]["passed"], report["seek"]["passed"], report["reset_replay"]["passed"])
            if not all(value is True for value in required):
                raise ValueError("suite contradicts child media report")
            if data["backend"] == "onnx" and report.get("cross_backend", {}).get("passed") is not True:
                raise ValueError("ONNX media case lacks passing independent PyTorch comparison")
            key = (data["backend"], case["case"])
            selected[key] = {"backend": data["backend"], "case": case["case"], "report": str(report_path),
                             "report_sha256": sha256(path=report_path), "frames": report["decoded_frames"],
                             "profile": report["profile"], "model_sha256": report["validation"]["artifact_sha256"],
                             "video_sha256": report["video_sha256"],
                             "contact_sheet": report["media"]["contact_sheet"],
                             "contact_sheet_sha256": sha256(path=pathlib.Path(report["media"]["contact_sheet"])),
                             "video": report["media"]["video"],
                             "output_video_sha256": sha256(path=pathlib.Path(report["media"]["video"])),
                             "cross_backend": report.get("cross_backend"),
                             "output_schema": report["output_schema"]}
        failures.extend({"suite": str(suite), **case} for case in data["failure_cases"])
        blocked.extend(data["blocked"])
    successes = list(selected.values())
    groups = [item for case in successes if case["cross_backend"] is not None
              for comparison in case["cross_backend"]["cases"] for item in comparison["outputs"].values()]
    result = {"format": "qcut-private-pipeline-e2e-summary-v1", "product_editor_e2e": False,
              "native_oracle_rerun": False, "scope": "executed local model media chains only; blocked coverage remains open",
              "successful_media_jobs": len(successes), "successful_by_backend": dict(Counter(item["backend"] for item in successes)),
              "video_capable_bundles": len({item["model_sha256"] for item in successes}),
              "reference_clips": len({item["video_sha256"] for item in successes}),
              "primary_frames": sum(item["frames"] for item in successes),
              "independent_replay_frames": sum(item["frames"] for item in successes),
              "cross_backend_output_groups": len(groups),
              "cross_backend_max_abs": max((item["max_abs"] for item in groups), default=None),
              "cross_backend_all_passed": bool(groups) and all(item["passed"] for item in groups),
              "expected_failure_cases": len(failures), "expected_failures_all_passed": all(item["passed"] for item in failures),
              "historical_failed_attempts": [item for item in attempts if not item["passed"]],
              "blocked": blocked, "cases": successes, "failure_cases": failures,
              "suites": [{"path": str(suite.resolve()), "sha256": sha256(path=suite)} for suite in suites]}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", type=pathlib.Path, action="append", required=True)
    parser.add_argument("--out", type=pathlib.Path, required=True)
    args = parser.parse_args()
    report = summarize(suites=args.suite, output=args.out)
    print(json.dumps({key: value for key, value in report.items() if key not in {"cases", "failure_cases", "blocked", "historical_failed_attempts", "suites"}}, indent=2))


if __name__ == "__main__":
    main()
