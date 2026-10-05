"""CPU receipt audit of primary-106 post-load XY, not GPU or product parity."""
from __future__ import annotations

import math
import struct

POINT_COUNT = 106
MAX_PASSES = 8
MAX_POINTER = 2**64 - 1
POINT_FIELDS = frozenset((
    "prediction", "thread", "binding_id", "graph_id", "graph", "base", "points_begin",
    "source_address", "point_index", "face_id", "width", "height", "loaded_bits",
    "memory_bits", "caller_offset", "observation", "renderer_consumption",
))
LIFECYCLE = (
    ("live_render_stage_begin", 0), ("live_candidate_received", 0),
    ("live_makeup_publication", 0), ("live_makeup_update_exit", 0),
    ("live_owned_rollback", 0), ("live_render_stage_complete", 0),
    ("live_feature_parameters_applied", 0), ("live_initialization_output_suppressed", 0),
    ("live_render_stage_begin", 1), ("live_candidate_received", 1),
    ("live_makeup_publication", 1), ("live_makeup_update_exit", 1),
    ("live_owned_rollback", 1),
)


def require(*, condition, message):
    if not condition:
        raise ValueError(message)


def integer(*, value, minimum=0, maximum=2**53 - 1):
    require(condition=type(value) is int and minimum <= value <= maximum,
            message="typed bounded integer required")
    return value


def object_record(*, value):
    require(condition=type(value) is dict, message="audit object required")
    return value


def equal_integer(*, row, key, expected):
    integer(value=row.get(key), maximum=MAX_POINTER)
    require(condition=row[key] == expected, message=f"{key} association mismatch")


def no_consumption(*, row, required=False):
    if required or "renderer_consumption" in row:
        require(condition=row.get("renderer_consumption") is False,
                message="renderer consumption is outside point-read evidence")
    for key in ("product_parity_verified", "pipeline_acceptance"):
        if key in row:
            require(condition=row[key] is False, message=f"unsupported claim: {key}")


def worker_points(*, worker, pid, token, source_key):
    require(condition=type(worker) is list and len(worker) == 2,
            message="exactly two cold worker predictions required")
    points_by_prediction, dimensions = [], []
    for index, row in enumerate(worker):
        object_record(value=row)
        require(condition=row.get("ok") is True and row.get("token") == token,
                message="worker session mismatch")
        for key, expected in dict(pid=pid, prediction=index, timestamp_us=0).items():
            equal_integer(row=row, key=key, expected=expected)
        result = object_record(value=row.get("result"))
        require(condition=result.get("schema") == "face-live-candidate-result-v1" and
                result.get("source_key") == source_key, message="worker result source mismatch")
        for key, expected in dict(prediction=index, frame_number=index, timestamp_us=0).items():
            equal_integer(row=result, key=key, expected=expected)
        no_consumption(row=row)
        no_consumption(row=result)
        dimensions.append(tuple(integer(value=result.get(key), minimum=1, maximum=4096)
                                for key in ("algorithm_width", "algorithm_height")))
        faces = result.get("faces")
        require(condition=type(faces) is list and len(faces) == 1, message="single face required")
        face = object_record(value=faces[0])
        equal_integer(row=face, key="id", expected=0)
        points = face.get("points")
        require(condition=type(points) is list and len(points) == POINT_COUNT,
                message="106 primary candidate points required")
        for pair in points:
            require(condition=type(pair) is list and len(pair) == 2, message="XY pair required")
            for value in pair:
                require(condition=type(value) in (int, float) and 0 <= value <= 1 and math.isfinite(value),
                        message="finite normalized candidate coordinate required")
        points_by_prediction.append(points)
    require(condition=dimensions[0] == dimensions[1], message="algorithm geometry changed")
    return points_by_prediction


