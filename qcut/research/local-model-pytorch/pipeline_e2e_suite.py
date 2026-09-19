#!/usr/bin/env python3
"""Run video pipeline CLI cases and authored media failure/cancellation fixtures."""
import argparse
import json
import pathlib
import signal
import subprocess
import sys
import time

from pipeline_e2e_media import command
from pipeline_e2e_run import PRIVATE, ROOT, private_output

BUNDLES = {
    "skin": "batch-20260919/f84a8cd7355ec07c/model.pt",
    "video-object": "batch-20260919/346b64693e02775f/model.pt",
    "tflite": "tflite/model.pt",
    "skeleton": "batch-20260919/734f9e41b6fd4b3f/model.pt",
    "shot": "batch-20260919/shots/shot-split.pt",
    "legacy-shot": "legacy-shots/legacy-shot-split.pt",
    "denoise": "denoise-original/candidate.pt",
    "c73": "classifier-c73-20260919-verified/c73.pt",
    "dance": "classifier-dance-20260919-verified/dance.pt",
    "ocr-det": "ocr-det-20260919-verified/ocr-detector.pt",
    "tracking-backbone": "tracking-final-20260919/tracking.pt",
    "clip2m": "vision-batch-phase4-clip2m-final/clip2m.pt",
    "clip30m": "vision-batch-phase4-clip30m-final/clip30m.pt",
    "normal": "vision-batch-phase4-normal-final/normal.pt",
}
ONNX_DIRECTORIES = {"skin": "skin-r2", "skeleton": "skeleton-r2", "video-object": "videoobject-r2",
                    "tflite": "tflite-r2", "legacy-shot": "legacy", "ocr-det": "ocr",
                    "tracking-backbone": "tracking-backbone", "clip2m": "vision-clip2m",
                    "clip30m": "vision-clip30m", "normal": "vision-normal"}
SCRIPT = pathlib.Path(__file__).with_name("pipeline_e2e_run.py")
ASSETS = ROOT / ".local/jianying-effect-references/_assets"


def write_suite(*, output, report):
    (output / "suite.json").write_text(json.dumps(report, indent=2) + "\n")


def arguments(*, model, ledger, video, output, profile, frames):
    return [sys.executable, str(SCRIPT), "--model", str(model), "--ledger", str(ledger), "--video", str(video),
            "--out", str(output), "--profile", profile, "--frames", str(frames), "--threads", "2"]


def invoke(*, argv, log, case_output, expect_status="passed"):
    try:
        with log.open("w") as stream:
            process = subprocess.run(argv, stdout=stream, stderr=subprocess.STDOUT, timeout=900)
        case = json.loads((case_output / "report.json").read_text())
        passed = case.get("status") == expect_status and (process.returncode == 0) == (expect_status == "passed")
        return {"passed": passed, "returncode": process.returncode, "status": case.get("status"),
                "expected_status": expect_status, "case_report": str((case_output / "report.json").resolve()),
                "error": case.get("error"), "log": str(log.resolve())}
    except Exception as error:
        return {"passed": False, "error": f"{type(error).__name__}: {error}", "log": str(log.resolve())}


def failures(*, output, ledger):
    fixtures = output / "fixtures"
    fixtures.mkdir()
    video = ASSETS / "ref-clip-face-1280x720.mp4"
    corrupt, empty, audio = fixtures / "corrupt.mp4", fixtures / "empty.mp4", fixtures / "audio-only.wav"
    corrupt.write_bytes(b"authored invalid media fixture\x00\xff")
    empty.write_bytes(b"")
    command(argv=["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.25",
                  str(audio)], log=fixtures / "audio-create.json")
    cases = [("corrupt", corrupt, "skin", 2, []), ("empty", empty, "skin", 2, []),
             ("audio-only", audio, "skin", 2, []), ("zero-request", video, "skin", 0, []),
             ("invalid-profile", video, "not-a-model", 2, []),
             ("zero-decoded-frames", video, "skin", 2, ["--start", "9999"]),
             ("wrong-model-profile", video, "c73", 2, [])]
    results = []
    for name, source, profile, count, extra in cases:
        case_output = output / name
        argv = arguments(model=PRIVATE / BUNDLES["skin"], ledger=ledger, video=source,
                         output=case_output, profile=profile, frames=count) + extra
        result = invoke(argv=argv, log=output / f"{name}.log", case_output=case_output, expect_status="failed")
        results.append({"case": name, **result})
    results.append(cancellation(output=output, ledger=ledger, video=video))
    return results


