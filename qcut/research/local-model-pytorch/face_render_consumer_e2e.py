"""Private native controls and visual evidence for the landmark-consumption probe."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import struct
import subprocess

import numpy as np

import espresso_oracle
import face_render_consumer_probe as probe


def frame(*, directory: Path, index: int) -> np.ndarray:
    from PIL import Image
    with Image.open(directory / f"frame-{index}.png") as image:
        return np.asarray(image.convert("RGBA"))


def difference(*, original: np.ndarray, changed: np.ndarray) -> dict:
    if original.shape != changed.shape or original.ndim != 3 or original.shape[2] != 4:
        raise ValueError("comparison requires equal RGBA dimensions")
    delta = np.abs(original.astype(np.int16) - changed.astype(np.int16))
    mask = np.max(delta, axis=2) > 0
    ys, xs = np.nonzero(mask)
    return {
        "changed_pixels": int(mask.sum()), "max_channel_error": int(delta.max()),
        "mean_channel_error": float(delta.mean()),
        "bbox": None if not len(xs) else [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
    }


def frame_differences(*, baseline: Path, candidate: Path) -> list[dict]:
    return [difference(original=frame(directory=baseline, index=index),
                       changed=frame(directory=candidate, index=index))
            for index in range(probe.FRAME_COUNT)]


def equal_frames(*, baseline: Path, candidate: Path) -> list[dict]:
    differences = frame_differences(baseline=baseline, candidate=candidate)
    if any(item["changed_pixels"] for item in differences):
        raise RuntimeError(f"control pixels changed: {candidate.name}: {differences}")
    return differences


def control_failures(*, controls: dict[str, list[dict]]) -> list[str]:
    return [f"control pixels changed: {name}" for name, items in controls.items()
            if any(item["changed_pixels"] for item in items)]


def comparison_sheet(*, original: Path, baseline: Path, replay: Path, plus: Path,
                     minus: Path, output: Path, passed: bool) -> None:
    from PIL import Image, ImageDraw
    base = frame(directory=baseline, index=3)
    positive = frame(directory=plus, index=3)
    negative = frame(directory=minus, index=3)
    diff_positive = np.clip(np.max(np.abs(positive[:, :, :3].astype(np.int16) - base[:, :, :3]), axis=2) * 8,
                            0, 255).astype(np.uint8)
    diff_negative = np.clip(np.max(np.abs(negative[:, :, :3].astype(np.int16) - base[:, :, :3]), axis=2) * 8,
                            0, 255).astype(np.uint8)
    with Image.open(original) as image:
        untouched = image.convert("RGB")
    tiles = [
        ("Original image", untouched), ("Native beauty", Image.fromarray(base[:, :, :3])),
        ("External replay: same points", Image.fromarray(frame(directory=replay, index=3)[:, :, :3])),
        ("External replay: eye X +0.01", Image.fromarray(positive[:, :, :3])),
        ("+0.01 minus native: gain 8", Image.fromarray(diff_positive).convert("RGB")),
        ("-0.01 minus native: gain 8", Image.fromarray(diff_negative).convert("RGB")),
    ]
    width, height = 480, 360
    sheet = Image.new("RGB", (width * 3, (height + 32) * 2 + 32), "#ffffff")
    draw = ImageDraw.Draw(sheet)
    draw.text((8, 10), "Frame 3 | " + ("All controls passed" if passed else
              "DIAGNOSTIC ONLY: controls failed, see report.json"), fill="#111111")
    for index, (label, image) in enumerate(tiles):
        x, y = index % 3 * width, index // 3 * (height + 32) + 32
        draw.text((x + 8, y + 10), label, fill="#111111")
        sheet.paste(image.resize((width, height), Image.Resampling.LANCZOS), (x, y + 32))
    sheet.save(output)


def native_rejects(*, root: Path, host: Path, runtime: Path, package: Path,
                   width: int, height: int, payload: bytes, label: str,
                   requests: str = "exit\n", expected_error: str | None = None) -> None:
    directory = root / label
    directory.mkdir()
    (directory / "replay.bin").write_bytes(payload)
    environment = probe.probe_environment(runtime=runtime, out=directory, width=width, height=height,
                                          mode="trace", eye_shift=0, has_replay=True)
    result = subprocess.run([str(host), str(runtime), str(runtime / "Models"), str(package)],
                            input=requests, text=True, env=environment, capture_output=True, timeout=30)
    (directory / "host.log").write_text(result.stdout + result.stderr)
    if result.returncode < 1 or "[research-error]" not in result.stderr:
        raise RuntimeError(f"native payload guard did not reject {label}")
    if expected_error is not None and expected_error not in result.stdout + result.stderr:
        raise RuntimeError(f"native payload guard reported the wrong error: {label}")


def run(*, args: argparse.Namespace) -> dict:
    from PIL import Image
    root = espresso_oracle.private_path(path=args.out)
    if root.exists() and any(root.iterdir()):
        raise ValueError("E2E directory must be empty")
    root.mkdir(parents=True, exist_ok=True)
    directories = {}
    common = {"runtime": args.runtime, "package": args.package, "image": args.image,
              "parameters": '{"face_adjust_eye":[{"id":-1,"intensity":1.0}]}'}
    jobs = (
        ("original", "original", 0, None), ("original-repeat", "original", 0, None),
        ("read", "read", 0, None), ("trace", "trace", 0, None),
        ("trace-repeat", "trace", 0, None), ("same-replay", "trace", 0, "trace"),
        ("plus-replay", "trace", 0.01, "trace"), ("minus-replay", "trace", -0.01, "trace"),
    )
    for name, mode, shift, source in jobs:
        print(f"native case: {name}", flush=True)
        directory = root / name
        probe.run(args=argparse.Namespace(**common, out=directory, mode=mode, eye_shift=shift,
                                        replay=None if source is None else directories[source] / "replay.json"))
        directories[name] = directory
    controls = {name: frame_differences(baseline=directories["original"], candidate=directories[name])
                for name in ("original-repeat", "read", "trace", "trace-repeat", "same-replay")}
    reference_frame = frame(directory=directories["original"], index=3)
    controls["original-stability"] = [difference(original=reference_frame,
        changed=frame(directory=directories["original"], index=index)) for index in range(probe.FRAME_COUNT)]
    failures = control_failures(controls=controls)
    shifts = {}
    point_record = json.loads((directories["trace"] / "replay.json").read_text())
    eyes = np.asarray(point_record["frames"][-1]["faces"][0]["points"])[52:64]
    width, height = point_record["width"], point_record["height"]
    eye_roi = [max(0, int((eyes[:, 0].min() - 0.07) * width)),
               max(0, int((1 - eyes[:, 1].max() - 0.10) * height)),
               min(width - 1, int((eyes[:, 0].max() + 0.07) * width)),
               min(height - 1, int((1 - eyes[:, 1].min() + 0.10) * height))]
    for name in ("plus-replay", "minus-replay"):
        shifts[name] = [difference(original=frame(directory=directories["original"], index=index),
                                   changed=frame(directory=directories[name], index=index))
                        for index in range(probe.FRAME_COUNT)]
        if not all(item["changed_pixels"] > 0 for item in shifts[name]):
            failures.append(f"external shift had no pixel effect: {name}")
        if any(item["bbox"] is not None and (item["bbox"][0] < eye_roi[0] or
               item["bbox"][1] < eye_roi[1] or item["bbox"][2] > eye_roi[2] or
               item["bbox"][3] > eye_roi[3]) for item in shifts[name]):
            failures.append(f"external shift changed pixels outside the eye ROI: {name}")
    blank = root / "no-face.png"
    Image.new("RGB", (640, 480), "#808080").save(blank)
    blank_args = {**common, "image": blank}
    for name, mode in (("no-face-original", "original"), ("no-face-trace", "trace")):
        probe.run(args=argparse.Namespace(**blank_args, out=root / name, mode=mode, eye_shift=0, replay=None))
    equal_frames(baseline=root / "no-face-original", candidate=root / "no-face-trace")
    no_face = json.loads((root / "no-face-trace/replay.json").read_text())
    if any(item["faces"] for item in no_face["frames"]):
        raise RuntimeError("blank fixture produced a face")
    probe.run(args=argparse.Namespace(**{**common, "parameters":
                                    '{"face_adjust_eye":[{"id":-1,"intensity":0.0}]}'}, out=root / "effect-off",
                                    mode="trace", eye_shift=0.01, replay=directories["trace"] / "replay.json"))
    with Image.open(args.image) as image:
        original = np.asarray(image.convert("RGBA"))
    if any(difference(original=original, changed=frame(directory=root / "effect-off", index=index))["changed_pixels"]
           for index in range(probe.FRAME_COUNT)):
        raise RuntimeError("point mutation changed pixels with effect disabled")
    summary = json.loads((directories["same-replay"] / "summary.json").read_text())
    payload = (directories["same-replay"] / "replay.bin").read_bytes()
    corruptions = {"truncated": payload[:12], "trailing": payload + b"x",
                   "bad-magic": b"BADMAGIC" + payload[8:],
                   "bad-time": payload[:20] + struct.pack("<q", 100_001) + payload[28:],
                   "bad-dimensions": payload[:8] + struct.pack("<I", summary["width"] + 1) + payload[12:],
                   "too-many-faces": payload[:28] + struct.pack("<I", 11) + payload[32:],
                   "negative-track": payload[:32] + struct.pack("<i", -1) + payload[36:],
                   "out-of-range": payload[:36] + struct.pack("<f", 1.1) + payload[40:],
                   "nan-point": payload[:36] + struct.pack("<f", float("nan")) + payload[40:]}
    for name, data in corruptions.items():
        native_rejects(root=root, host=directories["trace"] / "host", runtime=args.runtime.resolve(),
                       package=args.package.resolve(), width=summary["width"], height=summary["height"],
                       payload=data, label=f"reject-{name}")
    native_rejects(root=root, host=directories["trace"] / "host", runtime=args.runtime.resolve(),
                   package=args.package.resolve(), width=summary["width"], height=summary["height"],
                   payload=payload, label="reject-unconsumed", expected_error="unconsumed replay frames")
    mismatch = payload[:32] + struct.pack("<i", 1000) + payload[36:]
    guard_request = "\t".join(["render", "guard", "0", str(directories["trace"] / "input.rgba"),
                                str(root / "guard.rgba"), common["parameters"]]) + "\nexit\n"
    native_rejects(root=root, host=directories["trace"] / "host", runtime=args.runtime.resolve(),
                   package=args.package.resolve(), width=summary["width"], height=summary["height"],
                   payload=mismatch, label="reject-track-mismatch", requests=guard_request,
                   expected_error="replay track id mismatch")
    comparison_sheet(original=args.image, baseline=directories["original"], replay=directories["same-replay"],
                     plus=directories["plus-replay"], minus=directories["minus-replay"],
                     output=root / "comparison.png", passed=not failures)
    report = {"passed": not failures, "failures": failures,
              "controls": controls, "shifts": shifts, "eye_roi": eye_roi,
              "native_negative_cases": [*corruptions, "unconsumed", "track-mismatch"],
              "same_value_replay_equal_frames": [item["changed_pixels"] == 0
                                                for item in controls["same-replay"]],
              "no_face_control_equal": True, "effect_off_equal": True,
              "external_landmark_consumption_verified": not failures,
              "external_injection_verified": False, "native_analysis_bypassed": False}
    (root / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    if failures:
        raise RuntimeError(f"native controls failed; evidence preserved at {root / 'report.json'}")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("runtime", "package", "image", "out"):
        parser.add_argument("--" + name, type=Path, required=True)
    print(json.dumps(run(args=parser.parse_args()), indent=2))


if __name__ == "__main__":
    main()
