"""CPU decode/export by default; opt-in BASE bridge audit needs a parent GPU lease.

Only the first 2-24 consecutive video frames are supported. Original PTS and fps
remain in decoded.json; manifest timestamps explicitly subtract the first PTS.
Six repeated bootstrap requests per bridge host are NOT additional video frames.
No Extra/makeup, seek, product backend, or temporal acceptance is enabled here.
"""
from __future__ import annotations

import argparse
import csv
from fractions import Fraction
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat

from face_alignment_replay import strict_json
import face_live_bridge_bundle as bundle
from face_live_bridge_process import ProcessScope, cancellation_signals, output_budget
import face_render_sequence_probe as sequence
from face_temporal_campaign import FILE_LIMIT, file_fingerprint

MAX_PIXELS = 1920 * 1080
MAX_DIMENSION = 2048
MAX_SPAN = 2
PROBE_WINDOW = 4
DECODE_BUDGET = 256 * 1024**2
JSON_LIMIT = 2 * 1024**2
GAPS = ["minutes-long continuous tracking and throughput", "turn/blink/occlusion coverage",
        "no-face disappearance/re-entry and multi-face identity", "seek/reset/source replacement",
        "native cancellation/GPU teardown on genuine video", "Extra/makeup temporal refinement",
        "product preview/export and cross-platform parity"]


def require(*, condition, message):
    if not condition:
        raise ValueError(message)


def rational(*, value, name):
    require(condition=isinstance(value, str) and len(value) <= 48 and
            re.fullmatch(r"-?\d+(?:/\d+|\.\d+)?", value) is not None,
            message=f"invalid rational {name}")
    result = Fraction(value)
    require(condition=abs(result.numerator) <= 2**63 - 1 and result.denominator <= 2**63 - 1,
            message=f"out-of-range rational {name}")
    return result


def integer(*, value, name, minimum=0, maximum=2**63 - 1):
    require(condition=type(value) is int and minimum <= value <= maximum,
            message=f"bounded integer required: {name}")
    return value


def seal(*, path, files):
    require(condition=not path.is_symlink() and stat.S_ISREG(path.stat().st_mode),
            message="regular non-symlink file required")
    current = file_fingerprint(path=path)
    require(condition=str(path) not in files or files[str(path)] == current,
            message=f"input/artifact changed: {path.name}")
    files[str(path)] = current
    return current


def verify(*, files):
    for name in list(files):
        seal(path=Path(name), files=files)


def validate_args(*, args):
    integer(value=args.frames, name="frames", minimum=2, maximum=24)
    for name, maximum in (("decode_timeout", 120), ("timeout", 240)):
        value = getattr(args, name)
        require(condition=type(value) in (int, float) and math.isfinite(value) and 1 <= value <= maximum,
                message=f"{name} must be within 1-{maximum} seconds")
    require(condition=type(args.execute_native) is bool and type(args.dry_run) is bool and
            not (args.execute_native and args.dry_run), message="dry-run and execute-native are exclusive")
    require(condition=type(args.eye_intensity) in (int, float) and math.isfinite(args.eye_intensity) and
            0 < args.eye_intensity <= 1, message="BASE eye intensity must be positive and at most 1")
    if args.execute_native:
        require(condition=isinstance(args.lease, str) and 1 <= len(args.lease.strip()) <= 160 and
                args.lease == args.lease.strip() and not any(ord(char) < 32 for char in args.lease),
                message="explicit parent GPU lease identifier required")
        require(condition=all(getattr(args, name) is not None for name in ("runtime", "package", "root")),
                message="native run requires runtime, BASE package and ONNX root")
    require(condition=args.execute_native or args.lease is None, message="lease requires execute-native")


def input_options():
    return ["-max_alloc", str(64 * 1024**2), "-cpucount", "1", "-threads", "1",
            "-protocol_whitelist", "file", "-format_whitelist", "mov,matroska,webm,avi",
            "-probesize", str(8 * 1024**2), "-analyzeduration", "5000000"]


