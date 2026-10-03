"""Seven-frame pinned profile: dynamic consumption; native analysis stays active.

Use the capture's compiled owned host, six first-frame warmups and seven
manifest requests. This is not independent inference or product parity proof.
"""
from __future__ import annotations

import argparse
import io
import json
import math
import os
from pathlib import Path
import sys

from face_alignment_replay import LockedFiles, strict_json, valid_hash
import face_host_geometry_probe as geometry
import face_host_geometry_sequence_probe as capture_probe
import face_owned_replay_e2e as replay
import face_render_consumer_probe as consumer
import face_render_sequence_probe as sequence
from face_render_stability_probe import digest

DIMENSIONS = (1448, 1086)
FRAME_COUNT, WARMUPS, SEEKS, CONVERSIONS = 7, 6, 2, 24
SOURCE_ROOT = Path(__file__).resolve().parents[1]


def require(*, condition, message):
    if not condition:
        raise ValueError(message)


def hashed(*, locked, path, expected, maximum=128 * 1024**2):
    require(condition=valid_hash(value=expected), message=f"required hash missing: {path.name}")
    return locked.read(path=path, expected=expected, maximum=maximum)


def sources(*, locked, evidence):
    values = evidence.get("source_sha256")
    require(condition=isinstance(values, dict) and 0 < len(values) <= 128,
            message="bounded nonempty source hashes required")
    for name, expected in values.items():
        require(condition=isinstance(name, str) and 0 < len(name) <= 4096 and ":" not in name
                and "\\" not in name, message="invalid source path")
        path = SOURCE_ROOT / name
        require(condition=not Path(name).is_absolute() and ".." not in Path(name).parts
                and path.resolve(strict=True).is_relative_to(SOURCE_ROOT), message="invalid source path")
        hashed(locked=locked, path=path, expected=expected, maximum=sequence.LOG_LIMIT)
    return values


def rows(*, data):
    require(condition=len(data) <= sequence.LOG_LIMIT and len(data.splitlines()) <= 1024,
            message="owned trace exceeds bounds")
    result = [strict_json(data=line) for line in data.splitlines()]
    require(condition=all(isinstance(item, dict) for item in result), message="owned trace needs objects")
    pending = False
    for item in result:
        if item.get("event") == "owned_face_conversion":
            require(condition=not pending, message="overlapping owned conversions")
            pending = True
        if item.get("event") == "owned_face_restored":
            require(condition=pending, message="owned restoration precedes conversion")
            pending = False
    require(condition=not pending, message="owned conversion lacks restoration")
    return result


def protocol(*, frames):
    return ["QCUT\tREADY\t1", *(f"QCUT\tRESULT\twarmup-{i}\t0" for i in range(WARMUPS)),
            *(f"QCUT\tRESULT\tframe-{i:02d}\t0" for i in range(len(frames)))]


