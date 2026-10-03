"""Two fresh original hosts; exact corresponding RGBA comparison, not inference bypass.
Version-1 manifest frames contain image, timestamp, parameters, optional expect_change.
Relative images resolve against the manifest; timestamps may repeat or go backwards.
Only explicit nonzero expect_change controls must differ from input."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import stat
import subprocess
import sys
import threading
import time
import uuid

import face_render_consumer_probe as consumer
from face_render_stability_probe import NativeHost

PRIVATE = Path(__file__).resolve().parents[2] / ".local/jianying-model-pytorch"
IMAGE_LIMIT = 128 * 1024**2
MANIFEST_LIMIT = 512 * 1024
LOG_LIMIT = 4 * 1024**2
LINE_LIMIT = 8192
IDENTITY_KEYS = {"id", "face_id", "track_id"}

def nonzero_effect(*, value: object) -> bool:
    if isinstance(value, dict):
        return any(nonzero_effect(value=child) for key, child in value.items()
                   if key not in IDENTITY_KEYS)
    if isinstance(value, list):
        return any(nonzero_effect(value=child) for child in value)
    return consumer.finite_number(value=value) and value != 0

def validate_manifest(*, value: object, base: Path, expect_change: bool = False) -> list[dict]:
    if (not isinstance(value, dict) or type(value.get("version")) is not int or
            value["version"] != 1 or not isinstance(value.get("frames"), list) or
            not 1 <= len(value["frames"]) <= 24):
        raise ValueError("manifest version 1 needs 1-24 frames")
    frames, errors = [], []
    for index, frame in enumerate(value["frames"]):
        try:
            if not isinstance(frame, dict) or set(frame) - {
                    "image", "timestamp", "parameters", "expect_change", "label"}:
                raise ValueError("invalid frame object or unknown field")
            image = frame.get("image")
            if (not isinstance(image, str) or not image.strip() or len(image) > 4096 or
                    re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", image)):
                raise ValueError("image must be a local path")
            path = consumer.protocol_path(path=Path(image))
            timestamp = frame.get("timestamp")
            if not consumer.finite_number(value=timestamp) or not 0 <= timestamp <= 60:
                raise ValueError("timestamp must be finite and between 0 and 60 seconds")
            parameters = consumer.parameters_json(text=json.dumps(frame.get("parameters")))
            if len(parameters.encode()) > 16384:
                raise ValueError("parameters exceed byte limit")
            control = frame.get("expect_change", False)
            if type(control) is not bool or (control and not nonzero_effect(value=frame["parameters"])):
                raise ValueError("expect_change requires an explicit nonzero effect control")
            label = frame.get("label", f"frame-{index:02d}")
            if not isinstance(label, str) or len(label) > 80:
                raise ValueError("label must be a string of at most 80 characters")
            frames.append(dict(image=str(path if path.is_absolute() else base / path),
                               timestamp=timestamp, parameters=json.loads(parameters),
                               expect_change=control, label=label))
        except (ValueError, TypeError, OverflowError, RecursionError) as error:
            errors.append(f"frame {index}: {error}")
    if expect_change and not any(frame["expect_change"] for frame in frames):
        errors.append("--expect-change requires a frame marked expect_change")
    if errors:
        raise ValueError("; ".join(errors))
    return frames

def validate_dimensions(*, width: int, height: int, expected: tuple | None = None) -> None:
    if type(width) is not int or type(height) is not int or not (1 <= width <= 4096 and 1 <= height <= 4096):
        raise ValueError("image dimensions must be between 1 and 4096")
    if expected is not None and (width, height) != expected:
        raise ValueError("sequence images must have the same dimensions")

def bounded_bytes(*, path: Path, limit: int) -> bytes:
    metadata = path.stat()
    if not stat.S_ISREG(metadata.st_mode):
        raise ValueError(f"regular local file required: {path}")
    if metadata.st_size > limit:
        raise ValueError(f"file exceeds byte limit: {path}")
    with path.open("rb") as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise ValueError(f"file grew beyond byte limit: {path}")
    return data

def file_identity(*, path: Path, limit: int) -> tuple[dict, bytes]:
    def marker():
        stat = path.stat()
        return [stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns]

    before = marker()
    data = bounded_bytes(path=path, limit=limit)
    identity = dict(sha256=hashlib.sha256(data).hexdigest(), stat=before,
                    resolved=str(path.resolve(strict=True)))
    if marker() != before:
        raise RuntimeError(f"file mutated while reading: {path}")
    return identity, data

def fresh_output(*, path: Path | None) -> Path:
    out = (path or PRIVATE / f"sequence-{uuid.uuid4().hex}").resolve()
    if out == PRIVATE.resolve() or not out.is_relative_to(PRIVATE.resolve()):
        raise ValueError("output must be beneath .local/jianying-model-pytorch")
    consumer.protocol_path(path=out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.mkdir(mode=0o700)
    return out

def source_snapshot() -> dict:
    sources = consumer.source_snapshot(original=True)
    for name in (Path(__file__).name, "face_render_stability_probe.py",
                 "face_render_injection_inventory.py", "espresso_oracle.py"):
        sources[f"local-model-pytorch/{name}"] = hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()
    return sources

def verify_runtime(*, runtime: Path) -> None:
    # Isolate the existing UUID guard so even its dwarfdump has an outer deadline.
    subprocess.run([sys.executable, "-c", "from pathlib import Path; import sys; "
                    "import face_render_consumer_probe as c; c.verify_library(runtime=Path(sys.argv[1]))",
                    str(runtime)], cwd=Path(__file__).parent, check=True, timeout=60,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def frame_difference(*, actual: bytes, reference: bytes, width: int, height: int) -> tuple[dict, bytes]:
    validate_dimensions(width=width, height=height)
    if len(actual) != width * height * 4 or len(reference) != len(actual):
        raise ValueError("native RGBA byte count mismatch")
    gray = bytearray(width * height)
    changed, maximum, left, top, right, bottom = 0, 0, width, height, 0, 0
    if actual != reference:
        for pixel, offset in enumerate(range(0, len(actual), 4)):
            delta = max(abs(actual[offset + channel] - reference[offset + channel]) for channel in range(4))
            if delta == 0:
                continue
            x, y = pixel % width, pixel // width
            changed += 1
            maximum = max(maximum, delta)
            left, top, right, bottom = min(left, x), min(top, y), max(right, x + 1), max(bottom, y + 1)
            gray[pixel] = min(255, delta * 8)
    return dict(equal=actual == reference, changed_pixels=changed, max_delta=maximum,
                bbox=[left, top, right, bottom] if changed else None,
                sha256=hashlib.sha256(actual).hexdigest()), bytes(gray)

def failure(*, report: dict, stage: str, error: object) -> None:
    report["failures"].append(dict(stage=stage, error=f"{type(error).__name__}: {error}"[:2000]))

def check_guards(*, report: dict, files: dict, runtime: Path | None) -> bool:
    previous = len(report["failures"])
    checks = [("source guard", lambda: source_snapshot() == report["source_sha256"])]
    checks.extend((f"file guard {path}", lambda path=path, identity=identity, limit=limit:
                   file_identity(path=path, limit=limit)[0] == identity)
                  for path, (identity, limit) in files.items())
    if runtime is not None:
        checks.append(("runtime SHA/UUID guard", lambda: verify_runtime(runtime=runtime) is None))
    for stage, check in checks:
        try:
            if not check():
                raise RuntimeError("identity mutated")
        except Exception as error:
            failure(report=report, stage=stage, error=error)
    return len(report["failures"]) == previous

class BoundedHost(NativeHost):
    def __init__(self, *, command: list[str], environment: dict[str, str], log: Path):
        self.protocol_rows = []
        self.reader_error = None
        super().__init__(command=command, environment=environment, log=log)

    def render(self, **request) -> None:
        # A stopped reader can block stdin.write before receive's timeout starts.
        deadline = threading.Timer(65, self.process.kill)
        deadline.daemon = True
        deadline.start()
        try:
            super().render(**request)
        finally:
            deadline.cancel()

    def read(self, *, log: Path) -> None:
        total = 0
        try:
            with log.open("wb") as stream:
                while line := self.process.stdout.readline(LINE_LIMIT + 1):
                    data = line.encode("utf-8")
                    total += len(data)
                    if len(line) > LINE_LIMIT or total > LOG_LIMIT:
                        raise RuntimeError("native log limit exceeded")
                    stream.write(data)
                    if "[research-error]" in line or line.startswith("[error]"):
                        raise RuntimeError("native error in host log")
                    if line.startswith("QCUT\t"):
                        if len(self.protocol_rows) >= 25:
                            raise RuntimeError("too many native protocol rows")
                        row = line.rstrip("\r\n")
                        self.protocol_rows.append(row)
                        self.rows.put(row)
        except Exception as error:
            self.reader_error = error
            self.rows.put(error)
            if self.process.poll() is None:
                self.process.kill()
        finally:
            self.rows.put(None)

def run_sequence(*, report: dict, frames: list[dict], out: Path, runtime: Path,
                 package: Path, width: int, height: int, run_index: int) -> None:
    from PIL import Image

    directory = out / f"run-{run_index}"
    directory.mkdir(mode=0o700)
    environment = consumer.probe_environment(runtime=runtime, out=directory, width=width,
        height=height, mode="original", eye_shift=0, has_replay=False)
    allowed = {"QCUT_FRAME_WIDTH", "QCUT_FRAME_HEIGHT", "DYLD_LIBRARY_PATH"}
    environment = {key: value for key, value in environment.items()
                   if key in allowed or not key.startswith(("QCUT_", "DYLD_", "MTL_", "LD_PRELOAD"))}
    command = [str(out / "host"), str(runtime), str(runtime / "Models"), str(package)]
    entry = dict(command=command, environment={key: environment[key] for key in sorted(allowed)},
                 protocol_rows=[], frames=[], exit_code=None)
    report["runs"].append(entry)
    host = None
    try:
        host = BoundedHost(command=command, environment=environment, log=directory / "host.log")
        host.receive(request_id=None)
        for index, frame in enumerate(frames):
            request_id = f"frame-{index:02d}"
            started, rendered = time.monotonic(), False
            detail = dict(index=index, request_id=request_id, passed=False)
            entry["frames"].append(detail)
            try:
                output = directory / f"{request_id}.rgba"
                host.render(request_id=request_id, timestamp=frame["timestamp"],
                    input_path=out / f"input-{index:02d}.rgba", output_path=output,
                    parameters=consumer.parameters_json(text=json.dumps(frame["parameters"])))
                rendered = True
                pixels = bounded_bytes(path=output, limit=width * height * 4)
                reference = bounded_bytes(path=out / f"input-{index:02d}.rgba", limit=width * height * 4)
                metrics, gray = frame_difference(actual=pixels, reference=reference, width=width, height=height)
                detail["versus_input"] = metrics
                Image.frombytes("RGBA", (width, height), pixels).save(output.with_suffix(".png"))
                Image.frombytes("L", (width, height), gray).save(directory / f"{request_id}-input-gain8.png")
                if frame["expect_change"] and metrics["equal"]:
                    raise RuntimeError("nonzero-effect control did not differ from input")
                detail["passed"] = True
            except Exception as error:
                failure(report=report, stage=f"run {run_index} frame {index}", error=error)
                row = host.protocol_rows[-1].split("\t") if host.protocol_rows else []
                if not rendered and not (len(row) == 5 and row[:4] == ["QCUT", "RESULT", request_id, "1"]):
                    break
            finally:
                detail["elapsed_ms"] = round((time.monotonic() - started) * 1000, 3)
        host.finish()
    except Exception as error:
        failure(report=report, stage=f"run {run_index} host", error=error)
    finally:
        if host is not None:
            try:
                host.close()
            except Exception as error:
                failure(report=report, stage=f"run {run_index} close", error=error)
            entry.update(protocol_rows=host.protocol_rows, exit_code=host.process.poll())
            entry["protocol_sha256"] = hashlib.sha256("\n".join(host.protocol_rows).encode()).hexdigest()
            if host.reader_error is not None:
                failure(report=report, stage=f"run {run_index} log", error=host.reader_error)
        expected = ["QCUT\tREADY\t1", *(f"QCUT\tRESULT\tframe-{index:02d}\t0" for index in range(len(frames)))]
        if entry["protocol_rows"] != expected:
            failure(report=report, stage=f"run {run_index} protocol", error=RuntimeError("incomplete or unexpected protocol"))
        for index in range(len(entry["frames"]), len(frames)):
            entry["frames"].append(dict(index=index, passed=False, skipped=True))
            failure(report=report, stage=f"run {run_index} frame {index}", error=RuntimeError("host aborted before request"))

def run(*, args: argparse.Namespace) -> dict:
    report = dict(passed=False, failures=[], runs=[], comparisons=[], frames=[],
                  native_analysis_bypassed=False, mode="original", seeks_per_request=2,
                  protocol_version=1, difference="min(255, 8 * max(abs(RGBA delta)))")
    try:
        out = fresh_output(path=args.out)
    except Exception as error:
        out = fresh_output(path=None)
        failure(report=report, stage="output", error=error)
    report["out"] = str(out)
    files, runtime = {}, None
    try:
        report["source_sha256"] = source_snapshot()
        if report["failures"]:
            raise ValueError("requested output refused; failure report is in a fresh private directory")
        manifest = consumer.protocol_path(path=args.manifest.absolute())
        identity, data = file_identity(path=manifest, limit=MANIFEST_LIMIT)
        files[manifest] = (identity, MANIFEST_LIMIT)
        report["manifest"] = dict(path=str(manifest), **identity)
        frames = validate_manifest(value=json.loads(data), base=manifest.parent, expect_change=args.expect_change)
        report["frames"] = frames
        from PIL import Image
        size = None
        for index, frame in enumerate(frames):
            try:
                image = Path(frame["image"])
                identity, data = file_identity(path=image, limit=IMAGE_LIMIT)
                if image in files and files[image][0] != identity:
                    raise RuntimeError("repeated source image mutated")
                files.setdefault(image, (identity, IMAGE_LIMIT))
                frame["identity"] = identity
                with Image.open(io.BytesIO(data)) as source:
                    validate_dimensions(width=source.width, height=source.height, expected=size)
                    size = source.size
                    rgba = source.convert("RGBA")
                    pixels = rgba.tobytes()
                    rgba.save(out / f"input-{index:02d}.png")
                raw = out / f"input-{index:02d}.rgba"
                raw.write_bytes(pixels)
                files[raw] = (file_identity(path=raw, limit=len(pixels))[0], len(pixels))
                frame["input_rgba_sha256"] = hashlib.sha256(pixels).hexdigest()
            except Exception as error:
                failure(report=report, stage=f"input frame {index}", error=error)
        if report["failures"]:
            raise ValueError("invalid sequence inputs")
        width, height = size
        report.update(width=width, height=height)
        runtime = consumer.protocol_path(path=args.runtime.resolve(strict=True))
        package = consumer.protocol_path(path=args.package.resolve(strict=True))
        if not package.is_dir() or not (runtime / "Models").is_dir():
            raise ValueError("package and runtime Models directories are required")
        from face_render_injection_inventory import LIBRARY_SHA256, UUID
        report.update(runtime_uuid=UUID, runtime_sha256=LIBRARY_SHA256,
                      graphics_uuid=consumer.GRAPHICS_UUID, graphics_sha256=consumer.GRAPHICS_SHA256,
                      runtime=str(runtime), package=str(package))
        if not check_guards(report=report, files=files, runtime=runtime):
            raise RuntimeError("preflight identity guard failed")
        consumer.compile_host(output=out / "host", original=True)
        identity, _ = file_identity(path=out / "host", limit=128 * 1024**2)
        files[out / "host"] = (identity, 128 * 1024**2)
        report["host_sha256"] = identity["sha256"]
        for run_index in range(2):
            if not check_guards(report=report, files=files, runtime=runtime):
                break
            run_sequence(report=report, frames=frames, out=out, runtime=runtime, package=package,
                         width=width, height=height, run_index=run_index)
        for index in range(len(frames)):
            try:
                paths = [out / f"run-{run_index}/frame-{index:02d}.rgba" for run_index in range(2)]
                reference, actual = [bounded_bytes(path=path, limit=width * height * 4) for path in paths]
                metrics, gray = frame_difference(actual=actual, reference=reference, width=width, height=height)
                report["comparisons"].append(dict(index=index, **metrics))
                Image.frombytes("L", (width, height), gray).save(out / f"frame-{index:02d}-repeat-gain8.png")
                if not metrics["equal"]:
                    raise RuntimeError("fresh-host corresponding RGBA frames differ")
            except Exception as error:
                failure(report=report, stage=f"repeat frame {index}", error=error)
    except (Exception, KeyboardInterrupt) as error:
        failure(report=report, stage="probe", error=error)
    finally:
        if "source_sha256" in report:
            check_guards(report=report, files=files, runtime=runtime)
        report["passed"] = (not report["failures"] and len(report["runs"]) == 2 and
                            len(report["comparisons"]) == len(report["frames"]))
        (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report

def make_fixture(*, image: Path, out: Path | None) -> Path:
    from PIL import Image, ImageChops

    directory = fresh_output(path=out)
    identity, data = file_identity(path=image, limit=IMAGE_LIMIT)
    with Image.open(io.BytesIO(data)) as source:
        validate_dimensions(width=source.width, height=source.height)
        original = source.convert("RGBA")
    variants = [original, ImageChops.offset(original, max(1, original.width // 16), 0),
                original.transpose(Image.Transpose.FLIP_LEFT_RIGHT),
                Image.new("RGBA", original.size, (96, 96, 96, 255)), original, original, original]
    labels = ["face", "motion", "mirror", "no-face", "recovery", "zero-effect", "half-effect"]
    frames = []
    for index, (label, variant) in enumerate(zip(labels, variants)):
        variant.save(directory / f"{label}.png")
        intensity = 0 if index == 5 else (0.5 if index == 6 else 1)
        frames.append(dict(image=f"{label}.png", timestamp=index / 30, label=label,
            parameters={"face_adjust_eye": [{"id": -1, "intensity": intensity}]}, expect_change=index not in (3, 5)))
    if file_identity(path=image, limit=IMAGE_LIMIT)[0] != identity:
        raise RuntimeError("fixture source image mutated")
    manifest = directory / "manifest.json"
    manifest.write_text(json.dumps(dict(version=1, frames=frames), indent=2, allow_nan=False) + "\n")
    (directory / "source.json").write_text(json.dumps(dict(path=str(image.absolute()), **identity), indent=2) + "\n")
    return manifest

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("runtime", "package", "manifest", "out"):
        parser.add_argument(f"--{name}", type=Path)
    parser.add_argument("--expect-change", action="store_true")
    args = parser.parse_args()
    report = run(args=args)
    print(json.dumps({key: report[key] for key in ("passed", "out", "failures")}, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
