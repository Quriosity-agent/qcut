"""Per-prediction audit adapter for the dependency-fed persistent core.

The caller must first validate the fresh capture/stream, source hashes, native
neutrality, and prediction associations. This adapter does NOT bless old captures
or convert fixed replay into a live backend. It never starts native/GPU capture.

CandidateAudit.process accepts the core packet/RGBA plus comparison-only
references indexed by model size: {120: {"tensor": ndarray, "heads": {name:
ndarray}, "graph_bytes": bytes}, 160: ...}. owned_faces is independently produced
by the existing owned decode/temporal pipeline, never a core input. No-face
packets require empty references; rejected native inferences need a separate
diagnostic, not publication of rejected/stale points. Keep every report bound
to the external validated stream SHA; this adapter cannot attest its origin.
"""
from __future__ import annotations

import hashlib
import threading

import numpy as np

from espresso_graph import analyze
from face_alignment_heads_parity import comparisons
from face_alignment_input_verify import difference
from face_alignment_replay import point_difference
from face_live_candidate import CandidateCore
from face_live_candidate_contract import fields
from face_live_candidate_onnx import validate_heads


def compare_prediction(*, observed, references, owned_faces, result, provenance):
    if type(references) is not dict or set(references) != set(observed):
        raise ValueError("exact model references for this accepted prediction required")
    report = dict(passed=False, reference_origin_verified=False, models={}, points=[],
                  tensor_tolerance=0, owned_point_tolerance=0,
                  arbitrary_frame_backend_connected=False)
    for size, candidate in observed.items():
        reference = references[size]
        fields(value=reference, names=("tensor", "heads", "graph_bytes"))
        graph_bytes = reference["graph_bytes"]
        if (type(graph_bytes) is not bytes or not 0 < len(graph_bytes) <= 1024**2 or
                hashlib.sha256(graph_bytes).hexdigest() != provenance["models"][str(size)]["graph_sha256"]):
            raise ValueError("oracle graph must match the executing model's pinned graph")
        graph = analyze(graph_bytes.decode("utf-8"))
        checkers = comparisons(graph=graph)
        heads = validate_heads(outputs=reference["heads"], size=size)
        tensor = reference["tensor"]
        if type(tensor) is not np.ndarray:
            raise ValueError("comparison tensor array required")
        checks = dict(tensor=difference(actual=candidate["tensor"], expected=tensor), heads={})
        for name, actual in candidate["heads"].items():
            checks["heads"][name] = checkers[name](actual=actual, expected=heads[name],
                descriptor=graph["descriptors"][name], raw=[4, 0])
        report["models"][str(size)] = checks
    if type(owned_faces) is not list or len(owned_faces) != len(result["faces"]):
        raise ValueError("owned pipeline face count mismatch")
    for candidate, expected in zip(result["faces"], owned_faces, strict=True):
        fields(value=expected, names=("id", "points"))
        if type(expected["id"]) is not int or expected["id"] != candidate["id"]:
            raise ValueError("owned pipeline face identity mismatch")
        points = np.asarray(expected["points"])
        if points.shape != (106, 2) or points.dtype.kind not in "fi" or not np.isfinite(points).all():
            raise ValueError("finite owned comparison points required")
        report["points"].append(point_difference(actual=np.asarray(candidate["points"], np.float32),
                                                expected=points.astype(np.float32), tolerance=0))
    report["passed"] = (all(row["tensor"].get("exact") is True and
        all(head["passed"] for head in row["heads"].values()) for row in report["models"].values()) and
        all(row["exact"] for row in report["points"]))
    return report


class ObservedModels:
    def __init__(self, *, models):
        self.models, self.version, self.observed = models, models.version, {}

    def verify(self):
        self.models.verify()

    def infer(self, *, size, values):
        if size in self.observed:
            raise ValueError("duplicate Stage1 execution within one prediction")
        outputs = self.models.infer(size=size, values=values)
        self.observed[size] = dict(tensor=values.copy(), heads=validate_heads(outputs=outputs, size=size))
        return outputs


class CandidateAudit:
    def __init__(self, *, models):
        self.models = ObservedModels(models=models)
        self.core = CandidateCore(models=self.models)
        self.last_report = None
        self.busy = threading.Lock()

    def process(self, *, packet, rgba, references, owned_faces):
        if not self.busy.acquire(blocking=False):
            raise RuntimeError("one audited prediction at a time required")
        try:
            return self._process(packet=packet, rgba=rgba, references=references, owned_faces=owned_faces)
        finally:
            self.busy.release()

    def _process(self, *, packet, rgba, references, owned_faces):
        self.models.observed = {}
        self.last_report = None

        def check_output(*, result):
            self.last_report = compare_prediction(observed=self.models.observed, references=references,
                owned_faces=owned_faces, result=result, provenance=self.models.models.provenance)
            if not self.last_report["passed"]:
                raise ValueError("candidate tensor/head/owned-point audit failed; no correction")

        try:
            result = self.core.process(packet=packet, rgba=rgba, check_output=check_output)
            self.last_report["prediction"] = result["prediction"]
            self.last_report["stage_timings_ms"] = result["stage_timings_ms"]
            self.last_report["total_ms_including_audit_and_guards"] = result["total_ms"]
            return result, self.last_report
        except Exception:
            if self.last_report is not None:
                self.last_report["passed"] = False
            raise
        finally:
            self.models.observed = {}