def load_capture(*, capture, runtime, package, locked):
    from PIL import Image

    previous = locked.json(path=capture / "report.json")
    require(condition=previous.get("passed") is True and previous.get("native_analysis_bypassed") is False
            and previous.get("observer_pixel_parity_verified") is True
            and previous.get("per_prediction_inference_association_verified") is True,
            message="passed observed dynamic capture with active native analysis required")
    require(condition=all(type(previous.get(key)) is int for key in ("width", "height"))
            and (previous.get("width"), previous.get("height")) == DIMENSIONS
            and all(type(previous.get(key)) is int and previous[key] == value for key, value in
                    (("warmup_requests_per_host", WARMUPS), ("seeks_per_request", SEEKS))),
            message="capture dimensions or request counts differ")
    frames, comparisons, runs = (previous.get(key) for key in ("frames", "comparisons", "runs"))
    require(condition=isinstance(frames, list) and len(frames) == FRAME_COUNT
            and isinstance(comparisons, list) and len(comparisons) == FRAME_COUNT
            and isinstance(runs, list) and len(runs) == 2
            and [item.get("name") for item in runs] == ["baseline", "observed"], message="capture counts differ")
    source_hashes = sources(locked=locked, evidence=previous)
    manifest = consumer.protocol_path(path=Path(previous["manifest"]))
    require(condition=manifest.is_absolute(), message="absolute original manifest required")
    data = locked.read(path=manifest, maximum=sequence.MANIFEST_LIMIT)
    original = sequence.validate_manifest(value=strict_json(data=data), base=manifest.parent)
    require(condition=len(original) == FRAME_COUNT, message="original manifest count differs")
    command = runs[0]["command"]
    require(condition=isinstance(command, list) and len(command) == 4 and command == runs[1]["command"],
            message="capture hosts differ")
    host_path = consumer.protocol_path(path=Path(command[0]))
    require(condition=host_path.is_absolute() and os.access(host_path, os.X_OK)
            and [Path(item).resolve(strict=True) for item in command[1:]] == [runtime, runtime / "Models", package],
            message="locked host executable/runtime/package mismatch")
    hashed(locked=locked, path=host_path, expected=previous.get("host_sha256"))
    byte_count = DIMENSIONS[0] * DIMENSIONS[1] * 4
    for index, (frame, expected, comparison) in enumerate(zip(frames, original, comparisons, strict=True)):
        require(condition={key: frame.get(key) for key in expected} == expected,
                message="capture frame differs from original manifest")
        image = hashed(locked=locked, path=Path(frame["image"]), expected=frame.get("image_sha256"),
                       maximum=sequence.IMAGE_LIMIT)
        raw = hashed(locked=locked, path=capture / f"input-{index:02d}.rgba",
                     expected=frame.get("input_rgba_sha256"), maximum=byte_count)
        with Image.open(io.BytesIO(image)) as source:
            require(condition=source.size == DIMENSIONS and source.convert("RGBA").tobytes() == raw,
                    message="captured input layout differs from original image")
        require(condition=type(comparison.get("index")) is int and comparison["index"] == index
                and comparison.get("equal") is True and comparison.get("bbox") is None
                and all(type(comparison.get(key)) is int and comparison[key] == 0
                        for key in ("changed_pixels", "max_delta"))
                and comparison.get("sha256") == comparison.get("baseline_sha256"),
                message="seven exact baseline/observed comparisons required")
        for name in ("baseline", "observed"):
            pixels = hashed(locked=locked, path=capture / name / f"frame-{index:02d}.rgba",
                            expected=comparison.get("baseline_sha256"), maximum=byte_count)
            require(condition=len(pixels) == byte_count, message="captured output byte count differs")
    timestamps = [math.floor(frame["timestamp"] * 1_000_000 + 0.5) for frame in frames]
    timing = [timestamps[0]] * (SEEKS * (WARMUPS - 1)) + [stamp for stamp in timestamps for _ in range(SEEKS)]
    conversions = []
    for entry in runs:
        require(condition=entry.get("protocol_rows") == protocol(frames=frames) and entry.get("reader_error") is None,
                message="capture protocol failed")
        trace = hashed(locked=locked, path=capture / entry["name"] / "records.jsonl",
                       expected=entry.get("records_sha256"), maximum=sequence.LOG_LIMIT)
        capture_probe.exact_events(data=trace, count=CONVERSIONS)
        conversions = [row for row in rows(data=trace) if row.get("event") == "owned_face_conversion"]
        require(condition=[row["timestamp_us"] for row in conversions] == timing, message="capture conversion timing differs")
    return previous, frames, host_path, digest(data=data), conversions, source_hashes


def load_candidate(*, candidate, capture, manifest_hash, conversions, locked, diagnostic=False):
    require(condition=type(diagnostic) is bool, message="typed diagnostic policy required")
    evidence = locked.json(path=candidate.with_name("report.json"))
    allowed_diagnostic = diagnostic and evidence.get("passed") is False and evidence.get("completed") is True and evidence.get("diagnostic_only") is True
    require(condition=(evidence.get("passed") is True or allowed_diagnostic) and evidence.get("independent_120_sampling_input_used") is True
            and evidence.get("capture_sha256") == locked.files[str(capture / "report.json")],
            message="candidate producer/capture provenance failed")
    if "source_sha256" in evidence:
        sources(locked=locked, evidence=evidence)
    data = hashed(locked=locked, path=candidate, expected=evidence.get("replay_sha256"), maximum=replay.REPLAY_LIMIT)
    value = strict_json(data=data)
    payload = consumer.validate_replay(value=value, width=DIMENSIONS[0], height=DIMENSIONS[1], image_hash=manifest_hash,
                                      maximum_timestamp_us=consumer.REPLAY_TIME_LIMIT_US)
    require(condition=len(value["frames"]) == CONVERSIONS, message="candidate needs exactly 24 conversions")
    for actual, expected in zip(value["frames"], conversions, strict=True):
        require(condition=actual["timestamp_us"] == expected["timestamp_us"]
                and [face["id"] for face in actual["faces"]] == [face["id"] for face in expected["faces_before"]],
                message="candidate conversion timing/IDs differ from capture")
    return value, payload


