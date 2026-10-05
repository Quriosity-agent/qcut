"""Alternate read-only hardware locations without stepping over an armed XY trap."""
from __future__ import annotations

import struct

from face_preprocess_lldb import command, register
import face_live_makeup_point_trace as trace

POINT_STORED = 0xa20804


def float32(*, value):
    return struct.unpack("<f", struct.pack("<f", value))[0]


def transformed_bits(*, row):
    x, y = struct.unpack("<2f", struct.pack("<2I", *row["loaded_bits"]))
    output = (float32(value=x * row["width"]),
              float32(value=row["height"] - float32(value=y * row["height"])))
    return list(struct.unpack("<2I", struct.pack("<2f", *output)))


def observe_store(*, frame, location, prediction, read, row):
    address, thread = frame.GetPCAddress(), frame.GetThread()
    trace.require(condition=location.GetBreakpoint().IsHardware() and address.IsValid() and
        address.GetModule().GetUUIDString() == trace.CORE_UUID and address.GetFileAddress() == POINT_STORED,
        message="unverified makeup post-store breakpoint")
    caller = thread.GetFrameAtIndex(1).GetPCAddress()
    trace.require(condition=caller.IsValid() and caller.GetModule().GetUUIDString() == trace.CORE_UUID and
        caller.GetFileAddress() == row["caller_offset"] and thread.GetThreadID() == row["thread"] and
        prediction == row["prediction"], message="makeup store left the observed load scope")
    values = {name: register(frame=frame, name=name) for name in ("x19", "x8", "x9", "x11", "w21", "w22")}
    trace.require(condition=values["x19"] == row["base"] and values["x8"] == row["point_index"] * 8 and
        (values["w21"], values["w22"]) == (row["width"], row["height"]),
        message="makeup store identity/index/dimensions changed")
    begin, destination = (trace.pointer(value=values[name]) for name in ("x9", "x11"))
    trace.require(condition=destination == begin + values["x8"] and
        (begin + 848 <= row["points_begin"] or row["points_begin"] + 848 <= begin),
        message="makeup output aliases source or has an invalid offset")
    source = list(struct.unpack("<2I", read(address=row["source_address"], size=8)))
    registers = [trace.float_register_bits(frame=frame, name=name) for name in ("s2", "s3")]
    stored = list(struct.unpack("<2I", read(address=destination, size=8)))
    trace.require(condition=source == row["loaded_bits"] and stored == registers == transformed_bits(row=row),
        message="makeup post-store value differs from the independently observed source")
    return dict(prediction=prediction, thread=row["thread"], point_index=row["point_index"],
        binding_id=row["binding_id"], graph_id=row["graph_id"], source_address=row["source_address"],
        destination_begin=begin, destination_address=destination, stored_bits=stored,
        observation="post-store-transformed-xy", target_memory_written=False)


class PointRotation:
    def __init__(self, *, target, load, callback):
        self.target, self.load = target, load
        self.pending, self.loads, self.events = None, 0, []
        self.mode = "disabled"
        trace.require(condition=load.IsHardware(), message="rotation requires hardware load breakpoint")
        load.SetEnabled(False)
        before = target.GetNumBreakpoints()
        command(debugger=target.GetDebugger(), text=
            f"breakpoint set --hardware --disable -s libcccreator.dylib -a {POINT_STORED:#x}")
        trace.require(condition=target.GetNumBreakpoints() == before + 1,
                      message="post-store hardware breakpoint creation failed")
        self.stored = target.GetBreakpointAtIndex(before)
        trace.require(condition=self.stored.IsHardware(), message="post-store software breakpoint forbidden")
        self.stored.SetScriptCallbackFunction(callback)
        self.SetEnabled(True)

    def switch(self, *, mode):
        self.load.SetEnabled(False)
        self.stored.SetEnabled(False)
        selected = {"load": self.load, "stored": self.stored, "disabled": None}[mode]
        if selected is not None:
            selected.SetEnabled(True)
        active = sum(self.target.GetBreakpointAtIndex(index).IsEnabled()
                     for index in range(self.target.GetNumBreakpoints()))
        trace.require(condition=active <= 4, message="makeup rotation hardware budget exceeded")
        self.mode = mode

    def SetEnabled(self, enabled):
        # ExtraTrace lends this same fourth slot to its call/return observations.
        trace.require(condition=self.pending is None, message="cannot lend a pending makeup store slot")
        self.switch(mode="load" if enabled else "disabled")

    def loaded(self, *, row):
        trace.require(condition=self.mode == "load" and self.pending is None and self.loads < trace.MAX_HITS,
                      message="unexpected or unbounded makeup rotation load")
        self.pending = dict(row)
        self.loads += 1
        self.switch(mode="stored")

    def observe(self, *, frame, location, prediction, read):
        trace.require(condition=self.mode == "stored" and self.pending is not None,
                      message="makeup store has no paired load")
        row = observe_store(frame=frame, location=location, prediction=prediction, read=read, row=self.pending)
        self.events.append(row)
        self.pending = None
        self.switch(mode="load")

    def report(self):
        return dict(schema="face-live-makeup-point-rotation-v1", loads=self.loads, stores=len(self.events),
            complete=self.pending is None and self.loads > 0 and self.loads == len(self.events),
            events=self.events, target_memory_written=False, software_breakpoints_used=False,
            unknown_stops_resumed=False)
