"""Bounded Stage2 call/return copies; never worker inputs or corrected points."""
from __future__ import annotations

import math
import struct
from pathlib import Path

from face_preprocess_lldb import LENS_UUID, command, file_address, register
from face_preprocess_memory import MAT_HEADER, checked_read

CALL = 0x2d9a20
RETURN = 0x2d9a24


def require(*, condition, message):
    if not condition:
        raise ValueError(message)


def scalar(*, read, address, kind):
    return struct.unpack(kind, checked_read(read=read, address=address, size=struct.calcsize(kind)))[0]


def floats(*, read, address, count):
    require(condition=type(count) is int and 1 <= count <= 560, message="bounded Extra float count required")
    values = list(struct.unpack(f"<{count}f", checked_read(read=read, address=address, size=count * 4)))
    require(condition=all(math.isfinite(value) and abs(value) <= 32768 for value in values),
            message="finite bounded Extra coordinates required")
    return values


def matrix(*, read, address, columns):
    fields = MAT_HEADER.unpack(checked_read(read=read, address=address, size=MAT_HEADER.size))
    flags, dims, rows, cols = fields[:4]
    data, stride, step = fields[4], fields[12], fields[13]
    require(condition=dims == 2 and flags & 0xfff == 5 and rows == 2 and cols in columns and
            cols * 4 <= stride <= 4096 and step == 4, message="unsupported Extra matrix descriptor")
    return [floats(read=read, address=data + row * stride, count=cols) for row in range(2)]


