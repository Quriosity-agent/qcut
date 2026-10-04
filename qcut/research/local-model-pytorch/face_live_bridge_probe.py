"""Prepare by default; explicit lease required for native single-face live audit.

Each invocation creates fresh inputs, native baseline, LLDB target and persistent
worker. Backward seeks/source replacement require a new invocation. No replay
files or historical tensors are producer inputs. Desktop permission is granted
manually in macOS; this launcher never changes TCC or relocates executables.
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack
import hashlib
import json
from pathlib import Path
import secrets
import shlex
import stat
import sys
import tempfile

from face_alignment_replay import strict_json
from face_live_candidate_onnx import OnnxHeads
from face_live_bridge_process import ProcessScope, cancellation_signals
from face_temporal_campaign import file_fingerprint
import face_live_bridge_bundle as bundle
import face_live_bridge_audit as audit
import face_live_host_identity as host_identity
import face_render_sequence_probe as sequence


def worker_ready(*, path, socket):
    if not path.exists() or not socket.exists():
        return False
    data = sequence.bounded_bytes(path=path, limit=4096)
    if not data.endswith(b"\n"):
        return False
    lines = data.splitlines()
    if len(lines) != 1:
        raise ValueError("unexpected worker readiness output")
    value = strict_json(data=lines[0])
    if (type(value) is not dict or value.get("ready") is not True or value.get("socket") != str(socket)
            or not isinstance(value.get("backend_version"), str)):
        raise ValueError("worker readiness association failed")
    metadata = socket.stat()
    if not stat.S_ISSOCK(metadata.st_mode) or metadata.st_mode & 0o777 != 0o600:
        raise ValueError("worker socket must be private")
    return True


def lldb_command(*, config):
    return ["xcrun", "lldb", "--batch", "--no-lldbinit", "-o",
        "script import sys; sys.dont_write_bytecode = True; sys.pycache_prefix = " +
        json.dumps(str(config.parent / "lldb-python-cache")) +
        "; sys.path.insert(0, " + json.dumps(str(bundle.HERE)) + ")", "-o",
        "command script import " + json.dumps(str(bundle.HERE / "face_live_bridge_lldb.py")), "-o",
        "script face_live_bridge_lldb.run(debugger=lldb.debugger, config_path=" + json.dumps(str(config)) + ")",
        "-o", "quit"]


def python_command(*, script, cache, arguments):
    # -B prevents writes, not reads; a fresh prefix excludes stale source-tree bytecode.
    return [sys.executable, "-B", "-X", "pycache_prefix=" + str(cache), str(script), *arguments]


def plans(*, frames, out, cold_frame=False):
    result = {}
    for phase in ("baseline", "live"):
        directory = out / phase
        directory.mkdir(mode=0o700)
        rows, text = bundle.requests(frames=frames, directory=directory, cold_frame=cold_frame)
        (directory / "requests.tsv").write_text(text)
        result[phase] = rows
    return result


def execute(*, args, out, frames, dimensions, requests, models, guard, scope, report):
    width, height = dimensions
    report["phase"] = "baseline-native"
    guard.verify()
    models.verify()
    report["native_execution_performed"] = True
    baseline = out / "baseline"
    original = scope.spawn(command=[str(out / "baseline-host"), str(args.runtime),
        str(args.runtime / "Models"), str(args.package)],
        environment=bundle.host_environment(runtime=args.runtime, directory=baseline, width=width, height=height),
        stdin=baseline / "requests.tsv", stdout=baseline / "host.stdout", stderr=baseline / "host.stderr")
    report["baseline_process"] = scope.wait(process=original, timeout=args.timeout)
    scope.finish(process=original)
    report["baseline_protocol"] = audit.protocol(
        data=sequence.bounded_bytes(path=baseline / "host.stdout", limit=4 * 1024**2), requests=requests["baseline"])
    for row in requests["baseline"]:
        guard.locked.read(path=Path(row["output"]), maximum=width * height * 4)
    guard.verify()
    models.verify()
    report["phase"] = "worker-startup"
    with tempfile.TemporaryDirectory(prefix="qcut-live-", dir="/tmp") as temporary:
        socket = Path(temporary) / "worker.sock"
        token = secrets.token_hex(32)
        source_key = "live-session:" + secrets.token_hex(16) + ":" + report["manifest_sha256"]
        live = out / "live"
        worker_command = python_command(script=bundle.HERE / "face_live_worker.py",
            cache=Path(temporary) / "python-cache", arguments=[
            "--root", str(args.root), "--socket", str(socket), "--log", str(live / "worker.jsonl"),
            "--token", token, "--source-key", source_key, "--timeout", "120"])
        worker = scope.spawn(command=worker_command, environment=bundle.system_environment(),
                             stdout=live / "worker.stdout", stderr=live / "worker.stderr")
        scope.until(predicate=lambda: worker_ready(path=live / "worker.stdout", socket=socket),
                    process=worker, timeout=30)
        config = dict(host=report.get("host_identity", {}).get("path", str(out / "live-host")),
            lens=str(args.runtime / "Frameworks/liblens.dylib"),
            core=str(args.runtime / "Frameworks/libcccreator.dylib"),
            trace_face_readers=getattr(args, "trace_face_readers", False),
            arguments=[str(args.runtime), str(args.runtime / "Models"), str(args.package)],
            environment=bundle.host_environment(runtime=args.runtime, directory=live, width=width, height=height,
                live=True, socket=socket, token=token, capture=out / "live-capture.dylib",
                cold_frame=report["cold_frame_audit"]),
            socket=str(socket), token=token, stdin=str(live / "requests.tsv"), stdout=str(live / "host.stdout"),
            stderr=str(live / "host.stderr"), report=str(live / "observer.json"))
        config_path = out / "lldb-config.json"
        if getattr(args, "trace_makeup_system", False):
            config["environment"]["QCUT_FACE_LIVE_MAKEUP_TRACE"] = "1"
        bundle.write_json(path=config_path, value=config)
        report.update(source_key=source_key, token_sha256=hashlib.sha256(token.encode()).hexdigest())
        report["phase"] = "live-native-lldb"
        debugger = scope.spawn(command=lldb_command(config=config_path), environment=bundle.system_environment(),
                               stdout=live / "lldb.log")
        report["live_process"] = scope.wait(process=debugger, timeout=args.timeout, companions=(worker,))
        scope.finish(process=debugger)
        report["phase"] = "live-audit"
        report["live_protocol"] = audit.protocol(
            data=sequence.bounded_bytes(path=live / "host.stdout", limit=4 * 1024**2), requests=requests["live"])
        for directory in (baseline, live):
            stderr = sequence.bounded_bytes(path=directory / "host.stderr", limit=4 * 1024**2)
            audit.require(condition=b"[research-error]" not in stderr, message="native host logged a research failure")
        timestamps = [row["timestamp_us"] for row in requests["live"] for _ in range(2)]
        observer = strict_json(data=sequence.bounded_bytes(path=live / "observer.json", limit=4 * 1024**2))
        report["callback_audit"] = audit.callbacks(worker=audit.json_lines(path=live / "worker.jsonl"),
            observer=observer, records=audit.json_lines(path=live / "records.jsonl"), timestamps=timestamps,
            token=token, source_key=source_key, cold_frame=report["cold_frame_audit"])
        report["frames"] = audit.render_outputs(baseline=requests["baseline"], live=requests["live"],
                                                frames=frames, width=width, height=height)
        report["live_checks_completed"] = True
        scope.finish(process=worker)


def timeout_context(*, out, phase):
    directory = out / ("live" if phase == "live-native-lldb" else "baseline")
    stdout = directory / "host.stdout"
    progressed = stdout.exists() and b"QCUT\tREADY\t1" in sequence.bounded_bytes(path=stdout, limit=4 * 1024**2)
    return dict(host_ready_observed=progressed,
        classification="native-progress-timeout" if progressed else "native-launch-not-confirmed",
        desktop_authorization="manual macOS Desktop Folder allowance is a known prerequisite; inspect OS prompt",
        permission_bypass_attempted=False, algorithm_failure_inferred=False,
        logs=[str(path) for path in directory.glob("*") if path.suffix in (".log", ".stdout", ".stderr")])


def run(*, args):
    single_frame = getattr(args, "single_frame", False)
    static_controls = getattr(args, "static_controls", False)
    cold_frame = getattr(args, "cold_frame", False)
    if cold_frame and not single_frame:
        raise ValueError("cold-frame requires explicit single-frame audit")
    if getattr(args, "trace_makeup_system", False) and not cold_frame:
        raise ValueError("makeup system observation requires cold-frame audit")
    if single_frame and static_controls:
        raise ValueError("single-frame and static-controls scopes are mutually exclusive")
    if not 1 <= args.timeout <= 240:
        raise ValueError("native phase timeout must be between 1 and 240 seconds")
    if args.execute_native and (not args.lease or len(args.lease) > 160):
        raise ValueError("explicit parent GPU lease identifier required before native execution")
    out = sequence.fresh_output(path=args.out)
    report = dict(schema="face-live-bridge-probe-v1", passed=False, prepared=False, completed=False,
        phase="prepare", scope=("static-controls-native-dependent-live-audit" if static_controls else
            "single-frame-native-dependent-live-audit" if single_frame else
            "bounded-single-face-native-dependent-live-research"), failures=[],
        single_frame_audit=single_frame, static_controls_audit=static_controls, temporal_sequence_acceptance=False,
        cold_frame_audit=cold_frame, warmup_request_count=0 if cold_frame else bundle.WARMUPS,
        native_execution_performed=False, live_checks_completed=False, native_analysis_bypassed=False,
        product_backend_registered=False, arbitrary_frame_backend_connected=False,
        product_parity_verified=False, native_head_value_parity_verified=False,
        native_point_value_parity_verified=False, captured_tensor_input_used=False,
        native_final_point_input_used=False, native_launch_lease=args.lease if args.execute_native else None,
        native_dependencies=["full-frame-to-algorithm-RGBA", "detection-and-acceptance",
            "entry-crop-arguments-and-predictor-entry-inverse", "tracking-geometry-tables-reset",
            "metadata-masks-and-native-renderer"], render_tolerance=0, frames=[])
    guard, scope, models = bundle.DependencyGuard(), ProcessScope(directory=out), None
    leases = ExitStack()
    try:
        with cancellation_signals(), scope:
            for key in ("runtime", "package", "root", "manifest"):
                setattr(args, key, getattr(args, key).resolve(strict=True))
            bundle.lock_dependencies(runtime=args.runtime, package=args.package, models=args.root, guard=guard)
            additional_packages = [path.resolve(strict=True) for path in getattr(args, "additional_packages", [])]
            for package in additional_packages:
                guard.tree(directory=package)
            report["additional_packages"] = list(map(str, additional_packages))
            frames, dimensions = bundle.prepare_inputs(manifest=args.manifest, out=out, guard=guard,
                                                       single_frame=single_frame, static_controls=static_controls)
            report.update(manifest=str(args.manifest), manifest_sha256=guard.locked.files[str(args.manifest)],
                          runtime=str(args.runtime), package=str(args.package), root=str(args.root),
                          width=dimensions[0], height=dimensions[1], input_frames=frames)
            requests = plans(frames=frames, out=out, cold_frame=cold_frame)
            report["requests"] = requests
            for phase in ("baseline", "live"):
                guard.locked.read(path=out / phase / "requests.tsv")
            models = OnnxHeads(root=args.root)
            report["models"] = models.provenance
            report["phase"] = "compile"
            report["compile_commands"] = bundle.compile_commands(runtime=args.runtime, out=out)
            stable_host = getattr(args, "stable_host", False)
            if stable_host:
                report["phase"] = "stable-host-identity"
                directory = leases.enter_context(host_identity.helper_lease(audit=out, cleanup=scope.cleanup))
                report["host_identity"] = host_identity.prepare_host(directory=directory,
                    runtime=args.runtime, scope=scope, out=out, guard=guard)
                report["compile_commands"].pop("live")
                report["phase"] = "compile"
            for name, command in report["compile_commands"].items():
                process = scope.spawn(command=command, environment=bundle.system_environment(),
                                      stdout=out / f"compile-{name}.log")
                scope.wait(process=process, timeout=180)
                scope.finish(process=process)
            for name in ("baseline-host", "live-host", "live-capture.dylib"):
                if stable_host and name == "live-host":
                    continue
                guard.locked.read(path=out / name, maximum=128 * 1024**2)
            guard.verify()
            models.verify()
            report["prepared"], report["phase"] = True, "cpu-prepared-native-not-run"
            if args.execute_native:
                execute(args=args, out=out, frames=frames, dimensions=dimensions, requests=requests,
                        models=models, guard=guard, scope=scope, report=report)
    except BaseException as error:
        report["failures"].append(dict(phase=report["phase"], error=f"{type(error).__name__}: {error}"[:2000]))
        if report["phase"] in ("baseline-native", "live-native-lldb") and report["native_execution_performed"]:
            try:
                report["timeout_diagnostic"] = timeout_context(out=out, phase=report["phase"])
            except Exception as diagnostic:
                report["timeout_diagnostic"] = dict(error=str(diagnostic), algorithm_failure_inferred=False)
    finally:
        report["cleanup"] = scope.cleanup
        if scope.cleanup["failures"]:
            report["failures"].append(dict(phase="cleanup", error=str(scope.cleanup["failures"])))
        try:
            guard.verify()
            if models is not None:
                models.verify()
            report["dependencies_unchanged"] = True
        except Exception as error:
            report["dependencies_unchanged"] = False
            report["failures"].append(dict(phase="final-provenance", error=str(error)))
        report["dependencies"] = guard.evidence()
        report["processes"] = [dict(row, command=["<session-token>" if index > 0 and row["command"][index - 1] ==
                                "--token" else item for index, item in enumerate(row["command"])]) for row in scope.history]
        try:
            report["artifacts"] = {str(path.relative_to(out)): file_fingerprint(path=path)
                                   for path in out.rglob("*") if path.is_file() and not path.is_symlink()}
        except Exception as error:
            report["artifacts"] = {}
            report["failures"].append(dict(phase="artifact-provenance", error=str(error)))
        report["completed"] = not report["failures"] and scope.cleanup["completed"]
        report["passed"] = report["completed"] and report["live_checks_completed"]
        report["bounded_native_dependent_rgba_parity"] = report["passed"]
        report["live_callback_handoff_verified"] = report["passed"]
        report["command"] = shlex.join(python_command(script=Path(__file__).resolve(),
            cache=Path(str(out) + "-rerun") / "python-cache", arguments=[
            "--runtime", str(args.runtime), "--package", str(args.package), "--root", str(args.root),
            "--manifest", str(args.manifest), "--out", str(out) + "-rerun", "--timeout", str(args.timeout),
            *(["--single-frame"] if single_frame else []),
            *(["--cold-frame"] if cold_frame else []),
            *(["--static-controls"] if static_controls else []),
            *(item for package in getattr(args, "additional_packages", []) for item in ("--additional-package", str(package))),
            *(["--stable-host"] if getattr(args, "stable_host", False) else []),
            *(["--trace-face-readers"] if getattr(args, "trace_face_readers", False) else []),
            *(["--trace-makeup-system"] if getattr(args, "trace_makeup_system", False) else []),
            *(["--execute-native", "--lease", args.lease] if args.execute_native else [])]))
        try:
            bundle.write_json(path=out / "report.json", value=report)
        finally:
            leases.close()
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("runtime", "package", "root", "manifest", "out"):
        parser.add_argument(f"--{name}", required=True, type=Path)
    parser.add_argument("--execute-native", action="store_true")
    parser.add_argument("--stable-host", action="store_true",
                        help="reuse a stable Apple Development-signed helper identity; does not grant permissions")
    parser.add_argument("--trace-face-readers", action="store_true",
                        help="add one read-only hardware breakpoint; getter hits are not consumption evidence")
    parser.add_argument("--trace-makeup-system", action="store_true",
                        help="cold-frame only: observe pinned makeup object dispatch, not consumption")
    parser.add_argument("--single-frame", action="store_true",
                        help="audit one static input; never claims temporal sequence acceptance")
    parser.add_argument("--cold-frame", action="store_true",
                        help="single-frame only: require owned handoff from first prediction with no repeated warmup")
    parser.add_argument("--static-controls", action="store_true",
                        help="audit different parameters on identical static pixels, not a video sequence")
    parser.add_argument("--additional-package", dest="additional_packages", action="append", type=Path, default=[],
                        help="hash-lock an explicitly selected dynamic makeup package")
    parser.add_argument("--lease")
    parser.add_argument("--timeout", type=float, default=90)
    report = run(args=parser.parse_args())
    print(json.dumps({key: report[key] for key in ("passed", "prepared", "completed", "phase", "failures")}))
    return 0 if report["completed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
