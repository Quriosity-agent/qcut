"""Read-only direct inner-filter arguments, separate from Stage2 reconstruction.

The Point136 AutoVector count is +0x450, NOT NewAlign float-vector +0x430.
Accept inline106 and the observed heap280/capacity306 input, never arbitrary heaps.
"""
from __future__ import annotations

import struct

from face_extra_crop_trace import BoundedReader, CONFIG_BYTES, READ_BYTES, READ_CALLS, inner_filter
from face_filter_abi import LENS_SHA256, STATE_ABI
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


def vector_layout(*, address, begin, capacity, size, count, protected=()):
    integer(value=address, minimum=4096, maximum=MAX_ADDRESS - 0x457)
    require(condition=address % 8 == 0, message="aligned Point136 descriptor required")
    for value in (begin, capacity, size):
        integer(value=value, maximum=MAX_ADDRESS)
    inline = size == (106 if count is None else count) and begin == address + 16 and size <= capacity <= 136
    heap = count is None and size == 280 and capacity == 306 and begin != address + 16
    require(condition=inline or heap,
            message=f"unsupported inline Point136 AutoVector: address={address:#x}, begin={begin:#x}, "
                    f"capacity={capacity}, size={size}, expected_count={count}")
    integer(value=begin, minimum=4096, maximum=MAX_ADDRESS - capacity * 8 + 1)
    require(condition=begin % 8 == 0, message="aligned Point136 payload required")
    if heap:
        require(condition=all(begin + capacity * 8 <= start or end <= begin for start, end in protected)
                and (begin + capacity * 8 <= address or address + 0x458 <= begin),
                message="heap Point136 storage aliases protected memory")


def point_vector(*, read, address, count, protected=()):
    integer(value=address, minimum=4096, maximum=MAX_ADDRESS - 0x457)
    require(condition=address % 8 == 0, message="aligned Point136 descriptor required")
    begin, capacity = struct.unpack("<2Q", checked_read(read=read, address=address, size=16))
    size = scalar(read=read, address=address + 0x450, kind="<Q")
    vector_layout(address=address, begin=begin, capacity=capacity, size=size, count=count, protected=protected)
    return dict(address=address, data=begin, capacity=capacity, count=size,
                xy=[] if size == 0 else floats(read=read, address=begin, count=size * 2))


def same_bits(*, left, right):
    return len(left) == len(right) and struct.pack(f"<{len(left)}f", *left) == struct.pack(f"<{len(right)}f", *right)


def normal_state(*, state):
    """Live gate until heap output/history ownership is captured for copy branches.

    CPU branch math lives in face_extra_inner_math. Do not widen this gate alone:
    shared crop snapshots still cap histories at106 and returns require inline106.
    """
    require(condition=type(state) is dict and type(state.get("count")) is int and state["count"] == 106
            and type(state.get("current_xy")) is list and len(state["current_xy"]) == 212,
            message="initialized primary106 direct inner state required")
    numbers(value=[state.get("scale")], length=1, maximum=2**20)
    require(condition=state["scale"] >= 1e-5, message="near-zero direct inner branch unsupported")


def protected_regions(*, storage, state, filter_address, input_address, output_address):
    require(condition=type(storage) is list and len(storage) == 4, message="four inner history descriptors required")
    ranges = [(input_address, input_address + 0x458), (output_address, output_address + 0x458),
              (filter_address, filter_address + 0xa0)]
    for triple, name in zip(storage, ("current_xy", "previous_xy", "delta_x", "delta_y"), strict=True):
        require(condition=type(triple) is list and len(triple) == 3, message="bounded inner history descriptor required")
        require(condition=type(state.get(name)) is list and len(state[name]) in
                (0, 212 if name.endswith("_xy") else 106), message="bounded inner history values required")
        begin, end, capacity = triple
        for value in triple:
            integer(value=value, maximum=MAX_ADDRESS)
        require(condition=begin <= end <= capacity and capacity - begin <= 4096 and
                (capacity - begin) % 4 == 0 and end - begin == len(state[name]) * 4 and
                ((begin == end == capacity == 0) or (begin >= 4096 and begin % 4 == 0)),
                message="inner history storage does not match captured state")
        if capacity > begin:
            ranges.append((begin, capacity))
    return ranges


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
    state = inner_filter(read=reader, alignment=scope["alignment"],
                         width=crop["source"]["width"], height=crop["source"]["height"])
    normal_state(state=state)
    storage = [list(struct.unpack("<3Q", checked_read(read=reader,
        address=scope["alignment"] + 0x310 + STATE_ABI[key], size=24)))
        for key in ("current", "previous", "delta_x", "delta_y")]
    protected = protected_regions(storage=storage, state=state, filter_address=scope["alignment"] + 0x310,
                                  input_address=input_address, output_address=output_address)
    inputs = point_vector(read=reader, address=input_address, count=None, protected=protected)
    outputs = point_vector(read=reader, address=output_address, count=0 if event == "call" else 106)
    if previous is not None:
        require(condition=all(inputs[key] == previous["input"][key] for key in ("address", "data", "capacity", "count"))
                and same_bits(left=inputs["xy"], right=previous["input"]["xy"]),
                message="const direct inner input changed")
        require(condition=all(outputs[key] == previous["output"][key] for key in ("address", "data", "capacity")),
                message="direct inner output ownership changed")
    return dict(event=event, offset=CALL if event == "call" else RETURN, prediction=prediction,
        thread=thread, **scope, sp=sp, fp=fp, filter_address=scope["alignment"] + 0x310,
        input=inputs, output=outputs, inner_filter=state, filter_storage=storage, consumed_point_count=state["count"],
        read_budget=dict(bytes=bounded.bytes, calls=bounded.calls), **POLICY)


def _vector_receipt(*, value, address, count, protected=()):
    require(condition=type(value) is dict, message="direct Point136 receipt required")
    for key in ("address", "data", "count", "capacity"):
        integer(value=value.get(key), maximum=MAX_ADDRESS)
    require(condition=value["address"] == address,
            message="direct Point136 receipt ownership mismatch")
    vector_layout(address=address, begin=value["data"], capacity=value["capacity"], size=value["count"],
                  count=count, protected=protected)
    numbers(value=value.get("xy"), length=value["count"] * 2)


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
        normal_state(state=row.get("inner_filter"))
        require(condition=type(row.get("consumed_point_count")) is int and row["consumed_point_count"] == 106,
                message="explicit primary106 consumption required")
        protected = protected_regions(storage=row.get("filter_storage"), state=row["inner_filter"],
            filter_address=row["filter_address"], input_address=row["sp"] + 0x1b68, output_address=row["sp"] + 0x1710)
        _vector_receipt(value=row.get("input"), address=row["sp"] + 0x1b68, count=None, protected=protected)
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