def commands(*, args, out):
    probe = [str(args.ffprobe), "-v", "error", *input_options(), "-select_streams", "v:0"]
    output = ["-map", "0:v:0", "-an", "-sn", "-dn", "-frames:v", str(args.frames),
              "-fps_mode", "passthrough", "-enc_time_base", "demux", "-threads:v", "1", "-pix_fmt", "rgba"]
    return {
        "metadata": [*probe, "-show_streams", "-show_format", "-of", "json", str(args.source)],
        "timestamps": [*probe, "-read_intervals", f"%+{PROBE_WINDOW}", "-show_frames", "-show_entries",
            "frame=stream_index,pts,best_effort_timestamp,duration,pkt_duration,width,height,interlaced_frame",
            "-of", "json", str(args.source)],
        "decode": [str(args.ffmpeg), "-hide_banner", "-v", "error", "-nostdin", "-n", "-xerror",
            "-filter_threads", "1", *input_options(), "-hwaccel", "none", "-noautorotate", "-copyts",
            "-i", str(args.source), *output, "-c:v", "png", "-start_number", "0",
            "-avoid_negative_ts", "disabled", str(out / "frames/frame-%02d.png"),
            *output, "-c:v", "rawvideo", "-avoid_negative_ts", "disabled", "-f", "framehash",
            "-hash", "sha256", str(out / "decoded.framehash")],
    }


def decode_budget(*, directory):
    output_budget(directory=directory, maximum=DECODE_BUDGET)


def invoke(*, name, command, out, scope, timeout):
    path = out / f"{name}.stdout"
    process = scope.spawn(command=command, environment=bundle.system_environment(),
                          stdout=path, stderr=out / f"{name}.stderr")
    scope.wait(process=process, timeout=timeout)
    scope.finish(process=process)
    require(condition=not sequence.bounded_bytes(path=out / f"{name}.stderr", limit=4 * 1024**2).strip(),
            message=f"{name} reported decoder errors")
    return path


def read_json(*, path):
    result = strict_json(data=sequence.bounded_bytes(path=path, limit=JSON_LIMIT))
    require(condition=type(result) is dict, message="ffprobe JSON object required")
    return result


def metadata(*, value):
    streams = value.get("streams")
    require(condition=type(streams) is list and len(streams) == 1 and type(streams[0]) is dict,
            message="exactly one selected video stream required")
    stream = streams[0]
    require(condition=stream.get("codec_type") == "video" and
            stream.get("disposition", {}).get("attached_pic", 0) == 0, message="video required, not a cover image")
    width = integer(value=stream.get("width"), name="width", minimum=1, maximum=MAX_DIMENSION)
    height = integer(value=stream.get("height"), name="height", minimum=1, maximum=MAX_DIMENSION)
    require(condition=width * height <= MAX_PIXELS, message="video pixel budget exceeded; no implicit resize")
    for name in ("avg_frame_rate", "r_frame_rate", "time_base"):
        rate = rational(value=stream.get(name), name=name)
        require(condition=0 < rate <= (1 if name == "time_base" else 120), message=f"unsupported {name}")
    duration = rational(value=value.get("format", {}).get("duration"), name="source duration")
    require(condition=0 < duration <= 600, message="source duration must be positive and at most 600 seconds")
    require(condition=stream.get("field_order", "unknown") in ("progressive", "unknown"),
            message="interlaced video is outside this profile")
    require(condition=stream.get("sample_aspect_ratio", "1:1") == "1:1",
            message="non-square pixels require an explicit future geometry profile")
    require(condition=stream.get("tags", {}).get("rotate", "0") == "0" and
            not any(row.get("side_data_type") == "Display Matrix" or row.get("rotation", 0) != 0
                    for row in stream.get("side_data_list", [])), message="rotated/display-matrix video unsupported")
    return dict(stream_index=integer(value=stream.get("index"), name="stream index", maximum=1024),
                width=width, height=height, source_duration=str(duration),
                **{key: stream[key] for key in ("time_base", "avg_frame_rate", "r_frame_rate")})