def render_host(*, entry, out, capture, frames, value, host_path, runtime, package, locked):
    environment = replay.environment(runtime=runtime, directory=out, width=DIMENSIONS[0], height=DIMENSIONS[1])
    environment.pop("LD_PRELOAD", None)
    environment["QCUT_FACE_BIND_REPLAY"] = str(out / "replay.bin")
    environment["QCUT_FACE_REPLAY_MAX_TIME_US"] = str(consumer.REPLAY_TIME_LIMIT_US)
    entry.update(command=[str(host_path), str(runtime), str(runtime / "Models"), str(package)], requests=[],
                 environment={key: item for key, item in environment.items() if key.startswith(("QCUT_", "DYLD_"))})
    locked.verify()
    host = sequence.BoundedHost(command=entry["command"], environment=environment, log=out / "host.log",
                                max_rows=1 + WARMUPS + FRAME_COUNT)
    trace, cursor = b"", 0
    try:
        host.receive(request_id=None)
        for request_index in range(WARMUPS + FRAME_COUNT):
            warmup = request_index < WARMUPS
            index = 0 if warmup else request_index - WARMUPS
            frame = frames[index]
            request_id = f"warmup-{request_index}" if warmup else f"frame-{index:02d}"
            detail = dict(request_id=request_id, timestamp=frame["timestamp"], passed=False)
            entry["requests"].append(detail)
            output = out / ("warmup.rgba" if warmup else f"{request_id}.rgba")
            host.render(request_id=request_id, timestamp=frame["timestamp"], input_path=capture / f"input-{index:02d}.rgba",
                        output_path=output, parameters=consumer.parameters_json(text=json.dumps(frame["parameters"])))
            pixels = sequence.bounded_bytes(path=output, limit=DIMENSIONS[0] * DIMENSIONS[1] * 4)
            require(condition=len(pixels) == DIMENSIONS[0] * DIMENSIONS[1] * 4, message="native RGBA byte count mismatch")
            if not warmup:
                detail["sha256"] = digest(data=locked.read(path=output, maximum=len(pixels)))
            updated = sequence.bounded_bytes(path=out / "records.jsonl", limit=sequence.LOG_LIMIT)
            require(condition=updated.startswith(trace), message="owned trace was rewritten between requests")
            count = 0 if request_index == 0 else SEEKS
            span = dict(value, frames=value["frames"][cursor:cursor + count])
            actual_count = replay.validate_external_events(events=rows(data=updated[len(trace):]), replay=span, shift=0)
            require(condition=actual_count == count, message="exact per-request seek count differs")
            detail.update(owned_record_span=[len(trace), len(updated)], owned_face_conversions=count, passed=True)
            trace, cursor = updated, cursor + count
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
    require(condition=entry["protocol_rows"] == protocol(frames=frames) and host.reader_error is None,
            message="bounded host protocol/log failed")
    data = locked.read(path=out / "records.jsonl", maximum=sequence.LOG_LIMIT)
    require(condition=data == trace and cursor == CONVERSIONS, message="late owned trace or incomplete replay")
    entry["owned_face_conversions"] = replay.validate_external_events(events=rows(data=data), replay=value, shift=0)
    entry.update(owned_face_restorations=CONVERSIONS, records_sha256=digest(data=data))
    log = locked.read(path=out / "host.log", maximum=sequence.LOG_LIMIT)
    require(condition=[line for line in log.splitlines() if line.startswith(b"QCUT\t")]
            == [row.encode("ascii") for row in protocol(frames=frames)]
            and not any(marker in log for marker in (b"[research-error]", b"[error]")), message="host log failed")
    entry["host_log_sha256"] = digest(data=log)


def compare_outputs(*, report, out, capture, locked, diagnostic=False):
    from PIL import Image, ImageDraw

    width, height = DIMENSIONS
    tile_width, tile_height = 360, max(1, round(360 * height / width))
    sheet = Image.new("RGB", (tile_width * 4, (tile_height + 24) * FRAME_COUNT), "white")
    draw = ImageDraw.Draw(sheet)
    for index in range(FRAME_COUNT):
        name = f"frame-{index:02d}"
        actual, baseline = [locked.read(path=path, maximum=width * height * 4) for path in
                            (out / f"{name}.rgba", capture / "baseline" / f"{name}.rgba")]
        metrics, gray = sequence.frame_difference(actual=actual, reference=baseline, width=width, height=height)
        source = locked.read(path=capture / f"input-{index:02d}.rgba", maximum=width * height * 4)
        effect, _ = sequence.frame_difference(actual=actual, reference=source, width=width, height=height)
        report["comparisons"].append(dict(index=index, baseline_sha256=digest(data=baseline), versus_input=effect, **metrics))
        images = [Image.frombytes("RGBA", DIMENSIONS, pixels) for pixels in (baseline, actual)]
        images.append(Image.frombytes("L", DIMENSIONS, gray))
        images.append(Image.frombytes("RGBA", DIMENSIONS, source))
        images[1].save(out / f"{name}.png")
        images[2].save(out / f"{name}-diff-gain8.png")
        for column, (image, label) in enumerate(zip(images, ("baseline", "candidate", "difference x8", "original input"), strict=True)):
            x, y = column * tile_width, index * (tile_height + 24)
            draw.text((x + 4, y + 4), f"{name} {label}", fill="black")
            sheet.paste(image.convert("RGB").resize((tile_width, tile_height)), (x, y + 24))
    sheet.save(out / "comparison-sheet.png")
    for path in [out / "comparison-sheet.png", *(out / f"frame-{index:02d}{suffix}.png" for index in range(FRAME_COUNT)
                                                  for suffix in ("", "-diff-gain8"))]:
        locked.read(path=path, maximum=sequence.IMAGE_LIMIT)
    exact = all(row["equal"] and row["changed_pixels"] == row["max_delta"] == 0
                and row["bbox"] is None for row in report["comparisons"])
    if not diagnostic:
        require(condition=exact, message="candidate beauty pixels differ")
    require(condition=all(not frame["expect_change"] or not row["versus_input"]["equal"] for frame, row in
                          zip(report["frames"], report["comparisons"], strict=True)), message="nonzero-effect control did not change input")


