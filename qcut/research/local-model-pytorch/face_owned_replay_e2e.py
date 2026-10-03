"""Prove external XY points are consumed from isolated owned face results.

Same-value replay is exact; perturbations must affect only the chosen eye ROI.
Optional model replay is diagnostic: rendering success does not imply parity.
"""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
import struct
import subprocess

import face_owned_result_probe as owned
import face_render_consumer_probe as consumer
import face_render_sequence_probe as sequence
from face_owned_binding_e2e import validate_roi, validate_shift
from face_render_stability_probe import digest, frame_metrics, save_failure

REPLAY_LIMIT = 1024**2


def capture_replay(*, events: list[dict], width: int, height: int, image_hash: str,
                   maximum_timestamp_us: int = 100_000) -> dict:
    conversions = [item for item in events if item.get("event") == "owned_face_conversion"]
    value = dict(version=1, coordinate_space=consumer.COORDINATE_SPACE,
                 width=width, height=height, image_sha256=image_hash,
                 frames=[dict(timestamp_us=item.get("timestamp_us"),
                              faces=item.get("faces_before")) for item in conversions])
    consumer.validate_replay(value=value, width=width, height=height, image_hash=image_hash,
                             maximum_timestamp_us=maximum_timestamp_us)
    return value


def validate_external_events(*, events: list[dict], replay: dict, shift: float) -> int:
    conversions = [item for item in events if item.get("event") == "owned_face_conversion"]
    sequence.validate_owned_events(data="\n".join(json.dumps(item) for item in events).encode(),
                                   minimum=len(replay["frames"]))
    if len(conversions) != len(replay["frames"]):
        raise RuntimeError("owned replay conversion count differs from payload")
    for event, expected in zip(conversions, replay["frames"], strict=True):
        if (event.get("external_points") is not True or
                event.get("source_points_unchanged") is not True or
                event.get("owned_points_isolated") is not True or
                type(event.get("timestamp_us")) is not int or
                event.get("timestamp_us") != expected["timestamp_us"] or
                event.get("faces") != len(expected["faces"]) or
                event.get("eye_shift") != 0):
            raise RuntimeError("missing owned external replay isolation/timing evidence")
        applied = event.get("faces_applied")
        if not isinstance(applied, list) or len(applied) != len(expected["faces"]):
            raise RuntimeError("owned applied face count mismatch")
        for actual, source in zip(applied, expected["faces"], strict=True):
            if not isinstance(actual, dict) or type(actual.get("id")) is not int or actual["id"] != source["id"]:
                raise RuntimeError("owned replay identity was not preserved")
            coordinates = actual.get("points")
            if not isinstance(coordinates, list) or len(coordinates) != 106:
                raise RuntimeError("owned replay did not publish 106 points")
            for index, (point, reference) in enumerate(zip(coordinates, source["points"], strict=True)):
                if not isinstance(point, list) or len(point) != 2:
                    raise RuntimeError("invalid owned replay point evidence")
                for axis in range(2):
                    wanted = reference[axis] + (shift if axis == 0 and 52 <= index <= 63 else 0)
                    wanted = struct.unpack("<f", struct.pack("<f", wanted))[0]
                    if not consumer.finite_number(value=point[axis]) or abs(point[axis] - wanted) > 1e-9:
                        raise RuntimeError("owned clone coordinates differ from external payload")
    return len(conversions)


def shifted_replay(*, replay: dict, shift: float) -> dict:
    if not consumer.finite_number(value=shift) or abs(shift) > 0.02:
        raise ValueError("bounded finite eye shift required")
    value = copy.deepcopy(replay)
    for frame in value["frames"]:
        for face in frame["faces"]:
            for index in range(52, 64):
                face["points"][index][0] += shift
    consumer.validate_replay(value=value, width=value["width"], height=value["height"],
                             image_hash=value["image_sha256"])
    return value


def environment(*, runtime: Path, directory: Path, width: int, height: int) -> dict[str, str]:
    value = consumer.probe_environment(runtime=runtime, out=directory, width=width, height=height,
                                       mode="trace", eye_shift=0, has_replay=False)
    value = {key: item for key, item in value.items()
             if not key.startswith(("QCUT_", "DYLD_", "MTL_")) or key in {
                 "QCUT_FRAME_WIDTH", "QCUT_FRAME_HEIGHT", "QCUT_TRACE_UPDATES",
                 "QCUT_FACE_POINT_SHIFT", "QCUT_CONSUMER_RECORD", "DYLD_LIBRARY_PATH"}}
    value["QCUT_FACE_BIND_REPLAY"] = str(directory / "replay.bin")
    return value


