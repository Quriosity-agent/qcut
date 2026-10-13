"""Audit encoded beauty exports, exact decoded audio and temporal RGB residuals.

Usage: python3 scripts/analyze-beauty-timeline-video.py /path/to/evidence
Inputs: evidence/{original,native,independent}/export.mp4
Requires ffmpeg, ffprobe and numpy. Temporal metrics are diagnostics, not a
flicker or native-parity acceptance test; no optical-flow alignment is applied.
"""

import argparse
from contextlib import contextmanager
from fractions import Fraction
import hashlib
import itertools
import json
import math
import re
from pathlib import Path
import subprocess
import tempfile

import numpy as np


MODES = ("original", "native", "independent")


def finite_number(*, value):
    try:
        result = float(value)
        return result if np.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def probe_media(*, path):
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-count_frames", "-show_streams",
         "-show_format", "-of", "json", str(path)],
        check=True, capture_output=True, text=True)
    data = json.loads(result.stdout)
    videos = [stream for stream in data["streams"] if stream["codec_type"] == "video"]
    if len(videos) != 1:
        raise ValueError(f"Expected exactly one video stream: {path}")
    audios = [stream for stream in data["streams"] if stream["codec_type"] == "audio"]
    if len(audios) > 1:
        raise ValueError(f"Expected at most one mixed audio stream: {path}")
    return {"path": str(path), "bytes": path.stat().st_size,
            "video": videos[0], "audio": audios[0] if audios else None,
            "format": data["format"], "video_timestamps": hash_video_timestamps(path=path)}


def hash_video_timestamps(*, path, selected_indices=()):
    command = ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_frames",
               "-show_entries", "frame=best_effort_timestamp_time",
               "-of", "compact=p=0:nk=0", str(path)]
    digest = hashlib.sha256()
    requested = set(selected_indices)
    selected = {}
    count, first, previous, monotonic = 0, None, None, True
    with decoded_pipe(command=command) as pipe:
        for line in pipe:
            fields = dict(part.split("=", 1) for part in line.decode().strip().split("|") if "=" in part)
            value = fields.get("best_effort_timestamp_time")
            if value is None:
                continue
            if value == "N/A":
                raise ValueError(f"Video frame has no presentation timestamp: {path}")
            timestamp = Fraction(value)
            digest.update(f"{timestamp}\n".encode())
            if first is None:
                first = timestamp
            if previous is not None and timestamp <= previous:
                monotonic = False
            previous = timestamp
            if count in requested:
                selected[count] = float(timestamp)
            count += 1
    if count == 0:
        raise ValueError(f"No video presentation timestamps: {path}")
    return {"sha256": digest.hexdigest(), "count": count,
            "first_seconds": float(first), "last_seconds": float(previous),
            "strictly_increasing": monotonic,
            "precision": "ffprobe best_effort_timestamp_time decimal output",
            **({"selected": selected} if requested else {})}


@contextmanager
def decoded_pipe(*, command):
    with tempfile.TemporaryFile() as errors:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=errors)
        try:
            yield process.stdout
            process.stdout.close()
            result = process.wait(timeout=30)
            if result:
                errors.seek(0)
                detail = errors.read(8192).decode("utf-8", errors="replace")
                raise RuntimeError(f"FFmpeg exited {result}: {detail}")
        finally:
            process.stdout.close()
            if process.poll() is None:
                process.kill()
                process.wait(timeout=10)


def read_frame(*, pipe, frame_bytes):
    data = bytearray()
    while len(data) < frame_bytes:
        chunk = pipe.read(frame_bytes - len(data))
        if not chunk:
            if data:
                raise ValueError(f"Truncated RGB frame: {len(data)}/{frame_bytes} bytes")
            return None
        data.extend(chunk)
    return bytes(data)


