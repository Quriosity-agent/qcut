"""Check every repeated native beauty frame against an explicit reference."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import queue
import subprocess
import threading
import time
from pathlib import Path

import face_render_consumer_probe as consumer


def digest(*, data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def validate_counts(*, frames: int, warmup: int) -> None:
    if type(frames) is not int or not 1 <= frames <= 1024:
        raise ValueError("stability frame count must be between 1 and 1024")
    if type(warmup) is not int or not 0 <= warmup <= 100:
        raise ValueError("warmup count must be between 0 and 100")


def frame_metrics(*, actual: bytes, reference: bytes, width: int, height: int) -> dict:
    import numpy as np

    if len(actual) != width * height * 4 or len(reference) != len(actual):
        raise ValueError("native RGBA byte count mismatch")
    difference = np.abs(
        np.frombuffer(actual, dtype=np.uint8).reshape(height, width, 4).astype(np.int16)
        - np.frombuffer(reference, dtype=np.uint8).reshape(height, width, 4).astype(np.int16))
    ys, xs = np.nonzero(np.any(difference != 0, axis=2))
    return {
        "equal": actual == reference,
        "changed_pixels": int(xs.size),
        "max_delta": int(difference.max()),
        "bbox": None if xs.size == 0 else
        [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1],
        "sha256": digest(data=actual),
    }


def protocol_row(*, row: str, request_id: str | None) -> None:
    expected = (["QCUT", "READY", "1"] if request_id is None else
                ["QCUT", "RESULT", request_id, "0"])
    if row.split("\t") != expected:
        raise RuntimeError(f"unexpected native protocol row: {row[:200]}")


class NativeHost:
    def __init__(self, *, command: list[str], environment: dict[str, str], log: Path):
        self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.STDOUT, text=True, env=environment)
        self.rows: queue.Queue = queue.Queue()
        self.thread = threading.Thread(target=self.read, kwargs={"log": log}, daemon=True)
        self.thread.start()

    def read(self, *, log: Path) -> None:
        try:
            with log.open("w") as stream:
                for line in self.process.stdout:
                    stream.write(line)
                    if line.startswith("QCUT\t"):
                        self.rows.put(line.rstrip("\r\n"))
        except Exception as error:
            self.rows.put(error)
        finally:
            self.rows.put(None)

    def receive(self, *, request_id: str | None) -> None:
        try:
            row = self.rows.get(timeout=60)
        except queue.Empty as error:
            raise RuntimeError("native frame response timed out") from error
        if row is None or isinstance(row, Exception):
            raise RuntimeError("native host stopped before frame response") from row
        protocol_row(row=row, request_id=request_id)

    def render(self, *, request_id: str, timestamp: float, input_path: Path,
               output_path: Path, parameters: str) -> None:
        self.process.stdin.write("\t".join([
            "render", request_id, str(timestamp), str(input_path), str(output_path), parameters,
        ]) + "\n")
        self.process.stdin.flush()
        self.receive(request_id=request_id)

    def finish(self) -> None:
        self.process.stdin.write("exit\n")
        self.process.stdin.flush()
        self.process.stdin.close()
        result = self.process.wait(timeout=30)
        self.thread.join(timeout=5)
        if self.thread.is_alive() or result != 0 or self.rows.get(timeout=5) is not None:
            raise RuntimeError("native host did not exit cleanly")

    def close(self) -> None:
        if self.process.poll() is None:
            self.process.kill()
            self.process.wait(timeout=10)
        self.thread.join(timeout=5)
        if self.process.stdin is not None and not self.process.stdin.closed:
            self.process.stdin.close()
        self.process.stdout.close()


def probe_sources(*, completion: str) -> dict[str, str]:
    sources = consumer.source_snapshot(original=True)
    if completion != "none":
        bridge = Path(__file__).with_name("face_gpu_completion_bridge.mm")
        sources[f"local-model-pytorch/{bridge.name}"] = digest(data=bridge.read_bytes())
    sources[f"local-model-pytorch/{Path(__file__).name}"] = digest(
        data=Path(__file__).read_bytes())
    return sources


def build_host(*, output: Path, completion: str) -> None:
    if completion == "none":
        consumer.compile_host(output=output, original=True)
        return
    bridge = Path(__file__).with_name("face_gpu_completion_bridge.mm")
    sources = [bridge, *(path for path in consumer.source_files(original=True)
                         if path.name not in ("filter-host-main.mm", "filter-probe.mm"))]
    subprocess.run([
        "xcrun", "clang++", "-std=c++20", "-fobjc-arc", "-g", "-O1",
        "-Wall", "-Wextra", "-Werror", "-Wno-deprecated-declarations",
        *map(str, sources), "-framework", "AppKit", "-framework", "CoreVideo",
        "-framework", "IOSurface", "-framework", "OpenGL", "-o", str(output),
    ], check=True, timeout=180)


def save_failure(*, out: Path, index: int, pixels: bytes, reference: bytes,
                 width: int, height: int) -> None:
    import numpy as np
    from PIL import Image

    actual = np.frombuffer(pixels, dtype=np.uint8).reshape(height, width, 4)
    expected = np.frombuffer(reference, dtype=np.uint8).reshape(height, width, 4)
    gray = np.clip(np.abs(actual.astype(np.int16) - expected.astype(np.int16))
                   .max(axis=2) * 8, 0, 255).astype(np.uint8)
    Image.fromarray(actual).save(out / f"failure-{index:04d}.png")
    Image.fromarray(gray).save(out / f"failure-{index:04d}-diff-gain8.png")


def run(*, args: argparse.Namespace) -> dict:
    validate_counts(frames=args.frames, warmup=args.warmup)
    from PIL import Image
    import espresso_oracle
    from face_render_injection_inventory import LIBRARY_SHA256, UUID

    if args.completion not in ("none", "observe", "wait"):
        raise ValueError("unsupported completion mode")
    runtime = consumer.protocol_path(path=args.runtime.resolve())
    package = consumer.protocol_path(path=args.package.resolve())
    out = consumer.protocol_path(path=espresso_oracle.private_path(path=args.out))
    if out.exists() or not package.is_dir():
        raise ValueError("output must be fresh and package must exist")
    consumer.verify_library(runtime=runtime)
    parameters = consumer.parameters_json(text=args.parameters)
    if args.image.stat().st_size > 128 * 1024**2:
        raise ValueError("source image exceeds byte limit")
    image_bytes = args.image.read_bytes()
    image_hash = digest(data=image_bytes)
    with Image.open(io.BytesIO(image_bytes)) as image:
        width, height = image.size
        if not 1 <= width <= 4096 or not 1 <= height <= 4096:
            raise ValueError("source image exceeds dimension limit")
        pixels = image.convert("RGBA").tobytes()
    reference_path = espresso_oracle.private_path(path=args.reference)
    if reference_path.stat().st_size != len(pixels):
        raise ValueError("reference RGBA byte count mismatch")
    reference = reference_path.read_bytes()
    if args.expect_change and reference == pixels:
        raise ValueError("nonzero-effect reference must differ from source")
    sources = probe_sources(completion=args.completion)
    out.mkdir(parents=True)
    (out / "input.rgba").write_bytes(pixels)
    Image.frombytes("RGBA", (width, height), reference).save(out / "reference.png")
    build_host(output=out / "host", completion=args.completion)
    if sources != probe_sources(completion=args.completion):
        raise RuntimeError("stability probe sources changed during compilation")
    environment = consumer.probe_environment(runtime=runtime, out=out, width=width, height=height,
                                             mode="original", eye_shift=0, has_replay=False)
    environment.pop("QCUT_WAIT_ENGINE_RENDERER", None)
    environment.pop("MTL_DEBUG_LAYER", None)
    environment.pop("MTL_SHADER_VALIDATION", None)
    if args.completion == "wait":
        environment["QCUT_WAIT_ENGINE_RENDERER"] = "1"
    report = {
        "passed": False, "completion": args.completion, "frames_requested": args.frames,
        "warmup_requests": args.warmup, "advance_time": args.advance_time,
        "runtime_uuid": UUID, "runtime_sha256": LIBRARY_SHA256,
        "graphics_uuid": consumer.GRAPHICS_UUID, "graphics_sha256": consumer.GRAPHICS_SHA256,
        "source_sha256": sources, "host_sha256": digest(data=(out / "host").read_bytes()),
        "image_sha256": image_hash, "input_rgba_sha256": digest(data=pixels),
        "reference_path": str(reference_path), "reference_sha256": digest(data=reference),
        "parameters": json.loads(parameters), "frames": [], "failures": [],
        "native_analysis_bypassed": False,
    }
    host = NativeHost(command=[str(out / "host"), str(runtime), str(runtime / "Models"),
                               str(package)], environment=environment, log=out / "host.log")
    try:
        host.receive(request_id=None)
        for index in range(args.warmup):
            host.render(request_id=f"warmup-{index}", timestamp=0,
                        input_path=out / "input.rgba", output_path=out / "frame.rgba",
                        parameters=parameters)
        for index in range(args.frames):
            started = time.monotonic()
            timestamp = index / 30 if args.advance_time else 0
            host.render(request_id=f"frame-{index}", timestamp=timestamp,
                        input_path=out / "input.rgba", output_path=out / "frame.rgba",
                        parameters=parameters)
            if (out / "frame.rgba").stat().st_size != len(pixels):
                raise RuntimeError("native frame size mismatch")
            actual = (out / "frame.rgba").read_bytes()
            metrics = frame_metrics(actual=actual, reference=reference, width=width, height=height)
            metrics.update(index=index, timestamp=timestamp,
                           elapsed_ms=round((time.monotonic() - started) * 1000, 3))
            report["frames"].append(metrics)
            if not metrics["equal"]:
                report["failures"].append(index)
                if len(report["failures"]) <= 16:
                    save_failure(out=out, index=index, pixels=actual, reference=reference,
                                 width=width, height=height)
        host.finish()
        consumer.verify_library(runtime=runtime)
        if sources != probe_sources(completion=args.completion):
            raise RuntimeError("stability probe sources changed during execution")
        report["passed"] = not report["failures"]
    except Exception as error:
        report["error"] = f"{type(error).__name__}: {error}"
        raise
    finally:
        host.close()
        (out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    if not report["passed"]:
        raise RuntimeError(f"{len(report['failures'])}/{args.frames} frames differ from reference")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ("runtime", "package", "image", "reference", "out"):
        parser.add_argument(f"--{field}", type=Path, required=True)
    parser.add_argument("--parameters", required=True)
    parser.add_argument("--frames", type=int, default=128)
    parser.add_argument("--warmup", type=int, default=consumer.WARMUP_COUNT)
    parser.add_argument("--completion", choices=("none", "observe", "wait"), default="none")
    parser.add_argument("--advance-time", action="store_true")
    parser.add_argument("--expect-change", action="store_true")
    report = run(args=parser.parse_args())
    print(json.dumps({key: value for key, value in report.items() if key != "frames"}, indent=2))


if __name__ == "__main__":
    main()
