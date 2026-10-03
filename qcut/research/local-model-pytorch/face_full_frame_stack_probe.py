"""Fresh neutral host call-route trace; never modifies the fixed old capture."""
import argparse
import json
from pathlib import Path

from face_alignment_replay import LockedFiles
from face_diagnostic_report import finish
import face_full_frame_stack_lldb as stacks
import face_host_geometry_probe as geometry
import face_host_geometry_sequence_probe as observed
import face_owned_replay_e2e as owned
import face_preprocess_chain_capture as capture
from face_preprocess_chain_replay import sources
import face_preprocess_probe as probe
import face_render_consumer_probe as consumer
import face_render_sequence_probe as sequence
from face_render_stability_probe import frame_metrics


def run(*, args):
    out, locked = sequence.fresh_output(path=args.out), LockedFiles()
    report = dict(profile="full-frame-prediction-stack-diagnostic-v1", passed=False, completed=False,
                  diagnostic_only=True, native_analysis_bypassed=False, observer_pixel_parity_verified=False,
                  software_breakpoints_used=False, target_memory_written=False, target_functions_evaluated=False,
                  arbitrary_frame_backend_connected=False, product_parity_verified=False, failures=[])
    try:
        context = capture.load(root=args.capture.resolve(strict=True), locked=locked)
        evidence = context["evidence"]
        _, runtime, _, files, frames = probe.lock_profile(capture=context["original"],
            audit=Path(evidence["audit"]), locked=locked, **probe.profile_report_arguments(evidence=evidence))
        for name in ("observed", "trace", "geometry", "capture"):
            (out / name).mkdir()
        directory = out / "observed"
        requests = directory / "requests.tsv"
        requests.write_text(probe.requests(frames=frames, directory=directory))
        env = owned.environment(runtime=runtime, directory=directory, width=1448, height=1086)
        env = {key: value for key, value in env.items() if key in probe.SYSTEM_ENV_KEYS or key in probe.HOST_ENV_KEYS}
        env.update(DYLD_INSERT_LIBRARIES=f"{files['byte_observer']}:{files['geometry_observer']}",
            QCUT_BYTENN_CAPTURE_IO="1", QCUT_BYTENN_CAPTURE_TERMINALS="1",
            QCUT_BYTENN_CAPTURE_DIR=str(out / "capture"), QCUT_FACE_GEOMETRY_DIR=str(out / "geometry"))
        config = dict(host=str(context["host"]), lens=str(runtime / "Frameworks/liblens.dylib"),
            arguments=[str(runtime), str(runtime / "Models"), str(context["package"])],
            environment=env, stdin=str(requests), stdout=str(directory / "host.stdout"),
            stderr=str(directory / "host.stderr"), trace=str(out / "trace"))
        config_path = out / "lldb-config.json"
        config_path.write_text(json.dumps(config, allow_nan=False) + "\n")
        names = (Path(__file__).name, "face_full_frame_stack_lldb.py", "face_preprocess_lldb.py",
                 "face_preprocess_memory.py", "face_diagnostic_report.py")
        report.update(capture_sha256=locked.files[str(context["root"] / "report.json")],
                      source_sha256=sources(names=names, locked=locked))
        locked.verify()
        callback = Path(stacks.__file__).resolve()
        probe.bounded_process(command=["xcrun", "lldb", "--batch", "--no-lldbinit", "-o",
            "command script import " + json.dumps(str(callback)), "-o",
            "script face_full_frame_stack_lldb.run(debugger=lldb.debugger, config_path=" + json.dumps(str(config_path)) + ")",
            "-o", "quit"], environment=probe.system_environment(), log=out / "lldb.log")
        report["protocol"] = probe.validate_protocol(directory=directory, frames=frames, locked=locked)
        trace = locked.json(path=out / "trace/trace.json")
        if (trace.get("passed") is not True or trace.get("target_memory_written") is not False or
                trace.get("target_functions_evaluated") is not False or trace.get("software_breakpoints_used") is not False or
                trace.get("failures") != [] or trace.get("observer_failures") != []):
            raise ValueError("complete read-only hardware trace required")
        predictions = trace.get("predictions")
        if not isinstance(predictions, list) or len(predictions) != 26 or any(
                type(row.get("index")) is not int or row["index"] != index or not isinstance(row.get("stack"), list) or
                not 1 <= len(row["stack"]) <= 64 or row["stack"][0]["uuid"] != stacks.base.LENS_UUID or
                type(row["stack"][0]["file_address"]) is not int or
                row["stack"][0]["file_address"] != stacks.base.POINTS["prediction"]
                for index, row in enumerate(predictions)):
            raise ValueError("all initialized prediction stacks with pinned entry identities required")
        records = observed.snapshots(directory=out / "geometry", locked=locked)
        actual = geometry.algorithm_frames(records=records, directory=out / "geometry", locked=locked)
        if [row["sha256"] for row in actual] != [row["sha256"] for row in evidence["algorithm_frames"]]:
            raise ValueError("stack observer altered algorithm RGBA inputs")
        report["comparisons"] = []
        for index in range(7):
            pixels = [locked.read(path=root / f"frame-{index:02d}.rgba", maximum=1448 * 1086 * 4)
                      for root in (context["root"] / "baseline", directory)]
            delta = frame_metrics(reference=pixels[0], actual=pixels[1], width=1448, height=1086)
            if not delta["equal"]:
                raise ValueError("stack observation altered final pixels")
            report["comparisons"].append(dict(index=index, **delta))
        consumer.verify_library(runtime=runtime)
        report.update(passed=True, completed=True, observer_pixel_parity_verified=True,
                      prediction_stacks=predictions, algorithm_inputs_verified=26)
    except Exception as error:
        report["failures"].append(f"{type(error).__name__}: {error}")
        raise
    finally:
        finish(out=out, report=report, locked=locked)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("capture", "out"):
        parser.add_argument(f"--{name}", required=True, type=Path)
    report = run(args=parser.parse_args())
    print(json.dumps({key: report[key] for key in ("passed", "observer_pixel_parity_verified", "algorithm_inputs_verified")}))


if __name__ == "__main__":
    main()
