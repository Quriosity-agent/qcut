"""Strict receipts and zero-delta render audit, not native head-value parity."""
from __future__ import annotations

import hashlib
import math
from pathlib import Path

import numpy as np

from face_alignment_replay import strict_json, valid_hash
from face_live_candidate import STAGES
from face_live_candidate_onnx import head_shapes
from face_owned_result_probe import validate_audits
from face_render_stability_probe import frame_metrics
import face_render_sequence_probe as sequence


def require(*, condition, message):
    if not condition:
        raise ValueError(message)


def number(*, value, minimum=0, maximum=1e9):
    require(condition=type(value) in (int, float) and math.isfinite(value) and minimum <= value <= maximum,
            message="finite bounded audit number required")


def integer(*, value, maximum=2**53 - 1):
    require(condition=type(value) is int and 0 <= value <= maximum, message="typed audit integer required")


def json_lines(*, path):
    data = sequence.bounded_bytes(path=path, limit=4 * 1024**2)
    require(condition=bool(data) and data.endswith(b"\n"), message="complete nonempty JSONL required")
    lines = data.splitlines()
    require(condition=len(lines) <= 4096 and all(len(line) <= 128 * 1024 for line in lines),
            message="bounded JSONL records required")
    rows = [strict_json(data=line) for line in lines]
    require(condition=all(type(row) is dict for row in rows), message="audit object records required")
    return rows


def protocol(*, data, requests):
    text = data.decode("utf-8", errors="strict")
    rows = [line for line in text.splitlines() if line.startswith("QCUT\t")]
    expected = ["QCUT\tREADY\t1", *(f"QCUT\tRESULT\t{row['id']}\t0" for row in requests)]
    require(condition=rows == expected and "[research-error]" not in text,
            message="fresh host did not acknowledge every request exactly once")
    return dict(requests=len(requests), rows=rows)


def observer_groups(*, observer, count):
    require(condition=observer.get("passed") is True and observer.get("failures") == [] and
            observer.get("observer_failures") == [] and observer.get("predictions") == count,
            message="complete live entry observer report required")
    for key in ("target_memory_written", "software_breakpoints_used", "target_functions_evaluated"):
        require(condition=observer.get(key) is False, message=f"forbidden observer operation: {key}")
    events = observer.get("events")
    require(condition=type(events) is list and 1 <= len(events) <= 4096, message="live observer events required")
    integer(value=observer.get("callbacks"), maximum=4096)
    require(condition=observer["callbacks"] >= len(events), message="observer callback count mismatch")
    groups, index, owner = [], -1, None
    for row in events:
        require(condition=type(row) is dict and set(row) == {"op", "prediction", "data"},
                message="invalid observer event envelope")
        integer(value=row["prediction"], maximum=count - 1)
        require(condition=type(row["data"]) is dict, message="observer event data required")
        if row["op"] == "begin":
            require(condition=row["prediction"] == index + 1, message="observer begin duplicate or gap")
            integer(value=row["data"].get("owner"))
            current = row["data"]["owner"]
            require(condition=current >= 4096 and (owner is None or owner == current), message="native owner changed")
            owner, index = current, index + 1
            groups.append([])
        else:
            require(condition=index >= 0 and row["prediction"] == index and row["op"] in ("call", "infer"),
                    message="event outside current native prediction")
            groups[-1].append(row)
    require(condition=len(groups) == count, message="missing observer prediction")
    return groups