def timestamps(*, value, info, count):
    rows = value.get("frames")
    require(condition=type(rows) is list and count <= len(rows) <= 1024,
            message="insufficient or excessive decoded timestamp inventory")
    time_base = rational(value=info["time_base"], name="time_base")
    frames, origin, previous_us = [], None, -1
    for index, row in enumerate(rows[:count]):
        require(condition=type(row) is dict and row.get("stream_index") == info["stream_index"] and
                (row.get("width"), row.get("height")) == (info["width"], info["height"]) and
                row.get("interlaced_frame", 0) == 0, message="frame stream/dimensions/interlace changed")
        pts = integer(value=row.get("pts"), name="source PTS", minimum=-(2**63) + 1)
        require(condition=row.get("best_effort_timestamp", pts) == pts, message="ambiguous source PTS")
        absolute = pts * time_base
        origin = absolute if origin is None else origin
        relative = absolute - origin
        timestamp_us = math.floor(relative * 1000000 + Fraction(1, 2))
        require(condition=0 <= relative <= MAX_SPAN and timestamp_us > previous_us,
                message="non-chronological, sub-microsecond or overlong frame window")
        timestamp = float(relative)
        require(condition=math.floor(timestamp * 1000000 + 0.5) == timestamp_us,
                message="bridge timestamp rounding disagrees with source rational")
        duration = row.get("duration", row.get("pkt_duration"))
        if duration is not None:
            integer(value=duration, name="frame duration", minimum=1)
            require(condition=relative + duration * time_base <= MAX_SPAN,
                    message="frame end exceeds bounded window")
        frames.append(dict(index=index, source_pts=pts, source_seconds=str(absolute),
                           relative_seconds=str(relative), timestamp=timestamp, timestamp_us=timestamp_us,
                           source_duration_ticks=duration))
        previous_us = timestamp_us
    return frames


def decoded_frames(*, out, info, frames, files):
    from PIL import Image

    receipt = out / "decoded.framehash"
    seal(path=receipt, files=files)
    lines = sequence.bounded_bytes(path=receipt, limit=65536).decode("ascii").splitlines()
    require(condition=lines.count("#hash: SHA256") == 1, message="SHA256 decode receipt required")
    bases = [line.removeprefix("#tb 0: ") for line in lines if line.startswith("#tb 0: ")]
    require(condition=len(bases) == 1, message="one decoded time base required")
    time_base = rational(value=bases[0], name="decoded time base")
    require(condition=time_base > 0, message="positive decoded time base required")
    receipts = list(csv.reader((line for line in lines if line and not line.startswith("#")), skipinitialspace=True))
    expected = [out / f"frames/frame-{index:02d}.png" for index in range(len(frames))]
    require(condition=sorted((out / "frames").iterdir()) == expected and len(receipts) == len(frames),
            message="decoded frame inventory mismatch")
    hashes = []
    for frame, path, row in zip(frames, expected, receipts, strict=True):
        require(condition=len(row) == 6 and row[0] == "0" and
                all(re.fullmatch(r"-?\d{1,20}", item) for item in row[1:5]), message="invalid framehash row")
        require(condition=int(row[2]) * time_base == Fraction(frame["source_seconds"]),
                message="decoded PTS differs from ffprobe source PTS")
        identity = seal(path=path, files=files)
        with Image.open(path) as image:
            require(condition=image.format == "PNG" and image.size == (info["width"], info["height"]),
                    message="decoded PNG dimensions differ")
            pixels = image.convert("RGBA").tobytes()
        digest = hashlib.sha256(pixels).hexdigest()
        require(condition=int(row[4]) == len(pixels) and row[5].strip() == digest,
                message="decoded PNG/receipt pixel hash mismatch")
        frame.update(image=str(path.relative_to(out)), png_sha256=identity["sha256"], rgba_sha256=digest)
        hashes.append(digest)
    require(condition=len(set(hashes)) >= 2, message="decoded frames do not change; static repeats refused")
    return dict(distinct_frames=len(set(hashes)), adjacent_changes=sum(a != b for a, b in zip(hashes, hashes[1:])),
                pts_and_rgba_receipts_verified=True)


def run_bridge(*, args):
    import face_live_bridge_probe

    return face_live_bridge_probe.run(args=args)


