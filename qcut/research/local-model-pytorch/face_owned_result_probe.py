"""Compare native frames with an isolated FaceBuffer clone lifetime audit."""

from __future__ import annotations

import argparse
import io
import json
import subprocess
from pathlib import Path

import face_render_consumer_probe as consumer
from face_render_stability_probe import NativeHost, digest, frame_metrics, save_failure


def validate_counts(*, frames: int, warmup: int) -> None:
    if type(frames) is not int or not 1 <= frames <= 24:
        raise ValueError("ownership probe needs 1-24 frames")
    if type(warmup) is not int or not 0 <= warmup <= 6:
        raise ValueError("ownership probe needs 0-6 warmups")


def probe_sources() -> dict[str, str]:
    sources = consumer.source_snapshot(original=False)
    for name in ("face_owned_result_bridge.mm", "face_owned_binding_bridge.mm", "face_owned_result_probe.py",
                 "face_render_stability_probe.py"):
        path = Path(__file__).with_name(name)
        sources[f"local-model-pytorch/{name}"] = digest(data=path.read_bytes())
    sources.update(consumer.source_snapshot(original=True))
    return sources


def compile_owned(*, output: Path, binding: bool = False) -> None:
    bridge = Path(__file__).with_name(
        "face_owned_binding_bridge.mm" if binding else "face_owned_result_bridge.mm")
    sources = [bridge, *(path for path in consumer.source_files(original=True)
                         if path.name not in ("filter-host-main.mm", "filter-probe.mm"))]
    subprocess.run([
        "xcrun", "clang++", "-std=c++20", "-fobjc-arc", "-g", "-O1",
        "-Wall", "-Wextra", "-Werror", "-Wno-deprecated-declarations",
        *map(str, sources), "-framework", "AppKit", "-framework", "CoreVideo",
        "-framework", "IOSurface", "-framework", "OpenGL", "-o", str(output),
    ], check=True, timeout=180)


def validate_audits(*, events: list[dict], require_face: bool,
                    require_live_consumers: bool = False, consumer_event: str = "live_owned_conversion") -> dict:
    if consumer_event not in ("live_owned_conversion", "live_makeup_publication") or (
            consumer_event == "live_makeup_publication" and not require_live_consumers):
        raise ValueError("unsupported clone audit association")
    audits = [event for event in events if event.get("event") == "face_clone_audit"]
    updates = [event for event in events if event.get("event") == "algorithm_update"]
    consumers = [event for event in events if event.get("event") == consumer_event]
    expected = consumers if require_live_consumers else updates
    if not audits or len(audits) != len(expected):
        raise RuntimeError("every face consumer needs an ownership audit" if require_live_consumers else
                           "every native face update needs an ownership audit")
    primary_faces = 0
    for audit in audits:
        counts = audit.get("vector_counts")
        if (not isinstance(counts, list) or len(counts) != 6 or
                any(type(value) is not int or not 0 <= value <= 10 for value in counts) or
                any(audit.get(key) is not True for key in (
                    "distinct_buffer", "primary_metadata_equal", "primary_points_isolated")) or
                type(audit.get("initial_refcount")) is not int or
                audit.get("initial_refcount") != 0 or
                type(audit.get("owned_refcount")) is not int or
                audit.get("owned_refcount") != 1 or
                type(audit.get("source_refcount")) is not int or
                audit.get("source_refcount") < 1 or
                audit.get("native_analysis_bypassed") is not False):
            raise RuntimeError("clone ownership evidence is incomplete")
        primary_faces += counts[0]
    if require_face and primary_faces == 0:
        raise RuntimeError("no primary face exercised the deep-copy contract")
    return {"audited_clones": len(audits), "primary_faces_audited": primary_faces,
            "native_update_calls": len(updates), "native_analysis_bypassed": False,
            "audit_basis": ("live-makeup-publication" if consumer_event == "live_makeup_publication" else
                            "live-owned-conversion") if require_live_consumers else "algorithm-update"}