def run(*, args):
    out = sequence.fresh_output(path=args.out)
    report = dict(passed=False, completed=False, native_analysis_bypassed=False, independent_inference_verified=False,
                  product_parity_verified=False, external_replay_verified=False, pixel_parity_verified=False,
                  warmup_requests_per_host=WARMUPS, seeks_per_request=SEEKS, runs=[], comparisons=[], failures=[], out=str(out))
    locked, runtime = LockedFiles(), None
    try:
        capture = consumer.protocol_path(path=args.capture.resolve(strict=True))
        candidate = consumer.protocol_path(path=args.candidate.resolve(strict=True))
        runtime = consumer.protocol_path(path=args.runtime.resolve(strict=True))
        package = consumer.protocol_path(path=args.package.resolve(strict=True))
        require(condition=package.is_dir() and (runtime / "Models").is_dir(), message="package/runtime Models directories required")
        consumer.verify_library(runtime=runtime)
        for name, expected in (("liblens.dylib", geometry.LIBRARY_SHA256), ("libbytenn.dylib", geometry.BYTENN_SHA256)):
            hashed(locked=locked, path=runtime / "Frameworks" / name, expected=expected)
        previous, frames, host, manifest_hash, conversions, source_hashes = load_capture(
            capture=capture, runtime=runtime, package=package, locked=locked)
        for module in (sys.modules[__name__], consumer, replay, sequence, capture_probe, geometry,
                       sys.modules[LockedFiles.__module__], sys.modules[digest.__module__]):
            path = Path(module.__file__).resolve()
            source_hashes[str(path.relative_to(SOURCE_ROOT))] = digest(data=locked.read(path=path))
        value, payload = load_candidate(candidate=candidate, capture=capture, manifest_hash=manifest_hash,
                                        conversions=conversions, locked=locked, diagnostic=getattr(args, "diagnostic", False))
        binary = out / "replay.bin"
        binary.write_bytes(payload)
        locked.read(path=binary, maximum=replay.REPLAY_LIMIT)
        report.update(capture=str(capture), candidate=str(candidate), runtime=str(runtime), package=str(package),
                      capture_sha256=locked.files[str(capture / "report.json")], replay_sha256=locked.files[str(candidate)],
                      host_sha256=previous["host_sha256"], manifest_sha256=manifest_hash, source_sha256=source_hashes,
                      width=DIMENSIONS[0], height=DIMENSIONS[1], frames=frames)
        entry = dict(name="candidate")
        report["runs"].append(entry)
        render_host(entry=entry, out=out, capture=capture, frames=frames, value=value, host_path=host,
                    runtime=runtime, package=package, locked=locked)
        report["external_replay_verified"] = True
        compare_outputs(report=report, out=out, capture=capture, locked=locked, diagnostic=getattr(args, "diagnostic", False))
        exact = all(row["equal"] for row in report["comparisons"])
        report.update(pixel_parity_verified=exact, passed=exact, completed=True,
                      diagnostic_only=getattr(args, "diagnostic", False))
    except Exception as error:
        sequence.failure(report=report, stage="dynamic candidate render", error=error)
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
    for name in ("capture", "candidate", "runtime", "package", "out"):
        parser.add_argument(f"--{name}", required=True, type=Path)
    parser.add_argument("--diagnostic", action="store_true")
    report = run(args=parser.parse_args())
    print(json.dumps({key: report[key] for key in ("passed", "completed", "pixel_parity_verified", "external_replay_verified")}, allow_nan=False))


if __name__ == "__main__":
    main()