def heads_and_points(*, result, events):
    faces, heads, tensors = result.get("faces"), result.get("heads"), result.get("input_tensor_sha256")
    require(condition=type(faces) is list and len(faces) <= 1, message="single-face result required")
    require(condition=type(heads) is dict and type(tensors) is dict and set(heads) == set(tensors),
            message="per-model head/tensor inventory mismatch")
    require(condition=set(heads) in (set(), {"120"}, {"120", "160"}) and bool(heads) == bool(faces),
            message="invalid owned inference route")
    if faces:
        require(condition=type(faces[0]) is dict and set(faces[0]) == {"id", "points"}, message="invalid face result")
        integer(value=faces[0]["id"], maximum=2**31 - 1)
        points = faces[0]["points"]
        require(condition=type(points) is list and len(points) == 106, message="106 candidate points required")
        for pair in points:
            require(condition=type(pair) is list and len(pair) == 2, message="XY pair required")
            for value in pair:
                number(value=value, maximum=1)
    head_count = 0
    for size, rows in heads.items():
        require(condition=valid_hash(value=tensors[size]), message="invalid generated tensor hash")
        shapes = head_shapes(size=int(size))
        require(condition=type(rows) is dict and set(rows) == set(shapes), message="all five heads required")
        for name, count in shapes.items():
            record = rows[name]
            require(condition=type(record) is dict and set(record) == {"shape", "sha256"} and
                    record["shape"] == [1, 1, 1, count] and valid_hash(value=record["sha256"]),
                    message="head shape/hash mismatch")
            for dimension in record["shape"]:
                integer(value=dimension, maximum=212)
            head_count += 1
    pending, native_sizes = None, []
    for event in events:
        data = event["data"]
        if event["op"] == "call":
            require(condition=pending is None, message="ambiguous pending crop call")
            require(condition=set(data) == {"alignment", "call", "source"}, message="entry caller fields required")
            source = data["source"]
            require(condition=type(source) is dict and set(source) == {"width", "height", "sha256"} and
                    [source["width"], source["height"]] == [result["algorithm_width"], result["algorithm_height"]] and
                    valid_hash(value=source["sha256"]), message="crop source descriptor differs")
            pending = data
            continue
        require(condition=set(data) == {"size", "network", "detection_inverse"} and
                type(data["size"]) is int and data["size"] in (120, 160), message="invalid native inference event")
        integer(value=data["network"])
        require(condition=data["network"] >= 4096, message="invalid native network")
        native_sizes.append(data["size"])
        if data["size"] == 160:
            require(condition=pending is not None and type(data["detection_inverse"]) is list,
                    message="160 lacks actual entry caller/inverse")
            matrix = np.asarray(data["detection_inverse"], dtype=np.float32)
            require(condition=matrix.shape == (2, 3) and np.isfinite(matrix).all(), message="invalid entry inverse")
            pending = None
        else:
            require(condition=pending is None and data["detection_inverse"] is None, message="unconsumed 160 caller")
    require(condition=pending is None, message="crop caller lacks matching predictor")
    if faces:
        allowed = ([160, 120], [160, 120, 160]) if "160" in heads else ([120], [120, 160])
        require(condition=native_sizes in allowed, message="native inference order outside single-face profile")
    expected_stages = list(STAGES if "160" in heads else STAGES[4:]) if faces else []
    require(condition=result.get("stages_run") == expected_stages, message="owned stage receipt mismatch")
    timings = result.get("stage_timings_ms")
    require(condition=type(timings) is dict and set(timings) == set(STAGES), message="every stage timing required")
    for name, value in timings.items():
        number(value=value)
        require(condition=name in expected_stages or value == 0, message="inactive stage has runtime")
    number(value=result.get("total_ms"))
    return head_count, len(faces), native_sizes


