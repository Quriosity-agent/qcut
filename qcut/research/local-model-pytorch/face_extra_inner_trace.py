"""Read-only direct inner-filter arguments, separate from Stage2 reconstruction.

The Point136 AutoVector count is +0x450, NOT NewAlign float-vector +0x430.
Only the inspected inline primary106 ABI is accepted; no target code executes.
"""
from __future__ import annotations

import struct

from face_extra_crop_trace import BoundedReader, CONFIG_BYTES, READ_BYTES, READ_CALLS, inner_filter
from face_filter_abi import LENS_SHA256
from face_host_geometry_contract import integer, numbers
from face_live_extra_trace import context, floats, require, scalar
from face_preprocess_memory import MAX_ADDRESS, checked_read

CALL = 0x2cff58
RETURN = 0x2cff5c
SCHEMA = "face-extra-direct-inner-v1"
IDENTITY = ("owner", "alignment", "runtime", "face_id", "configs", "face_config", "thread", "prediction")
POLICY = dict(diagnostic_only=True, target_memory_written=False, target_functions_evaluated=False,
              native_points_sent_to_worker=False, product_parity_verified=False)


def route(*, crop):
    config, modes, face = crop["config_bytes"], crop["face_modes"], crop["face_bytes"]
    for offset in CONFIG_BYTES:
        integer(value=config.get(hex(offset)), maximum=255)
    integer(value=face.get("0x4d"), maximum=255)
    require(condition=config["0x4"] & 1 and not any(config[key] & 1 for key in ("0xb", "0x20", "0x21"))
            and modes == {"0x3c": 1, "0x68": 0} and type(crop["reset_byte"]) is int
            and crop["reset_byte"] == 0, message="unsupported direct inner routing profile")
    if face["0x4d"] & 1:
        return "face-0x4d-bit0"
    if not config["0x0"] & 1:
        return "config-0x0-bit0-clear"
    if config["0xa"] & 1:
        return "config-0xa-bit0"
    return None


def point_vector(*, read, address, count):
    integer(value=address, minimum=4096, maximum=MAX_ADDRESS - 0x457)
    require(condition=address % 8 == 0, message="aligned Point136 descriptor required")
    begin, capacity = struct.unpack("<2Q", checked_read(read=read, address=address, size=16))
    size = scalar(read=read, address=address + 0x450, kind="<Q")
    require(condition=size == count and begin == address + 16 and size <= capacity <= 136,
            message="unsupported inline Point136 AutoVector")
    return dict(address=address, data=begin, capacity=capacity, count=size,
                xy=[] if size == 0 else floats(read=read, address=begin, count=size * 2))


def same_bits(*, left, right):
    return len(left) == len(right) and struct.pack(f"<{len(left)}f", *left) == struct.pack(f"<{len(right)}f", *right)


def _bound_context(*, read, scope, crop):
    current = context(read=read, owner=scope["owner"], registers=dict(x0=scope["alignment"],
        x3=scope["configs"], x4=scope["face_config"], x5=scope["runtime"]))
    require(condition=current == scope, message="direct inner face context changed")
    config = {hex(offset): scalar(read=read, address=scope["configs"] + offset, kind="<B")
              for offset in CONFIG_BYTES}
    modes = {hex(offset): scalar(read=read, address=scope["face_config"] + offset, kind="<i")
             for offset in (0x3c, 0x68)}
    face = scalar(read=read, address=scope["face_config"] + 0x4d, kind="<B")
    reset = scalar(read=read, address=scope["runtime"] + 0x114, kind="<B")
    require(condition=config == crop["config_bytes"] and modes == crop["face_modes"] and
            face == crop["face_bytes"]["0x4d"] and reset == crop["reset_byte"],
            message="direct inner routing changed during Stage2")


def capture(*, read, scope, crop, prediction, thread, event, registers, previous=None):
    require(condition=event in ("call", "return") and route(crop=crop) is None,
            message="direct inner capture requires active route")
    integer(value=prediction, maximum=1)
    integer(value=thread, minimum=1)
    sp, fp = registers["sp"], registers["fp"]
    for value in (sp, fp):
        integer(value=value, minimum=4096, maximum=MAX_ADDRESS - 0x1fc0)
        require(condition=value % 16 == 0, message="aligned direct inner stack required")
    if event == "call":
        require(condition=previous is None and registers["x0"] == scope["alignment"] + 0x310 and
                registers["x1"] == sp + 0x1b68 and registers["x2"] == sp + 0x1710,
                message="direct inner argument ownership mismatch")
        input_address, output_address = registers["x1"], registers["x2"]
    else:
        require(condition=type(previous) is dict and previous["event"] == "call" and
                previous["sp"] == sp and previous["fp"] == fp and
                previous["prediction"] == prediction and previous["thread"] == thread and
                all(previous[key] == scope[key] for key in IDENTITY if key not in ("thread", "prediction")),
                message="unpaired direct inner return")
        # x0-x2 are caller-clobbered; the inner function has no w0 status.
        input_address, output_address = previous["input"]["address"], previous["output"]["address"]
    bounded = BoundedReader(read=read)
    reader = bounded.read
    _bound_context(read=reader, scope=scope, crop=crop)
    inputs = point_vector(read=reader, address=input_address, count=106)
    outputs = point_vector(read=reader, address=output_address, count=0 if event == "call" else 106)
    if previous is not None:
        require(condition=all(inputs[key] == previous["input"][key] for key in ("address", "data", "capacity", "count"))
                and same_bits(left=inputs["xy"], right=previous["input"]["xy"]),
                message="const direct inner input changed")
        require(condition=all(outputs[key] == previous["output"][key] for key in ("address", "data", "capacity")),
                message="direct inner output ownership changed")
    state = inner_filter(read=reader, alignment=scope["alignment"],
                         width=crop["source"]["width"], height=crop["source"]["height"])
    return dict(event=event, offset=CALL if event == "call" else RETURN, prediction=prediction,
        thread=thread, **scope, sp=sp, fp=fp, filter_address=scope["alignment"] + 0x310,
        input=inputs, output=outputs, inner_filter=state,
        read_budget=dict(bytes=bounded.bytes, calls=bounded.calls), **POLICY)


