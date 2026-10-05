"""Live read-only caller/order observer; actual entry registers, never cached crop.

Three inference breakpoints; an optional fourth observes getter stacks or XY loads.
The native post-predict callback performs the pixel/geometry exchange and owned
renderer handoff. Getter observations never count as consumption receipts.
"""
from __future__ import annotations

import json
import hashlib
import math
from pathlib import Path
import re
import struct
import sys
import time

from face_preprocess_lldb import CALLERS, command, register, file_address
from face_preprocess_memory import unpack_detection_call
from face_live_worker_protocol import exchange
import face_live_reader_trace as reader_trace
import face_live_makeup_point_trace as point_trace
from face_live_extra_trace import ExtraTrace
from face_live_makeup_point_rotation import PointRotation

STATE = None
POINTS = {"begin": 0x2c4dac, "call": 0x2ca3bc, "infer": 0x36b43c}
CONTROL_LOG_LIMIT = 4 * 1024**2


def diagnostic_value(*, capture):
    try:
        value = capture()
        json.dumps(value, allow_nan=False)
        return value
    except Exception as error:
        return dict(unavailable=f"{type(error).__name__}: {error}"[:512])


def address_identity(*, address, target):
    if not address.IsValid():
        return dict(unavailable="invalid SBAddress")
    module = address.GetModule()
    return dict(load_address=address.GetLoadAddress(target), file_address=address.GetFileAddress(),
                module=(module.GetFileSpec().GetFilename() or "")[:256],
                uuid=(module.GetUUIDString() or "")[:128])


def breakpoint_inventory(*, target):
    count, rows = target.GetNumBreakpoints(), []
    for index in range(min(count, 16)):
        point = target.GetBreakpointAtIndex(index)
        locations, total = [], point.GetNumLocations()
        for slot in range(min(total, 8)):
            location = point.GetLocationAtIndex(slot)
            locations.append(dict(id=location.GetID(), enabled=location.IsEnabled(),
                resolved=location.IsResolved(), hits=location.GetHitCount(),
                address=diagnostic_value(capture=lambda: address_identity(address=location.GetAddress(), target=target))))
        rows.append(dict(id=point.GetID(), hardware=point.IsHardware(), enabled=point.IsEnabled(),
                         hits=point.GetHitCount(), location_count=total, locations=locations))
    return dict(count=count, entries=rows, truncated=count > 16 or any(row["location_count"] > 8 for row in rows),
                physical_debug_register_state_verified=False)


def stop_detail(*, thread, frame, target, read, description, inventory, last_callback):
    count = thread.GetStopReasonDataCount()
    result = dict(reason_data_count=count,
        reason_data=[thread.GetStopReasonDataAtIndex(index) for index in range(min(count, 16))],
        reason_data_truncated=count > 16, hardware_matches=[], automatic_resume_allowed=False,
        cause="unresolved-unexpected-stop")
    if frame is None:
        return result
    pc = frame.GetPC()
    result["address"] = diagnostic_value(capture=lambda: address_identity(address=frame.GetPCAddress(), target=target))
    result["registers"] = {name: diagnostic_value(capture=lambda name=name: register(frame=frame, name=name))
                           for name in ("pc", "cpsr", "esr", "far", "mdscr_el1")}
    if read is not None and 4096 <= pc < 2**64 - 4 and pc % 4 == 0:
        def instruction():
            data = read(address=pc, size=4)
            if len(data) != 4:
                raise ValueError("short stopped instruction read")
            word = struct.unpack("<I", data)[0]
            return dict(bytes_hex=data.hex(), arm64_brk=word & 0xffe0001f == 0xd4200000,
                        source="SBProcess.ReadMemory", software_traps_may_be_removed=True)
        result["instruction"] = diagnostic_value(capture=instruction)
    for point in inventory.get("entries", []):
        for location in point["locations"]:
            address = location["address"]
            if (point["hardware"] and point["enabled"] and location["enabled"] and location["resolved"] and
                    address.get("load_address") == pc and address.get("uuid") and
                    address.get("uuid") == result["address"].get("uuid") and
                    address.get("file_address") == result["address"].get("file_address")):
                result["hardware_matches"].append(dict(breakpoint=point["id"], location=location["id"]))
    # SBThread exception data may expose only the exception type, not its Mach codes.
    match = re.fullmatch(r"EXC_BREAKPOINT \(code=(0x[0-9a-fA-F]{1,16}|[0-9]{1,20}), "
                        r"subcode=(0x[0-9a-fA-F]{1,16}|[0-9]{1,20})\)", description)
    if match and thread.GetStopReason() == 6:
        code, subcode = [int(text, 16 if text.startswith("0x") else 10) for text in match.groups()]
        result["mach_description"] = dict(code=code, subcode=subcode, source="LLDB description, not raw exception packet")
        if code == 1:
            result["signature"] = "arm64-step-form" if subcode == 0 else "arm64-address-trap-form"
    if last_callback:
        result["last_callback_relation"] = dict(
            same_thread=last_callback.get("thread") == thread.GetThreadID(),
            same_pc=last_callback.get("pc") == pc,
            same_stop_id=last_callback.get("stop_id") == thread.GetProcess().GetStopID(),
            callback_returned_false=last_callback.get("disposition") == "return-false")
    return result