def bridge_args(*, args, out):
    return argparse.Namespace(runtime=args.runtime, package=args.package, root=args.root,
        manifest=out / "manifest.json", out=out / "bridge", timeout=args.timeout,
        execute_native=True, lease=args.lease, stable_host=args.stable_host,
        lldb_executable=getattr(args, "lldb_executable", None), debugserver=getattr(args, "debugserver", None),
        single_frame=False, static_controls=False, cold_frame=False, extra_root=None)


def audit_bridge(*, result, out, frames):
    for name in ("passed", "completed", "live_checks_completed", "dependencies_unchanged", "native_execution_performed"):
        require(condition=result.get(name) is True, message=f"bridge missing successful {name}")
    require(condition=result.get("failures") == [] and result.get("cleanup", {}).get("completed") is True and
            result.get("warmup_request_count") == bundle.WARMUPS and result.get("render_tolerance") == 0 and
            result.get("temporal_sequence_acceptance") is False and
            result.get("product_backend_registered") is False, message="bridge scope/cleanup mismatch")
    require(condition=result.get("manifest_sha256") == file_fingerprint(path=out / "manifest.json")["sha256"],
            message="bridge manifest association mismatch")
    inputs, rendered = result.get("input_frames", []), result.get("frames", [])
    require(condition=len(inputs) == len(rendered) == len(frames), message="bridge frame coverage mismatch")
    for frame, source, rendered_frame in zip(frames, inputs, rendered, strict=True):
        require(condition=source.get("input_sha256") == frame["rgba_sha256"] and
                source.get("timestamp") == frame["timestamp"] and rendered_frame.get("frame") == frame["index"] and
                rendered_frame.get("equal") is True, message="bridge per-frame source/time/result mismatch")
    count = (len(frames) + bundle.WARMUPS) * 2
    callback = result.get("callback_audit", {})
    require(condition=callback.get("predictions") == count and
            callback.get("conversions") == callback.get("restorations") == count - 2 and
            callback.get("owned_point_groups", 0) > 0, message="bridge callback/point receipt coverage mismatch")


