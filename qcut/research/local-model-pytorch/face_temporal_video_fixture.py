"""Local video frames for bounded portrait temporal experiments, not parity proof.

Select decoded frame ordinals from ffprobe JSON, then decode those same ordinals
without input seeking. The manifest records actual decoded presentation times.
"""
from __future__ import annotations

import argparse
from bisect import bisect_left
from fractions import Fraction
import hashlib
import io
import json
import math
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile

import face_render_sequence_probe as sequence

DIMENSIONS = (1448, 1086)
VIDEO_LIMIT = 2 * 1024**3
JSON_LIMIT = 16 * 1024**2
FRAME_LIMIT = 12000
CONTAINERS = {"mov,mp4,m4a,3gp,3g2,mj2", "matroska,webm", "avi", "mpegts", "flv", "ogg", "gif"}
EYE_PARAMETERS = ("face_adjust_eye", "face_adjust_eye_width", "face_adjust_eye_height",
                  "face_adjust_eye_position", "face_adjust_eye_distance")


def finite(*, value):
    try:
        return type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        return False


def requests(*, start, end, count):
    if (not finite(value=start) or not finite(value=end) or not 0 <= start <= end <= 60
            or type(count) is not int or not 1 <= count <= 24):
        raise ValueError("finite [0,60] second window and 1-24 typed frames required")
    return [start] if count == 1 else [start + (end - start) * index / (count - 1) for index in range(count)]


def effect(*, parameter, intensity, no_face, count):
    if parameter not in EYE_PARAMETERS or not finite(value=intensity) or not -1 <= intensity <= 1:
        raise ValueError("supported eye parameter and finite intensity in [-1,1] required")
    if (not isinstance(no_face, (list, tuple)) or any(type(index) is not int or not 0 <= index < count
                                                   for index in no_face) or len(set(no_face)) != len(no_face)):
        raise ValueError("no-face indices must be unique typed frame indices")
    return {parameter: [{"id": -1, "intensity": intensity}]}


def local_path(*, path):
    text = str(path)
    if re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", text) or any(char in text for char in ("\t", "\n", "\r", "\0")):
        raise ValueError("local path without protocol delimiters required")
    return Path(path).resolve(strict=True)


def video_identity(*, path):
    def marker():
        item = path.stat()
        if not stat.S_ISREG(item.st_mode) or not 0 < item.st_size <= VIDEO_LIMIT:
            raise ValueError("nonempty regular local video at most 2 GiB required")
        return [item.st_dev, item.st_ino, item.st_size, item.st_mtime_ns, item.st_ctime_ns]

    before, digest = marker(), hashlib.sha256()
    with path.open("rb") as stream:
        total = 0
        while data := stream.read(1024**2):
            total += len(data)
            if total > VIDEO_LIMIT:
                raise ValueError("video grew beyond byte limit")
            digest.update(data)
    if marker() != before or total != before[2]:
        raise RuntimeError("video mutated while hashing")
    return dict(resolved=str(path), stat=before, sha256=digest.hexdigest())


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def invalid_constant(value):
    raise ValueError(f"invalid JSON number: {value}")


def command_json(*, command, commands):
    commands.append(command)
    result = subprocess.run(command, check=True, capture_output=True, timeout=120)
    if len(result.stdout) > JSON_LIMIT or len(result.stderr) > sequence.LOG_LIMIT:
        raise ValueError("subprocess JSON/log exceeds byte limit")
    value = json.loads(result.stdout, object_pairs_hook=unique_object, parse_constant=invalid_constant)
    if not isinstance(value, dict):
        raise ValueError("ffprobe JSON object required")
    return value


def number(*, value, name):
    if not isinstance(value, str) or len(value) > 80:
        raise ValueError(f"ffprobe {name} needs a bounded numeric string")
    parsed = float(value)
    if not math.isfinite(parsed):
        raise ValueError(f"ffprobe {name} must be finite")
    return parsed


