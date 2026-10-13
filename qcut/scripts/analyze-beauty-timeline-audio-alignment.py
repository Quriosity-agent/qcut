"""Measure source/export audio lag for an explicitly declared contiguous edit.

Usage: python3 scripts/analyze-beauty-timeline-audio-alignment.py RUN --contiguous-source
The caller asserts timeline [0,duration) maps to source container presentation
timestamps [0,duration), at 1x, without audio crossfades or other audio edits.
The first video PTS is not normalized to zero. This is not a lip-sync verdict.
"""

import argparse
import json
import math
from pathlib import Path
import subprocess

import numpy as np


MODES = ("original", "native", "independent")
SAMPLE_RATE = 48_000


def finite(*, value):
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else None
    except (TypeError, ValueError):
        return None


def probe_audio(*, path):
    result = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format",
                             "-of", "json", str(path)], check=True, capture_output=True, text=True)
    metadata = json.loads(result.stdout)
    audio = [stream for stream in metadata["streams"] if stream["codec_type"] == "audio"]
    video = [stream for stream in metadata["streams"] if stream["codec_type"] == "video"]
    if len(audio) != 1 or len(video) != 1:
        raise ValueError(f"Expected one audio and one video stream: {path}")
    frames = subprocess.run([
        "ffprobe", "-v", "error", "-select_streams", "a:0", "-read_intervals", "%+0.5",
        "-show_frames", "-show_entries", "frame=best_effort_timestamp_time",
        "-of", "json", str(path)], check=True, capture_output=True, text=True)
    timestamps = [finite(value=frame.get("best_effort_timestamp_time"))
                  for frame in json.loads(frames.stdout).get("frames", [])]
    first_decoded = next((value for value in timestamps if value is not None), None)
    if first_decoded is None:
        raise ValueError(f"Missing decoded audio presentation origin: {path}")
    audio_start = first_decoded
    video_start = finite(value=video[0].get("start_time"))
    if audio_start is None or video_start is None:
        raise ValueError(f"Missing audio/video presentation origins: {path}")
    return {"path": str(path.resolve()), "audio": audio[0], "video": video[0],
            "first_decoded_audio_pts_seconds": first_decoded,
            "audio_origin_source": "first decoded frame PTS",
            "audio_start_seconds": audio_start,
            "video_start_seconds": video_start,
            "audio_start_relative_to_video_seconds": audio_start - video_start}


def decode_window(*, path, start_seconds, count, sample_rate=SAMPLE_RATE):
    start_sample = round(start_seconds * sample_rate)
    left_pad = min(count, max(0, -start_sample))
    begin = max(0, start_sample)
    wanted = count - left_pad
    if wanted == 0:
        return np.zeros(count, dtype=np.float64), {"left_padded_samples": count, "right_padded_samples": 0}
    filters = (f"aformat=channel_layouts=mono,aresample={sample_rate},asetpts=PTS-STARTPTS,"
               f"atrim=start_sample={begin}:end_sample={begin + wanted}")
    result = subprocess.run([
        "ffmpeg", "-v", "error", "-i", str(path), "-map", "0:a:0", "-vn", "-sn", "-dn",
        "-af", filters, "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1"],
        check=True, capture_output=True)
    if len(result.stdout) % 4 or len(result.stdout) > wanted * 4:
        raise ValueError(f"Unexpected decoded audio window length: {path}")
    decoded = np.frombuffer(result.stdout, dtype="<f4").astype(np.float64)
    if not np.isfinite(decoded).all():
        raise ValueError(f"Nonfinite decoded audio: {path}")
    right_pad = wanted - len(decoded)
    return np.pad(decoded, (left_pad, right_pad)), {
        "left_padded_samples": left_pad, "right_padded_samples": right_pad}


