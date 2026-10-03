"""Verify owned clones affect actual native beauty pixels, without analysis bypass."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import face_owned_result_probe as owned
import face_render_consumer_probe as consumer
from face_render_stability_probe import NativeHost, digest, frame_metrics, save_failure


def validate_roi(*, roi: list[int], width: int, height: int) -> None:
    if (len(roi) != 4 or any(type(value) is not int for value in roi) or
            not 0 <= roi[0] < roi[2] <= width or not 0 <= roi[1] < roi[3] <= height):
        raise ValueError("four bounded ROI coordinates required")


def validate_shift(*, metrics: dict, roi: list[int]) -> None:
    bbox = metrics.get("bbox")
    if (metrics.get("equal") is not False or metrics.get("changed_pixels", 0) <= 0 or
            not isinstance(bbox, list) or len(bbox) != 4 or
            not roi[0] <= bbox[0] < bbox[2] <= roi[2] or
            not roi[1] <= bbox[1] < bbox[3] <= roi[3]):
        raise RuntimeError("owned point perturbation did not stay inside the eye ROI")


def validate_conversions(*, events: list[dict], shift: float) -> int:
    converted = [event for event in events if event.get("event") == "owned_face_conversion"]
    restored = [event for event in events if event.get("event") == "owned_face_restored"]
    if not converted or any(
            event.get("eye_shift") != shift or event.get("faces", 0) < 1 or
            event.get("raw_clone_verified") is not True or
            event.get("original_restored") is not False or
            event.get("native_analysis_bypassed") is not False for event in converted):
        raise RuntimeError("missing owned-conversion perturbation evidence")
    if len(restored) != len(converted) or any(
            event.get("original_restored") is not True or event.get("gpu_complete") is not True
            for event in restored):
        raise RuntimeError("owned results were not restored after GPU completion")
    return len(converted)


def run(*, args: argparse.Namespace) -> dict:
    from PIL import Image, ImageDraw
    import espresso_oracle

    out = consumer.protocol_path(path=espresso_oracle.private_path(path=args.out))
    if out.exists():
        raise ValueError("fresh private output required")
    out.mkdir(parents=True)
    source_digest = digest(data=Path(__file__).read_bytes())
    report = {"passed": False, "native_analysis_bypassed": False,
              "owned_result_rendered": False, "cases": {}, "failures": []}
    try:
        control = owned.run(args=argparse.Namespace(
            runtime=args.runtime, package=args.package, image=args.image,
            out=out / "same-value", parameters=args.parameters, frames=4, warmup=6,
            require_face=True, expect_change=True, binding=True))
        width, height = control["width"], control["height"]
        validate_roi(roi=args.eye_roi, width=width, height=height)
        report.update(eye_roi=args.eye_roi, width=width, height=height,
                      source_sha256=control["source_sha256"],
                      e2e_sha256=source_digest, image_sha256=control["image_sha256"])
        report["cases"]["same-value"] = {
            "passed": control["passed"], "frames": control["frames"],
            "owned_face_conversions": control["owned_face_conversions"]}
        runtime = args.runtime.resolve(strict=True)
        package = args.package.resolve(strict=True)
        host_path = out / "same-value/clone-audit/host"
        binary_digest = digest(data=host_path.read_bytes())
        parameters = consumer.parameters_json(text=args.parameters)
        for name, shift in (("plus", 0.01), ("minus", -0.01)):
            directory = out / name
            directory.mkdir()
            environment = consumer.probe_environment(
                runtime=runtime, out=directory, width=width, height=height,
                mode="trace", eye_shift=0, has_replay=False)
            environment["QCUT_FACE_BIND_EYE_SHIFT"] = str(shift)
            host = NativeHost(command=[str(host_path), str(runtime), str(runtime / "Models"),
                                       str(package)], environment=environment, log=directory / "host.log")
            frames = []
            try:
                host.receive(request_id=None)
                for index in range(6):
                    host.render(request_id=f"warmup-{index}", timestamp=0,
                                input_path=out / "same-value/input.rgba",
                                output_path=directory / "warmup.rgba", parameters=parameters)
                for index in range(4):
                    output = directory / f"frame-{index}.rgba"
                    host.render(request_id=f"frame-{index}", timestamp=index / 30,
                                input_path=out / "same-value/input.rgba", output_path=output,
                                parameters=parameters)
                    actual = output.read_bytes()
                    reference = (out / f"same-value/original/frame-{index}.rgba").read_bytes()
                    metrics = frame_metrics(actual=actual, reference=reference,
                                            width=width, height=height)
                    frames.append(metrics)
                    validate_shift(metrics=metrics, roi=args.eye_roi)
                    if index == 0:
                        Image.frombytes("RGBA", (width, height), actual).save(directory / "output.png")
                        save_failure(out=directory, index=0, pixels=actual, reference=reference,
                                     width=width, height=height)
                host.finish()
            finally:
                host.close()
            log = (directory / "host.log").read_text()
            if "[research-error]" in log:
                raise RuntimeError("owned conversion reported an error")
            events = [json.loads(line) for line in (directory / "records.jsonl").read_text().splitlines()]
            conversions = validate_conversions(events=events, shift=shift)
            if len({frame["sha256"] for frame in frames}) != 1:
                raise RuntimeError("repeated owned-perturbation frames are unstable")
            report["cases"][name] = {"passed": True, "shift": shift,
                                     "frames": frames, "owned_face_conversions": conversions}
        if report["cases"]["plus"]["frames"][0]["sha256"] == report["cases"]["minus"]["frames"][0]["sha256"]:
            raise RuntimeError("opposite perturbations produced identical frames")
        consumer.verify_library(runtime=runtime)
        if (owned.probe_sources() != control["source_sha256"] or
                digest(data=Path(__file__).read_bytes()) != source_digest or
                digest(data=host_path.read_bytes()) != binary_digest or
                digest(data=args.image.read_bytes()) != control["image_sha256"]):
            raise RuntimeError("owned binding provenance changed during execution")
        tiles = [
            (out / "same-value/original.png", "Native control"),
            (out / "plus/output.png", "Owned clone: eye X +0.01"),
            (out / "minus/output.png", "Owned clone: eye X -0.01"),
            (out / "same-value/failure-0000-diff-gain8.png", "Native vs same clone: gain 8"),
            (out / "plus/failure-0000-diff-gain8.png", "Plus vs native: gain 8"),
            (out / "minus/failure-0000-diff-gain8.png", "Minus vs native: gain 8"),
        ]
        tile_height = round(480 * height / width)
        sheet = Image.new("RGB", (1440, (tile_height + 28) * 2), "white")
        draw = ImageDraw.Draw(sheet)
        for index, (path, title) in enumerate(tiles):
            x, y = (index % 3) * 480, (index // 3) * (tile_height + 28)
            with Image.open(path) as image:
                sheet.paste(image.convert("RGB").resize((480, tile_height)), (x, y + 28))
            draw.text((x + 8, y + 8), title, fill="black")
        sheet.save(out / "comparison.png")
        report.update(passed=True, owned_result_rendered=True,
                      host_sha256=binary_digest, native_analysis_bypassed=False)
    except Exception as error:
        report["failures"].append(f"{type(error).__name__}: {error}")
        raise
    finally:
        (out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("runtime", "package", "image", "out"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    parser.add_argument("--parameters", required=True)
    parser.add_argument("--eye-roi", type=int, nargs=4, required=True)
    result = run(args=parser.parse_args())
    print(json.dumps({"passed": result["passed"], "owned_result_rendered": True,
                      "native_analysis_bypassed": False, "cases": list(result["cases"])}, indent=2))


if __name__ == "__main__":
    main()
