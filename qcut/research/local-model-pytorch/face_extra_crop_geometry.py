"""CPU-only Extra crop evidence audit, NOT an owned transform implementation.

Existing post-Stage2 matrices are native dependencies, not reconstructed inputs.
Even a complete boundary snapshot does not establish the inner call arguments,
cache branch or native arithmetic order. No fit against transforms/final pixels
is performed here, and no report from this module enables owned geometry.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

from face_extra_crop_trace import CONFIG_BYTES, READ_BYTES, READ_CALLS, SCHEMA, TRANSFORMS
from face_host_geometry_contract import integer, matrix, numbers
from face_live_extra_trace import CALL, RETURN, require
from face_live_stage_audit import filter_state, metric
from face_temporal_smoothing import LENS_SHA256


IDENTITY = ("owner", "alignment", "runtime", "face_id", "configs", "face_config", "thread")
DEPENDENCIES = ("extra.forward:A+0x1b10", "extra.inverse:A+0x1b70",
                "stage2.forward:A+0x7d28", "stage2.inverse:A+0x7d88", "inner_filter:A+0x310")


def compare_bits(*, actual, expected):
    for value in (actual, expected):
        require(condition=isinstance(value, np.ndarray) and value.dtype == np.float32 and
                1 <= value.ndim <= 2 and value.size <= 560 and np.isfinite(value).all(),
                message="bounded finite float32 arrays required; implicit conversion forbidden")
    return metric(candidate=actual, native=expected)


def mean106(*, mean, size):
    """Only the statically identified mean preparation, not similarity fitting."""
    numbers(value=mean, length=480)
    integer(value=size, minimum=1, maximum=4096)
    values = np.asarray(mean, dtype=np.float32)[:212].reshape(106, 2)
    return (values.astype(np.float64) / 256.0 * size).astype(np.float32)


def _flags(*, value, offsets):
    require(condition=type(value) is dict and all(hex(offset) in value for offset in offsets),
            message="missing crop routing flags")
    for offset in offsets:
        integer(value=value[hex(offset)], maximum=255)


def _event(*, row, prediction, event):
    require(condition=type(row) is dict and row.get("event") == event and
            type(row.get("prediction")) is int and row["prediction"] == prediction and
            type(row.get("offset")) is int and row["offset"] == (CALL if event == "before" else RETURN),
            message="ordered paired Stage2 boundaries required")
    for name in IDENTITY:
        integer(value=row.get(name), minimum=0 if name == "face_id" else 1 if name == "thread" else 4096)
    require(condition=row["configs"] == row["owner"] + 0x7e58 and
            row["face_config"] == row["owner"] + 0x7a40, message="crop configuration owner mismatch")
    state = row.get("snapshot")
    require(condition=type(state) is dict, message="Stage2 snapshot required")
    matrix(value=state.get("tracked"), columns=(106, 280))
    published = state.get("published_xy")
    require(condition=type(published) is list and len(published) in (212, 560),
            message="bounded Stage2 published points required")
    numbers(value=published, length=len(published))
    _flags(value=state.get("config_bytes"), offsets=(0, 4, 0xa, 0xb, 0x20, 0x21))
    modes = state.get("face_modes")
    require(condition=type(modes) is dict, message="face modes required")
    for offset in (0x3c, 0x68):
        integer(value=modes.get(hex(offset)), minimum=-(2**31), maximum=2**31 - 1)
    integer(value=state.get("reset_byte"), maximum=255)
    if event == "after":
        integer(value=row.get("return_code"), maximum=0)


def _capture(*, row):
    value = row.get("crop_geometry")
    if value is None:
        return None
    require(condition=type(value) is dict and value.get("schema") == SCHEMA and
            value.get("lens_sha256") == LENS_SHA256, message="pinned crop snapshot required")
    for key in (*IDENTITY, "prediction", "offset", "event"):
        require(condition=type(value.get(key)) is type(row[key]) and value[key] == row[key],
                message=f"crop snapshot association mismatch: {key}")
    for key, expected in (("diagnostic_only", True), ("target_memory_written", False),
                          ("target_functions_evaluated", False), ("native_points_sent_to_worker", False),
                          ("product_parity_verified", False)):
        require(condition=value.get(key) is expected, message="read-only diagnostic crop snapshot required")
    _flags(value=value.get("config_bytes"), offsets=CONFIG_BYTES)
    _flags(value=value.get("face_bytes"), offsets=(0x44, 0x96))
    for key in ("config_bytes", "face_modes"):
        for name, expected in row["snapshot"][key].items():
            require(condition=type(value.get(key)) is dict and type(value[key].get(name)) is type(expected) and
                    value[key][name] == expected, message="crop snapshot routing differs from boundary")
    require(condition=type(value.get("reset_byte")) is int and
            value["reset_byte"] == row["snapshot"]["reset_byte"],
            message="crop reset differs from boundary")
    for key in ("tracked", "published_xy"):
        expected = np.asarray(row["snapshot"][key], np.float32)
        if key == "published_xy":
            numbers(value=value.get(key), length=len(expected))
        else:
            matrix(value=value.get(key), columns=(106, 280))
        require(condition=compare_bits(actual=np.asarray(value[key], np.float32), expected=expected)["equal"],
                message="crop point copy differs from boundary")
    source = value.get("source")
    require(condition=type(source) is dict, message="crop source descriptor required")
    for key in ("width", "height"):
        integer(value=source.get(key), minimum=1, maximum=4096)
    for key in ("address", "data"):
        integer(value=source.get(key), minimum=4096)
    require(condition=type(source.get("channels")) is int and source["channels"] in (3, 4) and
            type(source.get("step")) is int and source["step"] == source["channels"],
            message="bounded crop source channels required")
    integer(value=source.get("stride"), minimum=source["width"] * source["channels"], maximum=16384)
    parameter = value.get("input_parameter")
    require(condition=type(parameter) is dict, message="crop input parameter required")
    integer(value=parameter.get("address"), minimum=4096)
    for key in ("format", "orientation"):
        integer(value=parameter.get(key), minimum=-(2**31), maximum=2**31 - 1)
    budget = value.get("read_budget")
    require(condition=type(budget) is dict, message="crop snapshot read budget required")
    integer(value=budget.get("bytes"), minimum=1, maximum=READ_BYTES)
    integer(value=budget.get("calls"), minimum=1, maximum=READ_CALLS)
    state = value.get("inner_filter")
    require(condition=type(state) is dict and type(state.get("count")) is int and state["count"] in (0, 106),
            message="bounded inner filter state required")
    decoded = state
    if state["count"] == 0:
        require(condition=state.get("width") == state.get("height") == 0,
                message="empty filter dimensions required")
        decoded = dict(state, width=source["height"], height=source["width"])
    filter_state(value=decoded, count=state["count"], native=True,
                 width=source["width"], height=source["height"])
    numbers(value=value.get("mean"), length=480)
    transforms = value.get("transforms")
    require(condition=type(transforms) is dict and set(transforms) == set(TRANSFORMS),
            message="both crop transform caches required")
    for item in transforms.values():
        require(condition=type(item) is dict and type(item.get("ready")) is bool,
                message="typed transform cache required")
        for key in ("forward", "inverse"):
            matrix(value=item.get(key), columns=(3,), optional=not item["ready"])
        for key in ("mean_xy", "cached_xy"):
            raw = item.get(key)
            require(condition=type(raw) is list and len(raw) in ((212,) if item["ready"] else (0, 212)),
                    message="bounded transform cache points required")
            numbers(value=raw, length=len(raw))
    return value


def audit_observer(*, observer):
    require(condition=type(observer) is dict and observer.get("passed") is True,
            message="completed read-only observer required")
    for key in ("target_memory_written", "target_functions_evaluated", "software_breakpoints_used"):
        require(condition=observer.get(key) is False, message="observer was not read-only")
    trace = observer.get("extra_trace")
    require(condition=type(trace) is dict and trace.get("schema") == "face-live-extra-boundary-v1" and
            trace.get("complete") is True, message="complete Extra trace required")
    for key in ("target_memory_written", "native_points_sent_to_worker", "product_parity_verified"):
        require(condition=trace.get(key) is False, message="Extra trace must remain diagnostic-only")
    events = trace.get("events")
    require(condition=type(events) is list and len(events) == 4, message="two cold boundary pairs required")
    cases = []
    for prediction in range(2):
        before, after = events[prediction * 2:prediction * 2 + 2]
        for row, event in ((before, "before"), (after, "after")):
            _event(row=row, prediction=prediction, event=event)
            require(condition=all(row[key] == events[0][key] for key in IDENTITY),
                    message="cold Extra owner/thread/face identity changed")
        pre, post = _capture(row=before), _capture(row=after)
        for key in ("config_bytes", "face_modes", "reset_byte"):
            require(condition=before["snapshot"][key] == after["snapshot"][key],
                    message="Stage2 routing changed across call")
        if pre is not None and post is not None:
            for key in ("source", "input_parameter", "config_bytes", "face_bytes"):
                require(condition=pre[key] == post[key], message="crop input context changed across call")
            require(condition=compare_bits(actual=np.asarray(pre["mean"], np.float32),
                    expected=np.asarray(post["mean"], np.float32))["equal"],
                    message="constant crop mean changed across call")
        config = before["snapshot"]["config_bytes"]
        inner_active = bool(config["0x0"] & 1 and not config["0xa"] & 1)
        missing = []
        if pre is None:
            missing.extend(("pre_crop_transform_caches", "pre_crop_mean", "pre_crop_branch_flags"))
            if inner_active:
                missing.append("pre_crop_inner_filter_history")
        elif inner_active and len(pre["inner_filter"]["current_xy"]) != 212:
            missing.append("initialized_pre_crop_inner_filter_history")
        if post is None:
            missing.append("post_crop_filter_and_cache_state")
        reference = after.get("extra_model")
        native_matrices = False
        if reference is not None:
            require(condition=type(reference) is dict and reference.get("diagnostic_only") is True and
                    reference.get("native_points_sent_to_worker") is False,
                    message="Extra model must remain diagnostic-only")
            for key in ("forward", "inverse", "stage2_forward", "stage2_inverse"):
                matrix(value=reference.get(key), columns=(3,))
            native_matrices = True
        cases.append(dict(prediction=prediction, inner_filter_expected=inner_active,
            boundary_copies_available=pre is not None and post is not None,
            native_post_crop_matrices_available=native_matrices, missing=missing,
            reconstruction_ready=False, float32_geometry_comparison=None))
    return dict(schema="face-extra-crop-geometry-audit-v1", audit_completed=True,
        status="evidence-only-no-owned-geometry", cases=cases, native_dependencies=list(DEPENDENCIES),
        owned_geometry_enabled=False, geometry_parity_verified=False, product_parity_verified=False,
        next_step="Capture crop_geometry at both existing Stage2 stops; then bind the actual inner "
                  "filter/computeTransform input and output calls before implementing their arithmetic.",
        unresolved=["actual inner call arguments and cache/recompute branch",
                    "GetCurrentPostitionNew differs from the existing outer filter implementation",
                    "similarity solver and inverse float32 instruction order",
                    "fresh independently reconstructed transform bit comparisons"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--observer", required=True, type=Path)
    args = parser.parse_args()
    with args.observer.open("rb") as stream:
        payload = stream.read(4 * 1024**2 + 1)
    require(condition=len(payload) <= 4 * 1024**2, message="observer exceeds bounded JSON size")
    report = audit_observer(observer=json.loads(payload))
    report["observer_sha256"] = hashlib.sha256(payload).hexdigest()
    print(json.dumps(report, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
