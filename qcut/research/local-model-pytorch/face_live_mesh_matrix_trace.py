"""One borrowed HW slot, read-only matrix consumer controller.

Integration order (parent owns process continuation and all shared callbacks):
1. At MeshTrace getter, disable its slot; start() with pending MeshSnapshot.
2. Route matrix stops to observe(). When mode == mesh_copies, the slot is free;
   parent switches MeshTrace to vertices, then normals as before.
3. After normals, disable the mesh slot; resume() with the two copy receipts.
4. Route remaining stops here. Complete/failed always disables our slot.

Arming only after normals cannot capture the two earlier Lua property loads.
No target writes, expression evaluation, GPU calls, or process continuation.
"""
from __future__ import annotations

import struct

from face_preprocess_lldb import command, register
from face_live_mesh_abi import require
from face_live_mesh_matrix_abi import IDENTITIES, SITES, verify_libraries
from face_live_mesh_matrix_audit import MatrixAudit
from face_live_mesh_matrix_capture import MatrixScope

MAX_BREAKPOINTS = 32
MAX_CAPTURES = 4
REGISTER_NAMES = {
    "mvp_getter": ("x0", "x19", "x20", "sp", "x30", "q0", "q1"),
    "model_getter": ("x0", "x19", "x20", "sp", "x30", "q0", "q1"),
    "mvp_saved": ("x0", "x19", "x20", "sp", "x30"),
    "model_saved": ("x0", "x19", "x20", "sp", "x30"),
    "renderer_enter": ("x0", "x30"),
    "renderer_return": ("x0", "x30"),
    "setter": ("x0", "x1", "x2", "sp"),
    "lookup": ("x19", "x20", "x22", "x23", "x24", "x25", "x26", "x27", "x28", "sp"),
    "update_before": ("x0", "x1", "x2", "x19", "x20"),
    "create_before": ("x0", "x1", "x2", "x19", "x20"),
    "update_after": ("x0", "x19", "x20", "x30"),
    "create_after": ("x0", "x19", "x20", "x30"),
    "setter_return": ("sp",),
}


def read_register(*, frame, name):
    if name not in ("q0", "q1"):
        return register(frame=frame, name=name)
    import lldb
    value = frame.FindRegister(name)
    require(condition=value.IsValid(), message="missing matrix SIMD register")
    data, error = value.GetData(), lldb.SBError()
    require(condition=data.GetByteSize() == 16, message="matrix SIMD register width differs")
    words = []
    for offset in (0, 8):
        words.append(data.GetUnsignedInt64(error, offset))
        require(condition=error.Success(), message="unreadable matrix SIMD register")
    return struct.pack("<2Q", *words)