def _vector_receipt(*, value, address, count):
    require(condition=type(value) is dict, message="direct Point136 receipt required")
    for key in ("address", "data", "count", "capacity"):
        integer(value=value.get(key), maximum=MAX_ADDRESS)
    require(condition=value["address"] == address and value["data"] == address + 16 and
            value["count"] == count and count <= value["capacity"] <= 136,
            message="direct Point136 receipt ownership mismatch")
    numbers(value=value.get("xy"), length=count * 2)


def validate_receipt(*, receipt, before, after):
    """Validate association before CPU arithmetic uses any captured input."""
    require(condition=type(receipt) is dict and receipt.get("complete") is True,
            message="complete direct inner receipt required")
    for key in IDENTITY:
        require(condition=type(receipt.get(key)) is type(before[key]) and receipt[key] == before[key],
                message="direct inner receipt identity mismatch")
    pre, post = before["crop_geometry"], after["crop_geometry"]
    reason = route(crop=pre)
    require(condition=reason == route(crop=post) and receipt.get("bypass_reason") == reason,
            message="direct inner bypass evidence mismatch")
    events = receipt.get("events")
    require(condition=type(events) is list and len(events) == (2 if reason is None else 0),
            message="direct inner call/return pair required")
    for row, event, offset in zip(events, ("call", "return"), (CALL, RETURN)):
        require(condition=type(row) is dict and row.get("event") == event and
                type(row.get("offset")) is int and row["offset"] == offset,
                message="ordered direct inner events required")
        for key in IDENTITY:
            require(condition=type(row.get(key)) is type(before[key]) and row[key] == before[key],
                    message="direct inner event identity mismatch")
        for key, expected in POLICY.items():
            require(condition=row.get(key) is expected, message="read-only direct inner receipt required")
        for key in ("sp", "fp"):
            integer(value=row.get(key), minimum=4096, maximum=MAX_ADDRESS - 0x1fc0)
            require(condition=row[key] % 16 == 0, message="aligned direct inner stack receipt required")
        require(condition=type(row.get("filter_address")) is int and
                row["filter_address"] == before["alignment"] + 0x310,
                message="direct inner filter owner mismatch")
        _vector_receipt(value=row.get("input"), address=row["sp"] + 0x1b68, count=106)
        _vector_receipt(value=row.get("output"), address=row["sp"] + 0x1710, count=0 if event == "call" else 106)
        budget = row.get("read_budget")
        require(condition=type(budget) is dict, message="direct inner read budget required")
        integer(value=budget.get("bytes"), minimum=1, maximum=READ_BYTES)
        integer(value=budget.get("calls"), minimum=1, maximum=READ_CALLS)
    if events:
        call, returned = events
        require(condition=all(call[key] == returned[key] for key in ("sp", "fp")) and
                all(call["input"][key] == returned["input"][key] for key in ("address", "data", "capacity", "count"))
                and same_bits(left=call["input"]["xy"], right=returned["input"]["xy"]),
                message="direct inner const input or stack changed")
        require(condition=all(call["output"][key] == returned["output"][key] for key in ("address", "data", "capacity")),
                message="direct inner output receipt ownership changed")
    return reason


def validate_trace(*, trace, events):
    require(condition=type(trace) is dict and trace.get("schema") == SCHEMA and
            trace.get("lens_sha256") == LENS_SHA256 and trace.get("complete") is True,
            message="complete pinned direct inner trace required")
    for key, expected in POLICY.items():
        require(condition=trace.get(key) is expected, message="read-only direct inner trace required")
    receipts = trace.get("receipts")
    require(condition=type(receipts) is list and len(receipts) == 2,
            message="two direct inner receipts required")
    for index, receipt in enumerate(receipts):
        validate_receipt(receipt=receipt, before=events[index * 2], after=events[index * 2 + 1])
    return receipts
