"""Pure receipt audit of a native CPU geometry consumer, not GPU/product parity.

Trust the read-only observer's hardware/UUID/PC guard as in point_audit.
Point loads have no independent timestamps; their flushed publication binding
supplies cold-stage context. No RGBA comparison or native execution occurs here.
"""
from __future__ import annotations

import face_live_makeup_conversion_math as conversion_math
import face_live_makeup_point_audit as point_audit
from face_live_makeup_point_audit import equal_integer, integer, object_record, require

LIFECYCLE = (
    ("live_render_stage_begin", 0), ("live_candidate_received", 0),
    ("live_makeup_publication", 0), ("live_makeup_update_exit", 0),
    ("live_owned_rollback", 0), ("live_render_stage_complete", 0),
    ("live_feature_parameters_applied", 0), ("live_initialization_output_suppressed", 0),
    ("live_render_stage_begin", 1), ("live_candidate_received", 1),
    ("live_makeup_publication", 1), ("live_makeup_geometry_enter", 1),
    ("live_makeup_geometry_complete", 1), ("live_makeup_conversion", 1),
    ("live_makeup_update_exit", 1), ("live_owned_restored", 1),
    ("live_render_stage_complete", 1),
)
CONTEXT_FIELDS = ("binding_id", "graph_id", "graph", "thread", "face_id")
OPTIONAL_CONSUMPTION = frozenset((
    "live_candidate_received", "live_owned_rollback", "live_owned_restored",
))


def _claims(*, row, consumed=False, required=False):
    if required or "renderer_consumption" in row:
        require(condition=row.get("renderer_consumption") is consumed,
                message="renderer consumption receipt mismatch")
    for key in ("product_parity_verified", "extra_points_verified", "pipeline_acceptance"):
        if key in row:
            require(condition=row[key] is False, message=f"unsupported claim: {key}")


def _observer_pid(*, observer):
    object_record(value=observer)
    require(condition=observer.get("passed") is True and observer.get("failures") == [] and
            observer.get("observer_failures") == [] and observer.get("unexpected_stops") == [],
            message="successful read-only observer required")
    equal_integer(row=observer, key="predictions", expected=2)
    _claims(row=observer)
    for key in ("target_memory_written", "software_breakpoints_used", "target_functions_evaluated"):
        require(condition=observer.get(key) is False, message=f"read-only observer receipt required: {key}")
    return integer(value=observer.get("pid"), minimum=1, maximum=2**31 - 1)


def _lifecycle(*, records):
    require(condition=type(records) is list and 1 <= len(records) <= 4096,
            message="bounded host records required")
    relevant, published = [], []
    kinds = {kind for kind, _ in LIFECYCLE}
    for row in records:
        object_record(value=row)
        kind = row.get("event")
        require(condition=kind is None or type(kind) is str, message="invalid host event name")
        require(condition=kind != "live_owned_conversion", message="legacy conversion receipt rejected")
        if kind in kinds:
            relevant.append(row)
        else:
            _claims(row=row)
    require(condition=len(relevant) == len(LIFECYCLE), message="incomplete or duplicate host lifecycle")
    receipts = {}
    for row, (kind, prediction) in zip(relevant, LIFECYCLE, strict=True):
        require(condition=row["event"] == kind, message="host stage order mismatch")
        equal_integer(row=row, key="timestamp_us", expected=0)
        if kind != "live_render_stage_begin" or "prediction" in row:
            equal_integer(row=row, key="prediction", expected=prediction)
        consumed = kind == "live_makeup_conversion" or (kind == "live_render_stage_complete" and prediction == 1)
        _claims(row=row, consumed=consumed, required=kind not in OPTIONAL_CONSUMPTION)
        if kind in ("live_render_stage_begin", "live_render_stage_complete"):
            require(condition=row.get("stage") == ("initializing" if prediction == 0 else "rendering"),
                    message="incorrect cold render stage")
        if kind == "live_render_stage_complete":
            require(condition=row.get("source_restored") is True, message="stage source not restored")
        if kind == "live_feature_parameters_applied":
            equal_integer(row=row, key="result", expected=0)
        if kind == "live_makeup_publication":
            point_audit.validate_publication(row=row, prediction=prediction)
            published.append(row)
        if kind in ("live_owned_rollback", "live_owned_restored"):
            require(condition=row.get("gpu_complete") is True and row.get("original_restored") is True,
                    message="publication restoration incomplete")
        if kind in ("live_makeup_geometry_complete", "live_makeup_conversion"):
            require(condition=row.get("native_returned") is True and row.get("source_points_unchanged") is True,
                    message="native geometry completion not verified")
        receipts[kind, prediction] = row
    point_audit.validate_isolation(published=published)
    for row, (kind, prediction) in zip(relevant, LIFECYCLE, strict=True):
        required_context = set()
        if kind in ("live_owned_rollback", "live_owned_restored", "live_makeup_conversion",
                    "live_makeup_geometry_enter", "live_makeup_geometry_complete"):
            required_context.update(("binding_id", "graph_id"))
        if kind == "live_makeup_geometry_enter":
            required_context.update(CONTEXT_FIELDS)
        if kind == "live_makeup_geometry_complete":
            required_context.add("thread")
        for key in CONTEXT_FIELDS:
            if key in row or key in required_context:
                equal_integer(row=row, key=key, expected=published[prediction][key])
    return published, receipts