def run(*, args):
    validate_args(args=args)
    out = sequence.fresh_output(path=args.out)
    report = dict(schema="face-live-video-probe-v1", out=str(out), phase="preflight", prepared=False,
        completed=False, passed=False, failures=[], native_execution_performed=False, bridge_invoked=False,
        bounded_native_dependent_rgba_parity=False, temporal_sequence_acceptance=False,
        product_parity_verified=False, product_backend_registered=False, extra_refinement_enabled=False,
        scope="first-consecutive-frames-BASE-native-dependent-research", remaining_gaps=GAPS,
        warmup_requests_per_host=bundle.WARMUPS, requested_frame_count=args.frames,
        limits=dict(source_bytes=FILE_LIMIT, source_duration_seconds=600, max_dimension=MAX_DIMENSION,
                    max_pixels=MAX_PIXELS, frame_count=24, span_seconds=MAX_SPAN,
                    probe_window_seconds=PROBE_WINDOW, decode_output_bytes=DECODE_BUDGET),
        decoder_config=dict(hardware_acceleration=False, threads=1, pixel_format="rgba", autorotate=False,
                            resize=False, fps_conversion=False, seek=False, source_stream="v:0"))
    files, scope = {}, ProcessScope(directory=out, budget=decode_budget)
    try:
        with cancellation_signals():
            args.source = args.source.absolute()
            report["source"] = dict(path=str(args.source), **seal(path=args.source, files=files))
            for name in ("ffmpeg", "ffprobe"):
                supplied = getattr(args, name)
                require(condition=supplied.is_absolute(), message="explicit absolute decoder executables required")
                path = supplied.resolve(strict=True)
                require(condition=os.access(path, os.X_OK), message="decoder executable required")
                setattr(args, name, path)
                seal(path=path, files=files)
            seal(path=Path(__file__).resolve(), files=files)
            (out / "frames").mkdir(mode=0o700)
            report["commands"] = commands(args=args, out=out)
            with scope:
                data = {}
                for name in ("metadata", "timestamps", "decode"):
                    report["phase"] = name
                    verify(files=files)
                    stdout = invoke(name=name, command=report["commands"][name], out=out,
                                    scope=scope, timeout=args.decode_timeout)
                    if name == "metadata":
                        data["metadata"] = read_json(path=stdout)
                        info = metadata(value=data["metadata"])
                        report["video"] = info
                    if name == "timestamps":
                        frames = timestamps(value=read_json(path=stdout), info=info, count=args.frames)
                report["motion"] = decoded_frames(out=out, info=info, frames=frames, files=files)
            report.update(phase="manifest", decoded_frames=frames, source_pts_origin=frames[0]["source_seconds"],
                          timestamp_rebase="source PTS * time_base minus first source PTS * time_base",
                          covered_pts_span_seconds=frames[-1]["relative_seconds"])
            manifest = dict(version=1, frames=[dict(image=frame["image"], timestamp=frame["timestamp"],
                parameters={"face_adjust_EnlargeEye": [{"id": -1, "intensity": args.eye_intensity}]},
                expect_change=True, label=f"source-frame-{frame['index']:02d}") for frame in frames])
            sequence.validate_manifest(value=manifest, base=out, expect_change=True)
            bundle.write_json(path=out / "manifest.json", value=manifest)
            bundle.write_json(path=out / "decoded.json", value=dict(source=report["source"], video=info,
                frames=frames, motion=report["motion"], commands=report["commands"], config=report["decoder_config"],
                warmup_requests_per_host=bundle.WARMUPS, timestamp_rebase=report["timestamp_rebase"]))
            for name in ("manifest.json", "decoded.json", "metadata.stdout", "timestamps.stdout"):
                seal(path=out / name, files=files)
            verify(files=files)
            report.update(prepared=True, phase="cpu-prepared-native-not-run")
            if args.execute_native:
                report.update(phase="BASE-bridge", bridge_invoked=True, native_launch_lease=args.lease)
                result = run_bridge(args=bridge_args(args=args, out=out))
                report["bridge_report"] = str(out / "bridge/report.json")
                report["native_execution_performed"] = result.get("native_execution_performed") is True
                audit_bridge(result=result, out=out, frames=frames)
                report["bounded_native_dependent_rgba_parity"] = True
    except (Exception, KeyboardInterrupt) as error:
        report["failures"].append(dict(phase=report["phase"], error=f"{type(error).__name__}: {error}"[:2000]))
    finally:
        report["cleanup"] = scope.close()
        try:
            verify(files=files)
            report["dependencies_unchanged"] = True
        except Exception as error:
            report["dependencies_unchanged"] = False
            report["failures"].append(dict(phase="final-provenance", error=str(error)))
        report["files"] = files
        report["processes"] = scope.history
        report["completed"] = report["prepared"] and not report["failures"] and report["cleanup"]["completed"]
        report["passed"] = report["completed"] and report["bounded_native_dependent_rgba_parity"]
        report["bounded_native_dependent_rgba_parity"] = report["passed"]
        bundle.write_json(path=out / "report.json", value=report)
    return report


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    for name in ("source", "out", "ffmpeg", "ffprobe"):
        result.add_argument(f"--{name}", type=Path, required=True)
    for name in ("runtime", "package", "root"):
        result.add_argument(f"--{name}", type=Path)
    modes = result.add_mutually_exclusive_group()
    modes.add_argument("--dry-run", action="store_true", help="decode/export only (the default); no bridge compilation")
    modes.add_argument("--execute-native", action="store_true")
    result.add_argument("--lease")
    result.add_argument("--stable-host", action="store_true")
    result.add_argument("--lldb-executable", type=Path)
    result.add_argument("--debugserver", type=Path)
    result.add_argument("--frames", type=int, default=12)
    result.add_argument("--eye-intensity", type=float, default=0.4)
    result.add_argument("--decode-timeout", type=float, default=60)
    result.add_argument("--timeout", type=float, default=90, help="per native phase, at most 240 seconds")
    return result


def main():
    report = run(args=parser().parse_args())
    print(json.dumps({key: report[key] for key in ("out", "prepared", "passed", "completed", "phase", "failures")}))
    return 0 if report["completed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
