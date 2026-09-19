"""Opt-in private ONNX shot detection. No torch, native vendor library, or network."""
import argparse
from collections import deque
import json
from pathlib import Path
import signal
import sys
import time

import numpy as np
import onnxruntime as ort

from onnx_infer import ONNXModel
from shot_postprocess import CENTER_OFFSET, FIRST_SCORED_FRAME, WINDOW, cut_points
from shot_video import PREPROCESSING, decoded_frames, resize_frame

ARTIFACT_SHA256 = "6cb814bb30d7dcaf12af5de4a8d09506bca52731e2523862e22c26a364400a96"
SOURCE_SHA256 = "98da44a79ddbeeb25ea73a087074fc10bc81d12c7c109c6920f12cd317acdaf2"
INPUTS = {"frames": {"shape": [7, 3, 96, 96], "dtype": "float32"}}
OUTPUTS = {"features": {"shape": [7, 128], "dtype": "float32"},
           "probability": {"shape": [], "dtype": "float32"}}


def load_model(*, contract):
    path = Path(contract)
    if not path.is_absolute() or path.stat().st_size > 1024 * 1024:
        raise ValueError("bounded absolute ONNX contract required")
    metadata = json.loads(path.read_text())
    if (not isinstance(metadata, dict) or metadata.get("source_format") != "qcut-private-shot-pytorch"
            or metadata.get("source_bundle_sha256") != SOURCE_SHA256
            or metadata.get("artifact_sha256") != ARTIFACT_SHA256
            or metadata.get("inputs") != INPUTS or metadata.get("outputs") != OUTPUTS):
        raise ValueError("not an approved shot model contract")
    return ONNXModel(contract_path=path)


def score_frames(*, model, frames, on_progress=None):
    window, scores, differences = deque(maxlen=WINDOW), {}, []
    previous, frame_count = None, 0
    for index, frame in enumerate(frames):
        small = resize_frame(frame=frame)
        if previous is not None:
            differences.append(float(np.abs(small - previous).mean(dtype=np.float32)))
        previous = small
        window.append(small / np.float32(127.5) - np.float32(1))
        if index >= FIRST_SCORED_FRAME:
            probability = float(model({"frames": np.stack(window)})["probability"])
            if not np.isfinite(probability) or not 0 <= probability <= 1:
                raise ValueError("invalid cut probability")
            scores[index - CENTER_OFFSET] = probability
        frame_count += 1
        if on_progress and frame_count % 24 == 0:
            on_progress(frame_count)
    if not frame_count:
        raise ValueError("video decoded no frames")
    return frame_count, scores, differences


def run(*, contract, video, ffmpeg, fps=24, width=320, height=180, threshold=.35):
    if not np.isfinite(threshold) or not 0 <= threshold <= 1:
        raise ValueError("threshold must be between 0 and 1")
    started = time.monotonic()
    model = load_model(contract=contract)
    with decoded_frames(video=video, ffmpeg=ffmpeg, fps=fps, width=width, height=height) as frames:
        count, scores, differences = score_frames(
            model=model, frames=frames,
            on_progress=lambda count: print(f"[progress] frames {count}", file=sys.stderr, flush=True))
    cuts = sorted(set(cut_points(scores, differences, threshold)))
    return {"engine": "onnx", "frame_count": count, "fps": fps, "width": width, "height": height,
            "threshold": threshold, "cut_frames": cuts, "scores": sorted(scores.items()),
            "onnx_version": ort.__version__, "artifact_sha256": ARTIFACT_SHA256,
            "preprocessing": PREPROCESSING, "elapsed_ms": round((time.monotonic() - started) * 1000)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--video", type=Path)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--fps", type=float, default=24)
    parser.add_argument("--width", type=int, default=320)
    parser.add_argument("--height", type=int, default=180)
    args = parser.parse_args()
    if args.check:
        load_model(contract=args.contract)
        print(json.dumps({"available": True, "onnx_version": ort.__version__, "artifact_sha256": ARTIFACT_SHA256}))
        return 0
    if not args.video or not args.video.is_absolute() or not args.video.is_file():
        parser.error("--video must be an existing absolute file")
    print(json.dumps(run(contract=args.contract, video=args.video, ffmpeg=args.ffmpeg,
                         fps=args.fps, width=args.width, height=args.height), allow_nan=False))
    return 0


def cancel(_signal, _frame):
    raise KeyboardInterrupt


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, cancel)
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("ONNX shot detection cancelled", file=sys.stderr)
        raise SystemExit(130)
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