class Observer:
    def __init__(self, *, target, config):
        self.target, self.config = target, config
        self.index, self.tid, self.callbacks = -1, None, 0
        self.events, self.failures = [], []
        self.started = time.monotonic()
        self.process = None
        self.caller = None
        self.reader_hits, self.reader_events = 0, []
        self.point_hits, self.point_events = 0, []
        self.extra = None
        self.rotation = None
        self.mesh = None
        self.mesh_callbacks = 0
        self.matrix_callbacks = 0
        self.reshape = None
        self.callback_tail = []

    def callback_entry(self, *, frame, location):
        row = diagnostic_value(capture=lambda: dict(thread=frame.GetThread().GetThreadID(),
            stop_id=self.process.GetStopID(), pc=frame.GetPC(), breakpoint=location.GetBreakpoint().GetID(),
            location=location.GetID(), breakpoint_hits=location.GetBreakpoint().GetHitCount()))
        row.update(disposition="entered", prediction_before=self.index)
        self.callback_tail = [*self.callback_tail[-15:], row]
        return row

    def read(self, *, address, size):
        import lldb
        error = lldb.SBError()
        data = self.process.ReadMemory(address, size, error)
        if error.Fail() or len(data) != size:
            raise ValueError("unreadable live caller memory")
        return data

    def scalar(self, *, address, kind):
        return struct.unpack(kind, self.read(address=address, size=struct.calcsize(kind)))[0]

    def inverse(self, *, alignment):
        fields = struct.unpack("<iiii10Q", self.read(address=alignment + 0x1048, size=96))
        flags, dims, rows, cols = fields[:4]
        data, stride, step = fields[4], fields[12], fields[13]
        if (dims != 2 or flags & 0xfff != 5 or rows != 2 or cols != 3 or
                data < 4096 or not 12 <= stride <= 4096 or step != 4):
            raise ValueError("160 predictor-entry inverse descriptor unsupported")
        result = [list(struct.unpack("<3f", self.read(address=data + row * stride, size=12)))
                  for row in range(2)]
        if any(not math.isfinite(value) or abs(value) > 32768 for row in result for value in row):
            raise ValueError("160 predictor-entry inverse unbounded")
        return result

    def handle(self, *, frame, location):
        self.callbacks += 1
        if self.callbacks > 4096 or time.monotonic() - self.started > 240:
            raise ValueError("live debugger watchdog exceeded")
        if not location.GetBreakpoint().IsHardware():
            raise ValueError("live software breakpoints forbidden")
        offset = file_address(address=frame.GetPCAddress())
        op = next((name for name, address in POINTS.items() if offset == address), None)
        if op is None:
            raise ValueError("unrecognized live breakpoint")
        tid = frame.GetThread().GetThreadID()
        if self.tid is not None and tid != self.tid:
            raise ValueError("live cross-thread callbacks unsupported")
        self.tid = tid
        if op == "begin":
            if self.caller is not None:
                raise ValueError("unconsumed detection caller at prediction boundary")
            self.index += 1
            data = dict(owner=register(frame=frame, name="x0"))
            if self.extra is not None:
                self.extra.begin(prediction=self.index, owner=data["owner"], thread=tid)
        elif op == "call":
            if register(frame=frame, name="w3") != 160 or register(frame=frame, name="w4") != 160:
                return
            caller = file_address(address=frame.GetThread().GetFrameAtIndex(1).GetPCAddress())
            if caller not in CALLERS:
                raise ValueError("unverified live detection caller")
            registers = {name:register(frame=frame, name=name) for name in
                         ("x0", "x1", "x2", "x29", "lr", "w3", "w4", "w5", "w6", "w7")}
            registers["s0_bits"] = register(frame=frame, name="s0")
            observed = unpack_detection_call(read=self.read, registers=registers)
            if self.caller is not None:
                raise ValueError("second detection caller before predictor")
            self.caller = observed["alignment"]
            call = {key:observed[key] for key in ("format", "orientation", "target", "flags", "expansion")}
            call["rect"] = {"values":observed["rect"]["values"]}
            data = dict(alignment=observed["alignment"], call=call,
                source=dict(width=observed["source_mat"]["cols"], height=observed["source_mat"]["rows"],
                            sha256=hashlib.sha256(observed["source_bytes"]).hexdigest()))
        else:
            predictor = register(frame=frame, name="x0")
            dims = [self.scalar(address=predictor + offset, kind="<i") for offset in (0x3c, 0x40)]
            if dims not in ([120, 120], [160, 160]):
                raise ValueError("unsupported live predictor dimensions")
            provider = self.scalar(address=predictor + 0x110, kind="<Q")
            inverse = None
            if dims[0] == 160:
                if self.caller is None:
                    raise ValueError("160 predictor without actual crop caller")
                # FaceAlignmentDet writes this after crop and before this predictor entry.
                inverse = self.inverse(alignment=self.caller)
                self.caller = None
            elif self.caller is not None:
                raise ValueError("tracking predictor crossed pending detection caller")
            data = dict(size=dims[0], network=self.scalar(address=provider + 0x48, kind="<Q"),
                        detection_inverse=inverse)
        exchange(path=self.config["socket"], message=dict(op=op, data=data, prediction=self.index,
            pid=self.process.GetProcessID(), token=self.config["token"]), timeout=15)
        self.events.append(dict(op=op, prediction=self.index, data=data))
        if op == "infer" and self.index == 1 and self.config.get("trace_mesh_points", False):
            self.mesh.SetEnabled(True)
        if op == "infer" and self.index == 1 and self.config.get("trace_reshape_points"):
            self.reshape.arm()