def render_case(*, directory: Path, control: Path, runtime: Path, package: Path,
                replay: dict, parameters: str, frames: int, warmup: int) -> list[dict]:
    from PIL import Image

    directory.mkdir()
    width, height = replay["width"], replay["height"]
    payload = consumer.validate_replay(value=replay, width=width, height=height,
                                       image_hash=replay["image_sha256"])
    (directory / "replay.json").write_text(json.dumps(replay, indent=2, allow_nan=False) + "\n")
    (directory / "replay.bin").write_bytes(payload)
    host = sequence.BoundedHost(
        command=[str(control / "clone-audit/host"), str(runtime), str(runtime / "Models"), str(package)],
        environment=environment(runtime=runtime, directory=directory, width=width, height=height),
        log=directory / "host.log", max_rows=1 + warmup + frames)
    comparisons = []
    try:
        host.receive(request_id=None)
        for index in range(warmup):
            host.render(request_id=f"warmup-{index}", timestamp=0,
                        input_path=control / "input.rgba", output_path=directory / "warmup.rgba",
                        parameters=parameters)
        for index in range(frames):
            output = directory / f"frame-{index}.rgba"
            host.render(request_id=f"frame-{index}", timestamp=index / 30,
                        input_path=control / "input.rgba", output_path=output, parameters=parameters)
            pixels = sequence.bounded_bytes(path=output, limit=width * height * 4)
            reference = (control / f"original/frame-{index}.rgba").read_bytes()
            comparisons.append(frame_metrics(actual=pixels, reference=reference, width=width, height=height))
            save_failure(out=directory, index=index, pixels=pixels, reference=reference,
                         width=width, height=height)
            Image.frombytes("RGBA", (width, height), pixels).save(output.with_suffix(".png"))
        host.finish()
    finally:
        host.close()
    expected = ["QCUT\tREADY\t1", *(f"QCUT\tRESULT\twarmup-{index}\t0" for index in range(warmup)),
                *(f"QCUT\tRESULT\tframe-{index}\t0" for index in range(frames))]
    if host.protocol_rows != expected or host.reader_error is not None:
        raise RuntimeError("owned replay protocol or bounded log failed")
    if "[research-error]" in (directory / "host.log").read_text():
        raise RuntimeError("owned replay native callback failed")
    return comparisons


def reject_case(*, directory: Path, host: Path, runtime: Path, package: Path, payload: bytes,
                width: int, height: int, requests: str, error: str) -> None:
    directory.mkdir()
    (directory / "replay.bin").write_bytes(payload)
    result = subprocess.run([str(host), str(runtime), str(runtime / "Models"), str(package)],
                            input=requests, text=True, capture_output=True, timeout=45,
                            env=environment(runtime=runtime, directory=directory, width=width, height=height))
    log = result.stdout + result.stderr
    (directory / "host.log").write_text(log)
    if result.returncode < 1 or "[research-error]" not in log or error not in log:
        raise RuntimeError(f"native owned replay guard did not reject {directory.name}")


def save_sheet(*, out: Path, candidate: bool) -> None:
    from PIL import Image, ImageDraw

    names = ["control/original.png", "same/frame-3.png", "plus/frame-3.png",
             "same/failure-0003-diff-gain8.png", "plus/failure-0003-diff-gain8.png",
             "minus/failure-0003-diff-gain8.png"]
    labels = ["Native", "Owned external: same", "Owned external: eye +0.01",
              "Same - native: gray x8", "Plus - native: gray x8", "Minus - native: gray x8"]
    if candidate:
        names.extend(["candidate/frame-3.png", "candidate/failure-0003-diff-gain8.png"])
        labels.extend(["Model points: DIAGNOSTIC", "Model - native: gray x8"])
    rows = (len(names) + 2) // 3
    sheet = Image.new("RGB", (1440, rows * 388), "white")
    draw = ImageDraw.Draw(sheet)
    for index, (name, label) in enumerate(zip(names, labels, strict=True)):
        x, y = index % 3 * 480, index // 3 * 388
        with Image.open(out / name) as image:
            sheet.paste(image.convert("RGB").resize((480, 360)), (x, y + 28))
        draw.text((x + 8, y + 8), label, fill="black")
    sheet.save(out / "comparison.png")


