#!/usr/bin/env python3
"""Bounded 60-second looped video-object stress; never unique-footage evidence."""
import argparse
import json
from pathlib import Path
import signal
import subprocess
import sys
import time

from espresso_archive import sha256
from pipeline_e2e_media import command, probe
from pipeline_e2e_run import PRIVATE, private_output
from pipeline_e2e_suite import ASSETS, BUNDLES, arguments


def descendant_rss(*, root_pid, rows):
    children = {root_pid}
    previous = set()
    while previous != children:
        previous = set(children)
        children.update(pid for pid, parent, _ in rows if parent in children)
    return sum(rss for pid, _, rss in rows if pid in children) * 1024


def process_tree_rss(*, pid):
    snapshot = subprocess.run(["ps", "-axo", "pid=,ppid=,rss="], capture_output=True, check=True, timeout=5)
    rows = [tuple(map(int, row.split())) for row in snapshot.stdout.decode().splitlines() if row.strip()]
    return descendant_rss(root_pid=pid, rows=rows)


def save(*, path, report):
    temporary = path.with_suffix(".pending.json")
    temporary.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    temporary.replace(path)


def fixture(*, source, output):
    output.mkdir()
    video = output / "looped-stress-fixture-60s-4fps.mp4"
    argv = ["ffmpeg", "-nostdin", "-v", "error", "-xerror", "-stream_loop", "-1", "-i", str(source),
            "-t", "60", "-vf", "fps=4", "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "20",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(video)]
    command(argv=argv, log=output / "loop-command.json")
    metadata = probe(video=video, log=output / "probe-command.json")
    stream = metadata["streams"][0]
    duration = float(stream.get("duration", metadata["format"]["duration"]))
    if int(stream["nb_read_frames"]) != 240 or abs(duration - 60) > 0.01 or stream["avg_frame_rate"] != "4/1":
        raise ValueError("looped stress fixture must be 240 frames at 4 fps / 60 seconds")
    report = {"label": "looped stress fixture", "unique_footage_seconds_claimed": False,
              "source": str(source.resolve()), "source_sha256": sha256(path=source),
              "artifact": str(video.resolve()), "artifact_sha256": sha256(path=video),
              "loop_command": argv, "probe": metadata, "frames": 240, "fps": 4, "duration_s": 60}
    save(path=output / "fixture.json", report=report)
    return report


def monitored(*, argv, output, memory_limit_bytes, cancel_after=None):
    log, monitor_path = output.parent / f"{output.name}.log", output.parent / f"{output.name}-monitor.json"
    started = time.monotonic()
    report = {"argv": argv, "memory_limit_bytes": memory_limit_bytes, "samples": [], "passed": False,
              "memory_scope": "0.25s sampled process-tree RSS plus child self ru_maxrss; not an OS sandbox guarantee",
              "cancel_after_frames": cancel_after, "signal_reason": None}
    with log.open("w") as stream:
        process = subprocess.Popen(argv, stdout=stream, stderr=subprocess.STDOUT)
        signalled_at = None
        try:
            while process.poll() is None:
                child_report = output / "report.json"
                child = json.loads(child_report.read_text()) if child_report.is_file() else {}
                rss = process_tree_rss(pid=process.pid)
                elapsed = time.monotonic() - started
                report["samples"].append({"elapsed_s": elapsed, "tree_rss_bytes": rss,
                                          "stage": child.get("stage"), "frames": child.get("completed_frames", 0)})
                if signalled_at is None:
                    reason = None
                    if rss > memory_limit_bytes:
                        reason = "memory-limit"
                    elif elapsed > 900:
                        reason = "timeout"
                    elif cancel_after is not None and child.get("completed_frames", 0) >= cancel_after:
                        reason = "requested-cancellation"
                    if reason is not None:
                        report["signal_reason"] = reason
                        process.send_signal(signal.SIGTERM)
                        signalled_at = time.monotonic()
                elif time.monotonic() - signalled_at > 10:
                    process.kill()
                save(path=monitor_path, report=report)
                time.sleep(0.25)
            returncode = process.wait()
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
    child_path = output / "report.json"
    child = json.loads(child_path.read_text()) if child_path.is_file() else {}
    tree_peak = max((item["tree_rss_bytes"] for item in report["samples"]), default=0)
    self_peak = child.get("memory", {}).get("self_peak_rss_bytes")
    bounded = bool(report["samples"]) and self_peak is not None and max(tree_peak, self_peak) <= memory_limit_bytes
    result_ok = returncode == 0 and child.get("passed") is True
    if cancel_after is not None:
        result_ok = (returncode == 130 and child.get("status") == "cancelled"
                     and report["signal_reason"] == "requested-cancellation"
                     and child.get("completed_frames", 0) >= cancel_after)
    report.update(returncode=returncode, passed=result_ok and bounded, observed_memory_bound_passed=bounded,
                  tree_peak_rss_bytes=tree_peak, self_peak_rss_bytes=self_peak,
                  child_report=str(child_path.resolve()), child_status=child.get("status"),
                  child_report_sha256=sha256(path=child_path) if child_path.is_file() else None,
                  elapsed_s=time.monotonic() - started, completed_frames=child.get("completed_frames"))
    save(path=monitor_path, report=report)
    return report


def stress(*, output, source, model, ledger, contract, memory_limit_mib=2048):
    if not 256 <= memory_limit_mib <= 4096:
        raise ValueError("memory monitor limit must be 256..4096 MiB")
    output = private_output(path=output)
    report = {"format": "qcut-private-looped-video-stress-v1", "passed": False, "cases": [],
              "scope": "looped stress fixture, not 60 seconds of unique footage or editor E2E",
              "fixture": fixture(source=source, output=output / "fixture")}
    save(path=output / "stress.json", report=report)
    video = Path(report["fixture"]["artifact"])
    for mode, count, start, policy in (("continuous", 240, 0, "start-only"), ("seek-reset", 8, 30, "midpoint")):
        for backend in ("pytorch", "onnx"):
            name = f"{backend}-{mode}"
            case_output = output / name
            argv = arguments(model=model, ledger=ledger, video=video, output=case_output, profile="video-object", frames=count)
            argv += ["--fps", "4", "--start", str(start), "--reset-policy", policy]
            if backend == "onnx":
                argv += ["--backend", "onnx", "--contract", str(contract), "--compare-run", str(output / f"pytorch-{mode}")]
            result = monitored(argv=argv, output=case_output, memory_limit_bytes=memory_limit_mib * 1024 * 1024)
            report["cases"].append({"case": name, "frames": count, "start_s": start, "reset_policy": policy,
                                    "monitor": str(output / f"{name}-monitor.json"), **result})
            save(path=output / "stress.json", report=report)
            print(f"{name}: {result['passed']}, peak={result['tree_peak_rss_bytes'] / 1024**2:.1f} MiB", flush=True)
    cancelled = output / "onnx-cancelled"
    argv = arguments(model=model, ledger=ledger, video=video, output=cancelled, profile="video-object", frames=240)
    argv += ["--backend", "onnx", "--contract", str(contract), "--reset-policy", "start-only"]
    report["cancellation"] = monitored(argv=argv, output=cancelled, memory_limit_bytes=memory_limit_mib * 1024 * 1024,
                                        cancel_after=32)
    report["passed"] = all(item["passed"] for item in report["cases"]) and report["cancellation"]["passed"]
    report["successful_primary_frames"] = sum(item["frames"] for item in report["cases"] if item["passed"])
    report["independent_replay_frames"] = report["successful_primary_frames"]
    report["source_and_fixture_are_not_distinct_unique_clips"] = True
    save(path=output / "stress.json", report=report)
    return report


def memory_guard_probe(*, output):
    output = private_output(path=output)
    script = "import time; payload = bytearray(96 * 1024 * 1024); time.sleep(15)"
    result = monitored(argv=[sys.executable, "-c", script], output=output / "authored-allocation",
                       memory_limit_bytes=64 * 1024 * 1024)
    report = {"label": "authored memory-watchdog failure fixture, not model evidence",
              "passed": result["signal_reason"] == "memory-limit" and result["returncode"] != 0,
              "requested_allocation_bytes": 96 * 1024 * 1024, "monitor": result}
    save(path=output / "memory-guard-probe.json", report=report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--source", type=Path, default=ASSETS / "ref-clip-body-1280x720.mp4")
    parser.add_argument("--model", type=Path, default=PRIVATE / BUNDLES["video-object"])
    parser.add_argument("--ledger", type=Path, default=PRIVATE / "phase3-20260919/ledger.json")
    parser.add_argument("--contract", type=Path, default=PRIVATE / "onnx-phase4/videoobject-r2/contract.json")
    parser.add_argument("--memory-limit-mib", type=int, default=2048)
    parser.add_argument("--guard-probe-only", action="store_true")
    args = parser.parse_args()
    if args.guard_probe_only:
        result = memory_guard_probe(output=args.out)
        print(json.dumps({"passed": result["passed"], "reason": result["monitor"]["signal_reason"]}))
        return int(not result["passed"])
    result = stress(output=args.out, source=args.source, model=args.model, ledger=args.ledger,
                    contract=args.contract, memory_limit_mib=args.memory_limit_mib)
    print(json.dumps({"passed": result["passed"], "primary_frames": result["successful_primary_frames"]}))
    return int(not result["passed"])


if __name__ == "__main__":
    raise SystemExit(main())