def run(*, args: argparse.Namespace) -> dict:
    validate_counts(frames=args.frames, warmup=args.warmup)
    from PIL import Image
    import espresso_oracle

    runtime = consumer.protocol_path(path=args.runtime.resolve(strict=True))
    package = consumer.protocol_path(path=args.package.resolve(strict=True))
    out = consumer.protocol_path(path=espresso_oracle.private_path(path=args.out))
    if out.exists() or not package.is_dir():
        raise ValueError("fresh private output and existing effect package required")
    if args.image.stat().st_size > 128 * 1024**2:
        raise ValueError("image exceeds byte limit")
    source = args.image.read_bytes()
    with Image.open(io.BytesIO(source)) as image:
        width, height = image.size
        if not 1 <= width <= 4096 or not 1 <= height <= 4096:
            raise ValueError("image exceeds dimension limit")
        pixels = image.convert("RGBA").tobytes()
    parameters = consumer.parameters_json(text=args.parameters)
    consumer.verify_library(runtime=runtime)
    sources = probe_sources()
    out.mkdir(parents=True)
    (out / "input.rgba").write_bytes(pixels)
    report = {"passed": False, "mode": "clone-audit", "frames": [], "failures": [],
              "image_sha256": digest(data=source), "input_rgba_sha256": digest(data=pixels),
              "source_sha256": sources, "parameters": json.loads(parameters),
              "native_analysis_bypassed": False, "owned_result_rendered": False,
              "width": width, "height": height}
    try:
        for phase in ("original", "clone-audit"):
            directory = out / phase
            directory.mkdir()
            if phase == "original":
                consumer.compile_host(output=directory / "host", original=True)
            else:
                compile_owned(output=directory / "host", binding=args.binding)
            if probe_sources() != sources:
                raise RuntimeError("ownership sources changed during compilation")
            environment = consumer.probe_environment(
                runtime=runtime, out=directory, width=width, height=height,
                mode="original" if phase == "original" else "trace",
                eye_shift=0, has_replay=False)
            environment.pop("QCUT_FACE_BIND_EYE_SHIFT", None)
            host = NativeHost(command=[str(directory / "host"), str(runtime),
                                       str(runtime / "Models"), str(package)],
                              environment=environment, log=directory / "host.log")
            try:
                host.receive(request_id=None)
                for index in range(args.warmup):
                    host.render(request_id=f"warmup-{index}", timestamp=0,
                                input_path=out / "input.rgba", output_path=directory / "warmup.rgba",
                                parameters=parameters)
                for index in range(args.frames):
                    output = directory / f"frame-{index}.rgba"
                    host.render(request_id=f"frame-{index}", timestamp=index / 30,
                                input_path=out / "input.rgba", output_path=output,
                                parameters=parameters)
                    actual = output.read_bytes()
                    if len(actual) != len(pixels):
                        raise RuntimeError("native frame size mismatch")
                    if phase == "original":
                        if args.expect_change and actual == pixels:
                            raise RuntimeError("nonzero-effect reference is unchanged")
                        continue
                    reference = (out / "original" / output.name).read_bytes()
                    metrics = frame_metrics(actual=actual, reference=reference,
                                            width=width, height=height)
                    metrics.update(index=index, timestamp=index / 30)
                    report["frames"].append(metrics)
                    if not metrics["equal"]:
                        report["failures"].append(index)
                        if len(report["failures"]) <= 16:
                            save_failure(out=out, index=index, pixels=actual, reference=reference,
                                         width=width, height=height)
                host.finish()
            finally:
                host.close()
            if "[research-error]" in (directory / "host.log").read_text():
                raise RuntimeError("ownership callback reported an error")
        events = [json.loads(line) for line in
                  (out / "clone-audit" / "records.jsonl").read_text().splitlines()]
        report.update(validate_audits(events=events, require_face=args.require_face))
        if args.binding:
            conversions = [event for event in events if event.get("event") == "owned_face_conversion"]
            restorations = [event for event in events if event.get("event") == "owned_face_restored"]
            if (not conversions or len(conversions) != len(restorations) or
                    any(event.get("raw_clone_verified") is not True for event in conversions) or
                    any(event.get("original_restored") is not True or
                        event.get("gpu_complete") is not True for event in restorations)):
                raise RuntimeError("owned clone was not consumed by FaceAdapter")
            report.update(owned_result_rendered=True, owned_face_conversions=len(conversions),
                          mode="owned-conversion")
        consumer.verify_library(runtime=runtime)
        if probe_sources() != sources or args.image.read_bytes() != source:
            raise RuntimeError("probe source or input changed during execution")
        for phase in ("original", "clone-audit"):
            actual = (out / phase / "frame-0.rgba").read_bytes()
            Image.frombytes("RGBA", (width, height), actual).save(out / f"{phase}.png")
        save_failure(out=out, index=0, pixels=(out / "clone-audit/frame-0.rgba").read_bytes(),
                     reference=(out / "original/frame-0.rgba").read_bytes(),
                     width=width, height=height)
        report["passed"] = not report["failures"]
        if not report["passed"]:
            raise RuntimeError("ownership audit altered native output")
    except Exception as error:
        report["error"] = f"{type(error).__name__}: {error}"
        raise
    finally:
        (out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("runtime", "package", "image", "out"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    parser.add_argument("--parameters", required=True)
    parser.add_argument("--frames", type=int, default=16)
    parser.add_argument("--warmup", type=int, default=6)
    parser.add_argument("--require-face", action="store_true")
    parser.add_argument("--expect-change", action="store_true")
    parser.add_argument("--binding", action="store_true")
    result = run(args=parser.parse_args())
    print(json.dumps({key: value for key, value in result.items() if key != "frames"}, indent=2))


if __name__ == "__main__":
    main()