def correlate_window(*, reference, candidate, margin_samples, sample_rate=SAMPLE_RATE):
    reference, candidate = np.asarray(reference, dtype=np.float64), np.asarray(candidate, dtype=np.float64)
    if reference.ndim != 1 or candidate.ndim != 1 or len(reference) < 2 or len(candidate) != len(reference) + 2 * margin_samples:
        raise ValueError("Bounded reference plus symmetric candidate search margin required")
    if not np.isfinite(reference).all() or not np.isfinite(candidate).all():
        raise ValueError("Finite audio samples required")
    centered = reference - np.mean(reference)
    energy = float(np.dot(centered, centered))
    rms = math.sqrt(energy / len(reference))
    if rms < 1e-5:
        return {"informative": False, "reason": "Reference window is silent or nearly constant", "reference_rms": rms}
    size = 1 << (len(reference) + len(candidate) - 2).bit_length()
    convolution = np.fft.irfft(np.fft.rfft(candidate, size) * np.fft.rfft(centered[::-1], size), size)
    numerator = convolution[len(reference) - 1:len(candidate)]
    sums = np.concatenate(([0.0], np.cumsum(candidate)))
    squared = np.concatenate(([0.0], np.cumsum(candidate * candidate)))
    n = len(reference)
    local_sum = sums[n:] - sums[:-n]
    variance = np.maximum(0, squared[n:] - squared[:-n] - local_sum * local_sum / n)
    denominator = np.sqrt(energy * variance)
    scores = np.divide(numerator, denominator, out=np.full_like(numerator, -1), where=denominator > 1e-20)
    scores = np.clip(scores, -1, 1)
    best = int(np.argmax(scores))
    aligned = candidate[best:best + n]
    centered_output = aligned - np.mean(aligned)
    gain = float(np.dot(centered, centered_output) / energy)
    residual = centered_output - gain * centered
    exclusion = max(1, round(0.02 * sample_rate))
    competitors = np.concatenate((scores[:max(0, best - exclusion)], scores[min(len(scores), best + exclusion + 1):]))
    runner_up = float(np.max(competitors)) if len(competitors) else None
    peak = float(scores[best])
    return {"informative": True, "lag_samples": best - margin_samples,
            "lag_ms": (best - margin_samples) * 1000 / sample_rate,
            "correlation": peak, "zero_lag_correlation": float(scores[margin_samples]),
            "runner_up_outside_20ms": runner_up,
            "ambiguous_peak": runner_up is not None and peak - runner_up < 0.01,
            "at_search_boundary": best in (0, len(scores) - 1),
            "reference_rms": rms, "best_fit_gain": gain,
            "gain_adjusted_residual_rms": float(np.sqrt(np.mean(residual * residual)))}


def windows_for_duration(*, duration, search_seconds):
    if not math.isfinite(duration) or duration <= 2 * search_seconds + 0.2:
        raise ValueError("Duration too short for bounded audio alignment windows")
    width = min(2.0, (duration - 2 * search_seconds) / 4)
    cut = duration / 2
    seam_width = min(0.8, width)
    return [
        {"name": "early", "start_seconds": search_seconds, "duration_seconds": width},
        {"name": "before_cut", "start_seconds": cut - width, "duration_seconds": width},
        {"name": "across_cut", "start_seconds": cut - seam_width / 2, "duration_seconds": seam_width},
        {"name": "after_cut", "start_seconds": cut, "duration_seconds": width},
        {"name": "late", "start_seconds": duration - search_seconds - width, "duration_seconds": width},
    ]


def drift_summary(*, windows):
    usable = [row for row in windows if row["measurement"].get("informative")
              and row["measurement"]["correlation"] >= 0.95
              and not row["measurement"]["ambiguous_peak"]
              and not row["measurement"]["at_search_boundary"]
              and not any(row["padding"].values())]
    if len(usable) < 2:
        return {"available": False, "reason": "Fewer than two unpadded, unambiguous windows with correlation >= 0.95"}
    times = np.array([row["start_seconds"] + row["duration_seconds"] / 2 for row in usable])
    lags = np.array([row["measurement"]["lag_ms"] for row in usable])
    centered = times - np.mean(times)
    ordered = np.argsort(times)
    denominator = float(np.dot(centered, centered))
    return {"available": True, "window_count": len(usable),
            "first_to_last_lag_change_ms": float(lags[ordered[-1]] - lags[ordered[0]]),
            "lag_range_ms": float(np.max(lags) - np.min(lags)),
            "slope_ms_per_minute": float(60 * np.dot(centered, lags) / denominator) if denominator else None,
            "verdict": None}


