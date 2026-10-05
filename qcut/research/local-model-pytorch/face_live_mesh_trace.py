"""One borrowed hardware slot: getter, whole vertex copy, whole normal copy.

Parent callback calls observe() and stops the target on any exception. This
controller never continues the process, evaluates expressions, or writes memory.
"""
from __future__ import annotations

from face_preprocess_lldb import command, register
from face_live_mesh_abi import CORE_UUID, COPY_RETURNS, GETTER_CALLERS, SITES, require, verify_library
from face_live_mesh_capture import ReadBudget, pointer, snapshot, snapshot_report, whole_copy
import struct

MAX_BREAKPOINTS = 32
MAX_CAPTURES = 4


class MeshTrace:
    def __init__(self, *, target, core, callback):
        self.abi = verify_library(library=core)
        self.target, self.points = target, {}
        self.mode, self.pending, self.failed = "disabled", None, False
        self.events, self.completed, self.scope = [], 0, None
        self.active_count(maximum=3)
        modules = [module for module in target.modules if module.GetUUIDString() == CORE_UUID]
        require(condition=len(modules) == 1, message="one pinned mesh image required")
        try:
            for name, address in SITES.items():
                before = target.GetNumBreakpoints()
                require(condition=before < MAX_BREAKPOINTS, message="mesh breakpoint inventory limit")
                command(debugger=target.GetDebugger(), text=
                    f"breakpoint set --hardware --disable -s libcccreator.dylib -a {address:#x}")
                require(condition=target.GetNumBreakpoints() == before + 1,
                        message="mesh breakpoint creation failed")
                point = target.GetBreakpointAtIndex(before)
                self.points[name] = point
                require(condition=point.IsHardware() and not point.IsEnabled(),
                        message="disabled hardware mesh breakpoint required")
                point.SetScriptCallbackFunction(callback)
        except Exception:
            self.disable()
            raise

    def active_count(self, *, maximum):
        total = self.target.GetNumBreakpoints()
        require(condition=total <= MAX_BREAKPOINTS, message="mesh breakpoint inventory limit")
        active = [self.target.GetBreakpointAtIndex(index) for index in range(total)
                  if self.target.GetBreakpointAtIndex(index).IsEnabled()]
        require(condition=len(active) <= maximum and all(point.IsHardware() for point in active),
                message="mesh shared hardware slot unavailable")

    def disable(self):
        for point in self.points.values():
            point.SetEnabled(False)
        self.mode = "disabled"

    def switch(self, *, mode):
        self.disable()
        try:
            self.active_count(maximum=3)
            if mode != "disabled":
                self.points[mode].SetEnabled(True)
            self.active_count(maximum=4)
            self.mode = mode
        except Exception:
            self.disable()
            raise

    def SetEnabled(self, enabled):
        require(condition=type(enabled) is bool and self.pending is None and not self.failed,
                message="cannot lend pending/failed mesh slot")
        if enabled:
            require(condition=self.completed < MAX_CAPTURES, message="mesh capture budget exceeded")
        self.switch(mode="getter" if enabled else "disabled")

    def observe(self, *, frame, location, prediction, timestamp_us, face_id, read):
        try:
            return self._observe(frame=frame, location=location, prediction=prediction,
                timestamp_us=timestamp_us, face_id=face_id, read=read)
        except Exception:
            self.failed = True
            self.disable()
            raise

    def _observe(self, *, frame, location, prediction, timestamp_us, face_id, read):
        require(condition=not self.failed and self.mode in SITES and self.completed < MAX_CAPTURES,
                message="mesh observation outside active capture")
        address, thread = frame.GetPCAddress(), frame.GetThread()
        point = location.GetBreakpoint()
        require(condition=point.IsHardware() and point.IsEnabled() and
                point.GetID() == self.points[self.mode].GetID() and address.IsValid() and
                address.GetModule().GetUUIDString() == CORE_UUID and
                address.GetFileAddress() == SITES[self.mode], message="unverified mesh breakpoint")
        tid = thread.GetThreadID()
        require(condition=type(prediction) is int and 0 <= prediction < 4096 and
                type(timestamp_us) is int and 0 <= timestamp_us < 2**53 and
                type(tid) is int and tid > 0, message="invalid mesh observation scope")
        target = thread.GetProcess().GetTarget()
        slide = address.GetLoadAddress(target) - address.GetFileAddress()
        require(condition=type(slide) is int and 0 <= slide < 2**53 and slide % 4096 == 0,
                message="invalid mesh image slide")
        scope = (prediction, timestamp_us, tid, slide, face_id)
        reader = ReadBudget(read=read)
        if self.mode == "getter":
            caller = thread.GetFrameAtIndex(1).GetPCAddress()
            require(condition=caller.IsValid() and caller.GetModule().GetUUIDString() == CORE_UUID and
                    caller.GetFileAddress() in GETTER_CALLERS, message="unverified 1256 mesh getter caller")
            mesh, begin = (pointer(value=register(frame=frame, name=name)) for name in ("x0", "x9"))
            index, size = (register(frame=frame, name=name) for name in ("w19", "x10"))
            require(condition=type(size) is int and 8 <= size <= 80 and size % 8 == 0 and
                    type(index) is int and 0 <= index < size // 8,
                    message="unbounded 1256 mesh list")
            require(condition=struct.unpack("<Q", reader.read(address=begin + index * 8, size=8))[0] == mesh,
                    message="mesh getter does not reference listed mesh")
            owner = pointer(value=register(frame=frame, name="x20"))
            self.pending = snapshot(reader=reader, mesh=mesh, slide=slide, face_id=face_id)
            self.scope = scope
            row = dict(event="native_mesh_getter", prediction=prediction, timestamp_us=timestamp_us,
                       thread=tid, result_owner=owner, list_index=index, list_count=size // 8,
                       **snapshot_report(value=self.pending))
            self.events.append(row)
            self.switch(mode="vertices")
            return row
        require(condition=self.pending is not None and self.scope == scope,
                message="mesh copy left getter scope")
        require(condition=register(frame=frame, name="x30") == slide + COPY_RETURNS[self.mode],
                message="mesh copy boundary did not return from pinned copy loop")
        current = snapshot(reader=reader, mesh=self.pending.mesh, slide=slide, face_id=face_id)
        require(condition=current == self.pending, message="mesh changed since getter")
        names = ("x8", "x9", "x10", "x11", "x12", "w13", "x19", "x21", "x23",
                 "w20", "w22", "w25", "sp")
        registers = {name: register(frame=frame, name=name) for name in names}
        destination_mesh = pointer(value=registers["x19"])
        if self.mode == "normals":
            require(condition=destination_mesh == self.events[-1]["destination_mesh"],
                    message="mesh copy renderer object changed")
        row = dict(event="native_mesh_copy", prediction=prediction, timestamp_us=timestamp_us,
                   thread=tid, face_id=face_id, destination_mesh=destination_mesh,
                   **whole_copy(reader=reader, registers=registers, channel=self.mode, source=self.pending))
        self.events.append(row)
        if self.mode == "vertices":
            self.switch(mode="normals")
        else:
            self.pending = None
            self.completed += 1
            self.switch(mode="disabled")
        return row

    def report(self):
        return dict(schema="face-live-mesh-trace-v1", abi=self.abi,
            complete=not self.failed and self.pending is None and self.completed > 0 and
                     self.mode == "disabled" and len(self.events) == self.completed * 3,
            completed=self.completed, failed=self.failed, events=list(self.events),
            target_memory_written=False, software_breakpoints_used=False,
            unknown_stops_resumed=False, matrix_consumer_verified=False,
            qcut_mesh_ownership_verified=False, gpu_consumption_verified=False,
            renderer_consumption=False, product_backend_enabled=False)
