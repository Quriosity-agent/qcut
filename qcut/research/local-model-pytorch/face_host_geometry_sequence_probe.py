"""Bounded dynamic observer-neutrality sidecar; native analysis remains enabled.

Two fresh instances of the same locked owned host receive six first-frame
warmups and 1-24 manifest requests, each with the host's two internal seeks.
Neural markers delimit observations, not verified per-face inference ownership.
"""
from __future__ import annotations

import argparse
import io
import json
import math
from pathlib import Path
import subprocess
import sys

from face_alignment_replay import LockedFiles, strict_json
from face_host_geometry_contract import associate_inferences, validate_sequence, validate_snapshot
import face_host_geometry_probe as geometry
import face_owned_replay_e2e as replay
import face_render_consumer_probe as consumer
import face_render_model_capture as models
import face_render_model_parity as parity
import face_render_sequence_probe as sequence
from face_render_stability_probe import digest

WARMUPS = 6
SEEKS = 2


def prepare_inputs(*, manifest, out, locked):
    from PIL import Image

    manifest = consumer.protocol_path(path=manifest.absolute())
    data = locked.read(path=manifest, maximum=sequence.MANIFEST_LIMIT)
    frames = sequence.validate_manifest(value=strict_json(data=data), base=manifest.parent)
    size = None
    for index, frame in enumerate(frames):
        image = consumer.protocol_path(path=Path(frame["image"]))
        data = locked.read(path=image, maximum=sequence.IMAGE_LIMIT)
        frame["image_sha256"] = digest(data=data)
        with Image.open(io.BytesIO(data)) as source:
            sequence.validate_dimensions(width=source.width, height=source.height, expected=size)
            size = source.size
            rgba = source.convert("RGBA")
            pixels = rgba.tobytes()
            rgba.save(out / f"input-{index:02d}.png")
        raw = out / f"input-{index:02d}.rgba"
        raw.write_bytes(pixels)
        frame["input_rgba_sha256"] = digest(data=locked.read(path=raw, maximum=len(pixels)))
    return frames, size


def lock_baseline(*, capture, locked):
    previous = locked.json(path=capture / "report.json")
    parity.validate_capture(captured=previous)
    control = locked.json(path=capture / "control/report.json")
    if (control.get("passed") is not True or control.get("owned_result_rendered") is not True or
            control.get("native_analysis_bypassed") is not False):
        raise ValueError("passed actual model capture with owned baseline required")
    sequence.validate_dimensions(width=control.get("width"), height=control.get("height"))
    sources = {}
    for evidence in (control, previous):
        for name, expected in evidence["source_sha256"].items():
            path = Path(__file__).resolve().parents[1] / name
            locked.read(path=path, expected=expected)
            sources[name] = expected
    for name in (Path(__file__).name, "face_host_geometry_probe.py", "face_host_geometry_capture.mm",
                 "face_host_geometry_contract.py", "face_alignment_replay.py", "face_alignment_warp_native.py",
                 "face_geometry_native.py", "face_render_model_parity.py"):
        sources["local-model-pytorch/" + name] = digest(data=locked.read(path=Path(__file__).with_name(name)))
    host, observer = capture / "control/clone-audit/host", capture / "observer.dylib"
    locked.read(path=host, maximum=128 * 1024**2, expected=previous["host_sha256"])
    locked.read(path=observer, maximum=128 * 1024**2, expected=previous["observer_sha256"])
    locked.read(path=capture / "control/input.rgba", maximum=sequence.IMAGE_LIMIT,
                expected=control["input_rgba_sha256"])
    # The supplied baseline is static; its existing four-frame contract stays intact.
    for index in range(4):
        locked.read(path=capture / f"control/original/frame-{index}.rgba", maximum=sequence.IMAGE_LIMIT,
                    expected=control["frames"][index]["sha256"])
    return host, observer, sources