def run(*, args: argparse.Namespace) -> dict:
    out = sequence.fresh_output(path=args.out)
    report = dict(passed=False, native_analysis_bypassed=False, external_owned_points_rendered=False,
                  model_parity_verified=False, cases={}, negative_cases=[], failures=[])
    files = {}
    try:
        runtime, package = args.runtime.resolve(strict=True), args.package.resolve(strict=True)
        report["source_sha256"] = {**owned.probe_sources(), **{
            f"local-model-pytorch/{name}": digest(data=Path(__file__).with_name(name).read_bytes())
            for name in (Path(__file__).name, "face_owned_binding_e2e.py", "face_render_sequence_probe.py")}}
        control = owned.run(args=argparse.Namespace(
            runtime=runtime, package=package, image=args.image, out=out / "control",
            parameters=args.parameters, frames=4, warmup=6, require_face=True, expect_change=True, binding=True))
        width, height, image_hash = control["width"], control["height"], control["image_sha256"]
        report.update(width=width, height=height, image_sha256=image_hash)
        validate_roi(roi=args.eye_roi, width=width, height=height)
        records = sequence.bounded_bytes(path=out / "control/clone-audit/records.jsonl", limit=sequence.LOG_LIMIT)
        native = capture_replay(events=[json.loads(line) for line in records.splitlines()],
                                width=width, height=height, image_hash=image_hash)
        (out / "native-replay.json").write_text(json.dumps(native, indent=2) + "\n")
        cases = [("same", native, 0), ("plus", shifted_replay(replay=native, shift=0.01), 0),
                 ("minus", shifted_replay(replay=native, shift=-0.01), 0)]
        if args.candidate is not None:
            identity, data = sequence.file_identity(path=args.candidate, limit=REPLAY_LIMIT)
            files[args.candidate] = identity
            candidate = json.loads(data)
            consumer.validate_replay(value=candidate, width=width, height=height, image_hash=image_hash)
            cases.append(("candidate", candidate, 0))
        parameters = consumer.parameters_json(text=args.parameters)
        host_path = out / "control/clone-audit/host"
        host_identity = sequence.file_identity(path=host_path, limit=128 * 1024**2)[0]
        files[host_path] = host_identity
        for name, replay, shift in cases:
            metrics = render_case(directory=out / name, control=out / "control", runtime=runtime,
                                  package=package, replay=replay, parameters=parameters, frames=4, warmup=6)
            events = [json.loads(line) for line in sequence.bounded_bytes(
                path=out / name / "records.jsonl", limit=sequence.LOG_LIMIT).splitlines()]
            count = validate_external_events(events=events, replay=replay, shift=shift)
            report["cases"][name] = dict(rendered=True, frames=metrics, conversions=count,
                                        exact_native_parity=all(item["equal"] for item in metrics))
            if name == "same" and not report["cases"][name]["exact_native_parity"]:
                raise RuntimeError("same-value owned external replay changed native pixels")
            if name in ("plus", "minus"):
                for item in metrics:
                    validate_shift(metrics=item, roi=args.eye_roi)
                if len({item["sha256"] for item in metrics}) != 1:
                    raise RuntimeError("owned external perturbation is unstable")
        if report["cases"]["plus"]["frames"][0]["sha256"] == report["cases"]["minus"]["frames"][0]["sha256"]:
            raise RuntimeError("opposite external perturbations produced identical pixels")
        payload = consumer.validate_replay(value=native, width=width, height=height, image_hash=image_hash)
        requests = "\n".join(["\t".join([
            "render", f"warmup-{index}", "0", str(out / "control/input.rgba"),
            str(out / "rejected.rgba"), parameters]) for index in range(2)]) + "\nexit\n"
        bad_timing, bad_identity = bytearray(payload), bytearray(payload)
        offset = 20
        for frame in native["frames"]:
            if frame["timestamp_us"] == 0:
                struct.pack_into("<q", bad_timing, offset, 1)
            offset += 12 + len(frame["faces"]) * 852
        struct.pack_into("<i", bad_identity, 32, 2**31 - 1)
        corruptions = [
            ("truncated", payload[:25], "truncated replay payload", "exit\n"),
            ("nonfinite", payload[:36] + struct.pack("<f", float("nan")) + payload[40:],
             "invalid normalized replay landmark", "exit\n"),
            ("trailing", payload + b"x", "trailing replay payload", "exit\n"),
            ("unconsumed", payload, "unconsumed owned replay frames", "exit\n"),
            ("timing", bytes(bad_timing), "owned replay timing or face count mismatch", requests),
            ("identity", bytes(bad_identity), "owned replay track id mismatch", requests),
            ("count", payload[:28] + struct.pack("<I", 0) + payload[884:],
             "owned replay timing or face count mismatch", requests),
        ]
        for label, bad, error, commands in corruptions:
            reject_case(directory=out / f"reject-{label}", host=host_path, runtime=runtime,
                        package=package, payload=bad, width=width, height=height, requests=commands, error=error)
            report["negative_cases"].append(label)
        consumer.verify_library(runtime=runtime)
        current = {**owned.probe_sources(), **{key: digest(data=Path(__file__).with_name(Path(key).name).read_bytes())
                   for key in report["source_sha256"] if Path(key).name in
                   (Path(__file__).name, "face_owned_binding_e2e.py", "face_render_sequence_probe.py")}}
        if current != report["source_sha256"] or digest(data=args.image.read_bytes()) != image_hash:
            raise RuntimeError("owned replay sources or image changed during execution")
        for path, identity in files.items():
            if sequence.file_identity(path=path, limit=128 * 1024**2 if path == host_path else REPLAY_LIMIT)[0] != identity:
                raise RuntimeError("owned replay payload or host binary changed during execution")
        save_sheet(out=out, candidate=args.candidate is not None)
        report.update(passed=True, external_owned_points_rendered=True, host_sha256=host_identity["sha256"])
    except Exception as error:
        report["failures"].append(f"{type(error).__name__}: {error}")
        raise
    finally:
        (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("runtime", "package", "image", "out"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    parser.add_argument("--parameters", required=True)
    parser.add_argument("--eye-roi", type=int, nargs=4, required=True)
    parser.add_argument("--candidate", type=Path)
    result = run(args=parser.parse_args())
    print(json.dumps({key: result[key] for key in (
        "passed", "external_owned_points_rendered", "model_parity_verified", "native_analysis_bypassed")}, indent=2))


if __name__ == "__main__":
    main()