def publications(*, records):
    require(condition=type(records) is list and 1 <= len(records) <= 4096,
            message="bounded host records required")
    relevant, published = [], []
    kinds = {kind for kind, _ in LIFECYCLE}
    for row in records:
        object_record(value=row)
        no_consumption(row=row)
        kind = row.get("event")
        require(condition=kind is None or type(kind) is str, message="invalid host event name")
        require(condition=kind not in ("live_owned_conversion", "live_owned_restored"),
                message="conversion receipts are outside rollback-only point audit")
        if kind in kinds:
            relevant.append(row)
    require(condition=len(relevant) == len(LIFECYCLE), message="incomplete or duplicate host lifecycle")
    for row, (kind, prediction) in zip(relevant, LIFECYCLE, strict=True):
        require(condition=row["event"] == kind, message="host stage order mismatch")
        equal_integer(row=row, key="timestamp_us", expected=0)
        if kind != "live_render_stage_begin" or "prediction" in row:
            equal_integer(row=row, key="prediction", expected=prediction)
        if kind not in ("live_candidate_received", "live_owned_rollback"):
            no_consumption(row=row, required=True)
        if kind in ("live_render_stage_begin", "live_render_stage_complete"):
            require(condition=row.get("stage") == ("initializing" if prediction == 0 else "rendering"),
                    message="incorrect cold render stage")
        if kind == "live_render_stage_complete":
            require(condition=row.get("source_restored") is True, message="initial source not restored")
        if kind == "live_feature_parameters_applied":
            equal_integer(row=row, key="result", expected=0)
        if kind == "live_makeup_publication":
            validate_publication(row=row, prediction=prediction)
            published.append(row)
        if kind == "live_owned_rollback":
            for key in ("binding_id", "graph_id"):
                equal_integer(row=row, key=key, expected=published[prediction][key])
            require(condition=row.get("gpu_complete") is True and row.get("original_restored") is True,
                    message="publication rollback incomplete")
    validate_isolation(published=published)
    for row, (_, prediction) in zip(relevant, LIFECYCLE, strict=True):
        for key in ("binding_id", "graph_id", "graph", "thread", "face_id"):
            if key in row:
                equal_integer(row=row, key=key, expected=published[prediction][key])
    return published


def validate_publication(*, row, prediction):
    for key, expected in dict(binding_id=prediction + 1, graph_id=1, faces=1, face_id=0).items():
        equal_integer(row=row, key=key, expected=expected)
    integer(value=row.get("thread"), minimum=1, maximum=MAX_POINTER)
    for key in ("graph", "source_buffer", "owned_buffer", "source_base", "source_points",
                "owned_base", "owned_points"):
        integer(value=row.get(key), minimum=4096, maximum=MAX_POINTER)
    require(condition=row.get("candidate_injected") is True, message="candidate not published")


def validate_isolation(*, published):
    first, second = published
    for key in ("graph", "thread"):
        require(condition=first[key] == second[key], message=f"publication {key} changed")
    owned, sources = [], set()
    for row in published:
        addresses = [row[f"{owner}_{field}"] for owner in ("source", "owned")
                     for field in ("buffer", "base", "points")]
        require(condition=len(set(addresses + [row["graph"]])) == 7,
                message="aliased publication pointers")
        owned.extend(row[f"owned_{field}"] for field in ("buffer", "base", "points"))
        sources.update(row[f"source_{field}"] for field in ("buffer", "base", "points"))
    require(condition=len(set(owned)) == 6 and not set(owned).intersection(sources),
            message="owned storage reused or aliases source storage")
    for row in published:
        begin, end = row["owned_points"], row["owned_points"] + POINT_COUNT * 8
        require(condition=end <= MAX_POINTER, message="point vector address overflow")
        require(condition=all(not begin <= address < end for address in
                              (sources | set(owned) | {row["graph"]}) - {begin}),
                message="owned point vector overlaps publication storage")
        for source in published:
            source_begin = source["source_points"]
            source_end = source_begin + POINT_COUNT * 8
            require(condition=source_end <= MAX_POINTER and (end <= source_begin or source_end <= begin),
                    message="owned point vector overlaps source vector")