def snapshots(*, directory, locked):
    paths = list(directory.glob("prediction-*.json"))
    if not 1 <= len(paths) <= 64:
        raise ValueError("bounded nonempty actual geometry snapshots required")
    records = []
    for path in paths:
        row = strict_json(data=locked.read(path=path, maximum=512 * 1024))
        validate_snapshot(row=row)
        if path.name != f"prediction-{row['index']}.json":
            raise ValueError("geometry snapshot filename/index mismatch")
        records.append(row)
    return validate_sequence(records=records, temporal=True)


def exact_events(*, data, count, timestamp=None):
    evidence = sequence.validate_owned_events(data=data, minimum=0 if count is None else count)
    if count is not None and any(evidence[key] != count for key in ("owned_face_conversions", "owned_face_restorations")):
        raise RuntimeError("owned conversion/restoration count differs from exact seek count")
    pending = False
    for line in data.splitlines():
        event = strict_json(data=line)
        if event.get("event") == "owned_face_conversion":
            if (pending or event.get("external_points") is not False or
                    event.get("source_points_unchanged") is not True or
                    event.get("owned_points_isolated") is not True or
                    type(event.get("timestamp_us")) is not int or
                    (timestamp is not None and event["timestamp_us"] != math.floor(timestamp * 1_000_000 + 0.5))):
                raise RuntimeError("owned seek timing/isolation or restoration order changed")
            pending = True
        if event.get("event") == "owned_face_restored":
            if not pending:
                raise RuntimeError("owned restoration preceded conversion")
            pending = False
    return evidence


def render_host(*, entry, frames, out, runtime, package, host_path, byte_observer, observer, width, height, locked):
    from PIL import Image

    directory = out / entry["name"]
    directory.mkdir()
    environment = replay.environment(runtime=runtime, directory=directory, width=width, height=height)
    environment.pop("QCUT_FACE_BIND_REPLAY", None)
    environment.pop("LD_PRELOAD", None)
    if entry["name"] == "observed":
        environment.update(DYLD_INSERT_LIBRARIES=f"{byte_observer}:{observer}", QCUT_BYTENN_CAPTURE_IO="1",
                           QCUT_BYTENN_CAPTURE_DIR=str(out / "capture"), QCUT_FACE_GEOMETRY_DIR=str(out / "geometry"))
    entry.update(command=[str(host_path), str(runtime), str(runtime / "Models"), str(package)],
                 environment={key: value for key, value in environment.items() if key.startswith(("QCUT_", "DYLD_"))},
                 requests=[], protocol_rows=[])
    host = sequence.BoundedHost(command=entry["command"], environment=environment,
                                log=directory / "host.log", max_rows=1 + WARMUPS + len(frames))
    try:
        host.receive(request_id=None)
        trace = b""
        for request_index in range(WARMUPS + len(frames)):
            warmup = request_index < WARMUPS
            index = 0 if warmup else request_index - WARMUPS
            frame = frames[index]
            request_id = f"warmup-{request_index}" if warmup else f"frame-{index:02d}"
            detail = dict(request_id=request_id, timestamp=frame["timestamp"], passed=False)
            entry["requests"].append(detail)
            output = directory / ("warmup.rgba" if warmup else f"{request_id}.rgba")
            host.render(request_id=request_id, timestamp=frame["timestamp"], input_path=out / f"input-{index:02d}.rgba",
                        output_path=output, parameters=consumer.parameters_json(text=json.dumps(frame["parameters"])))
            pixels = sequence.bounded_bytes(path=output, limit=width * height * 4)
            if len(pixels) != width * height * 4:
                raise ValueError("native RGBA byte count mismatch")
            if not warmup:
                Image.frombytes("RGBA", (width, height), pixels).save(output.with_suffix(".png"))
                detail["sha256"] = digest(data=locked.read(path=output, maximum=len(pixels)))
            updated = sequence.bounded_bytes(path=directory / "records.jsonl", limit=sequence.LOG_LIMIT)
            if not updated.startswith(trace):
                raise RuntimeError("owned trace was rewritten between requests")
            detail["owned_record_span"] = [len(trace), len(updated)]
            detail.update(exact_events(data=updated[len(trace):], count=None if warmup else SEEKS,
                                       timestamp=frame["timestamp"]))
            trace = updated
            if request_index == WARMUPS - 1:
                # Cold adapter installation omits two conversions across the six warmups.
                entry["warmup_evidence"] = exact_events(data=trace, count=SEEKS * (WARMUPS - 1))
            detail["passed"] = True
        host.finish()
    finally:
        entry.update(protocol_rows=list(host.protocol_rows), reader_error=str(host.reader_error) if host.reader_error else None)
        original_error = sys.exc_info()[1]
        try:
            host.close()
        except Exception as error:
            entry["close_error"] = f"{type(error).__name__}: {error}"
            if original_error is None:
                raise
    expected = ["QCUT\tREADY\t1", *(f"QCUT\tRESULT\twarmup-{index}\t0" for index in range(WARMUPS)),
                *(f"QCUT\tRESULT\tframe-{index:02d}\t0" for index in range(len(frames)))]
    if entry["protocol_rows"] != expected or host.reader_error is not None:
        raise RuntimeError("geometry sequence host protocol or bounded log failed")
    data = locked.read(path=directory / "records.jsonl", maximum=sequence.LOG_LIMIT)
    entry.update(exact_events(data=data, count=SEEKS * (WARMUPS - 1 + len(frames))), records_sha256=digest(data=data))
    locked.read(path=directory / "host.log", maximum=sequence.LOG_LIMIT)


