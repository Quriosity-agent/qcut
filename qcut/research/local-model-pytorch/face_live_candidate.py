"""Persistent dependency-fed research inference, NOT a live beauty backend.

CLI: --root MODEL_ROOT [--inspect]; otherwise one JSON object per stdin line:
{"rgba_path": "/absolute/algorithm.rgba", "packet": {...dependency contract...}}.
Replies are JSON lines; failures never return points or advance temporal state.
One process owns one ordered source; start a new process/core after seeking or
changing source. Each packet is an internal prediction, not a displayed frame.

Modes supplied by the future native callback:
  seed-160: infer absolute detection seed, then update it with owned 120 points.
  reset-120: initialize both filters from owned tracked 120 points (no update).
  update: advance existing owned history. face=null clears history, emits [].
Only ordinary uncached Base/Extra primary106 temporal routes, packed orientation-0
RGBA and one face are supported. Extra Stage2 geometry parity is unverified;
Extra/iris/fitting/masks remain native, not owned inference or parity claims.
Native geometry, acceptance, identities and reset signals remain dependencies.
No native capture, GPU renderer, product registration or replay lookup occurs.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
import sys
import threading
import time

import numpy as np

from face_alignment_replay import LockedFiles, strict_json
from face_alignment_sampling import signed_input
from face_geometry import reorder_landmarks
from face_host_geometry_replay import decode_actual, map_double, normalized
from face_live_candidate_contract import NATIVE_DEPENDENCIES, fields, smoothing_state, validate, validate_metadata
from face_live_candidate_onnx import OnnxHeads, validate_heads
from face_live_candidate_trace import stage_snapshot
from face_preprocess_replay import prepare
from face_temporal_smoothing import BaseState, LENS_SHA256, update, update_base

STAGES = ("sampling-160", "inference-160", "decode-160", "map-160", "sampling-120",
          "inference-120", "decode-map-120", "temporal-smoothing", "normalization")


def update_primary(*, state, points, extra):
    """Pinned liblens primary106 temporal schedule, not Extra Stage2 geometry.

    ExtraInfoSmoothOutput 0x37b880, caller 0x335038 with w7=false and
    optimized=false: 73 at 0x37bc1c, 33 at 0x37bc44, 73 at 0x37bc5c.
    Both 73 calls consume the same raw input, not the first filtered output.
    BaseInfoSmoothOutput 0x37cc58 updates each partition once.
    Extra init 0x37b304 and Base init 0x37b7e8 share the first33/last73 layout.
    """
    if extra:
        _, last73 = update(state=state.last73, points=points[33:], optimized=False)
        state = BaseState(first33=state.first33, last73=last73)
    return update_base(state=state, points=points, optimized=False)


def measured(*, timings, name, function, **kwargs):
    start = time.perf_counter_ns()
    result = function(**kwargs)
    timings[name] += (time.perf_counter_ns() - start) / 1e6
    return result


class CandidateCore:
    def __init__(self, *, models, stage_observer=None):
        if stage_observer is not None and not callable(stage_observer):
            raise TypeError("stage observer must be callable or None")
        self.models = models
        self.stage_observer = stage_observer
        self.state = self.identity = self.profile = self.sequence = None
        self.seen_ids = set()
        self.busy = threading.Lock()

    def process(self, *, packet, rgba, check_output=None):
        if not self.busy.acquire(blocking=False):
            raise RuntimeError("one prediction at a time required")
        try:
            return self._process(packet=packet, rgba=rgba, check_output=check_output)
        finally:
            self.busy.release()

    def _process(self, *, packet, rgba, check_output):
        started = time.perf_counter_ns()
        packet, rgba = validate(packet=packet, rgba=rgba)
        if self.stage_observer is not None and packet["face"] is None:
            raise ValueError("stage diagnostics require exactly one face")
        sequence = (packet["source_key"], packet["width"], packet["height"], packet["prediction"],
                    packet["frame_number"], packet["timestamp_us"])
        if self.sequence is None:
            if packet["prediction"] != 0:
                raise ValueError("new source must start at internal prediction zero")
        elif (sequence[:3] != self.sequence[:3] or sequence[3] != self.sequence[3] + 1 or
              sequence[4] < self.sequence[4] or sequence[5] < self.sequence[5]):
            raise ValueError("ordered contiguous predictions on one source required; new core after seek")
        self.models.verify()
        timings = dict.fromkeys(STAGES, 0.0)
        stages_run, tensors, heads, faces = [], {}, {}, []
        face = packet["face"]
        extra = packet["runtime_state"]["base_output_mode_bit"]
        state = identity = profile = None
        if face is not None:
            identity = (face["slot"], face["alignment"], face["id"])
            profile = json.dumps(dict(smoothing=face["smoothing"], tables=face["tables"],
                                      runtime_state=packet["runtime_state"]), sort_keys=True)
            mode = face["mode"]
            if self.state is not None and (identity != self.identity or profile != self.profile):
                raise ValueError("unobserved identity/table/parameter/route transition; clear history first")
            if self.state is None and face["id"] in self.seen_ids:
                raise ValueError("reactivated native face ID is unsupported")
            if (mode == "update" and self.state is None) or (mode == "seed-160" and self.state is not None):
                raise ValueError("missing or unexpected owned initialization")
            seed = None
            if mode == "seed-160":
                init = face["initialization"]
                pixels = measured(timings=timings, name="sampling-160", function=prepare,
                                  frame=rgba, call=init["call"])["tensor"]
                tensors["160"] = hashlib.sha256(pixels.tobytes()).hexdigest()
                heads["160"] = measured(timings=timings, name="inference-160", function=self.models.infer,
                                        size=160, values=pixels)
                heads["160"] = validate_heads(outputs=heads["160"], size=160)
                decoded = measured(timings=timings, name="decode-160", function=reorder_landmarks,
                    raw_pairs=heads["160"]["fc_landmark_s1"].reshape(106, 2),
                    destinations=np.asarray(face["tables"]["order"], np.int32))
                seed = measured(timings=timings, name="map-160", function=map_double,
                    points=decoded, inverse=np.asarray(init["detection_inverse"], np.float32))
                stages_run.extend(("sampling-160", "inference-160", "decode-160", "map-160"))
            pixels = measured(timings=timings, name="sampling-120", function=signed_input,
                              frame=rgba, forward=np.asarray(face["forward"], np.float32))
            tensors["120"] = hashlib.sha256(pixels.tobytes()).hexdigest()
            heads["120"] = measured(timings=timings, name="inference-120", function=self.models.infer,
                                    size=120, values=pixels)
            heads["120"] = validate_heads(outputs=heads["120"], size=120)
            decoded_120, tracked = measured(timings=timings, name="decode-map-120", function=decode_actual,
                raw=heads["120"]["fc_landmark_s1"].reshape(106, 2),
                snapshot={"tables": face["tables"]}, face=face)
            temporal_start = time.perf_counter_ns()
            state = self.state
            if mode in ("seed-160", "reset-120"):
                state = smoothing_state(points=seed if mode == "seed-160" else tracked,
                                        parameters=face["smoothing"])
            points = tracked
            if mode != "reset-120":
                points, state = update_primary(state=state, points=tracked, extra=extra)
            timings["temporal-smoothing"] += (time.perf_counter_ns() - temporal_start) / 1e6
            smoothed = points
            points = measured(timings=timings, name="normalization", function=normalized,
                points=points, request=[0, packet["width"], packet["height"], packet["stride"], 0])
            faces = [dict(id=face["id"], points=points.tolist())]
            stages_run.extend(("sampling-120", "inference-120", "decode-map-120",
                               "temporal-smoothing", "normalization"))
        result = dict(schema="face-live-candidate-result-v1", source="dependency-fed-research-inference",
            backend_version=self.models.version, source_key=packet["source_key"],
            prediction=packet["prediction"], frame_number=packet["frame_number"],
            timestamp_us=packet["timestamp_us"], algorithm_rgba_sha256=packet["rgba_sha256"],
            dependency_sha256=hashlib.sha256(json.dumps(packet, sort_keys=True, allow_nan=False).encode()).hexdigest(),
            algorithm_width=packet["width"], algorithm_height=packet["height"], faces=faces,
            coordinate_space="normalized-x-and-flipped-y-float32",
            input_tensor_sha256=tensors,
            heads={size: {name: dict(shape=list(value.shape), sha256=hashlib.sha256(value.tobytes()).hexdigest())
                          for name, value in output.items()} for size, output in heads.items()},
            stage_timings_ms=timings, stages_run=stages_run,
            primary_smoothing=dict(route="ordinary-extra-primary106" if extra else "ordinary-base-primary106",
                native_library_sha256=LENS_SHA256, evidence="pinned-arm64-static-disassembly",
                native_output_entrypoint="0x37b880" if extra else "0x37cc58",
                update_order=[73, 33, 73] if extra else [33, 73],
                extra_stage2_geometry_parity_verified=False),
            total_ms=(time.perf_counter_ns() - started) / 1e6,
            native_dependencies=list(NATIVE_DEPENDENCIES), native_final_point_input_used=False,
            captured_tensor_input_used=False, native_analysis_bypassed=False,
            native_callback_connected=False, arbitrary_frame_backend_connected=False,
            renderer_connected=False, product_parity_verified=False,
            candidate_parity_verified=False, dependency_origin="caller-supplied-unattested")
        if check_output is not None:
            # Auditors may reject, but cannot replace or mutate candidate coordinates.
            if check_output(result=copy.deepcopy(result)) is not None:
                raise ValueError("output checker must return None, never corrected points")
        self.models.verify()
        result["total_ms"] = (time.perf_counter_ns() - started) / 1e6
        if self.stage_observer is not None:
            snapshot = stage_snapshot(packet=packet, result=result, seed=seed,
                decoded=decoded_120, mapped=tracked, smoothed=smoothed, normalized=points, state=state)
            if self.stage_observer(snapshot=snapshot) is not None:
                raise ValueError("stage observer must return None")
        # Commit only after inference, normalization and all provenance guards succeed.
        self.state, self.identity, self.profile, self.sequence = state, identity, profile, sequence
        if face is not None:
            self.seen_ids.add(face["id"])
        return result


def serve(*, core, stream, output):
    while True:
        line = stream.readline(128 * 1024 + 1)
        if not line:
            return
        if len(line) > 128 * 1024:
            raise ValueError("dependency line exceeds 128 KiB; stream terminated")
        try:
            if not line.endswith(b"\n"):
                raise ValueError("truncated protocol line: newline terminator required")
            request = strict_json(data=line)
            fields(value=request, names=("rgba_path", "packet"))
            packet = validate_metadata(packet=request["packet"])
            if type(request["rgba_path"]) is not str:
                raise ValueError("explicit absolute algorithm RGBA path required")
            path = Path(request["rgba_path"])
            if not path.is_absolute():
                raise ValueError("explicit absolute algorithm RGBA path required")
            locked = LockedFiles()
            size = packet["stride"] * packet["height"]
            data = locked.read(path=path, maximum=size, expected=packet["rgba_sha256"])
            if len(data) != size:
                raise ValueError("algorithm RGBA byte length differs from validated dimensions")
            rgba = np.frombuffer(data, np.uint8).reshape(packet["height"], packet["width"], 4)
            result = core.process(packet=packet, rgba=rgba)
            reply = dict(ok=True, result=result)
        except Exception as error:
            reply = dict(ok=False, error=f"{type(error).__name__}: {error}",
                         arbitrary_frame_backend_connected=False)
        output.write(json.dumps(reply, allow_nan=False) + "\n")
        output.flush()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--inspect", action="store_true")
    args = parser.parse_args()
    models = OnnxHeads(root=args.root)
    if args.inspect:
        print(json.dumps(dict(backend_version=models.version, provenance=models.provenance,
            state="core-only-production-blocked", native_dependencies=NATIVE_DEPENDENCIES,
            blockers=["native-per-prediction-callback-missing", "owned-result-render-handoff-missing"],
            arbitrary_frame_backend_connected=False), indent=2))
        return
    serve(core=CandidateCore(models=models), stream=sys.stdin.buffer, output=sys.stdout)


if __name__ == "__main__":
    main()