def on_breakpoint(frame, location, internal_dict):
    callback = None
    try:
        STATE.process = frame.GetThread().GetProcess()
        callback = STATE.callback_entry(frame=frame, location=location)
        STATE.handle(frame=frame, location=location)
        callback.update(disposition="return-false", prediction_after=STATE.index)
        return False
    except Exception as error:
        if callback is not None:
            callback.update(disposition="return-true-error", prediction_after=STATE.index)
        STATE.failures.append(f"{type(error).__name__}: {error}")
        return True


def on_mesh_breakpoint(frame, location, internal_dict):
    try:
        STATE.mesh_callbacks += 1
        if STATE.mesh_callbacks > 12 or time.monotonic() - STATE.started > 240 or STATE.index != 1:
            raise ValueError("mesh cold-frame diagnostic budget/scope exceeded")
        STATE.mesh.observe(frame=frame, location=location, prediction=STATE.index,
                           timestamp_us=0, face_id=0, read=STATE.read)
        return False
    except Exception as error:
        STATE.failures.append(f"{type(error).__name__}: {error}")
        return True


def on_reshape_breakpoint(frame, location, internal_dict):
    try:
        from face_live_reshape_points import publication
        if STATE.index != 1 or time.monotonic() - STATE.started > 240:
            raise ValueError("reshape trace outside final cold prediction")
        row = publication(path=Path(STATE.config["report"]).parent / "records.jsonl", prediction=STATE.index)
        STATE.reshape.observe(frame=frame, location=location, publication=row, read=STATE.read)
        return False
    except Exception as error:
        STATE.failures.append(f"{type(error).__name__}: {error}")
        return True


