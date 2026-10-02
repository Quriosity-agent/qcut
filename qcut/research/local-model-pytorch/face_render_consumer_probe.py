"""Replay bounded face landmarks at the real Swing algorithm/render boundary."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
from pathlib import Path
import platform
import struct
import subprocess

HOST_SOURCES = (
    "filter-host-main.mm", "amazer-context-scope.mm", "filter-host-support.mm",
    "filter-face-inspect.mm", "filter-sequence-io.cpp", "graphics-runtime.mm",
    "graphics-probe.mm", "filter-probe.mm",
)
MAGIC = b"QCFACE1\0"
COORDINATE_SPACE = "normalized-bottom-left"
FRAME_COUNT = 4
WARMUP_COUNT = 10
GRAPHICS_SHA256 = "1b9493940eebda3b79d72b7308adf8abfbff56c9cfce9d7d73b31cd080453eee"
GRAPHICS_UUID = "57ECC10F-8BB8-319C-BA46-AF286E2EBD43"
ENV_KEYS = (
    "QCUT_TRACE_UPDATES", "QCUT_FACE_POINT_SHIFT", "QCUT_FACE_REPLAY",
    "QCUT_CONSUMER_RECORD", "QCUT_CONSUMER_TRACE",
)


def finite_number(*, value: object) -> bool:
    try:
        return type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        return False


def parameters_json(*, text: str) -> str:
    value = json.loads(text)
    if not isinstance(value, dict):
        raise ValueError("parameters must be an object")

    def validate(item):
        if isinstance(item, dict):
            for child in item.values():
                validate(child)
        elif isinstance(item, list):
            for child in item:
                validate(child)
        elif isinstance(item, float) and not math.isfinite(item):
            raise ValueError("parameters contain non-finite number")

    validate(value)
    return json.dumps(value, separators=(",", ":"), allow_nan=False)


def protocol_path(*, path: Path) -> Path:
    if any(character in str(path) for character in ("\t", "\n", "\r", "\0")):
        raise ValueError("path contains host protocol delimiter")
    return path


def validate_replay(*, value: dict, width: int, height: int, image_hash: str) -> bytes:
    if not isinstance(value, dict) or type(value.get("version")) is not int or value.get("version") != 1:
        raise ValueError("unsupported replay version")
    if (value.get("coordinate_space") != COORDINATE_SPACE or
            type(value.get("width")) is not int or type(value.get("height")) is not int or
            value.get("width") != width or value.get("height") != height or
            value.get("image_sha256") != image_hash):
        raise ValueError("replay provenance or coordinate space mismatch")
    frames = value.get("frames")
    if not isinstance(frames, list) or not 1 <= len(frames) <= 64:
        raise ValueError("replay needs 1-64 ordered update frames")
    payload = bytearray(struct.pack("<8sIII", MAGIC, width, height, len(frames)))
    previous = -1
    for frame in frames:
        if not isinstance(frame, dict):
            raise ValueError("invalid replay frame")
        timestamp = frame.get("timestamp_us")
        faces = frame.get("faces")
        if (type(timestamp) is not int or not max(0, previous) <= timestamp <= 100_000 or
                not isinstance(faces, list) or len(faces) > 10):
            raise ValueError("invalid replay timing or face count")
        previous = timestamp
        payload.extend(struct.pack("<qI", timestamp, len(faces)))
        ids = set()
        for face in faces:
            if not isinstance(face, dict):
                raise ValueError("invalid replay face")
            identity = face.get("id")
            points = face.get("points")
            if (type(identity) is not int or not 0 <= identity <= 2**31 - 1 or
                    identity in ids or not isinstance(points, list) or len(points) != 106):
                raise ValueError("invalid track identity or landmark count")
            ids.add(identity)
            coordinates = []
            for point in points:
                if (not isinstance(point, list) or len(point) != 2 or
                        any(not finite_number(value=number) or not 0 <= number <= 1
                            for number in point)):
                    raise ValueError("invalid normalized landmark")
                coordinates.extend(point)
            payload.extend(struct.pack("<i212f", identity, *coordinates))
    return bytes(payload)


def validate_mode(*, mode: str, eye_shift: float, replay: Path | None) -> None:
    if mode not in ("original", "read", "trace"):
        raise ValueError("unsupported probe mode")
    if not finite_number(value=eye_shift) or abs(eye_shift) > 0.02:
        raise ValueError("eye shift must be finite and at most 0.02")
    if mode != "trace" and (eye_shift != 0 or replay is not None):
        raise ValueError("eye shift and replay require trace mode")


def verify_library(*, runtime: Path) -> None:
    from face_render_injection_inventory import LIBRARY_SHA256, UUID

    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise ValueError("probe requires macOS arm64")
    for name, digest, identity in (
        ("libcccreator.dylib", LIBRARY_SHA256, UUID),
        ("libAGFX.dylib", GRAPHICS_SHA256, GRAPHICS_UUID),
    ):
        library = runtime / "Frameworks" / name
        if hashlib.sha256(library.read_bytes()).hexdigest() != digest:
            raise ValueError(f"unverified {name} SHA256")
        output = subprocess.check_output(["dwarfdump", "--uuid", str(library)], text=True)
        if f"{identity} (arm64)" not in output:
            raise ValueError(f"unverified {name} arm64 UUID")


def source_files(*, original: bool) -> list[Path]:
    directory = Path(__file__).resolve().parents[1] / "jianying-runtime-probe"
    if original:
        return [directory / name for name in HOST_SOURCES]
    return [Path(__file__).with_name("face_render_consumer_bridge.mm"),
            *(directory / name for name in HOST_SOURCES
              if name not in ("filter-host-main.mm", "filter-probe.mm"))]


def source_snapshot(*, original: bool) -> dict[str, str]:
    module = Path(__file__).resolve()
    sources = set(source_files(original=original))
    if not original:
        sources.add(module.parents[1] / "jianying-runtime-probe/filter-probe.mm")
    sources.update((module.parents[1] / "jianying-runtime-probe").glob("*.h"))
    sources.add(module)
    return {str(path.relative_to(module.parents[1])):
            hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(sources)}


def verify_sources(*, original: bool, expected: dict[str, str]) -> None:
    if source_snapshot(original=original) != expected:
        raise RuntimeError("probe sources changed during execution")


def compile_host(*, output: Path, original: bool) -> None:
    subprocess.run([
        "xcrun", "clang++", "-std=c++20", "-fobjc-arc", "-g", "-O1",
        "-Wall", "-Wextra", "-Werror", "-Wno-deprecated-declarations",
        *(str(path) for path in source_files(original=original)),
        "-framework", "AppKit", "-framework", "CoreVideo",
        "-framework", "IOSurface", "-framework", "OpenGL", "-o", str(output),
    ], check=True, timeout=180)


def validate_host_log(*, log: str) -> None:
    results = [line.split("\t") for line in log.splitlines()
               if line.startswith("QCUT\tRESULT\t")]
    expected = [[f"warmup-{index}", "0"] for index in range(WARMUP_COUNT)]
    expected.extend([f"frame-{index}", "0"] for index in range(FRAME_COUNT))
    if (log.splitlines().count("QCUT\tREADY\t1") != 1 or
            any(len(row) != 4 for row in results) or
            [row[2:4] for row in results] != expected or "[research-error]" in log):
        raise RuntimeError("host protocol failed; inspect private logs")


def probe_environment(*, runtime: Path, out: Path, width: int, height: int,
                      mode: str, eye_shift: float, has_replay: bool) -> dict[str, str]:
    environment = {key: value for key, value in os.environ.items() if key not in ENV_KEYS}
    environment.update({
        "QCUT_FRAME_WIDTH": str(width), "QCUT_FRAME_HEIGHT": str(height),
        "DYLD_LIBRARY_PATH": str(runtime / "Frameworks"),
        "QCUT_CONSUMER_RECORD": str(out / "records.jsonl"),
    })
    if mode == "trace":
        environment["QCUT_TRACE_UPDATES"] = "1"
        environment["QCUT_FACE_POINT_SHIFT"] = str(eye_shift)
    if has_replay:
        environment["QCUT_FACE_REPLAY"] = str(out / "replay.bin")
    return environment


def run(*, args: argparse.Namespace) -> dict:
    from PIL import Image
    import espresso_oracle
    from face_render_injection_inventory import LIBRARY_SHA256, UUID

    validate_mode(mode=args.mode, eye_shift=args.eye_shift, replay=args.replay)
    original_host = args.mode == "original"
    sources = source_snapshot(original=original_host)
    runtime = protocol_path(path=args.runtime.resolve(strict=True))
    package = protocol_path(path=args.package.resolve(strict=True))
    if not package.is_dir():
        raise ValueError("effect package directory required")
    verify_library(runtime=runtime)
    out = protocol_path(path=espresso_oracle.private_path(path=args.out))
    if out.exists() and any(out.iterdir()):
        raise ValueError("output directory must be empty")
    parameters = parameters_json(text=args.parameters)
    if args.image.stat().st_size > 128 * 1024**2:
        raise ValueError("image exceeds probe byte limit")
    image_bytes = args.image.read_bytes()
    image_hash = hashlib.sha256(image_bytes).hexdigest()
    with Image.open(io.BytesIO(image_bytes)) as source:
        width, height = source.size
        if not 1 <= width <= 4096 or not 1 <= height <= 4096:
            raise ValueError("image exceeds probe dimension limit")
        pixels = source.convert("RGBA").tobytes()
    replay_bytes = None
    if args.replay is not None:
        replay_path = espresso_oracle.private_path(path=args.replay)
        if replay_path.stat().st_size > 1024**2:
            raise ValueError("replay exceeds byte limit")
        replay_bytes = validate_replay(
            value=json.loads(replay_path.read_text()), width=width, height=height, image_hash=image_hash)
    out.mkdir(parents=True, exist_ok=True)
    (out / "input.rgba").write_bytes(pixels)
    if replay_bytes is not None:
        (out / "replay.bin").write_bytes(replay_bytes)
    host = out / "host"
    compile_host(output=host, original=original_host)
    verify_sources(original=original_host, expected=sources)
    labels = [(f"warmup-{index}", 0) for index in range(WARMUP_COUNT)]
    labels.extend((f"frame-{index}", index / 30) for index in range(FRAME_COUNT))
    requests = ["\t".join([
        "render", label, str(timestamp), str(out / "input.rgba"),
        str(out / f"{label}.rgba"), parameters,
    ]) for label, timestamp in labels]
    (out / "requests.txt").write_text("\n".join([*requests, "exit"]) + "\n")
    environment = probe_environment(
        runtime=runtime, out=out, width=width, height=height, mode=args.mode,
        eye_shift=args.eye_shift, has_replay=replay_bytes is not None)
    verify_library(runtime=runtime)
    with (out / "requests.txt").open() as input_stream, (out / "host.log").open("w") as log:
        subprocess.run([str(host), str(runtime), str(runtime / "Models"), str(package)],
                       stdin=input_stream, env=environment, stdout=log,
                       stderr=subprocess.STDOUT, timeout=120, check=True)
    verify_sources(original=original_host, expected=sources)
    verify_library(runtime=runtime)
    validate_host_log(log=(out / "host.log").read_text())
    events = [] if args.mode == "original" else [
        json.loads(line) for line in (out / "records.jsonl").read_text().splitlines()]
    updates = [event for event in events if event.get("event") == "algorithm_update"]
    if args.mode == "trace" and not updates:
        raise RuntimeError("no algorithm update observed")
    if replay_bytes is not None and not all(event["external_points"] for event in updates):
        raise RuntimeError("external replay was not consumed")
    for index in range(FRAME_COUNT):
        rendered = (out / f"frame-{index}.rgba").read_bytes()
        if len(rendered) != width * height * 4:
            raise RuntimeError("host output size mismatch")
        Image.frombytes("RGBA", (width, height), rendered).save(out / f"frame-{index}.png")
    summary = {
        "runtime_uuid": UUID, "runtime_sha256": LIBRARY_SHA256,
        "graphics_uuid": GRAPHICS_UUID, "graphics_sha256": GRAPHICS_SHA256,
        "width": width, "height": height, "mode": args.mode, "eye_shift": args.eye_shift,
        "warmup_requests": WARMUP_COUNT,
        "parameters": json.loads(parameters), "image_sha256": image_hash,
        "input_rgba_sha256": hashlib.sha256(pixels).hexdigest(),
        "source_sha256": sources,
        "output_sha256": {f"frame-{index}.rgba":
                          hashlib.sha256((out / f"frame-{index}.rgba").read_bytes()).hexdigest()
                          for index in range(FRAME_COUNT)},
        "native_update_calls": len(updates) if args.mode == "trace" else None,
        "external_landmark_updates": sum(bool(event["external_points"]) for event in updates),
        "external_injection_verified": False, "native_analysis_bypassed": False,
    }
    if updates:
        exported = {
            "version": 1, "coordinate_space": COORDINATE_SPACE,
            "width": width, "height": height, "image_sha256": image_hash,
            "frames": [{"timestamp_us": event["timestamp_us"], "faces": event["faces_before"]}
                       for event in updates],
        }
        validate_replay(value=exported, width=width, height=height, image_hash=image_hash)
        (out / "replay.json").write_text(json.dumps(exported, indent=2) + "\n")
    (out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--package", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--parameters", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--mode", choices=("original", "read", "trace"), default="read")
    parser.add_argument("--eye-shift", type=float, default=0)
    parser.add_argument("--replay", type=Path)
    print(json.dumps(run(args=parser.parse_args()), indent=2))


if __name__ == "__main__":
    main()
