"""Read-only reshape point conversion evidence; not final renderer acceptance."""
from __future__ import annotations

import math
from pathlib import Path
import struct

from face_live_makeup_point_trace import CORE_UUID, RECORD_LIMIT, float_register_bits, pointer, require
from face_live_makeup_point_rotation import float32
from face_live_worker_protocol import decode_message
from face_preprocess_lldb import register

SITES = {"v5_x": 0x9d6640, "v5_y": 0x9d664c, "v5_store": 0x9d6660,
         "v6_load": 0x9df364, "v6_store": 0x9df3c8}


def bits(*, values):
    return list(struct.unpack(f"<{len(values)}I", struct.pack(f"<{len(values)}f", *values)))


def values(*, words):
    result = struct.unpack(f"<{len(words)}f", struct.pack(f"<{len(words)}I", *words))
    require(condition=all(math.isfinite(value) for value in result), message="nonfinite reshape values")
    return result


def register_bytes(*, frame, name, size):
    import lldb
    value, error = frame.FindRegister(name), lldb.SBError()
    require(condition=value.IsValid() and size in (8, 16), message="missing reshape vector register")
    data = value.GetData().ReadRawData(error, 0, size)
    require(condition=not error.Fail() and len(data) == size, message="unreadable reshape register")
    return data


def pair_register(*, frame, name):
    return list(struct.unpack("<2I", register_bytes(frame=frame, name=name, size=8)))


def publication(*, path, prediction):
    with Path(path).open("rb") as stream:
        data = stream.read(RECORD_LIMIT + 1)
    require(condition=0 < len(data) <= RECORD_LIMIT and data.endswith(b"\n"),
            message="unbounded or incomplete reshape publication records")
    row = decode_message(data=data.splitlines()[-1])
    require(condition=all(type(row.get(key)) is int for key in ("prediction", "timestamp_us", "face_id", "faces")),
            message="typed isolated reshape publication scope required")
    require(condition=row.get("event") == "live_reshape_publication" and
            type(prediction) is int and prediction == 1 and row.get("prediction") == prediction and
            row.get("timestamp_us") == 0 and row.get("face_id") == 0 and row.get("faces") == 1 and
            row.get("candidate_injected") is True and row.get("renderer_consumption") is False and
            row.get("source_points_unchanged") is True, message="not a final isolated reshape publication")
    for key in ("binding_id", "graph_id", "thread"):
        require(condition=type(row.get(key)) is int and row[key] > 0, message="invalid reshape binding identity")
    for key in ("graph", "owned_base", "source_base", "owned_points", "source_points"):
        pointer(value=row.get(key))
    require(condition=row["owned_base"] != row["source_base"] and
            abs(row["owned_points"] - row["source_points"]) >= 848, message="aliased reshape publication")
    return row


def validate_frame(*, frame, location, stage, publication):
    address = frame.GetPCAddress()
    require(condition=location.GetBreakpoint().IsHardware() and address.IsValid() and
            address.GetModule().GetUUIDString() == CORE_UUID and address.GetFileAddress() == SITES[stage] and
            frame.GetThread().GetThreadID() == publication["thread"], message="unverified reshape stop scope")


def source_point(*, read, publication, begin, index):
    require(condition=begin == publication["owned_points"] and type(index) is int and 0 <= index < 106,
            message="reshape read is not from published candidate points")
    base = publication["owned_base"]
    vector = pointer(value=struct.unpack("<Q", read(address=base + 0x20, size=8))[0])
    span = struct.unpack("<QQ", read(address=vector + 0x10, size=16))
    require(condition=span == (begin, begin + 848) and
            struct.unpack("<i", read(address=base + 0x40, size=4))[0] == publication["face_id"],
            message="reshape face descriptor changed")
    words = list(struct.unpack("<2I", read(address=begin + index * 8, size=8)))
    require(condition=all(0 <= value <= 1 for value in values(words=words)), message="unbounded reshape source")
    return words


def v5_start(*, frame, read, publication):
    raw_index = register(frame=frame, name="x8")
    require(condition=type(raw_index) is int and raw_index % 2**32 == 0,
            message="invalid V5 fixed-point index")
    index, begin = raw_index >> 32, register(frame=frame, name="x9")
    words = source_point(read=read, publication=publication, begin=begin, index=index)
    require(condition=register(frame=frame, name="x12") == begin + index * 8 and
            register(frame=frame, name="x10") == 106 - index and
            float_register_bits(frame=frame, name="s0") == words[0], message="V5 X load mismatch")
    width = values(words=[float_register_bits(frame=frame, name="s8")])[0]
    height = struct.unpack("<d", register_bytes(frame=frame, name="d12", size=8))[0]
    require(condition=all(math.isfinite(v) and v.is_integer() and 0 < v <= 4096 for v in (width, height)),
            message="unbounded V5 dimensions")
    x, y = values(words=words)
    # V5 retains double precision for (1-y)*height, unlike MakeupV2.
    expected = bits(values=[float32(value=x * width), float32(value=(1.0 - y) * height)])
    return dict(point_index=index, source_bits=words, expected_bits=expected,
                destination=register(frame=frame, name="x11") - 4, width=width, height=height)