def on_matrix_breakpoint(frame, location, internal_dict):
    try:
        STATE.matrix_callbacks += 1
        if STATE.matrix_callbacks > 64 or time.monotonic() - STATE.started > 240 or STATE.index != 1:
            raise ValueError("matrix cold-frame diagnostic budget/scope exceeded")
        STATE.mesh.observe_matrix(frame=frame, location=location, prediction=STATE.index,
                                  timestamp_us=0, face_id=0)
        return False
    except Exception as error:
        STATE.failures.append(f"{type(error).__name__}: {error}")
        return True


def on_reader_breakpoint(frame, location, internal_dict):
    try:
        STATE.reader_hits += 1
        if STATE.reader_hits > reader_trace.MAX_HITS or time.monotonic() - STATE.started > 240:
            raise ValueError("face reader diagnostic budget exceeded")
        row = reader_trace.observe(frame=frame, location=location, prediction=STATE.index)
        if row is not None:
            STATE.reader_events.append(row)
        return False
    except Exception as error:
        STATE.failures.append(f"{type(error).__name__}: {error}")
        return True


def on_point_breakpoint(frame, location, internal_dict):
    try:
        STATE.point_hits += 1
        if STATE.point_hits > point_trace.MAX_HITS or time.monotonic() - STATE.started > 240:
            raise ValueError("makeup point diagnostic budget exceeded")
        STATE.process = frame.GetThread().GetProcess()
        publication = point_trace.publication_scope(
            path=Path(STATE.config["report"]).parent / "records.jsonl", prediction=STATE.index)
        row = point_trace.observe(frame=frame, location=location,
            prediction=STATE.index, read=STATE.read, publication=publication)
        STATE.point_events.append(row)
        if STATE.config.get("rotate_makeup_points", False):
            STATE.rotation.loaded(row=row)
        return False
    except Exception as error:
        STATE.failures.append(f"{type(error).__name__}: {error}")
        return True


def on_point_store_breakpoint(frame, location, internal_dict):
    try:
        if time.monotonic() - STATE.started > 240:
            raise ValueError("makeup store diagnostic budget exceeded")
        STATE.rotation.observe(frame=frame, location=location, prediction=STATE.index, read=STATE.read)
        return False
    except Exception as error:
        STATE.failures.append(f"{type(error).__name__}: {error}")
        return True


def on_extra_breakpoint(frame, location, internal_dict):
    try:
        if time.monotonic() - STATE.started > 240:
            raise ValueError("Extra diagnostic budget exceeded")
        STATE.process = frame.GetThread().GetProcess()
        STATE.extra.observe(frame=frame, location=location, read=STATE.read)
        return False
    except Exception as error:
        STATE.failures.append(f"{type(error).__name__}: {error}")
        return True


def process_diagnostics(*, process, exited_state, no_stop_reason, target=None, observer=None):
    stops = []
    inventory = diagnostic_value(capture=lambda: breakpoint_inventory(target=target)) if target is not None else {}
    thread_count = 0 if process.GetState() == exited_state else min(process.GetNumThreads(), 64)
    for index in range(thread_count):
        thread = process.GetThreadAtIndex(index)
        if thread.GetStopReason() in (0, no_stop_reason):
            continue
        frames = []
        for depth in range(min(thread.GetNumFrames(), 8)):
            frame = thread.GetFrameAtIndex(depth)
            frames.append(dict(pc=frame.GetPC(), symbol=(frame.GetFunctionName() or "")[:512]))
        row = dict(thread=thread.GetThreadID(), reason=thread.GetStopReason(),
                   description=(thread.GetStopDescription(1024) or "")[:1024], frames=frames)
        if target is not None:
            row["detail"] = diagnostic_value(capture=lambda: stop_detail(thread=thread,
                frame=thread.GetFrameAtIndex(0) if frames else None, target=target,
                read=observer.read if observer is not None else None, description=row["description"],
                inventory=inventory, last_callback=observer.callback_tail[-1] if observer and observer.callback_tail else None))
        stops.append(row)
        if len(stops) == 8:
            break
    result = dict(pid=process.GetProcessID(), state=process.GetState(),
                  exit_status=process.GetExitStatus(), unexpected_stops=stops)
    if target is not None:
        result.update(breakpoints=inventory, stop_id=diagnostic_value(capture=process.GetStopID),
                      unexpected_stop_policy="capture-then-kill-never-resume")
    return result