def hash_pcm(*, path, audio):
    if audio is None:
        return None
    channels = int(audio["channels"])
    sample_rate = int(audio["sample_rate"])
    command = ["ffmpeg", "-v", "error", "-i", str(path), "-map", "0:a:0",
               "-vn", "-c:a", "pcm_s32le", "-f", "s32le", "pipe:1"]
    digest = hashlib.sha256()
    size = 0
    with decoded_pipe(command=command) as pipe:
        for chunk in iter(lambda: pipe.read(1024 * 1024), b""):
            digest.update(chunk)
            size += len(chunk)
    bytes_per_sample_frame = channels * 4
    if size == 0 or size % bytes_per_sample_frame:
        raise ValueError(f"Empty or incomplete decoded PCM: {path}")
    samples = size // bytes_per_sample_frame
    return {"sha256": digest.hexdigest(), "bytes": size,
            "sample_frames": samples, "sample_rate": sample_rate,
            "channels": channels, "channel_layout": audio.get("channel_layout"),
            "decoded_duration_seconds": samples / sample_rate,
            "stream_start_seconds": finite_number(value=audio.get("start_time")),
            "stream_duration_seconds": finite_number(value=audio.get("duration")),
            "format": "signed 32-bit little-endian PCM; native rate/channels, no resampling"}


def compare_audio(*, audio):
    present = {mode: audio[mode] is not None for mode in MODES}
    if not all(present.values()):
        return {"audio_present": present, "decoded_pcm_equal": False,
                "stream_timing_equal": False, "audio_unchanged": False,
                "reason": "At least one output has no audio; audio preservation is unverified"}
    baseline = audio["original"]
    identity_fields = ("sha256", "bytes", "sample_frames", "sample_rate", "channels", "channel_layout")
    pcm_equal = all(all(audio[mode][key] == baseline[key] for key in identity_fields)
                    for mode in MODES)
    timing_fields = ("stream_start_seconds", "stream_duration_seconds")
    complete = all(audio[mode][key] is not None for mode in MODES for key in timing_fields)
    tolerance = 0.5 / baseline["sample_rate"]
    timing_equal = complete and all(
        abs(audio[mode][key] - baseline[key]) <= tolerance
        for mode in MODES for key in timing_fields)
    return {"audio_present": present, "decoded_pcm_equal": pcm_equal,
            "stream_timing_metadata_complete": complete,
            "timing_tolerance_seconds": tolerance,
            "stream_timing_equal": bool(timing_equal),
            "audio_unchanged": bool(pcm_equal and timing_equal),
            "scope": "Equality between the three exports only; source A/V alignment and lip sync are not measured"}


def frame_rate(*, video):
    try:
        value = Fraction(video["avg_frame_rate"])
        return float(value) if value > 0 else None
    except (KeyError, ValueError, ZeroDivisionError):
        return None


def frame_count(*, video):
    try:
        return int(video["nb_read_frames"])
    except (KeyError, ValueError, TypeError):
        return None


def compare_video_metadata(*, media):
    reference = media["original"]["video"]
    fields = ("width", "height", "sample_aspect_ratio", "display_aspect_ratio")
    geometry_equal = all(all(media[mode]["video"].get(key) == reference.get(key) for key in fields)
                         for mode in MODES)
    rates = {mode: frame_rate(video=media[mode]["video"]) for mode in MODES}
    counts = {mode: frame_count(video=media[mode]["video"]) for mode in MODES}
    durations = {mode: finite_number(value=media[mode]["video"].get("duration")) for mode in MODES}
    starts = {mode: finite_number(value=media[mode]["video"].get("start_time")) for mode in MODES}
    rate_equal = rates["original"] is not None and len(set(rates.values())) == 1
    count_equal = counts["original"] is not None and counts["original"] > 0 and len(set(counts.values())) == 1
    tolerance = 0.5 / rates["original"] if rates["original"] else 0
    timing_equal = all(value is not None for value in (*durations.values(), *starts.values())) and all(
        abs(values[mode] - values["original"]) <= tolerance
        for values in (durations, starts) for mode in MODES)
    timestamps = {mode: media[mode]["video_timestamps"] for mode in MODES}
    pts_equal = len({value["sha256"] for value in timestamps.values()}) == 1 and all(
        value["strictly_increasing"] and value["count"] == counts[mode]
        for mode, value in timestamps.items())
    return {"geometry_equal": geometry_equal, "frame_rates": rates,
            "frame_counts": counts, "video_durations_seconds": durations,
            "video_starts_seconds": starts, "frame_rates_equal": rate_equal,
            "frame_counts_equal": count_equal, "timing_equal": timing_equal,
            "presentation_timestamps_equal": pts_equal,
            "matching_timeline": bool(geometry_equal and rate_equal and count_equal and timing_equal and pts_equal)}


