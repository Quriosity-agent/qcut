"""Diagnose full editor RGBA -> algorithm RGBA without loading a vendor library.

The native captures are immutable comparison oracles. A differing candidate is
never returned as a neural input or registered as a live editor backend.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess

import numpy as np
from PIL import Image, ImageDraw

from face_alignment_replay import LockedFiles
from face_diagnostic_report import finish
from face_host_sampling_inputs import algorithm_frame
import face_preprocess_chain_capture as capture
from face_preprocess_chain_replay import sources
import face_render_sequence_probe as sequence
from face_render_stability_probe import digest, frame_metrics

MODES = {0: "float-texture-unorm", 1: "float-buffer-truncate",
         2: "float-buffer-round", 3: "half-texture-unorm", 4: "half-buffer-truncate"}
SOURCE_NAMES = ("face_full_frame_probe.py", "face_full_frame_metal.mm", "face_diagnostic_report.py")
DIMENSIONS = (1448, 1086)
ALGORITHM_SIZE = (640, 480)


def bilinear_control(*, frame, size):
    if (type(frame) is not np.ndarray or frame.dtype != np.uint8 or frame.ndim != 3 or
            frame.shape[2] != 4 or not all(1 <= n <= 4096 for n in frame.shape[:2]) or
            frame.nbytes > 64 * 1024**2 or not isinstance(size, tuple) or len(size) != 2 or
            any(type(n) is not int or not 1 <= n <= 4096 for n in size) or
            size[0] * size[1] * 4 > 64 * 1024**2):
        raise ValueError("bounded RGBA frame and typed target dimensions required")
    height, width = frame.shape[:2]
    x = (np.arange(size[0]) + .5) * width / size[0] - .5
    y = (np.arange(size[1]) + .5) * height / size[1] - .5
    ix, iy = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64)
    wx, wy = (x - ix)[None, :, None], (y - iy)[:, None, None]
    x0, x1 = np.clip(ix, 0, width - 1), np.clip(ix + 1, 0, width - 1)
    y0, y1 = np.clip(iy, 0, height - 1), np.clip(iy + 1, 0, height - 1)
    top = frame[y0[:, None], x0] * (1 - wx) + frame[y0[:, None], x1] * wx
    bottom = frame[y1[:, None], x0] * (1 - wx) + frame[y1[:, None], x1] * wx
    return np.floor(top * (1 - wy) + bottom * wy + .5).astype(np.uint8)


def prediction_frame(*, index):
    if type(index) is not int or not 0 <= index < 26:
        raise ValueError("typed prediction index in the fixed 26-call profile required")
    return 0 if index < 12 else (index - 12) // 2


def execute(*, command):
    result = subprocess.run(command, capture_output=True, timeout=120, check=True)
    if len(result.stdout) + len(result.stderr) > sequence.LOG_LIMIT:
        raise ValueError("independent sampler log exceeds bound")
    return {"command": command, "stdout": result.stdout.decode("utf-8"),
            "stderr": result.stderr.decode("utf-8"), "returncode": result.returncode}


def visual(*, reference, candidate, path, label):
    delta = np.abs(candidate.astype(np.int16) - reference.astype(np.int16)).max(axis=2)
    gray = np.clip(delta * 8, 0, 255).astype(np.uint8)
    canvas = Image.new("RGB", (1920, 510), "white")
    draw = ImageDraw.Draw(canvas)
    for i, (name, value) in enumerate((("Native algorithm RGBA", reference), (label, candidate),
                                      ("Absolute grayscale x8", gray))):
        canvas.paste(Image.fromarray(value).convert("RGB"), (i * 640, 30))
        draw.text((i * 640 + 5, 8), name, fill="black")
    canvas.save(path)


def run(*, args):
    out, locked = sequence.fresh_output(path=args.out), LockedFiles()
    report = dict(profile="full-frame-algorithm-input-diagnostic-v1", passed=False, completed=False,
                  diagnostic_only=True, sampling_parity=False, captured_pixel_input_used=False,
                  native_library_loaded_by_sampler=False, arbitrary_frame_backend_connected=False,
                  product_parity_verified=False, cases=[], runs=[], failures=[])
    try:
        context = capture.load(root=args.capture.resolve(strict=True), locked=locked)
        if (len(context["frames"]) != 7 or len(context["snapshots"]) != 26 or
                len(context["evidence"]["algorithm_frames"]) != 26):
            raise ValueError("complete seven-frame 26-prediction profile required")
        for index, snapshot in enumerate(context["snapshots"]):
            if type(snapshot.get("index")) is not int or snapshot["index"] != index:
                raise ValueError("typed ordered prediction indices required")
            request = snapshot["request"]
            if (not isinstance(request, list) or any(type(value) is not int for value in request) or
                    request != [0, 640, 480, 2560, 0]):
                raise ValueError("fixed unrotated packed algorithm profile required")
        report.update(capture=str(context["root"]),
                      capture_sha256=locked.files[str(context["root"] / "report.json")],
                      source_sha256=sources(names=SOURCE_NAMES, locked=locked))
        binary = out / "sampler"
        report["runs"].append(execute(command=["xcrun", "clang++", "-std=c++17", "-O2",
            "-fobjc-arc", "-Wall", "-Wextra", "-Werror", "-framework", "Foundation",
            "-framework", "Metal", str(Path(__file__).with_name("face_full_frame_metal.mm")),
            "-o", str(binary)]))
        locked.read(path=binary, maximum=16 * 1024**2)
        candidates = {}
        for frame_index, frame in enumerate(context["frames"]):
            data = locked.read(path=frame["input"], maximum=DIMENSIONS[0] * DIMENSIONS[1] * 4)
            if len(data) != DIMENSIONS[0] * DIMENSIONS[1] * 4:
                raise ValueError("fixed full-frame RGBA byte count differs")
            pixels = np.frombuffer(data, np.uint8).reshape(DIMENSIONS[1], DIMENSIONS[0], 4)
            candidates[(frame_index, "cpu-bilinear-control")] = bilinear_control(frame=pixels, size=ALGORITHM_SIZE)
            for mode, name in MODES.items():
                path = out / f"frame-{frame_index:02d}-{name}.rgba"
                report["runs"].append(execute(command=[str(binary), str(frame["input"]), str(path),
                    *map(str, DIMENSIONS), *map(str, ALGORITHM_SIZE), str(mode)]))
                raw = locked.read(path=path, maximum=ALGORITHM_SIZE[0] * ALGORITHM_SIZE[1] * 4)
                if len(raw) != ALGORITHM_SIZE[0] * ALGORITHM_SIZE[1] * 4:
                    raise ValueError("independent sampler output byte count differs")
                candidates[(frame_index, name)] = np.frombuffer(raw, np.uint8).reshape(480, 640, 4)
        for snapshot, descriptor in zip(context["snapshots"], context["evidence"]["algorithm_frames"], strict=True):
            reference = algorithm_frame(root=context["root"], snapshot=snapshot, descriptor=descriptor, locked=locked)
            index = prediction_frame(index=snapshot["index"])
            checks = {}
            for name in ("cpu-bilinear-control", *MODES.values()):
                candidate = candidates[(index, name)]
                checks[name] = frame_metrics(reference=reference.tobytes(), actual=candidate.tobytes(), width=640, height=480)
                if snapshot["index"] in (12, 14, 16, 18, 20, 22, 24):
                    visual(reference=reference, candidate=candidate, path=out / f"frame-{index:02d}-{name}.png", label=name)
            report["cases"].append(dict(prediction=snapshot["index"], frame_index=index,
                input_rgba_sha256=locked.files[str(context["frames"][index]["input"])],
                reference_sha256=descriptor["sha256"], checks=checks))
        report["exact_modes"] = [name for name in MODES.values() if all(
            row["checks"][name]["equal"] for row in report["cases"])]
        report.update(completed=True, passed=True, sampling_parity=bool(report["exact_modes"]),
                      native_algorithm_rgba_required=not bool(report["exact_modes"]),
                      scope="fixed seven-frame profile; mode parity is not caller-route or arbitrary-frame proof")
    except Exception as error:
        report["failures"].append(f"{type(error).__name__}: {error}")
        raise
    finally:
        finish(out=out, report=report, locked=locked)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("capture", "out"):
        parser.add_argument(f"--{name}", required=True, type=Path)
    report = run(args=parser.parse_args())
    print(json.dumps({key: report[key] for key in ("completed", "sampling_parity", "exact_modes")}))


if __name__ == "__main__":
    main()