def validate_v5(*, frame, read, publication, pending, stored):
    index = pending["point_index"]
    words = source_point(read=read, publication=publication, begin=register(frame=frame, name="x9"), index=index)
    require(condition=words == pending["source_bits"] and register(frame=frame, name="x8") == index * 2**32 and
            register(frame=frame, name="x12") == publication["owned_points"] + index * 8 and
            register(frame=frame, name="x10") == 106 - index, message="V5 pending load scope changed")
    destination = pending["destination"]
    pointer(value=destination)
    begin = destination - index * 8
    require(condition=all(begin + 848 <= publication[key] or publication[key] + 848 <= begin
                          for key in ("owned_points", "source_points")), message="V5 destination aliases source")
    require(condition=register(frame=frame, name="x11") == destination + (12 if stored else 4),
            message="V5 store destination changed")
    expected = pending["expected_bits"]
    if stored:
        require(condition=list(struct.unpack("<2I", read(address=destination, size=8))) == expected and
                float_register_bits(frame=frame, name="s0") == expected[1], message="V5 stored conversion mismatch")
        return
    require(condition=float_register_bits(frame=frame, name="s0") == words[1] and
            struct.unpack("<I", read(address=destination, size=4))[0] == expected[0], message="V5 Y load mismatch")


def v6_expected(*, source, dimensions, shift, perpendicular, rules):
    f = lambda value: float32(value=value)
    scaled = [f(source[i] * dimensions[i]) for i in range(2)]
    offset = [f(f(shift[i] * rules[2]) + scaled[i]) for i in range(2)]
    first = [f(offset[0] - f(perpendicular[0] * rules[3])),
             f(offset[1] + f(perpendicular[1] * rules[3]))]
    extra = [f(f(shift[i] * rules[4]) + first[i]) for i in range(2)]
    second = [f(extra[0] - f(shift[1] * rules[5])), f(extra[1] + f(shift[0] * rules[5]))]
    return [bits(values=first), bits(values=second)]


def v6_start(*, frame, read, publication):
    index = register(frame=frame, name="w12")
    words = source_point(read=read, publication=publication, begin=register(frame=frame, name="x13"), index=index)
    require(condition=pair_register(frame=frame, name="v3") == words, message="V6 XY register mismatch")
    offset, output_index, end = (register(frame=frame, name=name) for name in ("x8", "x9", "x10"))
    require(condition=0 <= output_index < 256 and offset == output_index * 36 and
            offset < end <= 256 * 36 and end % 36 == 0, message="unbounded V6 rule span")
    rule_address = register(frame=frame, name="x11")
    require(condition=type(rule_address) is int and 4096 <= rule_address < 2**53 and rule_address % 4 == 0,
            message="invalid V6 rule address")
    rule_bits = list(struct.unpack("<9I", read(address=rule_address, size=36)))
    rules = values(words=rule_bits)
    require(condition=rules[6] == index and all(abs(v) <= 4096 for v in rules), message="unbounded V6 rules")
    dimensions, shift, perpendicular = [values(words=pair_register(frame=frame, name=name))
                                        for name in ("v9", "v0", "v2")]
    require(condition=all(v.is_integer() and 0 < v <= 4096 for v in dimensions) and
            all(abs(v) <= 32768 for v in (*shift, *perpendicular)), message="unbounded V6 conversion")
    return dict(point_index=index, source_bits=words, output_index=output_index, rule_offset=offset,
        rule_end=end, rule_address=rule_address, rule_bits=rule_bits,
        expected_bits=v6_expected(source=values(words=words), dimensions=dimensions,
            shift=shift, perpendicular=perpendicular, rules=rules),
        output_refs=[pointer(value=register(frame=frame, name=name)) for name in ("x23", "x22")])


def validate_v6(*, frame, read, publication, pending):
    require(condition=register(frame=frame, name="x9") == pending["output_index"] and
            register(frame=frame, name="x8") == pending["rule_offset"] and
            register(frame=frame, name="x10") == pending["rule_end"], message="V6 pending rule scope changed")
    require(condition=source_point(read=read, publication=publication, begin=publication["owned_points"],
            index=pending["point_index"]) == pending["source_bits"] and
            list(struct.unpack("<9I", read(address=pending["rule_address"], size=36))) == pending["rule_bits"],
            message="V6 source or rule changed")
    destinations, spans = [], []
    for i, name in enumerate(("x23", "x22")):
        ref = pointer(value=register(frame=frame, name=name))
        require(condition=ref == pending["output_refs"][i], message="V6 output reference changed")
        vector = pointer(value=struct.unpack("<Q", read(address=ref, size=8))[0])
        begin, end = struct.unpack("<QQ", read(address=vector + 0x10, size=16))
        pointer(value=begin)
        size = end - begin
        require(condition=all(end <= other_begin or other_end <= begin for other_begin, other_end in spans),
                message="V6 output buffers alias")
        require(condition=0 < size <= 256 * 8 and size % 8 == 0 and
                pending["output_index"] * 8 < size and all(end <= publication[key] or
                publication[key] + 848 <= begin for key in ("owned_points", "source_points")),
                message="invalid or aliased V6 output span")
        destination = begin + pending["output_index"] * 8
        require(condition=list(struct.unpack("<2I", read(address=destination, size=8))) ==
                pair_register(frame=frame, name=("v7", "v17")[i]) == pending["expected_bits"][i],
                message="V6 stored conversion mismatch")
        destinations.append(destination)
        spans.append((begin, end))
    return destinations
