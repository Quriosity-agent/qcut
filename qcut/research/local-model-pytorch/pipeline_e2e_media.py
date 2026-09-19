"""Bounded FFmpeg decode, encode, contact sheets, and output verification."""
import json
import math
import subprocess

import numpy as np

MAX_DECODE_BYTES = 256 * 1024 * 1024


def command(*, argv, log, timeout=180):
    try:
        result = subprocess.run(argv, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired as error:
        log.write_text(json.dumps({"argv": list(map(str, argv)), "timeout_seconds": timeout,
                                   "stderr": (error.stderr or b"").decode(errors="replace")}, indent=2) + "\n")
        raise
    log.write_text(json.dumps({"argv": list(map(str, argv)), "returncode": result.returncode,
                               "stderr": result.stderr.decode(errors="replace")}, indent=2) + "\n")
    if result.returncode:
        raise RuntimeError(f"media command exited {result.returncode}: {log}")
    return result.stdout


def probe(*, video, log):
    raw = command(argv=["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames",
                        "-show_entries", "stream=width,height,nb_read_frames,duration,avg_frame_rate:format=duration",
                        "-of", "json", str(video)], log=log)
    report = json.loads(raw)
    if len(report.get("streams", [])) != 1:
        raise ValueError("input must contain a video stream")
    return report


def decode(*, video, width, height, fps, frames, start, log):
    if (not 1 <= frames <= 600 or not math.isfinite(fps) or not 0 < fps <= 60
            or not math.isfinite(start) or start < 0 or min(width, height) <= 0
            or width * height * 3 * frames > MAX_DECODE_BYTES):
        raise ValueError("invalid or oversized decode request")
    raw = command(argv=["ffmpeg", "-nostdin", "-v", "error", "-xerror", "-i", str(video),
                        "-ss", str(start), "-an", "-vf", f"fps={fps},scale={width}:{height}:flags=bilinear",
                        "-frames:v", str(frames), "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"], log=log)
    stride = width * height * 3
    if not raw or len(raw) % stride:
        raise ValueError("empty or truncated decoded frames")
    return np.frombuffer(raw, np.uint8).reshape(-1, height, width, 3).copy()


def encode_and_verify(*, original, response, fps, output):
    if original.dtype != np.uint8 or response.dtype != np.uint8 or original.shape != response.shape:
        raise ValueError("visualization sequences must share RGB uint8 dimensions")
    count, height, width, channels = original.shape
    if not count or channels != 3 or width % 2 or height % 2:
        raise ValueError("invalid encoded video dimensions")
    original_path, response_path = output / "original.rgb", output / "response.rgb"
    original_path.write_bytes(original.tobytes())
    response_path.write_bytes(response.tobytes())
    video = output / "comparison.mp4"
    inputs = ["-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", f"{width}x{height}",
              "-framerate", str(fps)]
    filters = ("[0:v]split=2[o][a];[1:v]split=2[r][b];"
               "[a][b]blend=all_expr='A*0.6+B*0.4'[blend];[o][r][blend]hstack=inputs=3[v]")
    command(argv=["ffmpeg", "-nostdin", "-v", "error", "-xerror", *inputs, "-i", str(original_path),
                  *inputs, "-i", str(response_path), "-filter_complex", filters, "-map", "[v]",
                  "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "16", "-pix_fmt", "yuv420p",
                  "-frames:v", str(count), "-movflags", "+faststart", str(video)], log=output / "encode.json")
    info = probe(video=video, log=output / "output-probe-command.json")
    (output / "output-probe.json").write_text(json.dumps(info, indent=2) + "\n")
    stream = info["streams"][0]
    expected_duration = count / fps
    duration = float(stream.get("duration", info.get("format", {}).get("duration", "nan")))
    dimensions_ok = (stream["width"], stream["height"]) == (width * 3, height)
    frame_count_ok = int(stream.get("nb_read_frames", -1)) == count
    duration_ok = math.isfinite(duration) and abs(duration - expected_duration) <= max(0.001, 0.01 / fps)
    decoded = decode(video=video, width=width * 3, height=height, fps=fps, frames=count + 1,
                     start=0, log=output / "output-decode.json")
    nonblank = bool(np.ptp(decoded) > 0)
    complete = len(decoded) == count
    decoded_response = decoded[:, :, width:width * 2]
    response_mae = float(np.abs(decoded_response.astype(np.float32) - response).mean()) if complete else None
    response_fidelity = response_mae is not None and response_mae <= 8
    indices = sorted({0, count // 2, count - 1})
    select = "+".join(f"eq(n\\,{i})" for i in indices)
    screenshot = output / "contact-sheet.png"
    command(argv=["ffmpeg", "-nostdin", "-v", "error", "-i", str(video), "-vf",
                  f"select='{select}',tile=1x{len(indices)}", "-frames:v", "1", str(screenshot)],
            log=output / "screenshot.json")
    if not screenshot.is_file() or screenshot.stat().st_size == 0:
        raise ValueError("missing contact sheet")
    command(argv=["ffmpeg", "-nostdin", "-v", "error", "-xerror", "-i", str(screenshot),
                  "-f", "null", "-"], log=output / "screenshot-decode.json")
    return {"passed": all((dimensions_ok, frame_count_ok, duration_ok, nonblank, complete, response_fidelity)),
            "dimensions_ok": dimensions_ok, "frame_count_ok": frame_count_ok, "duration_ok": duration_ok,
            "decoded_nonblank": nonblank, "decoded_frame_count": len(decoded), "expected_frame_count": count,
            "expected_duration_s": expected_duration, "actual_duration_s": duration,
            "response_encode_mae": response_mae, "response_encode_mae_limit": 8,
            "response_fidelity": response_fidelity,
            "response_pixels": {"input_min": int(response.min()), "input_max": int(response.max()),
                                "decoded_min": int(decoded_response.min()), "decoded_max": int(decoded_response.max()),
                                "spatially_constant_frames": int(sum(np.ptp(frame) == 0 for frame in response)),
                                "scope": "blank/weak responses are reported, not relabelled as successful segmentation"},
            "video": str(video.resolve()), "contact_sheet": str(screenshot.resolve()),
            "columns": ["decoded source", "model response visualization", "60/40 blend"],
            "rows_frame_indices": indices, "audio": "intentionally omitted"}