def compare_outputs(*, report, out, frames, width, height, locked):
    from PIL import Image

    for index in range(len(frames)):
        name = f"frame-{index:02d}"
        reference, actual = [locked.read(path=out / run / f"{name}.rgba", maximum=width * height * 4)
                             for run in ("baseline", "observed")]
        metrics, gray = sequence.frame_difference(actual=actual, reference=reference, width=width, height=height)
        report["comparisons"].append(dict(index=index, baseline_sha256=digest(data=reference), **metrics))
        Image.frombytes("L", (width, height), gray).save(out / f"{name}-diff-gain8.png")
    if not all(row["equal"] for row in report["comparisons"]):
        raise RuntimeError("dual geometry/ByteNN observer changed beauty pixels")


def lock_inventory(*, inventory, directory, locked):
    for path in directory.glob("*.json"):
        locked.read(path=path, maximum=65536)
    for network in inventory["networks"].values():
        locked.read(path=Path(network["graph_path"]), maximum=1024**2, expected=network["graph_sha256"])
        for item in (*network["inputs"], *network["outputs"]):
            locked.read(path=Path(item["path"]), maximum=16 * 1024**2, expected=item["sha256"])


def run(*, args):
    out = sequence.fresh_output(path=args.out)
    report = dict(passed=False, native_analysis_bypassed=False, geometry_observer_only=True,
                  per_face_inference_association_verified=False, per_prediction_inference_association_verified=False,
                  observer_pixel_parity_verified=False, warmup_requests_per_host=WARMUPS, seeks_per_request=SEEKS,
                  protocol_version=1, runs=[], comparisons=[], failures=[], out=str(out))
    locked, runtime = LockedFiles(), None
    try:
        capture = consumer.protocol_path(path=args.capture.resolve(strict=True))
        host_path, byte_observer, sources = lock_baseline(capture=capture, locked=locked)
        report.update(capture=str(capture), source_sha256=sources)
        frames, (width, height) = prepare_inputs(manifest=args.manifest, out=out, locked=locked)
        report.update(frames=frames, width=width, height=height, manifest=str(args.manifest.absolute()))
        runtime = consumer.protocol_path(path=args.runtime.resolve(strict=True))
        package = consumer.protocol_path(path=args.package.resolve(strict=True))
        if not package.is_dir() or not (runtime / "Models").is_dir():
            raise ValueError("package and runtime Models directories are required")
        consumer.verify_library(runtime=runtime)
        for name, expected in (("liblens.dylib", geometry.LIBRARY_SHA256), ("libbytenn.dylib", geometry.BYTENN_SHA256)):
            locked.read(path=runtime / "Frameworks" / name, maximum=128 * 1024**2, expected=expected)
        report.update(runtime=str(runtime), package=str(package),
                      host_sha256=digest(data=locked.read(path=host_path, maximum=128 * 1024**2)),
                      observer_sha256=digest(data=locked.read(path=byte_observer, maximum=128 * 1024**2)))
        for name in ("geometry", "capture"):
            (out / name).mkdir()
        observer = out / "geometry-observer.dylib"
        subprocess.run([
            "xcrun", "clang++", "-std=c++17", "-O1", "-Wall", "-Wextra", "-Werror", "-dynamiclib", "-fobjc-arc",
            "-framework", "Foundation", f"-L{runtime / 'Frameworks'}", "-llens", f"-Wl,-rpath,{runtime / 'Frameworks'}",
            str(Path(__file__).with_name("face_host_geometry_capture.mm")), "-o", str(observer),
        ], check=True, timeout=180)
        report["geometry_observer_sha256"] = digest(data=locked.read(path=observer, maximum=128 * 1024**2))
        for name in ("baseline", "observed"):
            locked.verify()
            entry = dict(name=name)
            report["runs"].append(entry)
            render_host(entry=entry, frames=frames, out=out, runtime=runtime, package=package,
                        host_path=host_path, byte_observer=byte_observer, observer=observer,
                        width=width, height=height, locked=locked)
        compare_outputs(report=report, out=out, frames=frames, width=width, height=height, locked=locked)
        report["observer_pixel_parity_verified"] = True
        records = snapshots(directory=out / "geometry", locked=locked)
        report.update(predictions=len(records), geometry_snapshots=records, algorithm_request=records[0]["request"])
        actual_frames = geometry.algorithm_frames(records=records, directory=out / "geometry", locked=locked)
        if len(actual_frames) != len(records):
            raise ValueError("actual algorithm frames required for every geometry snapshot")
        report["algorithm_frames"] = actual_frames
        report["captures"] = models.inventory(capture=out / "capture")
        lock_inventory(inventory=report["captures"], directory=out / "capture", locked=locked)
        metadata = [models.metadata(path=path) for path in (out / "capture").glob("*.json")]
        report["prediction_inferences"] = associate_inferences(
            records=records, networks=report["captures"]["networks"], metadata=metadata, temporal=True)
        report["per_prediction_inference_association_verified"] = True
        if models.inventory(capture=out / "capture") != report["captures"]:
            raise RuntimeError("actual model inventory changed during capture validation")
        report["passed"] = True
    except Exception as error:
        sequence.failure(report=report, stage="dynamic geometry observer", error=error)
        raise
    finally:
        original_error, guard_error = sys.exc_info()[1], None
        checks = [("fixture/source guard", locked.verify)]
        if runtime is not None:
            checks.append(("runtime guard", lambda: consumer.verify_library(runtime=runtime)))
        for stage, check in checks:
            try:
                check()
            except Exception as error:
                report["passed"] = False
                sequence.failure(report=report, stage=stage, error=error)
                guard_error = error
        report["fixture_sha256"] = dict(locked.files)
        (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
        if original_error is None and guard_error is not None:
            raise guard_error
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("capture", "manifest", "runtime", "package", "out"):
        parser.add_argument(f"--{name}", required=True, type=Path)
    report = run(args=parser.parse_args())
    print(json.dumps(dict(passed=report["passed"], predictions=report["predictions"], frames=len(report["comparisons"]))))


if __name__ == "__main__":
    main()