def assumption_flag(*, value):
    if type(value) is not bool:
        raise ValueError("assume_square_pixels must be a typed boolean")
    return value


def sar_policy(*, stream, assume_square_pixels):
    enabled = assumption_flag(value=assume_square_pixels)
    present, raw = "sample_aspect_ratio" in stream, stream.get("sample_aspect_ratio")
    declared = raw == "1:1"
    unspecified = not present or (isinstance(raw, str) and raw in ("N/A", "0:1"))
    assumed = unspecified and enabled
    if not declared and not assumed:
        raise ValueError("square-pixel source required; only unspecified SAR permits explicit assumption")
    return dict(field_present=present, raw=raw, assumption_requested=enabled, assumed_square_pixels=assumed,
                effective="1:1", basis="caller-assumption" if assumed else "explicit-metadata")


def video_metadata(*, value, assume_square_pixels=False):
    streams = value.get("streams")
    if not isinstance(streams, list) or len(streams) != 1 or not isinstance(streams[0], dict):
        raise ValueError("exactly one selected video stream required")
    stream = streams[0]
    sequence.validate_dimensions(width=stream.get("width"), height=stream.get("height"))
    if type(stream.get("index")) is not int or stream["index"] < 0:
        raise ValueError("typed video stream index required")
    container = value.get("format")
    if not isinstance(container, dict) or container.get("format_name") not in CONTAINERS:
        raise ValueError("standalone video container required; playlists are not source-locked")
    sample_aspect_ratio = sar_policy(stream=stream, assume_square_pixels=assume_square_pixels)
    time_base = stream.get("time_base")
    if not isinstance(time_base, str) or not re.fullmatch(r"[1-9][0-9]{0,9}/[1-9][0-9]{0,9}", time_base):
        raise ValueError("bounded positive rational video time_base required")
    start_pts = stream.get("start_pts")
    if start_pts is not None and (type(start_pts) is not int or not -2**63 <= start_pts < 2**63):
        raise ValueError("typed signed-64-bit start_pts required")
    duration_value = stream.get("duration")
    basis = "stream"
    if duration_value in (None, "N/A"):
        duration_value = container.get("duration") if isinstance(container, dict) else None
        basis = "format"
    duration = number(value=duration_value, name="duration")
    if duration <= 0:
        raise ValueError("positive video duration required")
    start = number(value=stream.get("start_time", "0"), name="start_time")
    if start_pts is not None:
        start = float(start_pts * Fraction(time_base))
    return dict(index=stream["index"], width=stream["width"], height=stream["height"],
                duration=duration, duration_basis=basis, start_time=start, start_pts=start_pts, time_base=time_base,
                sample_aspect_ratio=sample_aspect_ratio)


def select_frames(*, value, metadata, requested):
    rows = value.get("frames")
    if not isinstance(rows, list) or not 1 <= len(rows) <= FRAME_LIMIT:
        raise ValueError("bounded nonempty decoded video frames required")
    times, raw_times = [], []
    time_base = Fraction(metadata["time_base"])
    origin = metadata["start_pts"] * time_base if metadata["start_pts"] is not None else Fraction(str(metadata["start_time"]))
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("decoded frame object required")
        sequence.validate_dimensions(width=row.get("width"), height=row.get("height"),
                                     expected=(metadata["width"], metadata["height"]))
        pts = row.get("best_effort_timestamp")
        if type(pts) is not int or not -2**63 <= pts < 2**63:
            raise ValueError("typed signed-64-bit decoded timestamp required")
        raw = pts * time_base
        stamp = float(raw - origin)
        if stamp < 0 or (times and stamp < times[-1]):
            raise ValueError("nonnegative ordered decoded timestamps required")
        times.append(stamp)
        raw_times.append(float(raw))
    selected = []
    for stamp in requested:
        if not 0 <= stamp < metadata["duration"]:
            raise ValueError("requested seek is outside source video duration")
        index = bisect_left(times, stamp - 1e-9)
        if index == len(times) or times[index] > 60 or times[index] >= metadata["duration"]:
            raise ValueError("requested seek has no decoded frame inside replay/source bounds")
        selected.append(dict(requested_timestamp=stamp, timestamp=times[index],
                             decoded_timestamp=raw_times[index], decoded_pts=rows[index]["best_effort_timestamp"],
                             decoded_frame_index=index))
    return selected