def rgb_frames(*, path, width, height):
    command = ["ffmpeg", "-v", "error", "-i", str(path), "-map", "0:v:0", "-an",
               "-vf", f"scale={width}:{height}:flags=area", "-fps_mode", "passthrough",
               "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"]
    with decoded_pipe(command=command) as pipe:
        while True:
            data = read_frame(pipe=pipe, frame_bytes=width * height * 3)
            if data is None:
                return
            yield np.frombuffer(data, dtype=np.uint8).reshape(height, width, 3)


def distribution(*, values):
    if not values:
        return None
    return {"count": len(values), "mean": float(np.mean(values)),
            **{f"p{level}": float(np.percentile(values, level)) for level in (50, 90, 95, 99)},
            "max": float(max(values))}


def measure_residuals(*, reference_frames, candidate_frames, fps):
    previous = None
    means, maxima, changes, change_maxima = [], [], [], []
    worst_residual = None
    worst_change = None
    counts = [0, 0]
    for index, (before, after) in enumerate(itertools.zip_longest(reference_frames, candidate_frames)):
        counts[0] += int(before is not None)
        counts[1] += int(after is not None)
        if before is None or after is None:
            continue
        if before.shape != after.shape:
            raise ValueError("Diagnostic frames have different dimensions")
        residual = after.astype(np.int16) - before.astype(np.int16)
        magnitude = np.abs(residual)
        mean, maximum = float(magnitude.mean()), int(magnitude.max())
        means.append(mean)
        maxima.append(maximum)
        position = {"frame": index, "nominal_seconds_from_first_frame": index / fps if fps else None}
        if worst_residual is None or mean > worst_residual["mean_abs_rgb"]:
            worst_residual = {**position, "mean_abs_rgb": mean, "max_abs_rgb": maximum}
        if previous is not None:
            # Signed residuals distinguish a -10 to +10 jump from constant magnitude.
            change = np.abs(residual - previous)
            change_mean, change_max = float(change.mean()), int(change.max())
            changes.append(change_mean)
            change_maxima.append(change_max)
            if worst_change is None or change_mean > worst_change["mean_abs_rgb_change"]:
                worst_change = {**position, "previous_frame": index - 1,
                                "mean_abs_rgb_change": change_mean,
                                "max_abs_rgb_change": change_max}
        previous = residual
    if not means:
        raise ValueError("No paired decoded video frames")
    return {"reference_frames": counts[0], "candidate_frames": counts[1],
            "paired_frames": len(means), "frame_counts_equal": counts[0] == counts[1],
            "per_frame_mean_abs_rgb": distribution(values=means),
            "per_frame_max_abs_rgb": distribution(values=maxima),
            "per_frame_mean_residual_change": distribution(values=changes),
            "per_frame_max_residual_change": distribution(values=change_maxima),
            "worst_residual_by_mean": worst_residual, "worst_residual_change_by_mean": worst_change}


def selected_frame_timestamps(*, path, indices):
    selected = hash_video_timestamps(path=path, selected_indices=indices).get("selected", {})
    if set(indices) != set(selected):
        raise ValueError(f"Selected frame indices missing from encoded video: {sorted(set(indices) - set(selected))}")
    return selected


def preencode_pngs(*, directory):
    frames = {}
    for path in directory.glob("export-frame-*.png"):
        match = re.fullmatch(r"export-frame-(\d+)\.png", path.name)
        if not match:
            continue
        index = int(match.group(1))
        if index in frames:
            raise ValueError(f"Duplicate preencode frame index {index}: {directory}")
        frames[index] = path
        if len(frames) > 32:
            raise ValueError("Compression diagnostics accept at most 32 selected frames")
    return dict(sorted(frames.items()))