def cancellation(*, output, ledger, video):
    case_output = output / "cancelled"
    argv = arguments(model=PRIVATE / BUNDLES["skin"], ledger=ledger, video=video,
                     output=case_output, profile="skin", frames=120) + ["--fps", "30"]
    signal_sent = False
    with (output / "cancelled.log").open("w") as stream:
        process = subprocess.Popen(argv, stdout=stream, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 90
            while process.poll() is None and time.monotonic() < deadline:
                report_path = case_output / "report.json"
                if report_path.is_file():
                    report = json.loads(report_path.read_text())
                    if report.get("completed_frames", 0) >= 1:
                        process.send_signal(signal.SIGTERM)
                        signal_sent = True
                        break
                time.sleep(0.02)
            returncode = process.wait(timeout=20)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
    report_path = case_output / "report.json"
    report = json.loads(report_path.read_text()) if report_path.is_file() else {}
    passed = signal_sent and returncode == 130 and report.get("status") == "cancelled" and report.get("passed") is False
    return {"case": "SIGTERM-after-real-inference", "passed": passed, "signal_sent": signal_sent,
            "returncode": returncode, "case_report": str(report_path.resolve()),
            "completed_frames": report.get("completed_frames"), "status": report.get("status")}


def run_suite(*, output, ledger, profiles, backend="pytorch", onnx_root=None, baseline=None, test_failures=False):
    output = private_output(path=output)
    report = {"format": "qcut-private-video-pipeline-suite-v1", "backend": backend, "cases": [],
              "failure_cases": [], "passed": False, "product_editor_e2e": False,
              "blocked": [{"bundle": "facefitting", "reason": "212-dimensional landmark feature input; no verified video-to-landmark adapter"}],
              "tracking_scope": "backbone only; feature heads and correlation/ROI/box decoding not a video tracker"}
    write_suite(output=output, report=report)
    for profile in profiles:
        for clip in ("face", "body"):
            name = f"{profile}-{clip}"
            case_output = output / name
            count = 4 if profile == "denoise" else 8 if profile == "tracking-backbone" else 24
            argv = arguments(model=PRIVATE / BUNDLES[profile], ledger=ledger,
                             video=ASSETS / f"ref-clip-{clip}-1280x720.mp4", output=case_output,
                             profile=profile, frames=count)
            if backend == "onnx":
                contract = onnx_root / ONNX_DIRECTORIES.get(profile, profile) / "contract.json"
                if not contract.is_file() or json.loads(contract.read_text()).get("status") != "onnx-runtime-parity-passed":
                    report["blocked"].append({"case": name, "reason": "no approved ONNX contract", "contract": str(contract)})
                    write_suite(output=output, report=report)
                    continue
                argv += ["--backend", "onnx", "--contract", str(contract), "--compare-run", str(baseline / name)]
            result = {"case": name, "frames": count, **invoke(argv=argv, log=output / f"{name}.log", case_output=case_output)}
            report["cases"].append(result)
            write_suite(output=output, report=report)
            print(f"{backend} {name}: {result['passed']} {result.get('error') or ''}", flush=True)
    if test_failures:
        report["failure_cases"] = failures(output=output, ledger=ledger)
    report["passed"] = bool(report["cases"]) and all(item["passed"] for item in report["cases"] + report["failure_cases"])
    report["completed_cases"] = len(report["cases"])
    report["completed_profiles"] = sorted({item["case"].rsplit("-", 1)[0] for item in report["cases"] if item["passed"]})
    write_suite(output=output, report=report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=pathlib.Path, required=True)
    parser.add_argument("--ledger", type=pathlib.Path, default=PRIVATE / "phase3-20260919/ledger.json")
    parser.add_argument("--profile", action="append", choices=sorted(BUNDLES))
    parser.add_argument("--backend", choices=("pytorch", "onnx"), default="pytorch")
    parser.add_argument("--onnx-root", type=pathlib.Path)
    parser.add_argument("--baseline", type=pathlib.Path)
    parser.add_argument("--failure-cases", action="store_true")
    args = parser.parse_args()
    if args.backend == "onnx" and (args.onnx_root is None or args.baseline is None):
        parser.error("ONNX requires contract root and independent PyTorch baseline")
    report = run_suite(output=args.out, ledger=args.ledger, profiles=args.profile or list(BUNDLES), backend=args.backend,
                       onnx_root=args.onnx_root, baseline=args.baseline, test_failures=args.failure_cases)
    print(json.dumps({"passed": report["passed"], "cases": len(report["cases"]), "failures": len(report["failure_cases"])}))
    return int(not report["passed"])


if __name__ == "__main__":
    raise SystemExit(main())