def run(*, debugger, config_path):
    import lldb
    global STATE
    STATE = None
    config = json.loads(Path(config_path).read_text())
    report = dict(passed=False, target_memory_written=False, software_breakpoints_used=False,
                  target_functions_evaluated=False, failures=[])
    process, control_log = None, None
    try:
        if config.get("trace_mesh_matrices", False) and not config.get("trace_mesh_points", False):
            raise ValueError("matrix tracing requires mesh copy diagnostics")
        if config.get("trace_reshape_points") and (config["trace_reshape_points"] not in ("v5", "v6") or
                not config.get("cold_frame", False) or any(config.get(key, False) for key in
                ("trace_face_readers", "trace_makeup_points", "trace_mesh_points", "trace_extra_stages"))):
            raise ValueError("reshape point diagnostics require an exclusive cold hardware slot")
        if config.get("trace_mesh_points", False) and (not config.get("cold_frame", False) or any(
                config.get(key, False) for key in ("trace_face_readers", "trace_makeup_points",
                    "rotate_makeup_points", "trace_extra_stages", "trace_extra_model"))):
            raise ValueError("mesh diagnostics require an exclusive cold hardware slot")
        if config.get("trace_makeup_points", False) and config.get("trace_face_readers", False):
            raise ValueError("getter and XY diagnostics share one hardware slot")
        if config.get("trace_extra_stages", False) and not config.get("trace_makeup_points", False):
            raise ValueError("Extra diagnostics require the makeup XY observer")
        if config.get("rotate_makeup_points", False) and not config.get("trace_makeup_points", False):
            raise ValueError("point rotation requires the makeup XY observer")
        debugger.SetAsync(False)
        report["debugger_version"] = debugger.GetVersionString()
        control_log = Path(config["report"]).with_name("debugger-control.log")
        with control_log.open("x"):
            pass
        command(debugger=debugger, text="log enable -f " + json.dumps(str(control_log)) + " lldb break step")
        report["debugger_control_log"] = dict(path=str(control_log), categories=["break", "step"],
                                             maximum_bytes=CONTROL_LOG_LIMIT)
        target = debugger.CreateTarget(config["host"])
        if not target.IsValid() or not target.GetTriple().startswith("arm64"):
            raise ValueError("pinned arm64 live target required")
        command(debugger=debugger, text="settings set target.disable-aslr false")
        command(debugger=debugger, text="target modules add " + json.dumps(config["lens"]))
        STATE = Observer(target=target, config=config)
        for address in POINTS.values():
            before = target.GetNumBreakpoints()
            command(debugger=debugger, text=f"breakpoint set --hardware -s liblens.dylib -a {address:#x}")
            if target.GetNumBreakpoints() != before + 1:
                raise ValueError("live hardware breakpoint creation failed")
            point = target.GetBreakpointAtIndex(before)
            if not point.IsHardware():
                raise ValueError("live hardware breakpoint required")
            point.SetScriptCallbackFunction(__name__ + ".on_breakpoint")
        if config.get("trace_face_readers", False):
            reader_trace.install(debugger=debugger, target=target, core=config["core"],
                                 callback=__name__ + ".on_reader_breakpoint")
        if config.get("trace_mesh_points", False):
            from face_live_mesh_trace import MeshTrace
            command(debugger=debugger, text="target modules add " + json.dumps(config["core"]))
            if config.get("trace_mesh_matrices", False):
                from face_live_mesh_matrix_bridge import MeshMatrixTrace
                agfx = str(Path(config["core"]).with_name("libAGFX.dylib"))
                command(debugger=debugger, text="target modules add " + json.dumps(agfx))
                STATE.mesh = MeshMatrixTrace(target=target, core=config["core"], agfx=agfx,
                    callback=__name__ + ".on_mesh_breakpoint", matrix_callback=__name__ + ".on_matrix_breakpoint")
            else:
                STATE.mesh = MeshTrace(target=target, core=config["core"],
                                       callback=__name__ + ".on_mesh_breakpoint")
        if config.get("trace_reshape_points"):
            from face_live_reshape_trace import ReshapeTrace
            command(debugger=debugger, text="target modules add " + json.dumps(config["core"]))
            STATE.reshape = ReshapeTrace(target=target, core=config["core"], branch=config["trace_reshape_points"],
                                         callback=__name__ + ".on_reshape_breakpoint")
        if config.get("trace_makeup_points", False):
            point_trace.install(debugger=debugger, target=target, core=config["core"],
                                callback=__name__ + ".on_point_breakpoint")
            point = target.GetBreakpointAtIndex(target.GetNumBreakpoints() - 1)
            if config.get("rotate_makeup_points", False):
                STATE.rotation = PointRotation(target=target, load=point,
                    callback=__name__ + ".on_point_store_breakpoint")
                point = STATE.rotation
            if config.get("trace_extra_stages", False):
                STATE.extra = ExtraTrace(target=target,
                    point_breakpoint=point,
                    callback=__name__ + ".on_extra_breakpoint",
                    inner_model=config.get("trace_extra_model", False),
                    model_directory=Path(config["report"]).parent / "extra-model")
        info = lldb.SBLaunchInfo(config["arguments"])
        info.SetEnvironmentEntries([f"{key}={value}" for key,value in config["environment"].items()], False)
        info.SetLaunchFlags(info.GetLaunchFlags() & ~lldb.eLaunchFlagDisableASLR)
        for fd, name, reading in ((0, "stdin", True), (1, "stdout", False), (2, "stderr", False)):
            if not info.AddOpenFileAction(fd, config[name], reading, not reading):
                raise ValueError("live target stdio redirection failed")
        error = lldb.SBError()
        process = target.Launch(info, error)
        if error.Fail():
            raise RuntimeError(error.GetCString())
        STATE.process = process
        report.update(process_diagnostics(process=process, exited_state=lldb.eStateExited,
                                          no_stop_reason=lldb.eStopReasonNone, target=target, observer=STATE))
        if STATE.failures or process.GetState() != lldb.eStateExited or process.GetExitStatus() != 0:
            raise RuntimeError(STATE.failures[-1] if STATE.failures else "live host stopped or failed")
        if STATE.extra is not None and not STATE.extra.report()["complete"]:
            raise ValueError("incomplete Extra call/return diagnostics")
        if STATE.rotation is not None and not STATE.rotation.report()["complete"]:
            raise ValueError("incomplete makeup load/store rotation")
        if config.get("trace_mesh_points", False) and not STATE.mesh.report()["complete"]:
            raise ValueError("incomplete native mesh copy diagnostics")
        if STATE.reshape is not None and not STATE.reshape.report()["complete"]:
            raise ValueError("incomplete reshape point conversion diagnostics")
        report["passed"] = True
    except Exception as error:
        report["failures"].append(f"{type(error).__name__}: {error}")
    finally:
        if process and process.IsValid() and process.GetState() != lldb.eStateExited:
            process.Kill()
        if STATE:
            report.update(events=STATE.events, predictions=STATE.index + 1, callbacks=STATE.callbacks,
                          observer_failures=STATE.failures, callback_tail=STATE.callback_tail)
            if config.get("trace_face_readers", False):
                report["reader_trace"] = dict(hits=STATE.reader_hits, events=STATE.reader_events,
                    renderer_consumption=False, target_memory_written=False)
            if config.get("trace_makeup_points", False):
                report["point_trace"] = dict(hits=STATE.point_hits, events=STATE.point_events,
                    renderer_consumption=False, target_memory_written=False)
            if STATE.extra is not None:
                report["extra_trace"] = STATE.extra.report()
            if STATE.rotation is not None:
                report["point_rotation"] = STATE.rotation.report()
            if config.get("trace_mesh_points", False) and STATE.mesh is not None:
                report["mesh_trace"] = STATE.mesh.report()
            if STATE.reshape is not None:
                report["reshape_trace"] = STATE.reshape.report()
        if "debugger_control_log" in report:
            try:
                command(debugger=debugger, text="log disable lldb break step")
                if control_log.stat().st_size > CONTROL_LOG_LIMIT:
                    raise ValueError("debugger control log exceeded 4 MiB")
            except Exception as error:
                report["passed"] = False
                report["failures"].append(f"debugger log: {type(error).__name__}: {error}"[:512])
        Path(config["report"]).write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    print(json.dumps(dict(passed=report["passed"], failures=report["failures"])))


def __lldb_init_module(debugger, internal_dict):
    sys.path.insert(0, str(Path(__file__).resolve().parent))