def read_png_rgb(*, path, width, height):
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0",
                            "-show_entries", "stream=width,height", "-of", "json", str(path)],
                           check=True, capture_output=True, text=True)
    streams = json.loads(probe.stdout)["streams"]
    if len(streams) != 1 or streams[0] != {"width": width, "height": height}:
        raise ValueError(f"Preencode PNG dimensions differ from encoded video: {path}")
    command = ["ffmpeg", "-v", "error", "-noautorotate", "-i", str(path),
               "-map", "0:v:0", "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"]
    with decoded_pipe(command=command) as pipe:
        data = read_frame(pipe=pipe, frame_bytes=width * height * 3)
        if data is None or pipe.read(1):
            raise ValueError(f"Expected one full-resolution PNG frame: {path}")
    return np.frombuffer(data, dtype=np.uint8).reshape(height, width, 3)


def compression_metrics(*, reference, decoded):
    if reference.shape != decoded.shape:
        raise ValueError("Compression frames must have identical dimensions")
    difference = decoded.astype(np.int16) - reference.astype(np.int16)
    magnitude = np.abs(difference)
    mse = float(np.mean(np.square(difference, dtype=np.int32), dtype=np.float64))
    return {"max_abs_rgb": int(magnitude.max()), "mean_abs_rgb": float(magnitude.mean()),
            "p99_abs_rgb": float(np.percentile(magnitude, 99)), "mean_squared_rgb": mse,
            "psnr_db": 10 * math.log10(255 ** 2 / mse) if mse else None,
            "psnr_infinite": mse == 0,
            "preencode_rgb_sha256": hashlib.sha256(reference.tobytes()).hexdigest(),
            "decoded_rgb_sha256": hashlib.sha256(decoded.tobytes()).hexdigest()}


