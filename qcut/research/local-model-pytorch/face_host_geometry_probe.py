"""Observe real FsNew geometry and neural inputs in the same owned beauty host."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess

from face_alignment_replay import LockedFiles, strict_json
from face_alignment_warp_native import BYTENN_SHA256
from face_geometry_native import LIBRARY_SHA256
from face_host_geometry_contract import associate_inferences, validate_sequence
import face_owned_replay_e2e as replay
import face_render_consumer_probe as consumer
import face_render_model_capture as models
import face_render_sequence_probe as sequence
from face_render_stability_probe import digest, frame_metrics


def snapshots(*, directory):
    paths = list(directory.glob("prediction-*.json"))
    if not 1 <= len(paths) <= 64:
        raise ValueError("bounded nonempty actual geometry snapshots required")
    records = [strict_json(data=sequence.bounded_bytes(path=path, limit=512 * 1024)) for path in paths]
    return validate_sequence(records=records)


def algorithm_frames(*, records, directory, locked):
    present = ["frame_file" in row or "frame_bytes" in row for row in records]
    if not any(present):
        return []
    if not all(present):
        raise ValueError("partial actual algorithm frame capture")
    frames = []
    for row in records:
        expected_name = f"frame-{row['index']}.rgba"
        _, width, height, _, _ = row["request"]
        expected_bytes = width * height * 4
        if (row.get("frame_file") != expected_name or type(row.get("frame_bytes")) is not int or
                row["frame_bytes"] != expected_bytes):
            raise ValueError("actual algorithm frame layout mismatch")
        data = locked.read(path=directory / expected_name, maximum=expected_bytes)
        if len(data) != expected_bytes:
            raise ValueError("actual algorithm frame byte count mismatch")
        frames.append(dict(prediction=row["index"], file=expected_name, bytes=expected_bytes,
                           sha256=digest(data=data)))
    return frames


def run(*, args):
    out = sequence.fresh_output(path=args.out)
    report = dict(passed=False, native_analysis_bypassed=False, geometry_observer_only=True,
                  per_face_inference_association_verified=False, failures=[], comparisons=[])
    locked = LockedFiles()
    try:
        baseline = args.capture.resolve(strict=True)
        previous = locked.json(path=baseline / "report.json")
        control = locked.json(path=baseline / "control/report.json")
        if (previous.get("passed") is not True or control.get("passed") is not True or
                control.get("owned_result_rendered") is not True or control.get("native_analysis_bypassed") is not False):
            raise ValueError("passed actual model capture with owned baseline required")
        runtime = args.runtime.resolve(strict=True)
        consumer.verify_library(runtime=runtime)
        for name, expected in (("liblens.dylib", LIBRARY_SHA256), ("libbytenn.dylib", BYTENN_SHA256)):
            locked.read(path=runtime / "Frameworks" / name, maximum=128 * 1024**2, expected=expected)
        sources = {**control["source_sha256"], **previous["source_sha256"], **{
            "local-model-pytorch/" + name: digest(data=Path(__file__).with_name(name).read_bytes())
            for name in (Path(__file__).name, "face_host_geometry_capture.mm", "face_alignment_replay.py",
                         "face_host_geometry_contract.py")}}
        for name, expected in sources.items():
            locked.read(path=Path(__file__).resolve().parents[1] / name, expected=expected)
        host_path, input_path = baseline / "control/clone-audit/host", baseline / "control/input.rgba"
        locked.read(path=host_path, maximum=128 * 1024**2, expected=previous["host_sha256"])
        locked.read(path=input_path, expected=control["input_rgba_sha256"])
        byte_observer = baseline / "observer.dylib"
        locked.read(path=byte_observer, expected=previous["observer_sha256"])
        width, height = control["width"], control["height"]
        if any(type(side) is not int or not 1 <= side <= 4096 for side in (width, height)):
            raise ValueError("bounded actual geometry frame dimensions required")
        for index in range(4):
            locked.read(path=baseline / f"control/original/frame-{index}.rgba")
        report.update(width=width, height=height, image_sha256=control["image_sha256"],
                      parameters=control["parameters"], source_sha256=sources,
                      lens_sha256=LIBRARY_SHA256, bytenn_sha256=BYTENN_SHA256)
        geometry, capture, observed = out / "geometry", out / "capture", out / "observed"
        for path in (geometry, capture, observed):
            path.mkdir()
        observer = out / "geometry-observer.dylib"
        subprocess.run([
            "xcrun", "clang++", "-std=c++17", "-O1", "-Wall", "-Wextra", "-Werror",
            "-dynamiclib", "-fobjc-arc", "-framework", "Foundation",
            f"-L{runtime / 'Frameworks'}", "-llens", f"-Wl,-rpath,{runtime / 'Frameworks'}",
            str(Path(__file__).with_name("face_host_geometry_capture.mm")), "-o", str(observer),
        ], check=True, timeout=180)
        environment = replay.environment(runtime=runtime, directory=observed, width=width, height=height)
        environment.pop("QCUT_FACE_BIND_REPLAY")
        environment.update(DYLD_INSERT_LIBRARIES=f"{byte_observer}:{observer}", QCUT_BYTENN_CAPTURE_IO="1",
                           QCUT_BYTENN_CAPTURE_DIR=str(capture), QCUT_FACE_GEOMETRY_DIR=str(geometry))
        parameters = consumer.parameters_json(text=json.dumps(control["parameters"]))
        host = sequence.BoundedHost(command=[str(host_path), str(runtime), str(runtime / "Models"),
                                            str(args.package.resolve(strict=True))],
                                    environment=environment, log=observed / "host.log", max_rows=11)
        try:
            host.receive(request_id=None)
            for index in range(10):
                output = observed / ("warmup.rgba" if index < 6 else f"frame-{index - 6}.rgba")
                host.render(request_id=f"warmup-{index}" if index < 6 else f"frame-{index - 6}",
                            timestamp=0 if index < 6 else (index - 6) / 30,
                            input_path=input_path, output_path=output, parameters=parameters)
                if index < 6:
                    continue
                metrics = frame_metrics(actual=sequence.bounded_bytes(path=output, limit=width * height * 4),
                                        reference=(baseline / f"control/original/frame-{index - 6}.rgba").read_bytes(),
                                        width=width, height=height)
                report["comparisons"].append(metrics)
                if not metrics["equal"]:
                    raise RuntimeError("actual geometry observer changed beauty pixels")
            host.finish()
        finally:
            host.close()
        expected = ["QCUT\tREADY\t1", *(f"QCUT\tRESULT\twarmup-{index}\t0" for index in range(6)),
                    *(f"QCUT\tRESULT\tframe-{index}\t0" for index in range(4))]
        if host.protocol_rows != expected or host.reader_error is not None:
            raise RuntimeError("geometry host protocol or bounded log failed")
        report.update(sequence.validate_owned_events(
            data=sequence.bounded_bytes(path=observed / "records.jsonl", limit=sequence.LOG_LIMIT), minimum=18))
        records = snapshots(directory=geometry)
        captured = models.inventory(capture=capture)
        metadata = [models.metadata(path=path) for path in capture.glob("*.json")]
        associations = associate_inferences(records=records, networks=captured["networks"], metadata=metadata)
        report.update(predictions=len(records), geometry_snapshots=records, captures=captured,
                      prediction_inferences=associations, per_prediction_inference_association_verified=True,
                      algorithm_frames=algorithm_frames(records=records, directory=geometry, locked=locked))
        if not any(face["active"] for row in records for face in row["faces"]):
            raise RuntimeError("no actual alignment geometry observed")
        locked.verify()
        consumer.verify_library(runtime=runtime)
        report.update(passed=True, geometry_observer_sha256=digest(data=observer.read_bytes()),
                      fixture_sha256=locked.files)
    except Exception as error:
        report["failures"].append(f"{type(error).__name__}: {error}")
        raise
    finally:
        (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("capture", "runtime", "package", "out"):
        parser.add_argument(f"--{name}", required=True, type=Path)
    report = run(args=parser.parse_args())
    print(json.dumps(dict(passed=report["passed"], predictions=report["predictions"],
                          successful_inferences=report["captures"]["successful_inferences"])))


if __name__ == "__main__":
    main()
