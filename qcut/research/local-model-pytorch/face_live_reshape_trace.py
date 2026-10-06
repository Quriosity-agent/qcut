"""One hardware slot traces one final V5 or V6 conversion pass, not all rendering."""
from __future__ import annotations

from face_preprocess_lldb import command, register
from face_live_mesh_abi import verify_library
import face_live_reshape_points as points


class ReshapeTrace:
    def __init__(self, *, target, core, branch, callback):
        points.require(condition=branch in ("v5", "v6"), message="explicit reshape branch required")
        identity = verify_library(library=core)
        self.identity = {key: identity[key] for key in ("uuid", "sha256")}
        self.target, self.branch, self.breakpoints = target, branch, {}
        self.pending, self.publication = None, None
        self.mode, self.failed, self.finished = "disabled", False, False
        self.events, self.callbacks = [], 0
        self.failure_context = None
        self.budget(maximum=3)
        try:
            for name, address in points.SITES.items():
                if not name.startswith(branch):
                    continue
                before = target.GetNumBreakpoints()
                command(debugger=target.GetDebugger(), text=
                    f"breakpoint set --hardware --disable -s libcccreator.dylib -a {address:#x}")
                points.require(condition=target.GetNumBreakpoints() == before + 1,
                               message="reshape hardware breakpoint creation failed")
                point = target.GetBreakpointAtIndex(before)
                self.breakpoints[name] = point
                points.require(condition=point.IsHardware() and not point.IsEnabled(),
                               message="disabled reshape hardware breakpoint required")
                point.SetScriptCallbackFunction(callback)
        except Exception:
            self.disable()
            raise

    def budget(self, *, maximum):
        count = self.target.GetNumBreakpoints()
        points.require(condition=count <= 16, message="reshape breakpoint inventory limit")
        active = [self.target.GetBreakpointAtIndex(index) for index in range(count)
                  if self.target.GetBreakpointAtIndex(index).IsEnabled()]
        points.require(condition=len(active) <= maximum and all(point.IsHardware() for point in active),
                       message="reshape hardware slot unavailable")

    def disable(self):
        for point in self.breakpoints.values():
            point.SetEnabled(False)
        self.mode = "disabled"

    def switch(self, *, mode):
        self.disable()
        try:
            self.budget(maximum=3)
            if mode != "disabled":
                self.breakpoints[mode].SetEnabled(True)
            self.budget(maximum=4)
            self.mode = mode
        except Exception:
            self.disable()
            raise

    def arm(self):
        points.require(condition=self.mode == "disabled" and not self.failed and
                       self.pending is None and not self.events and not self.finished,
                       message="reshape trace cannot be rearmed")
        self.switch(mode="v5_x" if self.branch == "v5" else "v6_load")

    def observe(self, *, frame, location, publication, read):
        try:
            self._observe(frame=frame, location=location, publication=publication, read=read)
        except Exception:
            self.failed = True
            registers = {}
            for name in ("x8", "x9", "x10", "x11", "x12", "x13", "x22", "x23", "x24"):
                try:
                    registers[name] = register(frame=frame, name=name)
                except Exception:
                    registers[name] = None
            self.failure_context = dict(stage=self.mode, registers=registers, pending=self.pending)
            self.disable()
            raise

    def _observe(self, *, frame, location, publication, read):
        self.callbacks += 1
        points.require(condition=not self.failed and not self.finished and self.mode != "disabled" and
                       self.callbacks <= 768, message="reshape callback budget/scope exceeded")
        points.require(condition=location.GetBreakpoint().GetID() == self.breakpoints[self.mode].GetID() and
                       location.GetBreakpoint().IsEnabled(), message="unexpected reshape breakpoint identity")
        points.validate_frame(frame=frame, location=location, stage=self.mode, publication=publication)
        if self.publication is None:
            self.publication = dict(publication)
        points.require(condition=publication == self.publication, message="reshape publication changed within pass")
        if self.mode == "v5_x":
            self.pending = points.v5_start(frame=frame, read=read, publication=publication)
            points.require(condition=self.pending["point_index"] == len(self.events),
                           message="V5 skipped or repeated point")
            self.switch(mode="v5_y")
            return
        if self.mode in ("v5_y", "v5_store"):
            stored = self.mode == "v5_store"
            points.validate_v5(frame=frame, read=read, publication=publication, pending=self.pending, stored=stored)
            if not stored:
                self.switch(mode="v5_store")
                return
            self.events.append(dict(self.pending, branch="v5", loads_verified=True, stores_verified=True))
            self.pending = None
            self.finished = len(self.events) == 106
            self.switch(mode="disabled" if self.finished else "v5_x")
            return
        if self.mode == "v6_load":
            self.pending = points.v6_start(frame=frame, read=read, publication=publication)
            points.require(condition=self.pending["output_index"] == len(self.events) and
                (not self.events or self.pending["rule_end"] == self.events[0]["rule_end"]),
                message="V6 skipped or repeated rule")
            self.switch(mode="v6_store")
            return
        destinations = points.validate_v6(frame=frame, read=read, publication=publication, pending=self.pending)
        self.events.append(dict(self.pending, branch="v6", destinations=destinations,
                                loads_verified=True, stores_verified=True))
        self.finished = self.pending["rule_offset"] + 36 == self.pending["rule_end"]
        self.pending = None
        self.switch(mode="disabled" if self.finished else "v6_load")

    def report(self):
        return dict(schema="face-live-reshape-points-v1", branch=self.branch, identity=self.identity,
            complete=self.finished and not self.failed and self.pending is None and self.mode == "disabled",
            failed=self.failed, callbacks=self.callbacks, publication=self.publication, events=list(self.events),
            failure_context=self.failure_context,
            scope="first-final-prediction-selected-conversion-pass", target_memory_written=False,
            software_breakpoints_used=False, unknown_stops_resumed=False,
            renderer_consumption=False, gpu_consumption_verified=False, product_backend_enabled=False)
