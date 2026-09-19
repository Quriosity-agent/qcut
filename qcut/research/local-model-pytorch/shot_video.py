"""Bounded RGB decoding and a deterministic, torch-free shot sampling profile."""
from collections import deque
from contextlib import contextmanager
import subprocess
import threading

import numpy as np

MAX_FRAMES = 60 * 60 * 24
PREPROCESSING = "numpy-fp32-half-pixel-round-even-v1"


def resize_frame(*, frame):
    if frame.ndim != 3 or frame.shape[2] != 3 or frame.dtype != np.uint8:
        raise ValueError("expected HWC uint8 RGB frame")
    height, width = frame.shape[:2]
    if not 16 <= height <= 1920 or not 16 <= width <= 1920:
        raise ValueError("unsupported frame dimensions")
    y = np.maximum(np.float32(height / 96) * (np.arange(96, dtype=np.float32) + np.float32(.5)) - np.float32(.5), 0)
    x = np.maximum(np.float32(width / 96) * (np.arange(96, dtype=np.float32) + np.float32(.5)) - np.float32(.5), 0)
    iy, ix = y.astype(np.intp), x.astype(np.intp)
    wy, wx = (y - iy.astype(np.float32))[:, None, None], (x - ix.astype(np.float32))[None, :, None]
    next_y, next_x = np.minimum(iy + 1, height - 1), np.minimum(ix + 1, width - 1)
    top = (1 - wx) * frame[iy[:, None], ix[None, :]] + wx * frame[iy[:, None], next_x[None, :]]
    bottom = (1 - wx) * frame[next_y[:, None], ix[None, :]] + wx * frame[next_y[:, None], next_x[None, :]]
    return np.rint((1 - wy) * top + wy * bottom).clip(0, 255).transpose(2, 0, 1).copy()


def read_frame(*, stream, size):
    chunks, remaining = [], size
    while remaining:
        chunk = stream.read(remaining)
        if not chunk:
            if remaining != size:
                raise ValueError("truncated decoded RGB frame")
            return None
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


@contextmanager
def decoded_frames(*, video, ffmpeg, fps, width, height):
    if not np.isfinite(fps) or not 1 <= fps <= 60:
        raise ValueError("fps must be between 1 and 60")
    if any(type(value) is not int or not 16 <= value <= 1920 for value in (width, height)):
        raise ValueError("invalid sampling dimensions")
    command = [str(ffmpeg), "-hide_banner", "-loglevel", "error", "-nostdin", "-i", str(video),
               "-map", "0:v:0", "-an", "-sn", "-vf", f"fps={fps:.6f},scale={width}:{height}:flags=bilinear",
               "-pix_fmt", "rgb24", "-f", "rawvideo", "-"]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    errors = deque(maxlen=16)

    def drain_errors():
        while chunk := process.stderr.read(4096):
            errors.append(chunk)

    drain = threading.Thread(target=drain_errors, daemon=True)
    drain.start()

    def iterate():
        count = 0
        while data := read_frame(stream=process.stdout, size=width * height * 3):
            count += 1
            if count > MAX_FRAMES:
                raise ValueError("video exceeds bounded 86400-frame limit")
            yield np.frombuffer(data, dtype=np.uint8).reshape(height, width, 3)
        code = process.wait(timeout=15)
        drain.join(timeout=5)
        if code != 0:
            detail = b"".join(errors).decode("utf-8", "replace")[-4096:]
            raise ValueError(f"ffmpeg decode failed ({code}): {detail}")
        if not count:
            raise ValueError("video decoded no frames")

    try:
        yield iterate()
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)
        process.stdout.close()
        drain.join(timeout=5)
        process.stderr.close()