class MatrixTrace:
    def __init__(self, *, target, core, agfx, callback):
        self.abi = verify_libraries(core=core, agfx=agfx)
        self.target, self.points, self.slides = target, {}, {}
        self.audit, self.failed, self.history, self.mode = None, False, [], "disabled"
        self.active_count(maximum=3)
        try:
            for name, (role, pc) in SITES.items():
                before = target.GetNumBreakpoints()
                require(condition=before < MAX_BREAKPOINTS, message="matrix breakpoint inventory limit")
                library = "libcccreator.dylib" if role == "core" else "libAGFX.dylib"
                command(debugger=target.GetDebugger(), text=
                        f"breakpoint set --hardware --disable -s {library} -a {pc:#x}")
                require(condition=target.GetNumBreakpoints() == before + 1,
                        message="matrix breakpoint creation failed")
                point = target.GetBreakpointAtIndex(before)
                self.points[name] = point
                require(condition=point.IsHardware() and not point.IsEnabled(),
                        message="disabled hardware matrix breakpoint required")
                point.SetScriptCallbackFunction(callback)
        except Exception:
            self.disable()
            raise

    def load_slides(self):
        # ASLR load addresses do not exist during pre-launch breakpoint creation.
        slides = {}
        for role, (identity, _) in IDENTITIES.items():
            modules = [module for module in self.target.modules if module.GetUUIDString() == identity]
            require(condition=len(modules) == 1, message="one pinned matrix module per role required")
            address = modules[0].GetObjectFileHeaderAddress()
            require(condition=address.IsValid(), message="invalid matrix module header")
            slide = address.GetLoadAddress(self.target) - address.GetFileAddress()
            require(condition=type(slide) is int and 0 <= slide < 2**53 and slide % 4096 == 0,
                    message="invalid matrix module slide")
            slides[role] = slide
        require(condition=not self.slides or self.slides == slides, message="matrix module slides changed")
        self.slides = slides

    def active_count(self, *, maximum):
        total = self.target.GetNumBreakpoints()
        require(condition=total <= MAX_BREAKPOINTS, message="matrix breakpoint inventory limit")
        active = [self.target.GetBreakpointAtIndex(index) for index in range(total)
                  if self.target.GetBreakpointAtIndex(index).IsEnabled()]
        require(condition=len(active) <= maximum and all(point.IsHardware() for point in active),
                message="matrix shared hardware slot unavailable")

    def disable(self):
        for point in self.points.values():
            point.SetEnabled(False)

    def switch(self):
        self.disable()
        try:
            self.active_count(maximum=3)
            site = self.audit.expected_site()
            self.mode = self.audit.mode
            if site is not None:
                self.points[site["mode"]].SetEnabled(True)
            self.active_count(maximum=4)
        except Exception:
            self.failed = True
            self.disable()
            raise

    def start(self, *, source, prediction, timestamp_us, face_id, thread, core_slide, read):
        try:
            self.load_slides()
            require(condition=not self.failed and len(self.history) < MAX_CAPTURES and
                    (self.audit is None or self.audit.report()["complete"]) and
                    core_slide == self.slides["core"], message="cannot start matrix capture")
            scope = MatrixScope(prediction=prediction, timestamp_us=timestamp_us, face_id=face_id,
                                thread=thread, core_slide=core_slide, agfx_slide=self.slides["agfx"])
            self.audit = MatrixAudit(source=source, scope=scope, read=read)
            self.switch()
        except Exception:
            self.failed = True
            self.disable()
            raise

    def resume(self, *, vertices, normals):
        try:
            require(condition=not self.failed and self.audit is not None, message="inactive matrix capture")
            self.audit.bind_mesh_copies(vertices=vertices, normals=normals)
            self.switch()
        except Exception:
            self.failed = True
            self.disable()
            raise

    def observe(self, *, frame, location, prediction, timestamp_us, face_id):
        try:
            require(condition=not self.failed and self.audit is not None, message="inactive matrix capture")
            site = self.audit.expected_site()
            require(condition=site is not None, message="unexpected matrix stop outside capture")
            address, thread = frame.GetPCAddress(), frame.GetThread()
            point = location.GetBreakpoint()
            require(condition=point.GetID() == self.points[site["mode"]].GetID() and point.IsHardware() and
                    point.IsEnabled() and address.IsValid() and
                    address.GetModule().GetUUIDString() == site["uuid"] and
                    address.GetFileAddress() == site["file_pc"] and
                    address.GetLoadAddress(self.target) - address.GetFileAddress() == self.slides[site["module"]],
                    message="unverified matrix breakpoint")
            scope = MatrixScope(prediction=prediction, timestamp_us=timestamp_us, face_id=face_id,
                thread=thread.GetThreadID(), core_slide=self.slides["core"], agfx_slide=self.slides["agfx"])
            callers = []
            if site["mode"].endswith("_before"):
                for index in range(1, min(thread.GetNumFrames(), 5)):
                    caller = thread.GetFrameAtIndex(index).GetPCAddress()
                    if caller.IsValid():
                        callers.append((caller.GetModule().GetUUIDString(), caller.GetFileAddress()))
            registers = {name: read_register(frame=frame, name=name) for name in REGISTER_NAMES[site["mode"]]}
            event = self.audit.observe(module_uuid=site["uuid"], file_pc=site["file_pc"],
                                       scope=scope, registers=registers, callers=callers)
            self.switch()
            if self.audit.report()["complete"]:
                self.history.append(self.audit.report())
            return event
        except Exception:
            self.failed = True
            self.disable()
            raise

    def report(self):
        latest = self.audit.report() if self.audit is not None else None
        complete = not self.failed and bool(self.history) and latest is not None and latest["complete"]
        return dict(schema="face-live-mesh-matrix-trace-v1", abi=self.abi,
                    complete=complete, failed=self.failed, captures=list(self.history), current=latest,
                    matrix_cpu_consumer_verified=complete, matrix_consumer_verified=False,
                    qcut_mesh_ownership_verified=False, gpu_consumption_verified=False,
                    renderer_consumption=False, product_backend_enabled=False,
                    target_memory_written=False, unknown_stops_resumed=False)
