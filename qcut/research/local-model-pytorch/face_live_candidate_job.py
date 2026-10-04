"""One fresh static-frame audit for the development Beauty Lab, never playback.

The native detector, algorithm-RGBA resize, geometry and renderer remain in use.
Only the live worker produces replacement points. A separate native baseline is
an auditor, never a pixel fallback. Every job starts new tracking history.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image

from face_alignment_replay import LockedFiles, strict_json, valid_hash
from face_live_bridge_audit import json_lines, require
from face_live_bridge_bundle import write_json
from face_live_bridge_probe import run

MAX_RGBA = 16 * 1024**2
NATIVE_STAGES = ("detection", "geometry", "effect-rendering")
OWNED_STAGES = {
    "sampling-160": ("sampling-160",), "inference-160": ("inference-160",),
    "sampling-120": ("sampling-120",), "inference-120": ("inference-120",),
    "decode": ("decode-160", "decode-map-120"),
    "temporal-smoothing": ("temporal-smoothing",),
    "coordinate-mapping": ("map-160", "normalization"),
}


def request_input(*, request_path, guard):
    request = strict_json(data=guard.read(path=request_path, maximum=128 * 1024))
    require(condition=type(request) is dict and set(request) == {
        "requestId", "requestFingerprint", "inputSha256", "sourceKey", "frameNumber",
        "timestampSeconds", "width", "height", "parameters", "backendVersion"},
        message="exact live job request fields required")
    for key in ("inputSha256", "requestFingerprint"):
        require(condition=valid_hash(value=request[key]), message="request hashes required")
    width, height = request["width"], request["height"]
    require(condition=type(width) is int and type(height) is int and 1 <= width <= 4096 and
        1 <= height <= 4096 and width * height * 4 <= MAX_RGBA, message="bounded RGBA dimensions required")
    data = guard.read(path=request_path.parent / "input.rgba", maximum=MAX_RGBA,
                      expected=request["inputSha256"])
    require(condition=len(data) == width * height * 4, message="RGBA length mismatch")
    return request, data


def stage_metrics(*, worker):
    # These are cumulative worker timings including warmup, not frame latency.
    metrics = [dict(id=name, durationMs=sum(row["result"]["stage_timings_ms"][stage]
        for row in worker for stage in stages)) for name, stages in OWNED_STAGES.items()]
    return metrics + [dict(id=name, durationMs=None, unavailableReason="native-stage-not-instrumented")
                      for name in NATIVE_STAGES]


def run_job(*, args):
    request_path = args.request.resolve(strict=True)
    directory = request_path.parent
    require(condition={path.name for path in directory.iterdir()} == {"request.json", "input.rgba"} and
        request_path.name == "request.json", message="fresh job directory with only request and input required")
    guard = LockedFiles()
    request, data = request_input(request_path=request_path, guard=guard)
    with (directory / "input.png").open("xb") as stream:
        Image.frombytes("RGBA", (request["width"], request["height"]), data).save(stream, format="PNG")
    manifest = directory / "manifest.json"
    write_json(path=manifest, value=dict(version=1, frames=[dict(image="input.png", timestamp=0,
        parameters=request["parameters"], expect_change=True, label="current-request-static-audit")]))
    report = run(args=argparse.Namespace(runtime=args.runtime, package=args.package, root=args.root,
        manifest=manifest, out=directory / "audit", execute_native=True, lease=args.lease,
        timeout=args.timeout, single_frame=True))
    require(condition=report["passed"] is True and report["live_callback_handoff_verified"] is True and
        report["dependencies_unchanged"] is True and report["cleanup"]["completed"] is True,
        message="fresh live job did not pass: " + json.dumps(report["failures"]))
    require(condition=len(report["frames"]) == 1 and len(report["input_frames"]) == 1 and
        report["input_frames"][0]["input_sha256"] == request["inputSha256"],
        message="live audit input differs from requested pixels")
    output = directory / "audit/live/frame-00.rgba"
    pixels = guard.read(path=output, maximum=MAX_RGBA,
        expected=report["artifacts"]["live/frame-00.rgba"]["sha256"])
    require(condition=len(pixels) == len(data), message="live output dimensions differ")
    guard.verify()
    with (directory / "candidate.rgba").open("xb") as stream:
        stream.write(pixels)
    result = {key: value for key, value in request.items() if key != "parameters"}
    result.update(protocol="qcut-beauty-lab-candidate-v1", source="live-candidate",
        backendId="qcut-portrait-onnx-candidate-v1", nativeDependencies=list(NATIVE_STAGES),
        stageMetrics=stage_metrics(worker=json_lines(path=directory / "audit/live/worker.jsonl")),
        outputSha256=hashlib.sha256(pixels).hexdigest(), scope="audited-single-static-frame",
        temporal_sequence_acceptance=False, full_frame_preprocessing="native",
        native_baseline_used_as_output=False, audit="audit/report.json",
        timingScope="cumulative-owned-worker-including-warmup")
    write_json(path=directory / "result.json", value=result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("request", "runtime", "package", "root"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    parser.add_argument("--lease", required=True)
    parser.add_argument("--timeout", type=float, default=120)
    result = run_job(args=parser.parse_args())
    print(json.dumps(dict(passed=True, requestId=result["requestId"], scope=result["scope"])))


if __name__ == "__main__":
    main()