def measure_compression(*, directory, media):
    references = preencode_pngs(directory=directory)
    if not references:
        return {"available": False, "reason": "No selected preencode PNG frames"}
    video = media["video"]
    width, height = int(video["width"]), int(video["height"])
    indices = list(references)
    path = directory / "export.mp4"
    timestamps = selected_frame_timestamps(path=path, indices=indices)
    expression = "+".join(f"eq(n\\,{index})" for index in indices)
    command = ["ffmpeg", "-v", "error", "-noautorotate", "-i", str(path), "-map", "0:v:0", "-an",
               "-vf", f"select={expression}", "-frames:v", str(len(indices)),
               "-fps_mode", "passthrough", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"]
    rows = []
    with decoded_pipe(command=command) as pipe:
        for index, reference_path in references.items():
            data = read_frame(pipe=pipe, frame_bytes=width * height * 3)
            if data is None:
                raise ValueError(f"Encoded decoder omitted selected frame {index}: {path}")
            decoded = np.frombuffer(data, dtype=np.uint8).reshape(height, width, 3)
            reference = read_png_rgb(path=reference_path, width=width, height=height)
            rows.append({"frame_index": index, "presentation_timestamp_seconds": timestamps[index],
                         "preencode_png": str(reference_path),
                         **compression_metrics(reference=reference, decoded=decoded)})
        if pipe.read(1):
            raise ValueError("Encoded decoder returned unexpected additional selected frames")
    return {"available": True, "encoded_mp4": str(path.resolve()),
            "encoded_frame_count": frame_count(video=video),
            "encoded_codec": video.get("codec_name"), "encoded_pixel_format": video.get("pix_fmt"),
            "width": width, "height": height, "sample_count": len(rows),
            "selected_indices": indices, "unique_index_count": len(set(indices)),
            "unique_timestamp_count": len(set(timestamps.values())),
            "unique_preencode_rgb_count": len({row["preencode_rgb_sha256"] for row in rows}),
            "unique_decoded_rgb_count": len({row["decoded_rgb_sha256"] for row in rows}),
            "frames": rows, "acceptance_verdict": None}


def compression_report(*, evidence, media=None):
    passes = {}
    for mode in MODES:
        directory = evidence / mode
        path = directory / "export.mp4"
        if not path.is_file():
            passes[mode] = {"available": False, "reason": "Encoded export is missing"}
            continue
        metadata = media[mode] if media else probe_media(path=path)
        passes[mode] = measure_compression(directory=directory, media=metadata)
    return {"method": "Select encoded frame ordinals with FFmpeg; decode RGB24 at encoded dimensions; compare with same-index preencode PNG RGB24",
            "maximum_selected_frames_per_pass": 32, "passes": passes,
            "units": "8-bit RGB; mean/max/p99 across all RGB channel samples in each full-resolution frame; PSNR peak=255",
            "transforms": "No resize, registration, blur or rotation; alpha ignored for RGB comparison",
            "limitations": "Lossy encoding and RGB/YUV conversion are expected to change pixels. These metrics are separate from preview versus preencode parity; zero error is not required. Equal pixel hashes may be legitimate held frames, not proof of duplicated frame indices.",
            "acceptance_verdict": None}

def build_report(*, evidence, sample_width):
    if sample_width < 1 or sample_width > 1920:
        raise ValueError("Diagnostic width must be between 1 and 1920")
    paths = {mode: evidence / mode / "export.mp4" for mode in MODES}
    media = {mode: probe_media(path=path) for mode, path in paths.items()}
    audio = {mode: hash_pcm(path=paths[mode], audio=media[mode]["audio"]) for mode in MODES}
    metadata = compare_video_metadata(media=media)
    reference = media["native"]["video"]
    height = max(1, round(sample_width * reference["height"] / reference["width"]))
    left = rgb_frames(path=paths["native"], width=sample_width, height=height)
    right = rgb_frames(path=paths["independent"], width=sample_width, height=height)
    try:
        residual = measure_residuals(reference_frames=left, candidate_frames=right,
                                     fps=frame_rate(video=reference))
    finally:
        left.close()
        right.close()
    return {"schema_version": 1, "media": media, "video_comparison": metadata,
            "decoded_audio": audio, "audio_comparison": compare_audio(audio=audio),
            "compression_diagnostic": compression_report(evidence=evidence, media=media),
            "temporal_diagnostic": {
                "method": "All decoded frame pairs; fixed area downsample; signed independent-minus-native RGB residual and its consecutive-frame change",
                "sample_width": sample_width, "sample_height": height,
                "units": "8-bit RGB levels; percentiles are over per-frame statistics",
                "paired_by": "Decoded frame ordinal; full presentation timestamp hashes and stream metadata checked separately. Worst-frame times use nominal average fps; use frame index for VFR",
                "matching_timeline": metadata["matching_timeline"],
                "acceptance_verdict": None,
                "limitations": "Diagnostic only. Not motion compensated, no face tracking. Keyframes, crop, transitions, source motion and codec differences affect residuals. No flicker-pass or unencoded-pixel-parity claim.",
                **residual}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("evidence", type=Path)
    parser.add_argument("--sample-width", type=int, default=135)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--compression-only", action="store_true", help="Analyze available MP4/PNG modes, including incomplete runs")
    args = parser.parse_args()
    root = args.evidence.resolve()
    report = ({"schema_version": 1, "compression_diagnostic": compression_report(evidence=root)}
              if args.compression_only else build_report(evidence=root, sample_width=args.sample_width))
    target = args.output or root / ("compression-analysis.json" if args.compression_only else "video-analysis.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False) + "\n")
    print(json.dumps({"report": str(target), "video": report.get("video_comparison"),
                      "audio": report.get("audio_comparison"),
                      "compression_samples": {mode: value.get("sample_count", 0) for mode, value in report["compression_diagnostic"]["passes"].items()},
                      "temporal_diagnostic": report.get("temporal_diagnostic")}, indent=2))


if __name__ == "__main__":
    main()
