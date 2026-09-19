"""Private real-media shot comparison and decoder cleanup evidence, not editor E2E."""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

import numpy as np
import torch

from onnx_infer import digest
from shot_export import load_shots
from shot_onnx import run
from shot_video import PREPROCESSING, resize_frame
from detect_cuts_torch import cut_points, frame_scores, frames_from_video, resized_uint8

PRIVATE = Path(__file__).resolve().parents[2] / ".local/jianying-model-pytorch"


def compare_video(*, video, fps, contract, ffmpeg, backbone, head):
    started = time.monotonic()
    portable = run(contract=contract, video=video, ffmpeg=ffmpeg, fps=fps)
    frames = frames_from_video(video, fps, ffmpeg=ffmpeg)
    with torch.inference_mode():
        scores, differences = frame_scores(backbone, head, frames)
    reference = cut_points(scores, differences, .35)
    pixel_count, pixel_max = 0, 0
    for frame in frames:
        expected = resized_uint8(frame[None]).numpy()[0]
        actual = resize_frame(frame=frame)
        pixel_count += int(np.count_nonzero(actual != expected))
        pixel_max = max(pixel_max, int(np.abs(actual - expected).max()))
    probability_max = max((abs(probability - scores[index]) for index, probability in portable["scores"]), default=0)
    passed = reference == portable["cut_frames"] and portable["frame_count"] == len(frames)
    return {"video": str(video), "sha256": digest(path=video), "fps": fps, "frame_count": len(frames),
            "cut_agreement": passed, "torch_cut_frames": reference, "onnx_cut_frames": portable["cut_frames"],
            "probability_max_abs": probability_max, "rounded_rgb_different_values": pixel_count,
            "rounded_rgb_max_abs": pixel_max, "preprocessing": PREPROCESSING,
            "onnx_elapsed_ms": portable["elapsed_ms"], "total_elapsed_ms": round((time.monotonic() - started) * 1000)}


def cancellation(*, contract, video, ffmpeg):
    if os.name != "posix":
        return {"tested": False, "reason": "POSIX signal cleanup test only; Windows uses TS taskkill /T"}
    command = [sys.executable, str(Path(__file__).with_name("shot_onnx.py")), "--contract", str(contract),
               "--video", str(video), "--ffmpeg", str(ffmpeg)]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    child_pids = []
    try:
        for line in process.stderr:
            if line.startswith("[progress] frames"):
                listing = subprocess.run(["pgrep", "-P", str(process.pid)], capture_output=True, text=True, check=False)
                child_pids = [int(item) for item in listing.stdout.split()]
                break
        process.send_signal(signal.SIGTERM)
        stdout, stderr = process.communicate(timeout=10)
        alive = []
        for pid in child_pids:
            try:
                os.kill(pid, 0)
                alive.append(pid)
            except ProcessLookupError:
                pass
        return {"tested": True, "passed": bool(child_pids) and process.returncode == 130 and not alive and not stdout,
                "exit_code": process.returncode, "observed_ffmpeg_children": child_pids, "remaining_children": alive,
                "stderr": stderr[-500:]}
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=10)
        process.stdout.close()
        process.stderr.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--video", type=Path, action="append", required=True)
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    out = args.out.resolve()
    if not out.is_relative_to(PRIVATE.resolve()) or out.exists():
        parser.error("fresh private report path required")
    torch.set_num_threads(2)
    backbone, head = load_shots(path=args.model)
    cases = [compare_video(video=video.resolve(), fps=fps, contract=args.contract.resolve(), ffmpeg=args.ffmpeg,
                           backbone=backbone, head=head) for video in args.video for fps in (12, 24)]
    cleanup = cancellation(contract=args.contract.resolve(), video=args.video[-1].resolve(), ffmpeg=args.ffmpeg)
    report = {"scope": "real FFmpeg decode + portable ONNX cut agreement with previous PyTorch pipeline; not native/editor parity",
              "passed": all(case["cut_agreement"] for case in cases) and cleanup.get("passed", False),
              "cases": cases, "cancellation": cleanup}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    print(json.dumps(report, indent=2))
    return int(not report["passed"])


if __name__ == "__main__":
    raise SystemExit(main())
