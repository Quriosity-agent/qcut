"""Read-only observation immediately after the pinned primary XY load."""
from __future__ import annotations

import math
from pathlib import Path
import struct

from face_live_worker_protocol import decode_message
from face_preprocess_lldb import register
import face_live_reader_trace as reader_trace

CORE_UUID = reader_trace.CORE_UUID
POINT_LOAD = 0xa207f0
CALLERS = {0x9eb7bc, 0x9eb9c4}
MAX_HITS = 8 * 106
RECORD_LIMIT = 2 * 1024**2


def require(*, condition, message):
    if not condition:
        raise ValueError(message)


def pointer(*, value):
    require(condition=type(value) is int and 4096 <= value < 2**53 and value % 8 == 0,
            message="invalid makeup point pointer")
    return value


def float_register_bits(*, frame, name):
    import lldb
    value, error = frame.FindRegister(name), lldb.SBError()
    require(condition=value.IsValid(), message="missing makeup float register")
    bits = value.GetData().GetUnsignedInt32(error, 0)
    require(condition=not error.Fail(), message="unreadable makeup float register")
    return bits


def publication_scope(*, path, prediction):
    with Path(path).open("rb") as stream:
        data = stream.read(RECORD_LIMIT + 1)
    require(condition=0 < len(data) <= RECORD_LIMIT and data.endswith(b"\n"),
            message="unbounded or incomplete makeup publication records")
    publication = decode_message(data=data.splitlines()[-1])
    require(condition=publication.get("event") == "live_makeup_publication" and
            type(prediction) is int and prediction in (0, 1) and
            type(publication.get("prediction")) is int and publication["prediction"] == prediction and
            publication.get("timestamp_us") == 0 and publication.get("candidate_injected") is True and
            publication.get("renderer_consumption") is False,
            message="point read outside current published makeup update")
    return publication


def observe(*, frame, location, prediction, read, publication):
    address = frame.GetPCAddress()
    require(condition=location.GetBreakpoint().IsHardware() and address.IsValid() and
            address.GetModule().GetUUIDString() == CORE_UUID and address.GetFileAddress() == POINT_LOAD,
            message="unverified makeup XY breakpoint")
    thread = frame.GetThread()
    caller = thread.GetFrameAtIndex(1).GetPCAddress()
    require(condition=caller.IsValid() and caller.GetModule().GetUUIDString() == CORE_UUID and
            caller.GetFileAddress() in CALLERS, message="unverified makeup XY caller")
    tid = thread.GetThreadID()
    require(condition=tid == publication.get("thread") and type(tid) is int and tid > 0 and
            publication.get("prediction") == prediction, message="makeup XY publication scope changed")
    base = pointer(value=register(frame=frame, name="x19"))
    source = pointer(value=register(frame=frame, name="x11"))
    offset = register(frame=frame, name="x8")
    require(condition=type(offset) is int and 0 <= offset < 848 and offset % 8 == 0,
            message="makeup XY index outside 106-point profile")
    vector = pointer(value=struct.unpack("<Q", read(address=base + 0x20, size=8))[0])
    begin, end = struct.unpack("<QQ", read(address=vector + 0x10, size=16))
    pointer(value=begin)
    require(condition=end - begin == 848 and source == begin + offset and
            base == publication.get("owned_base") and begin == publication.get("owned_points") and
            base != publication.get("source_base") and begin != publication.get("source_points"),
            message="makeup XY load is not from isolated candidate span")
    face_id = struct.unpack("<i", read(address=base + 0x40, size=4))[0]
    require(condition=face_id >= 0 and face_id == publication.get("face_id") and publication.get("faces") == 1,
            message="makeup XY face identity mismatch")
    loaded = [float_register_bits(frame=frame, name=name) for name in ("s2", "s3")]
    memory = list(struct.unpack("<II", read(address=source, size=8)))
    require(condition=loaded == memory, message="loaded XY registers differ from candidate memory")
    values = struct.unpack("<2f", struct.pack("<2I", *loaded))
    require(condition=all(math.isfinite(value) and 0 <= value <= 1 for value in values),
            message="unbounded makeup source XY")
    width, height = (register(frame=frame, name=name) for name in ("w21", "w22"))
    require(condition=all(type(value) is int and 0 < value <= 4096 for value in (width, height)),
            message="unbounded makeup geometry dimensions")
    return dict(prediction=prediction, thread=tid, binding_id=publication["binding_id"],
        graph_id=publication["graph_id"], graph=publication["graph"], base=base, points_begin=begin,
        source_address=source, point_index=offset // 8, face_id=face_id, width=width, height=height,
        loaded_bits=loaded, memory_bits=memory, caller_offset=caller.GetFileAddress(),
        observation="post-load-source-xy", renderer_consumption=False)


def install(*, debugger, target, core, callback):
    reader_trace.install(debugger=debugger, target=target, core=core, callback=callback, address=POINT_LOAD)