def executable(*, value):
    path = shutil.which(str(value))
    if path is None:
        raise ValueError(f"local executable not found: {value}")
    return local_path(path=path)


def extract(*, source, selected, width, height, ffmpeg, directory, commands, normalize_unspecified_sar=False):
    normalize = assumption_flag(value=normalize_unspecified_sar)
    indices = sorted({frame["decoded_frame_index"] for frame in selected})
    selection = "+".join(f"eq(n,{index})" for index in indices)
    filters = (f"select='{selection}'," + ("setsar=1," if normalize else "") +
               f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
               f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1")
    command = [str(ffmpeg), "-nostdin", "-hide_banner", "-loglevel", "error", "-n",
               "-protocol_whitelist", "file,pipe", "-noautorotate", "-i", str(source), "-map", "0:v:0",
               "-an", "-sn", "-dn", "-vf", filters, "-fps_mode", "vfr", "-frames:v", str(len(indices)),
               "-threads", "1", str(directory / "decoded-%02d.png")]
    commands.append(command)
    result = subprocess.run(command, check=True, capture_output=True, timeout=180)
    if result.stdout or len(result.stderr) > sequence.LOG_LIMIT:
        raise ValueError("unexpected ffmpeg output or oversized log")
    expected = [directory / f"decoded-{index + 1:02d}.png" for index in range(len(indices))]
    if set(directory.iterdir()) != set(expected):
        raise RuntimeError("partial or extra decoded frame extraction")
    return dict(zip(indices, expected, strict=True))


def build(*, args):
    from PIL import Image

    assume_square_pixels = assumption_flag(value=getattr(args, "assume_square_pixels", False))
    requested = requests(start=args.start, end=args.end, count=args.count)
    parameters = effect(parameter=args.parameter, intensity=args.intensity, no_face=args.no_face, count=args.count)
    sequence.validate_dimensions(width=args.width, height=args.height)
    source = local_path(path=args.video)
    identity = video_identity(path=source)
    ffmpeg, ffprobe = executable(value=args.ffmpeg), executable(value=args.ffprobe)
    paths = [Path(__file__).resolve(), Path(sequence.__file__).resolve(), Path(sequence.consumer.__file__).resolve(),
             ffmpeg, ffprobe]
    guards = {path: sequence.file_identity(path=path, limit=sequence.IMAGE_LIMIT)[0] for path in paths}
    out = sequence.fresh_output(path=args.out)
    report = dict(passed=False, native_runtime_used=False, no_face_inferred=False, commands=[],
                  selection_policy="first-decoded-frame-at-or-after-request", input_seeking_used=False,
                  source=dict(path=str(source), assume_square_pixels_requested=assume_square_pixels, **identity),
                  source_sha256={str(path): row["sha256"]
                  for path, row in guards.items()}, frames=[], failures=[], out=str(out))
    created = []
    try:
        prefix = [str(ffprobe), "-v", "error", "-protocol_whitelist", "file,pipe", "-select_streams", "v:0"]
        raw_metadata = command_json(command=[*prefix, "-show_entries",
            "stream=index,width,height,duration,start_time,start_pts,time_base,sample_aspect_ratio:format=duration,format_name", "-of", "json", str(source)],
            commands=report["commands"])
        report["source"]["ffprobe_metadata"] = raw_metadata
        metadata = video_metadata(value=raw_metadata, assume_square_pixels=assume_square_pixels)
        report["source"]["sample_aspect_ratio"] = metadata["sample_aspect_ratio"]
        if max(requested) >= metadata["duration"]:
            raise ValueError("requested seek is outside source video duration")
        decoded = command_json(command=[*prefix, "-read_intervals", f"%+{min(metadata['duration'], 61):.9f}",
            "-show_frames", "-show_entries", "frame=best_effort_timestamp,width,height", "-of", "json", str(source)],
            commands=report["commands"])
        selected = select_frames(value=decoded, metadata=metadata, requested=requested)
        report.update(video=metadata, width=args.width, height=args.height, requested_window=[args.start, args.end],
                      sample_aspect_ratio_policy=metadata["sample_aspect_ratio"]["basis"], rotation_policy="coded-no-autorotate")
        with tempfile.TemporaryDirectory(prefix="decode-", dir=out) as temporary:
            extracted = extract(source=source, selected=selected, width=args.width, height=args.height, ffmpeg=ffmpeg,
                                directory=Path(temporary), commands=report["commands"],
                                normalize_unspecified_sar=metadata["sample_aspect_ratio"]["assumed_square_pixels"])
            frames, images = [], {}
            for index, frame in enumerate(selected):
                data = sequence.file_identity(path=extracted[frame["decoded_frame_index"]], limit=sequence.IMAGE_LIMIT)[1]
                with Image.open(io.BytesIO(data)) as image:
                    sequence.validate_dimensions(width=image.width, height=image.height, expected=(args.width, args.height))
                    if image.format != "PNG":
                        raise ValueError("decoded PNG image required")
                    image.load()
                path = out / f"frame-{index:02d}.png"
                created.append(path)
                path.write_bytes(data)
                images[path] = sequence.file_identity(path=path, limit=sequence.IMAGE_LIMIT)[0]
                no_face = index in args.no_face
                frames.append(dict(image=path.name, timestamp=frame["timestamp"], parameters=parameters,
                                   expect_change=args.intensity != 0 and not no_face, label=f"video-frame-{index:02d}"))
                report["frames"].append(dict(index=index, **frame, image=path.name, image_sha256=images[path]["sha256"],
                                             no_face_explicit=no_face))
        manifest = dict(version=1, frames=frames)
        sequence.validate_manifest(value=manifest, base=out)
        if video_identity(path=source) != identity:
            raise RuntimeError("source video changed during extraction")
        for path, expected in {**guards, **images}.items():
            if sequence.file_identity(path=path, limit=sequence.IMAGE_LIMIT)[0] != expected:
                raise RuntimeError(f"source/image guard changed: {path.name}")
        for name, value in (("source.json", report["source"]), ("manifest.json", manifest)):
            path = out / name
            created.append(path)
            path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")
        report.update(passed=True, manifest=str(out / "manifest.json"),
                      manifest_sha256=sequence.file_identity(path=out / "manifest.json", limit=sequence.MANIFEST_LIMIT)[0]["sha256"])
    except Exception as error:
        for path in created:
            path.unlink(missing_ok=True)
        report["failures"].append(f"{type(error).__name__}: {error}"[:2000])
    (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--start", type=float, default=0)
    parser.add_argument("--end", type=float, default=1)
    parser.add_argument("--count", type=int, default=7)
    parser.add_argument("--width", type=int, default=DIMENSIONS[0])
    parser.add_argument("--height", type=int, default=DIMENSIONS[1])
    parser.add_argument("--parameter", choices=EYE_PARAMETERS, default=EYE_PARAMETERS[0])
    parser.add_argument("--intensity", type=float, default=1)
    parser.add_argument("--no-face", type=int, nargs="*", default=[])
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--ffprobe", default="ffprobe")
    parser.add_argument("--assume-square-pixels", action="store_true",
                        help="Explicitly assume SAR 1:1 only when ffprobe leaves SAR unspecified")
    try:
        report = build(args=parser.parse_args())
    except (ValueError, OSError) as error:
        print(json.dumps(dict(passed=False, failures=[str(error)])))
        return 1
    print(json.dumps({key: report[key] for key in ("passed", "out", "failures")}, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
