#!/usr/bin/env python3
"""Verify exported Espresso networks on decoded video frames and temporal resets."""
import argparse
import json
import pathlib
import statistics
import subprocess
import time

import numpy as np
import torch

from espresso_archive import sha256
from espresso_torch import load_model
from native_oracle import align_batch_axis, predict_native
from verify import compare


def decode_frames(*, video, width, height, fps, frames, ffmpeg="ffmpeg"):
    if not 1 <= frames <= 600 or not 0 < fps <= 60:
        raise ValueError("frames must be 1..600 and fps must be 0..60")
    process = subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-i", str(video),
                              "-an", "-vf", f"fps={fps},scale={width}:{height}:flags=bilinear",
                              "-frames:v", str(frames), "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
                             check=True, capture_output=True, timeout=120)
    stride = width * height * 3
    if not process.stdout or len(process.stdout) % stride:
        raise ValueError("empty or truncated decoded frames")
    return np.frombuffer(process.stdout, dtype=np.uint8).reshape(-1, height, width, 3)


def frame_tensor(*, rgb, bgr):
    array = rgb[:, :, ::-1] if bgr else rgb
    return torch.from_numpy(array.copy()).permute(2, 0, 1).unsqueeze(0).float() / 255


def verify_sequence(*, artifact, video, oracle, output, fps=4, frames=24):
    model = load_model(path=artifact)
    model_inputs = model.spec["inputs"]
    temporal = set(model_inputs) == {"data", "prev_img", "prev_mask"}
    if len(model_inputs) != 1 and not temporal:
        raise ValueError("unsupported image input contract")
    image_name = "data" if temporal else next(iter(model_inputs))
    shape = model_inputs[image_name]["shape"]
    if shape[:2] != [1, 3]:
        raise ValueError("expected batch-one three-channel image input")
    decoded = decode_frames(video=video, width=shape[3], height=shape[2], fps=fps, frames=frames)
    native_model = artifact.parent / "oracle.mlmodelc"
    if not native_model.is_dir():
        raise ValueError("native reference must be extracted by the verified export batch first")
    torch_previous = torch.zeros(shape)
    native_previous = torch.zeros(shape)
    torch_mask = torch.zeros((1, 1, shape[2], shape[3]))
    native_mask = torch.zeros_like(torch_mask)
    cases = []
    times = []
    reset_at = len(decoded) // 2
    for index, frame in enumerate(decoded):
        current = frame_tensor(rgb=frame, bgr=temporal)
        reset = index in {0, reset_at}
        if reset:
            torch_previous.zero_()
            native_previous.zero_()
            torch_mask.zero_()
            native_mask.zero_()
        inputs = {image_name: current}
        native_inputs = {image_name: current}
        if temporal:
            inputs.update(prev_img=torch_previous, prev_mask=torch_mask)
            native_inputs.update(prev_img=native_previous, prev_mask=native_mask)
        with torch.inference_mode():
            started = time.perf_counter()
            actual = model(inputs)
            times.append((time.perf_counter() - started) * 1000)
        native = predict_native(oracle=oracle, native_model=native_model, inputs=native_inputs,
                                directory=output / f"frame-{index:04d}")
        if set(native) != set(actual):
            raise ValueError("native output schema mismatch")
        comparisons = {}
        ranges = {}
        for name, value in actual.items():
            array = value.numpy()
            expected = align_batch_axis(actual=array, expected=native[name])
            comparisons[name] = compare(actual=array, expected=expected)
            ranges[name] = {"min": float(array.min()), "max": float(array.max()), "mean": float(array.mean())}
            native[name] = expected
        cases.append({"frame": index, "time_s": index / fps, "reset": reset, "comparison": comparisons, "output_range": ranges})
        if temporal:
            torch_previous = current.clone()
            native_previous = current.clone()
            torch_mask = actual["nn_3"].clone()
            native_mask = torch.from_numpy(native["nn_3"].copy())
        if index == 0:
            np.savez(output / "first-input.npz", **{name: value.numpy() for name, value in inputs.items()})
    passed = all(c["passed"] for case in cases for c in case["comparison"].values())
    report = {"artifact": str(artifact.resolve()), "artifact_sha256": sha256(path=artifact),
              "video": str(video.resolve()), "video_sha256": sha256(path=video), "fps": fps,
              "frames": len(decoded), "passed": passed, "torch_median_ms": statistics.median(times),
              "torch_max_ms": max(times), "native_compute": "CPUOnly",
              "preprocessing": "ffmpeg bilinear stretch; BGR/255" if temporal else "ffmpeg bilinear stretch; RGB/255 (research input, product preprocessing unverified)",
              "temporal": "independent native/PyTorch feedback; midpoint reset" if temporal else "stateless",
              "scope": "same decoded tensors, not Jianying UI/preprocessing parity or model quality", "cases": cases}
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch", type=pathlib.Path, required=True)
    parser.add_argument("--video", type=pathlib.Path, action="append", required=True)
    parser.add_argument("--oracle", type=pathlib.Path, required=True)
    parser.add_argument("--out", type=pathlib.Path, required=True)
    parser.add_argument("--frames", type=int, default=24)
    parser.add_argument("--fps", type=float, default=4)
    args = parser.parse_args()
    torch.set_num_threads(4)
    batch = json.loads(args.batch.read_text())
    reports = []
    for item in batch["models"]:
        if item["status"] != "native-parity-passed":
            continue
        artifact = pathlib.Path(item["artifact"])
        for index, video in enumerate(args.video):
            output = args.out / artifact.parent.name / f"clip-{index}"
            output.mkdir(parents=True, exist_ok=True)
            report = verify_sequence(artifact=artifact, video=video, oracle=args.oracle.resolve(), output=output,
                                     fps=args.fps, frames=args.frames)
            reports.append({key: value for key, value in report.items() if key != "cases"})
            reports[-1]["report"] = str((output / "report.json").resolve())
            print(f"{item['source'].split('/')[-1]} clip-{index}: {report['frames']} frames passed={report['passed']}", flush=True)
            (args.out / "report.json").write_text(json.dumps(reports, indent=2) + "\n")
    if not reports:
        raise ValueError("no verified Espresso models in batch")
    return int(any(not report["passed"] for report in reports))


if __name__ == "__main__":
    raise SystemExit(main())
