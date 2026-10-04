"""Persistent single-source worker for live native dependency callbacks.

The debugger supplies causal caller/inference events; the native post-predict
callback supplies fresh RGBA and geometry. No capture, tensor, or replay paths
are accepted. Any failure poisons this session; source reset requires restarting
both native host and worker. The product backend is deliberately not registered.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import socket

import numpy as np

from face_host_initialization import select_initialization
from face_live_candidate import CandidateCore
from face_live_candidate_contract import SCHEMA, array, fields, integer, validate_metadata
from face_live_candidate_onnx import OnnxHeads
from face_live_worker_protocol import receive, send


class LiveWorker:
    def __init__(self, *, models, token, source_key, trace_directory=None, extra_refinement=None):
        self.trace_directory = trace_directory
        self.extra_refinement = extra_refinement
        options = {} if extra_refinement is None else dict(extra_refinement=extra_refinement)
        if trace_directory is not None:
            options["stage_observer"] = self.record_stages
        self.core = CandidateCore(models=models, **options)
        self.token, self.source_key = token, source_key
        self.pending, self.pid, self.error = None, None, None
        self.index = -1

    def record_stages(self, *, snapshot):
        index = snapshot["prediction"]
        if type(index) is not int or index not in (0, 1) or snapshot["timestamp_us"] != 0:
            raise ValueError("candidate stage diagnostics require cold single-frame scope")
        snapshot.update(pid=self.pid, token_sha256=hashlib.sha256(self.token.encode()).hexdigest())
        with (self.trace_directory / f"candidate-{index}.json").open("x") as stream:
            json.dump(snapshot, stream, allow_nan=False)
            stream.write("\n")

    def dispatch(self, *, message, pixels=b""):
        if self.error is not None:
            raise RuntimeError("session poisoned; restart native host and worker")
        try:
            return self._dispatch(message=message, pixels=pixels)
        except Exception as error:
            self.error = f"{type(error).__name__}: {error}"
            raise

    def _dispatch(self, *, message, pixels):
        fields(value=message, names=("op", "token", "pid", "prediction", "data"))
        if message["token"] != self.token:
            raise ValueError("worker session token mismatch")
        integer(value=message["pid"], minimum=1, maximum=2**31 - 1)
        integer(value=message["prediction"], maximum=4095)
        if self.pid is not None and message["pid"] != self.pid:
            raise ValueError("native process changed; explicit source reset required")
        op, data, index = message["op"], message["data"], message["prediction"]
        if op != "predict" and pixels:
            raise ValueError("pixels only belong to a post-prediction callback")
        if op == "cancel":
            raise RuntimeError("live session cancelled")
        if op == "begin":
            fields(value=data, names=("owner",))
            integer(value=data["owner"], minimum=4096)
            if self.pending is not None or index != self.index + 1:
                raise ValueError("unconsumed or unordered prediction begin")
            self.pid = message["pid"]
            self.pending = dict(index=index, owner=data["owner"], calls=[], inferences=[])
            return dict(ok=True)
        if self.pending is None or index != self.pending["index"]:
            raise ValueError("callback outside its native prediction")
        if op == "call":
            fields(value=data, names=("alignment", "call", "source"))
            integer(value=data["alignment"], minimum=4096)
            fields(value=data["source"], names=("width", "height", "sha256"))
            if len(self.pending["calls"]) >= 8:
                raise ValueError("too many detection calls")
            self.pending["calls"].append(copy.deepcopy(data))
            return dict(ok=True)
        if op == "infer":
            fields(value=data, names=("size", "network", "detection_inverse"))
            integer(value=data["size"], minimum=120, maximum=160)
            integer(value=data["network"], minimum=4096)
            if data["size"] not in (120, 160) or len(self.pending["inferences"]) >= 20:
                raise ValueError("unsupported predictor size/event count")
            events = self.pending["inferences"]
            event = dict(size=data["size"], network=str(data["network"]),
                         inference=sum(row["network"] == str(data["network"]) for row in events),
                         record_index=len(events))
            if data["size"] == 160:
                used = sum(row["size"] == 160 for row in events)
                if len(self.pending["calls"]) != used + 1:
                    raise ValueError("160 predictor lacks unique preceding caller")
                event["caller"] = self.pending["calls"][used]
                array(value=data["detection_inverse"], shape=(2, 3))
                event["detection_inverse"] = copy.deepcopy(data["detection_inverse"])
            elif data["detection_inverse"] is not None:
                raise ValueError("detection inverse only belongs to the 160 predictor entry")
            events.append(event)
            return dict(ok=True)
        if op != "predict":
            raise ValueError("unsupported live operation; reset requires new processes")
        fields(value=data, names=("owner", "width", "height", "stride", "format", "orientation",
                                  "runtime_state", "face", "predictors", "timestamp_us",
                                  *(("extra_geometry",) if self.extra_refinement is not None else ())))
        if data["owner"] != self.pending["owner"]:
            raise ValueError("post-prediction owner mismatch")
        for key in ("width", "height"):
            integer(value=data[key], minimum=1, maximum=4096)
        if len(pixels) != data["width"] * data["height"] * 4:
            raise ValueError("fresh RGBA byte count mismatch")
        integer(value=data["timestamp_us"])
        packet = {key:data[key] for key in ("width", "height", "stride", "format", "orientation", "runtime_state")}
        packet.update(schema=SCHEMA, source_key=self.source_key, prediction=index, frame_number=index,
            timestamp_us=data["timestamp_us"], rgba_sha256=hashlib.sha256(pixels).hexdigest(), face=None)
        events = self.pending["inferences"]
        if len(self.pending["calls"]) != sum(row["size"] == 160 for row in events):
            raise ValueError("unconsumed detection caller")
        if type(data["predictors"]) is not list or len(data["predictors"]) != 2:
            raise ValueError("two actual native predictor identities required")
        for predictor in data["predictors"]:
            fields(value=predictor, names=("network",))
            integer(value=predictor["network"], minimum=4096)
        if data["predictors"][0] == data["predictors"][1]:
            raise ValueError("native predictor identities must differ")
        for event in events:
            if event["network"] != str(data["predictors"][0 if event["size"] == 120 else 1]["network"]):
                raise ValueError("inference belongs to a different native predictor")
        proof = None
        if data["face"] is not None:
            face = copy.deepcopy(data["face"])
            fields(value=face, names=("id", "slot", "alignment", "forward", "inverse",
                                      "tables", "smoothing", "first"))
            if type(face["first"]) is not bool:
                raise ValueError("matched Base reset signal required")
            identity = tuple(face[key] for key in ("slot", "alignment", "id"))
            needs_seed = identity != self.core.identity and not face["first"]
            if len([row for row in events if row["size"] == 120]) != 1:
                raise ValueError("one live tracking inference required")
            initialization = None
            if needs_seed:
                snapshot = dict(index=index, bytenn_sequence=len(events), predictors=data["predictors"])
                selected, proof = select_initialization(snapshot=snapshot,
                    association=dict(prediction=index, neural_window=[0, len(events)], inferences=events))
                if selected["caller"]["alignment"] != face["alignment"]:
                    raise ValueError("seed caller does not own active alignment")
                initialization = dict(call=selected["caller"]["call"],
                                      detection_inverse=selected["detection_inverse"])
                proof.update(caller_source="live-ProcessDetectionImage-entry",
                             inverse_source="same-call-160-predictor-entry")
            packet["face"] = {key:face[key] for key in ("id", "slot", "alignment", "forward", "inverse", "tables", "smoothing")}
            packet["face"].update(mode="seed-160" if needs_seed else ("reset-120" if face["first"] else "update"),
                                   initialization=initialization)
        validate_metadata(packet=packet)
        rgba = np.frombuffer(pixels, np.uint8).reshape(data["height"], data["width"], 4)
        source = dict(width=data["width"], height=data["height"],
                      sha256=hashlib.sha256(rgba[:, :, :3][:, :, ::-1].tobytes()).hexdigest())
        if any(call["source"] != source for call in self.pending["calls"]):
            raise ValueError("live crop source does not match this prediction's algorithm RGBA")
        refinement = {} if self.extra_refinement is None else dict(extra_geometry=data["extra_geometry"])
        result = self.core.process(packet=packet, rgba=rgba, **refinement)
        self.index, self.pending = index, None
        return dict(ok=True, token=self.token, pid=self.pid, prediction=index, timestamp_us=data["timestamp_us"],
                    initialization_proof=proof, result=result,
                    stage_ownership=dict(full_frame_rgba="native", detection="native",
                        crop_caller_and_geometry="native-live-observed", sampling="owned",
                        heads="owned-onnx-cpu", temporal="owned", acceptance_and_reset="native",
                        renderer="native-owned-clone-required", native_analysis_bypassed=False,
                        live_parity_verified=False, product_backend_registered=False))


def serve(*, worker, path, log, timeout):
    if path.exists() or len(os.fsencode(path)) > 100:
        raise ValueError("fresh short Unix socket path required")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
        server.bind(str(path))
        os.chmod(path, 0o600)
        server.listen(4)
        server.settimeout(timeout)
        print(json.dumps(dict(ready=True, socket=str(path), backend_version=worker.core.models.version)), flush=True)
        try:
            while worker.error is None:
                connection, _ = server.accept()
                with connection:
                    try:
                        message, pixels = receive(connection=connection, timeout=timeout)
                        reply = worker.dispatch(message=message, pixels=pixels)
                        send(connection=connection, message=reply, timeout=timeout)
                        if message["op"] == "predict":
                            log.write(json.dumps(reply, allow_nan=False) + "\n")
                            log.flush()
                    except Exception as error:
                        worker.error = f"{type(error).__name__}: {error}"
                        failure = dict(ok=False, error=worker.error)
                        log.write(json.dumps(failure, allow_nan=False) + "\n")
                        log.flush()
                        try:
                            send(connection=connection, message=failure, timeout=1)
                        except OSError:
                            # A disconnected caller must not replace the original failure.
                            pass
        finally:
            path.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("root", "socket", "log"):
        parser.add_argument(f"--{name}", required=True, type=Path)
    parser.add_argument("--token", required=True)
    parser.add_argument("--source-key", required=True)
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--trace-directory", type=Path)
    parser.add_argument("--extra-root", type=Path)
    args = parser.parse_args()
    if not 1 <= args.timeout <= 120 or not 16 <= len(args.token) <= 128:
        parser.error("bounded timeout and session token required")
    if args.trace_directory is not None and (not args.trace_directory.is_absolute() or
            not args.trace_directory.is_dir() or any(args.trace_directory.iterdir())):
        parser.error("candidate trace directory must be absolute, empty and pre-created")
    extra_refinement = None
    if args.extra_root is not None:
        from face_extra_heads_onnx import ExtraHeads
        from face_live_extra_refinement import ExtraRefinement
        extra_refinement = ExtraRefinement(models=ExtraHeads(root=args.extra_root))
    worker = LiveWorker(models=OnnxHeads(root=args.root), token=args.token, source_key=args.source_key,
                        trace_directory=args.trace_directory, extra_refinement=extra_refinement)
    with args.log.open("x") as log:
        serve(worker=worker, path=args.socket, log=log, timeout=args.timeout)
    if worker.error:
        raise RuntimeError(worker.error)


if __name__ == "__main__":
    main()