def callbacks(*, worker, observer, records, timestamps, token, source_key):
    count = len(timestamps)
    require(condition=2 < count <= 60 and len(worker) == count, message="every internal prediction needs a worker result")
    groups = observer_groups(observer=observer, count=count)
    pid, version, head_count, point_groups, seeds = None, None, 0, 0, []
    for index, (row, events, timestamp) in enumerate(zip(worker, groups, timestamps, strict=True)):
        integer(value=row.get("prediction"), maximum=count - 1)
        integer(value=row.get("timestamp_us"))
        require(condition=row.get("ok") is True and row.get("token") == token and row.get("prediction") == index and
                row.get("timestamp_us") == timestamp, message="worker session/prediction/time association mismatch")
        integer(value=row.get("pid"), maximum=2**31 - 1)
        require(condition=row["pid"] > 0 and (pid is None or pid == row["pid"]), message="native PID changed")
        pid = row["pid"]
        result = row.get("result")
        require(condition=type(result) is dict and result.get("schema") == "face-live-candidate-result-v1" and
                result.get("source") == "dependency-fed-research-inference" and result.get("source_key") == source_key and
                result.get("prediction") == index and result.get("frame_number") == index and
                result.get("timestamp_us") == timestamp, message="core result association mismatch")
        for key in ("prediction", "frame_number", "timestamp_us"):
            integer(value=result[key])
        for key in ("native_final_point_input_used", "captured_tensor_input_used", "native_analysis_bypassed",
                    "product_parity_verified", "candidate_parity_verified", "arbitrary_frame_backend_connected"):
            require(condition=result.get(key) is False, message=f"unsupported provenance claim: {key}")
        for key in ("algorithm_rgba_sha256", "dependency_sha256"):
            require(condition=valid_hash(value=result.get(key)), message="candidate dependency hash required")
        current = result.get("backend_version")
        require(condition=type(current) is str and current.startswith("dependency-core-v1:") and
                valid_hash(value=current.split(":", 1)[1]) and (version is None or version == current),
                message="model/source backend identity changed")
        version = current
        for key in ("algorithm_width", "algorithm_height"):
            integer(value=result.get(key), maximum=4096)
            require(condition=result[key] > 0, message="nonempty algorithm pixels required")
        count_heads, count_points, sizes = heads_and_points(result=result, events=events)
        head_count, point_groups = head_count + count_heads, point_groups + count_points
        proof = row.get("initialization_proof")
        if "160" in result["heads"]:
            require(condition=type(proof) is dict and proof.get("association_mode") == "single-face-pretracking-160" and
                    proof.get("seed_record_index") == 0 and proof.get("tracking_record_index") == 1 and
                    proof.get("tracking_inference") == 0 and proof.get("excluded_160_inferences") ==
                    ([1] if sizes == [160, 120, 160] else []) and
                    proof.get("caller_source") == "live-ProcessDetectionImage-entry" and
                    proof.get("inverse_source") == "same-call-160-predictor-entry", message="causal seed proof missing")
            seeds.append(index)
        else:
            require(condition=proof is None, message="post-tracking detection must not reseed")
        ownership = row.get("stage_ownership", {})
        for key in ("native_analysis_bypassed", "live_parity_verified", "product_backend_registered"):
            require(condition=ownership.get(key) is False, message="worker overstates ownership/parity")
        for key, expected in dict(full_frame_rgba="native", detection="native",
                crop_caller_and_geometry="native-live-observed", sampling="owned", heads="owned-onnx-cpu",
                temporal="owned", acceptance_and_reset="native", renderer="native-owned-clone-required").items():
            require(condition=ownership.get(key) == expected, message="per-stage native dependencies mislabelled")
    receipts, pending, converted, restored = [], None, [], []
    for event in records:
        kind = event.get("event")
        if kind == "live_candidate_received":
            index = len(receipts)
            require(condition=index < count and event.get("prediction") == index and
                    event.get("timestamp_us") == timestamps[index] and pending is None, message="consumer receipt ordering mismatch")
            receipts.append(index)
        if kind == "live_owned_conversion":
            index = event.get("prediction")
            require(condition=type(index) is int and index == len(converted) + 2 and index < count and
                    receipts and receipts[-1] == index and pending is None and
                    event.get("timestamp_us") == timestamps[index] and
                    event.get("faces") == len(worker[index]["result"]["faces"]) and
                    event.get("source_points_unchanged") is True and
                    event.get("candidate_source") == "fresh-worker-inference" and
                    event.get("native_analysis_bypassed") is False, message="owned handoff mismatch")
            pending = index
            converted.append(index)
        if kind == "live_owned_restored":
            require(condition=pending is not None and event.get("prediction") == pending and
                    event.get("gpu_complete") is True and event.get("original_restored") is True,
                    message="owned restoration/completion mismatch")
            restored.append(pending)
            pending = None
    require(condition=receipts == list(range(count)) and converted == restored == list(range(2, count)) and
            pending is None and seeds and point_groups, message="incomplete live callback/render coverage")
    ownership_audit = validate_audits(events=records, require_face=True)
    stage_times = {stage: [row["result"]["stage_timings_ms"][stage] for row in worker] for stage in STAGES}
    return dict(predictions=count, native_pid=pid, backend_version=version, seed_predictions=seeds,
        owned_head_receipts=head_count, owned_point_groups=point_groups, conversions=len(converted),
        restorations=len(restored), bootstrap_unrendered_predictions=[0, 1], clone_audit=ownership_audit,
        stage_runtime_ms={key: dict(total=sum(values), p50=float(np.percentile(values, 50)),
                                   p95=float(np.percentile(values, 95))) for key, values in stage_times.items()},
        native_head_value_parity_verified=False, native_point_value_parity_verified=False,
        head_receipts_are_hashes_not_native_comparisons=True)


def render_outputs(*, baseline, live, frames, width, height):
    require(condition=len(baseline) == len(live), message="render request inventory mismatch")
    results = []
    for left, right in zip(baseline, live, strict=True):
        require(condition={key: value for key, value in left.items() if key != "output"} ==
                {key: value for key, value in right.items() if key != "output"}, message="baseline/live requests differ")
        raw = [sequence.bounded_bytes(path=Path(row["output"]), limit=width * height * 4) for row in (left, right)]
        metric = frame_metrics(actual=raw[1], reference=raw[0], width=width, height=height)
        if not left["warmup"]:
            frame = frames[left["frame"]]
            source = sequence.bounded_bytes(path=Path(frame["input"]), limit=width * height * 4)
            require(condition=hashlib.sha256(source).hexdigest() == frame["input_sha256"], message="original input changed")
            changed = frame_metrics(actual=raw[0], reference=source, width=width, height=height)
            expect_change = frame.get("expect_change")
            require(condition=type(expect_change) is bool and
                    (changed["changed_pixels"] > 0) is expect_change,
                    message="effect control differs from expected original-pixel change")
            results.append(dict(frame=left["frame"], native_sha256=hashlib.sha256(raw[0]).hexdigest(),
                                original_difference=changed, **metric))
        require(condition=metric["equal"] is True, message=f"zero-tolerance render mismatch: {left['id']}")
    return results
