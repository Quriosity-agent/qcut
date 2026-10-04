"""Live read-only caller/order observer; actual entry registers, never cached crop.

Three hardware breakpoints only. The native post-predict callback performs the
pixel/geometry exchange and owned renderer handoff while the target runs.
"""
from __future__ import annotations

import json
import hashlib
import math
from pathlib import Path
import struct
import sys
import time

from face_preprocess_lldb import CALLERS, command, register, file_address
from face_preprocess_memory import unpack_detection_call
from face_live_worker_protocol import exchange

STATE = None
POINTS = {"begin": 0x2c4dac, "call": 0x2ca3bc, "infer": 0x36b43c}


class Observer:
    def __init__(self, *, target, config):
        self.target, self.config = target, config
        self.index, self.tid, self.callbacks = -1, None, 0
        self.events, self.failures = [], []
        self.started = time.monotonic()
        self.process = None
        self.caller = None

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


def on_breakpoint(frame, location, internal_dict):
    try:
        STATE.process = frame.GetThread().GetProcess()
        STATE.handle(frame=frame, location=location)
        return False
    except Exception as error:
        STATE.failures.append(f"{type(error).__name__}: {error}")
        return True


def process_diagnostics(*, process, exited_state, no_stop_reason):
    stops = []
    thread_count = 0 if process.GetState() == exited_state else min(process.GetNumThreads(), 64)
    for index in range(thread_count):
        thread = process.GetThreadAtIndex(index)
        if thread.GetStopReason() in (0, no_stop_reason):
            continue
        frames = []
        for depth in range(min(thread.GetNumFrames(), 8)):
            frame = thread.GetFrameAtIndex(depth)
            frames.append(dict(pc=frame.GetPC(), symbol=(frame.GetFunctionName() or "")[:512]))
        stops.append(dict(thread=thread.GetThreadID(), reason=thread.GetStopReason(),
                          description=thread.GetStopDescription(1024), frames=frames))
        if len(stops) == 8:
            break
    return dict(pid=process.GetProcessID(), state=process.GetState(),
                exit_status=process.GetExitStatus(), unexpected_stops=stops)


def run(*, debugger, config_path):
    import lldb
    global STATE
    config = json.loads(Path(config_path).read_text())
    report = dict(passed=False, target_memory_written=False, software_breakpoints_used=False,
                  target_functions_evaluated=False, failures=[])
    process = None
    try:
        debugger.SetAsync(False)
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
                                          no_stop_reason=lldb.eStopReasonNone))
        if STATE.failures or process.GetState() != lldb.eStateExited or process.GetExitStatus() != 0:
            raise RuntimeError(STATE.failures[-1] if STATE.failures else "live host stopped or failed")
        report["passed"] = True
    except Exception as error:
        report["failures"].append(f"{type(error).__name__}: {error}")
    finally:
        if process and process.IsValid() and process.GetState() != lldb.eStateExited:
            process.Kill()
        if STATE:
            report.update(events=STATE.events, predictions=STATE.index + 1, callbacks=STATE.callbacks,
                          observer_failures=STATE.failures)
        Path(config["report"]).write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    print(json.dumps(dict(passed=report["passed"], failures=report["failures"])))


def __lldb_init_module(debugger, internal_dict):
    sys.path.insert(0, str(Path(__file__).resolve().parent))