def build_report(*, evidence_root, contiguous_source=False, search_seconds=0.25):
    if not contiguous_source:
        raise ValueError("Explicit --contiguous-source is required; arbitrary timeline mapping cannot be inferred")
    if not math.isfinite(search_seconds) or not 0 < search_seconds <= 1:
        raise ValueError("Audio lag search must be in (0,1] seconds")
    evidence = json.loads((evidence_root / "e2e-evidence.json").read_text())
    duration = float(evidence["duration"])
    windows = windows_for_duration(duration=duration, search_seconds=search_seconds)
    source = Path(evidence["source"])
    if not source.is_absolute():
        raise ValueError("Evidence source must be an explicit absolute path")
    files = {"source": source, **{mode: evidence_root / mode / "export.mp4" for mode in MODES}}
    media = {mode: probe_audio(path=path) for mode, path in files.items()}
    margin = round(search_seconds * SAMPLE_RATE)
    reports = {mode: [] for mode in MODES}
    for window in windows:
        count = round(window["duration_seconds"] * SAMPLE_RATE)
        reference, reference_padding = decode_window(
            path=source, start_seconds=window["start_seconds"] - media["source"]["audio_start_seconds"], count=count)
        for mode in MODES:
            candidate, candidate_padding = decode_window(
                path=files[mode], count=count + 2 * margin,
                start_seconds=window["start_seconds"] - margin / SAMPLE_RATE - media[mode]["audio_start_seconds"])
            reports[mode].append({**window, "padding": {
                **{f"source_{key}": value for key, value in reference_padding.items()},
                **{f"export_{key}": value for key, value in candidate_padding.items()}},
                "measurement": correlate_window(reference=reference, candidate=candidate, margin_samples=margin)})
    return {
        "schema_version": 1, "kind": "contiguous-source-audio-alignment-diagnostic",
        "evidence_root": str(evidence_root.resolve()), "media_duration_seconds": duration,
        "mapping": {"caller_declared_contiguous_source": True,
                    "clock": "container-presentation-timestamp-zero",
                    "normalize_first_video_timestamp": False,
                    "decoded_audio_window_origin": "First decoded audio PTS; sample index zero is not assumed to be container time zero",
                    "expected": "timeline [0,duration) equals source container PTS [0,duration), 1x, adjacent trim at duration/2; no audio crossfade",
                    "verified_from_project_tracks": False},
        "media": media, "sample_rate": SAMPLE_RATE, "channels": "mono FFmpeg downmix",
        "search_seconds": search_seconds, "lag_sign": "Positive means the exported waveform is delayed relative to the source container presentation clock",
        "passes": {mode: {"windows": reports[mode], "drift": drift_summary(windows=reports[mode])} for mode in MODES},
        "acceptance_verdict": None,
        "limitations": ["Waveform alignment, not perceptual lip sync; the video dissolve is not independently checked here.",
                        "First video PTS and audio-minus-video start difference are metadata only; neither is subtracted from the declared container clock. Actual video sampling and browser audio decoding require separate evidence.",
                        "AAC, resampling and the export audio graph can change samples or introduce fixed latency; report lag instead of demanding PCM identity with source.",
                        "Only bounded windows are retained for comparison; source bytes remain untouched. Silence, ambiguous peaks and search-edge peaks do not establish alignment.",
                        "Exact decoded PCM equality between beauty modes is a separate check in analyze-beauty-timeline-video.py."],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("evidence_root", type=Path)
    parser.add_argument("--contiguous-source", action="store_true")
    parser.add_argument("--search-seconds", type=float, default=0.25)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = build_report(evidence_root=args.evidence_root, contiguous_source=args.contiguous_source, search_seconds=args.search_seconds)
    output = args.output or args.evidence_root / "audio-alignment.json"
    output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    print(json.dumps({"output": str(output), "lag_ms_by_pass": {
        mode: [row["measurement"].get("lag_ms") for row in report["passes"][mode]["windows"]] for mode in MODES}}))


if __name__ == "__main__":
    main()