def _destination(*, geometry, published):
    base, begin = (integer(value=geometry.get(key), minimum=4096, maximum=point_audit.MAX_POINTER)
                   for key in ("destination_base", "destination_points"))
    span = point_audit.POINT_COUNT * 8
    end = begin + span
    addresses = {row[f"{owner}_{field}"] for row in published
                 for owner in ("source", "owned") for field in ("buffer", "base", "points")}
    addresses.update(row["graph"] for row in published)
    addresses.add(geometry["object"])
    require(condition=base != begin and base not in addresses and begin not in addresses,
            message="aliased geometry destination pointers")
    require(condition=end <= point_audit.MAX_POINTER, message="destination vector address overflow")
    require(condition=all(not begin <= address < end for address in addresses | {base}),
            message="destination vector overlaps receipt storage")
    for row in published:
        for owner in ("source", "owned"):
            source_begin = row[f"{owner}_points"]
            source_end = source_begin + span
            require(condition=not source_begin <= base < source_end and
                    (end <= source_begin or source_end <= begin),
                    message="destination overlaps source or owned point vector")


def _geometry(*, published, receipts, trace, summary):
    geometry = receipts["live_makeup_geometry_enter", 1]
    complete = receipts["live_makeup_geometry_complete", 1]
    publication = published[1]
    object_address = integer(value=geometry.get("object"), minimum=4097, maximum=point_audit.MAX_POINTER)
    equal_integer(row=complete, key="object", expected=object_address)
    for key, expected in dict(source_base=publication["owned_base"], source_points=publication["owned_points"],
                              caller_offset=0x9EBA4C, process_offset=0xA0BB54,
                              width=summary["width"], height=summary["height"]).items():
        equal_integer(row=geometry, key=key, expected=expected)
    _destination(geometry=geometry, published=published)
    conversion_math.audit_conversion(source_bits=geometry.get("source_bits"),
        destination_bits=geometry.get("destination_bits"), width=geometry["width"], height=geometry["height"])
    require(condition=geometry["source_bits"] == [event["loaded_bits"] for event in trace["events"]],
            message="geometry source bits differ from observed candidate loads")
    for kind in ("live_makeup_conversion", "live_owned_restored"):
        row = receipts[kind, 1]
        if "object" in row:
            equal_integer(row=row, key="object", expected=object_address)


def audit(*, worker, observer, records, token, source_key) -> dict:
    """Bind final native CPU consumption to one ordered primary-106 load pass."""
    require(condition=type(token) is str and bool(token) and type(source_key) is str and bool(source_key),
            message="nonempty session token and source key required")
    pid = _observer_pid(observer=observer)
    points = point_audit.worker_points(worker=worker, pid=pid, token=token, source_key=source_key)
    published, receipts = _lifecycle(records=records)
    trace = object_record(value=observer.get("point_trace"))
    events = trace.get("events")
    require(condition=type(events) is list and len(events) == point_audit.POINT_COUNT,
            message="exactly one primary-106 load pass required")
    publication = published[1]
    summary = point_audit.point_reads(trace=trace, publication=publication, points=points[1])
    _geometry(published=published, receipts=receipts, trace=trace, summary=summary)
    return dict(schema="face-live-makeup-render-audit-v1", **summary, native_pid=pid, predictions=2,
                prediction=1, timestamp_us=0, binding_id=publication["binding_id"], graph_id=publication["graph_id"],
                graph=publication["graph"], thread=publication["thread"], face_id=publication["face_id"],
                observation="post-load-source-xy", candidate_xy_reads_verified=True,
                geometry_conversion_verified=True, renderer_consumption=True, conversions=1, restorations=1,
                initialization_publications=1, initialization_rendered=False, product_parity_verified=False,
                extra_points_verified=False, pipeline_acceptance=False, target_memory_written=False)