def point_reads(*, trace, publication, points):
    object_record(value=trace)
    require(condition=trace.get("target_memory_written") is False, message="point observer wrote target memory")
    no_consumption(row=trace, required=True)
    events = trace.get("events")
    require(condition=type(events) is list and POINT_COUNT <= len(events) <= POINT_COUNT * MAX_PASSES and
            len(events) % POINT_COUNT == 0, message="one to eight complete primary-106 passes required")
    equal_integer(row=trace, key="hits", expected=len(events))
    geometry, caller = None, None
    for position, event in enumerate(events):
        object_record(value=event)
        require(condition=set(event) == POINT_FIELDS, message="unexpected point event fields")
        point_index = position % POINT_COUNT
        expected = dict(prediction=1, point_index=point_index, face_id=publication["face_id"],
                        thread=publication["thread"], binding_id=publication["binding_id"],
                        graph_id=publication["graph_id"], graph=publication["graph"],
                        base=publication["owned_base"], points_begin=publication["owned_points"],
                        source_address=publication["owned_points"] + point_index * 8)
        for key, value in expected.items():
            equal_integer(row=event, key=key, expected=value)
        current = tuple(integer(value=event[key], minimum=1, maximum=4096) for key in ("width", "height"))
        require(condition=geometry is None or geometry == current, message="point geometry changed")
        geometry = current
        integer(value=event["caller_offset"])
        require(condition=event["caller_offset"] in (0x9EB7BC, 0x9EB9C4), message="unknown XY reader caller")
        if point_index == 0:
            caller = event["caller_offset"]
        require(condition=event["caller_offset"] == caller, message="caller changed inside point pass")
        require(condition=event["observation"] == "post-load-source-xy", message="post-load observation required")
        no_consumption(row=event, required=True)
        expected_bits = list(struct.unpack("<2I", struct.pack("<2f", *points[point_index])))
        for key in ("loaded_bits", "memory_bits"):
            bits = event[key]
            require(condition=type(bits) is list and len(bits) == 2, message="two float32 words required")
            for word in bits:
                integer(value=word, maximum=2**32 - 1)
            require(condition=bits == expected_bits, message=f"{key} differs from candidate float32 XY")
    return dict(point_count=POINT_COUNT, read_count=len(events), pass_count=len(events) // POINT_COUNT,
                width=geometry[0], height=geometry[1])


def audit(*, worker, observer, records, token, source_key) -> dict:
    """Trust the read-only observer's hardware/UUID/PC guard, then bind its receipts.

    Events are authored during the callback after 0xa207ec ldp s2,s3, at
    0xa207f0 before scaling. They have no independent timestamp: their binding
    identifies the flushed publication whose cold timestamp is checked here.
    """
    require(condition=type(token) is str and bool(token) and type(source_key) is str and bool(source_key),
            message="nonempty session token and source key required")
    object_record(value=observer)
    require(condition=observer.get("passed") is True and observer.get("failures") == [] and
            observer.get("observer_failures") == [] and observer.get("unexpected_stops") == [],
            message="successful point observer required")
    equal_integer(row=observer, key="predictions", expected=2)
    pid = integer(value=observer.get("pid"), minimum=1, maximum=2**31 - 1)
    no_consumption(row=observer)
    for key in ("target_memory_written", "software_breakpoints_used", "target_functions_evaluated"):
        require(condition=observer.get(key) is False, message=f"read-only observer receipt required: {key}")
    points = worker_points(worker=worker, pid=pid, token=token, source_key=source_key)
    published = publications(records=records)
    publication = published[1]
    summary = point_reads(trace=observer.get("point_trace"), publication=publication, points=points[1])
    return dict(schema="face-live-makeup-point-audit-v1", **summary, native_pid=pid, predictions=2,
                prediction=1, timestamp_us=0, binding_id=publication["binding_id"], graph_id=publication["graph_id"],
                graph=publication["graph"], thread=publication["thread"], face_id=publication["face_id"],
                observation="post-load-source-xy", candidate_xy_reads_verified=True,
                renderer_consumption=False, product_parity_verified=False, pipeline_acceptance=False,
                extra_points_verified=False, target_memory_written=False)