def points(*, read, runtime):
    begin, end, capacity = struct.unpack("<3Q", checked_read(read=read, address=runtime + 0x38, size=24))
    require(condition=begin >= 4096 and begin % 4 == 0 and end - begin in (848, 2240) and
            end <= capacity <= begin + 4096 and (capacity - begin) % 8 == 0,
            message="unsupported Extra runtime point vector")
    return floats(read=read, address=begin, count=(end - begin) // 4)


def context(*, read, registers, owner):
    alignment, runtime = registers["x0"], registers["x5"]
    configs, face = registers["x3"], registers["x4"]
    require(condition=configs == owner + 0x7e58 and face == owner + 0x7a40,
            message="Extra configuration owner mismatch")
    begin, end, capacity = struct.unpack("<3Q", checked_read(read=read, address=owner + 0x7c00, size=24))
    require(condition=begin >= 4096 and end - begin == 4000 and capacity == end and
            begin <= runtime < end and (runtime - begin) % 400 == 0,
            message="Extra runtime outside bounded owner pool")
    require(condition=scalar(read=read, address=runtime, kind="<Q") == alignment and
            scalar(read=read, address=runtime + 8, kind="<B") & 1 and
            scalar(read=read, address=alignment + 0x934, kind="<I") == 0x123456,
            message="Extra alignment is not the active initialized face")
    face_id = scalar(read=read, address=runtime + 12, kind="<i")
    require(condition=face_id >= 0, message="Extra face ID must be nonnegative")
    return dict(owner=owner, alignment=alignment, runtime=runtime, face_id=face_id,
                configs=configs, face_config=face)


def snapshot(*, read, scope):
    alignment, runtime = scope["alignment"], scope["runtime"]
    return dict(stage1=matrix(read=read, address=alignment + 0xaa8, columns=(106,)),
        tracked=matrix(read=read, address=alignment + 0xb08, columns=(106, 280)),
        inverse=matrix(read=read, address=alignment + 0x1238, columns=(3,)),
        published_xy=points(read=read, runtime=runtime),
        config_bytes={hex(offset): scalar(read=read, address=scope["configs"] + offset, kind="<B")
                      for offset in (0, 4, 0xa, 0xb, 0x20, 0x21)},
        face_modes={hex(offset): scalar(read=read, address=scope["face_config"] + offset, kind="<i")
                    for offset in (0x3c, 0x68)},
        reset_byte=scalar(read=read, address=runtime + 0x114, kind="<B"))


class ExtraTrace:
    def __init__(self, *, target, point_breakpoint, callback, inner_model=False, model_directory=None):
        self.target, self.point = target, point_breakpoint
        self.events, self.pending, self.prediction = [], None, -1
        self.owner, self.thread = None, None
        self.inner_model, self.source, self.base = inner_model, None, None
        self.input_parameter = None
        self.model_directory = model_directory
        if inner_model:
            require(condition=isinstance(model_directory, Path) and model_directory.is_absolute(),
                    message="explicit private Extra model directory required")
            model_directory.mkdir(mode=0o700)
        self.breakpoints = {}
        require(condition=sum(module.GetUUIDString() == LENS_UUID for module in target.modules) == 1,
                message="pinned Extra image required")
        self.point.SetEnabled(False)
        for name, offset in (("before", CALL), ("after", RETURN)):
            before = target.GetNumBreakpoints()
            command(debugger=target.GetDebugger(),
                    text=f"breakpoint set --hardware --disable -s liblens.dylib -a {offset:#x}")
            require(condition=target.GetNumBreakpoints() == before + 1,
                    message="Extra hardware breakpoint creation failed")
            breakpoint = target.GetBreakpointAtIndex(before)
            require(condition=breakpoint.IsHardware(), message="Extra software breakpoint forbidden")
            breakpoint.SetScriptCallbackFunction(callback)
            self.breakpoints[name] = breakpoint

    def arm(self, *, name):
        self.point.SetEnabled(False)
        for breakpoint in self.breakpoints.values():
            breakpoint.SetEnabled(False)
        selected = self.point if name == "points" else self.breakpoints[name]
        selected.SetEnabled(True)
        active = sum(self.target.GetBreakpointAtIndex(index).IsEnabled()
                     for index in range(self.target.GetNumBreakpoints()))
        require(condition=active <= 4, message="Extra hardware breakpoint budget exceeded")

    def begin(self, *, prediction, owner, thread):
        require(condition=self.pending is None and type(prediction) is int and
                prediction == self.prediction + 1 and prediction in (0, 1),
                message="Extra diagnostics require two ordered cold predictions")
        require(condition=len(self.events) == prediction * 2,
                message="missing previous Extra call/return")
        require(condition=self.owner in (None, owner) and self.thread in (None, thread),
                message="Extra owner/thread changed")
        self.prediction, self.owner, self.thread = prediction, owner, thread
        self.arm(name="before")

    def observe(self, *, frame, location, read):
        require(condition=location.GetBreakpoint().IsHardware() and
                frame.GetThread().GetThreadID() == self.thread, message="unverified Extra thread/breakpoint")
        offset = file_address(address=frame.GetPCAddress())
        require(condition=len(self.events) < 4, message="Extra call budget exceeded")
        if offset == CALL:
            require(condition=self.pending is None and len(self.events) == self.prediction * 2,
                    message="unexpected Extra call order")
            values = {name: register(frame=frame, name=name) for name in ("x0", "x3", "x4", "x5")}
            self.pending = context(read=read, registers=values, owner=self.owner)
            if self.inner_model:
                self.source = register(frame=frame, name="x1")
                self.input_parameter = register(frame=frame, name="x2")
                self.base = frame.GetPC() - CALL
            name = "before"
        else:
            require(condition=offset == RETURN and self.pending is not None and
                    len(self.events) == self.prediction * 2 + 1, message="unpaired Extra return")
            current = context(read=read, owner=self.owner, registers=dict(x0=self.pending["alignment"],
                x3=self.pending["configs"], x4=self.pending["face_config"], x5=self.pending["runtime"]))
            require(condition=current == self.pending, message="Extra face identity changed across call")
            name = "after"
        row = dict(event=name, prediction=self.prediction, thread=self.thread, offset=offset,
                   **self.pending, snapshot=snapshot(read=read, scope=self.pending))
        if self.inner_model:
            from face_extra_crop_trace import snapshot as crop_snapshot
            row["crop_geometry"] = crop_snapshot(read=read, scope=self.pending, event=name,
                prediction=self.prediction, thread=self.thread, base=self.base,
                source=self.source, input_parameter=self.input_parameter)
        if name == "after":
            row["return_code"] = register(frame=frame, name="w0")
            if self.inner_model:
                from face_live_extra_model_trace import snapshot as model_snapshot
                row["extra_model"] = model_snapshot(read=read, alignment=self.pending["alignment"],
                    base=self.base, source=self.source, directory=self.model_directory, prediction=self.prediction)
        self.events.append(row)
        if name == "after":
            self.pending = None
            self.arm(name="points")
        else:
            self.arm(name="after")

    def report(self):
        return dict(schema="face-live-extra-boundary-v1", events=self.events,
                    complete=self.pending is None and self.prediction == 1 and len(self.events) == 4,
                    target_memory_written=False, native_points_sent_to_worker=False,
                    product_parity_verified=False)
