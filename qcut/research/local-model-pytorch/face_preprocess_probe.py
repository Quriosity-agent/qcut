"""Capture actual 160 crop stages without replacing analysis, tensors or points."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys

import numpy as np

from face_alignment_replay import LockedFiles, strict_json
from face_geometry_native import LIBRARY_SHA256
from face_alignment_warp_native import BYTENN_SHA256
from face_host_geometry_contract import associate_inferences
import face_host_geometry_probe as geometry
import face_host_geometry_sequence_probe as observed
import face_owned_replay_e2e as replay
import face_render_consumer_probe as consumer
import face_render_model_capture as models
import face_render_sequence_probe as sequence
from face_render_stability_probe import digest, frame_metrics
from face_temporal_capture_audit import source_hashes

PRIVATE = sequence.PRIVATE
OLD_REPORTS = {"sequence_replay": "face-host-geometry-sequence-replay-20261003-r9",
               "sequence_render": "face-host-geometry-sequence-render-20261003-r7"}
SOURCE_NAMES = ("face_preprocess_probe.py", "face_preprocess_lldb.py", "face_preprocess_memory.py")
DEADLINE = 300
SYSTEM_ENV_KEYS = {"HOME", "PATH", "TMPDIR", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE"}
HOST_ENV_KEYS = {"QCUT_FRAME_WIDTH", "QCUT_FRAME_HEIGHT", "QCUT_TRACE_UPDATES", "QCUT_FACE_POINT_SHIFT",
                 "QCUT_CONSUMER_RECORD", "DYLD_LIBRARY_PATH"}


def system_environment():
    return {key: value for key, value in os.environ.items() if key in SYSTEM_ENV_KEYS}


def lock_profile(*, capture, audit, locked):
    guard = locked.json(path=audit / "report.json")
    if guard.get("passed") is not True or guard.get("source_count") != 50:
        raise ValueError("passed locked 50-source audit required")
    evidence = locked.json(path=capture / "report.json", expected=guard["report_sha256"]["capture"])
    reports = [evidence]
    for key, name in OLD_REPORTS.items():
        reports.append(locked.json(path=PRIVATE / name / "report.json", expected=guard["report_sha256"][key]))
    sources = source_hashes(reports=reports)
    if len(sources) != 50:
        raise ValueError("locked source union changed")
    root = Path(__file__).resolve().parents[1]
    for name, expected in sources.items():
        path = (root / name).resolve(strict=True)
        if not path.is_relative_to(root):
            raise ValueError("source path escaped research")
        locked.read(path=path, maximum=1024**2, expected=expected)
    if (evidence.get("passed") is not True or evidence.get("predictions") != 26 or
            evidence.get("observer_pixel_parity_verified") is not True or
            evidence.get("width") != 1448 or evidence.get("height") != 1086):
        raise ValueError("locked seven-frame native profile required")
    runtime = consumer.protocol_path(path=Path(evidence["runtime"]).resolve(strict=True))
    package = consumer.protocol_path(path=Path(evidence["package"]).resolve(strict=True))
    for name, expected in (("liblens.dylib", LIBRARY_SHA256), ("libbytenn.dylib", BYTENN_SHA256)):
        locked.read(path=runtime / "Frameworks" / name, maximum=128 * 1024**2, expected=expected)
    consumer.verify_library(runtime=runtime)
    original = Path(evidence["capture"]).resolve(strict=True)
    files = {"host": (original / "control/clone-audit/host", evidence["host_sha256"]),
             "byte_observer": (original / "observer.dylib", evidence["observer_sha256"]),
             "geometry_observer": (capture / "geometry-observer.dylib", evidence["geometry_observer_sha256"])}
    for path, expected in files.values():
        locked.read(path=path, maximum=128 * 1024**2, expected=expected)
    manifest = consumer.protocol_path(path=Path(evidence["manifest"]).resolve(strict=True))
    frames = sequence.validate_manifest(value=strict_json(data=locked.read(path=manifest,
                                        maximum=sequence.MANIFEST_LIMIT)), base=manifest.parent)
    if len(frames) != 7 or len(evidence["frames"]) != 7:
        raise ValueError("seven original manifest frames required")
    for index, (frame, previous) in enumerate(zip(frames, evidence["frames"], strict=True)):
        if (frame["timestamp"] != previous["timestamp"] or frame["parameters"] != previous["parameters"] or
                frame["image"] != previous["image"]):
            raise ValueError("manifest request differs from locked capture")
        locked.read(path=Path(frame["image"]), maximum=sequence.IMAGE_LIMIT, expected=previous["image_sha256"])
        raw = consumer.protocol_path(path=capture / f"input-{index:02d}.rgba")
        data = locked.read(path=raw, maximum=1448 * 1086 * 4, expected=previous["input_rgba_sha256"])
        if len(data) != 1448 * 1086 * 4:
            raise ValueError("original RGBA input length mismatch")
        frame["input"] = raw
    for name in SOURCE_NAMES:
        locked.read(path=Path(__file__).with_name(name), maximum=1024**2)
    return evidence, runtime, package, {key: path for key, (path, _) in files.items()}, frames


def requests(*, frames, directory):
    if len(frames) != 7:
        raise ValueError("exact seven-frame request profile required")
    rows = []
    for ordinal in range(13):
        warmup = ordinal < 6
        frame = frames[0 if warmup else ordinal - 6]
        name = f"warmup-{ordinal}" if warmup else f"frame-{ordinal - 6:02d}"
        output = consumer.protocol_path(path=directory / f"{name}.rgba")
        input_path = consumer.protocol_path(path=Path(frame["input"]))
        rows.append("\t".join(("render", name, str(frame["timestamp"]), str(input_path),
                               str(output), consumer.parameters_json(text=json.dumps(frame["parameters"])))))
    return "\n".join([*rows, "exit", ""])


def bounded_process(*, command, environment, log, stdin=None):
    with log.open("xb") as stream:
        process = subprocess.Popen(command, env=environment, stdin=stdin or subprocess.DEVNULL,
                                   stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            code = process.wait(timeout=DEADLINE)
        except BaseException:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait(timeout=10)
            raise
    if log.stat().st_size > sequence.LOG_LIMIT:
        raise ValueError("process log exceeds bound")
    if code != 0:
        raise RuntimeError(f"bounded subprocess failed: {code}")


def validate_protocol(*, directory, frames, locked):
    data = locked.read(path=directory / "host.stdout", maximum=sequence.LOG_LIMIT)
    rows = [row for row in data.decode("utf-8").splitlines() if row.startswith("QCUT\t")]
    expected = ["QCUT\tREADY\t1", *(f"QCUT\tRESULT\twarmup-{index}\t0" for index in range(6)),
                *(f"QCUT\tRESULT\tframe-{index:02d}\t0" for index in range(7))]
    if rows != expected:
        raise ValueError("actual host protocol/order failed")
    trace = locked.read(path=directory / "records.jsonl", maximum=sequence.LOG_LIMIT)
    counts = observed.exact_events(data=trace, count=24)
    conversions = [strict_json(data=line) for line in trace.splitlines()
                   if strict_json(data=line).get("event") == "owned_face_conversion"]
    timestamps = [0] * 10 + [int(frame["timestamp"] * 1_000_000 + 0.5) for frame in frames for _ in range(2)]
    if [row["timestamp_us"] for row in conversions] != timestamps:
        raise ValueError("actual owned seek timestamps changed")
    return dict(protocol_rows=rows, records_sha256=digest(data=trace), **counts)


def validate_trace(*, trace, records, associations):
    if (trace.get("passed") is not True or trace.get("software_breakpoints_used") is not False or
            trace.get("target_memory_written") is not False or trace.get("target_functions_evaluated") is not False or
            trace.get("failures") != [] or trace.get("observer_failures") != [] or
            "pending" not in trace or trace["pending"] is not None or
            type(trace.get("maximum_active_breakpoints")) is not int or
            not 1 <= trace["maximum_active_breakpoints"] <= 4):
        raise ValueError("read-only resolved hardware trace required")
    predictions, events = trace.get("predictions"), trace.get("events")
    if not isinstance(predictions, list) or len(predictions) != 26 or not isinstance(events, list) or len(events) != 2:
        raise ValueError("complete locked trace profile required")
    for index, (entry, record) in enumerate(zip(predictions, records, strict=True)):
        if entry.get("index") != index or entry.get("owner") != record["handle"] or entry.get("request") != record["request"]:
            raise ValueError("hardware/native prediction ownership mismatch")
    selected = []
    for event, expected in zip(events, (0, 20), strict=True):
        if type(event.get("prediction")) is not int or event["prediction"] != expected:
            raise ValueError("unexpected actual 160 prediction")
        record, association = records[expected], associations[expected]
        predictor = record["predictors"][1]
        face = [row for row in record["faces"] if row["active"]]
        inference = [row for row in association["inferences"] if row["size"] == 160]
        if (len(face) != 1 or len(inference) != 1 or event.get("owner") != record["handle"] or
                event.get("call", {}).get("alignment") != face[0]["alignment"] or
                any(event.get(key) != predictor[key] for key in ("predictor", "provider", "network")) or
                str(event["network"]) != inference[0]["network"]):
            raise ValueError("actual crop/face/predictor/neural-window association failed")
        selected.append(dict(prediction=expected, face_id=face[0]["id"], neural_window=association["neural_window"],
                             inference=inference[0]["inference"], record_index=inference[0]["record_index"], event=event))
    return selected


def compare_inputs(*, cases, inventory, trace_dir, locked):
    results = []
    for case in cases:
        event = case["event"]
        for key in ("source", "crop", "resized", "prepared"):
            row = event[key]
            if row["file"] != f"prediction-{case['prediction']:02d}-{key}.bgr":
                raise ValueError("trace blob filename mismatch")
            pixels = locked.read(path=trace_dir / row["file"], maximum=16 * 1024**2, expected=row["sha256"])
            if len(pixels) != row["rows"] * row["cols"] * 3:
                raise ValueError("trace packed blob dimensions mismatch")
        prepared = np.frombuffer(pixels, dtype=np.uint8).astype(np.int16) - 128
        network = inventory["networks"][str(event["network"])]
        rows = [row for row in network["inputs"] if row["inference"] == case["inference"] and row["name"] == "data"]
        if len(rows) != 1 or rows[0]["raw"] != [1, 6] or rows[0]["dims_nwhc"] != [1, 160, 160, 3]:
            raise ValueError("one actual signed int8 160 tensor required")
        actual = np.frombuffer(locked.read(path=Path(rows[0]["path"]), maximum=76800,
                              expected=rows[0]["sha256"]), dtype=np.int8).astype(np.int16)
        if prepared.size != 76800 or actual.size != prepared.size:
            raise ValueError("actual/prepared 160 tensor byte count mismatch")
        diff = np.abs(actual - prepared)
        results.append(dict(prediction=case["prediction"], face_id=case["face_id"], inference=case["inference"],
                            neural_window=case["neural_window"], record_index=case["record_index"],
                            different_values=int(np.count_nonzero(diff)), maximum_difference=int(diff.max()),
                            prepared_sha256=event["prepared"]["sha256"], actual_tensor_sha256=rows[0]["sha256"]))
    if any(row["different_values"] for row in results):
        raise ValueError("prepared uint8 offset differs from actual tensor; normalization unresolved")
    return results


def run(*, args):
    out, locked = sequence.fresh_output(path=args.out), LockedFiles()
    report = dict(passed=False, diagnostic_only=True, independent_160_sampling_input_used=False,
                  product_parity_verified=False, native_analysis_bypassed=False, failures=[], comparisons=[])
    try:
        capture, audit = args.capture.resolve(strict=True), args.audit.resolve(strict=True)
        previous, runtime, package, files, frames = lock_profile(capture=capture, audit=audit, locked=locked)
        report.update(capture=str(capture), audit=str(audit), runtime=str(runtime), package=str(package),
                      old_sources_verified=50, host_sha256=previous["host_sha256"])
        for name in ("baseline", "observed", "trace", "geometry", "capture"):
            (out / name).mkdir()
        for name in ("baseline", "observed"):
            directory = out / name
            request_path = directory / "requests.tsv"
            request_path.write_text(requests(frames=frames, directory=directory))
            environment = replay.environment(runtime=runtime, directory=directory, width=1448, height=1086)
            environment = {key: value for key, value in environment.items()
                           if key in SYSTEM_ENV_KEYS or key in HOST_ENV_KEYS}
            argv = [str(files["host"]), str(runtime), str(runtime / "Models"), str(package)]
            locked.verify()
            if name == "baseline":
                with request_path.open("rb") as stdin:
                    bounded_process(command=argv, environment=environment, stdin=stdin,
                                    log=directory / "host.stdout")
            if name == "observed":
                environment.update(DYLD_INSERT_LIBRARIES=f"{files['byte_observer']}:{files['geometry_observer']}",
                                   QCUT_BYTENN_CAPTURE_IO="1", QCUT_BYTENN_CAPTURE_TERMINALS="1",
                                   QCUT_BYTENN_CAPTURE_DIR=str(out / "capture"), QCUT_FACE_GEOMETRY_DIR=str(out / "geometry"))
                config = dict(host=str(files["host"]), lens=str(runtime / "Frameworks/liblens.dylib"),
                              arguments=argv[1:], environment=environment, stdin=str(request_path),
                              stdout=str(directory / "host.stdout"), stderr=str(directory / "host.stderr"),
                              trace=str(out / "trace"))
                config_path = out / "lldb-config.json"
                config_path.write_text(json.dumps(config, indent=2, allow_nan=False) + "\n")
                callback = Path(__file__).with_name("face_preprocess_lldb.py")
                bounded_process(command=["xcrun", "lldb", "--batch", "--no-lldbinit", "-o",
                                "command script import " + json.dumps(str(callback)), "-o",
                                "script face_preprocess_lldb.run(debugger=lldb.debugger, config_path=" +
                                json.dumps(str(config_path)) + ")", "-o", "quit"],
                                environment=system_environment(), log=out / "lldb.log")
            report[name] = validate_protocol(directory=directory, frames=frames, locked=locked)
        for index in range(7):
            pixels = [locked.read(path=out / name / f"frame-{index:02d}.rgba", maximum=1448 * 1086 * 4)
                      for name in ("baseline", "observed")]
            result = frame_metrics(reference=pixels[0], actual=pixels[1], width=1448, height=1086)
            report["comparisons"].append(dict(index=index, **result))
        if not all(row["equal"] for row in report["comparisons"]):
            raise ValueError("hardware observation changed final RGBA")
        report["observer_pixel_parity_verified"] = True
        records = observed.snapshots(directory=out / "geometry", locked=locked)
        report["algorithm_frames"] = geometry.algorithm_frames(records=records, directory=out / "geometry", locked=locked)
        if len(report["algorithm_frames"]) != 26:
            raise ValueError("actual algorithm RGBA required for every prediction")
        inventory = models.inventory(capture=out / "capture")
        observed.lock_inventory(inventory=inventory, directory=out / "capture", locked=locked)
        associations = associate_inferences(records=records, networks=inventory["networks"],
                       metadata=[models.metadata(path=path) for path in (out / "capture").glob("*.json")], temporal=True)
        trace = locked.json(path=out / "trace/trace.json")
        cases = validate_trace(trace=trace, records=records, associations=associations)
        report.update(cases=cases, tensor_checks=compare_inputs(cases=cases, inventory=inventory,
                      trace_dir=out / "trace", locked=locked), trace=trace, captures=inventory,
                      geometry_snapshots=records, prediction_inferences=associations)
        report["passed"] = True
    except Exception as error:
        report["failures"].append(f"{type(error).__name__}: {error}")
        raise
    finally:
        active_error = sys.exc_info()[1]
        try:
            locked.verify()
        except Exception as error:
            report["passed"] = False
            report["failures"].append(f"guard {type(error).__name__}: {error}")
            if active_error is None:
                raise
        finally:
            report["fixture_sha256"] = dict(locked.files)
            (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("capture", "audit", "out"):
        parser.add_argument(f"--{name}", required=True, type=Path)
    report = run(args=parser.parse_args())
    print(json.dumps(dict(passed=report["passed"], tensor_checks=report["tensor_checks"])))


if __name__ == "__main__":
    main()
