"""Read-only hardware-breakpoint observer for the pinned arm64 detection crop."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import struct
import sys
import time

LENS_UUID = "248872F2-7736-32A9-A48B-DC5DFEE20C99"
POINTS = {"prediction": 0x2c4dac, "entry": 0x2ca3bc, "crop": 0x2ca460,
          "resized": 0x2ca5bc, "predictor": 0x36b43c}
CALLERS = {0x2d5f30, 0x2d5fd4}
TRACE_LIMIT = 128 * 1024**2
ACTIVE_LIMIT = 4
STATE = None


def command(*, debugger, text):
    import lldb
    result = lldb.SBCommandReturnObject()
    debugger.GetCommandInterpreter().HandleCommand(text, result)
    if not result.Succeeded():
        raise RuntimeError(result.GetError() or "LLDB command failed")
    return result.GetOutput()


def register(*, frame, name):
    import lldb
    value, error = frame.FindRegister(name), lldb.SBError()
    if not value.IsValid():
        raise ValueError(f"missing register: {name}")
    number = (value.GetData().GetUnsignedInt32(error, 0) if name == "s0"
              else value.GetValueAsUnsigned(error))
    if error.Fail():
        raise ValueError(f"unreadable register: {name}")
    return number


def file_address(*, address):
    if not address.IsValid() or address.GetModule().GetUUIDString() != LENS_UUID:
        raise ValueError("address is not in the pinned lens image")
    return address.GetFileAddress()


class Observer:
    def __init__(self, *, debugger, target, out):
        self.debugger, self.target, self.out = debugger, target, out
        self.breakpoints = {}
        self.prediction, self.thread, self.owner = -1, None, None
        self.pending, self.events, self.predictions, self.failures = None, [], [], []
        self.callbacks, self.trace_bytes, self.maximum_active = 0, 0, 0
        self.started = time.monotonic()
        self.process = None

    def read(self, *, address, size):
        import lldb
        error = lldb.SBError()
        value = self.process.ReadMemory(address, size, error)
        if error.Fail() or len(value) != size:
            raise ValueError("unreadable stopped-process memory")
        return value

    def scalar(self, *, address, kind):
        from face_preprocess_memory import checked_read
        return struct.unpack(kind, checked_read(read=self.read, address=address,
                                               size=struct.calcsize(kind)))[0]

    def install(self):
        for name, offset in POINTS.items():
            before = self.target.GetNumBreakpoints()
            command(debugger=self.debugger,
                    text=f"breakpoint set --hardware --disable -s liblens.dylib -a {offset:#x}")
            if self.target.GetNumBreakpoints() != before + 1:
                raise ValueError("hardware breakpoint creation failed")
            point = self.target.GetBreakpointAtIndex(before)
            if not point.IsHardware():
                raise ValueError("software breakpoint refused")
            point.SetScriptCallbackFunction(__name__ + ".on_breakpoint")
            self.breakpoints[name] = point
        self.arm(name="prediction", enabled=True)
        self.arm(name="entry", enabled=True)

    def arm(self, *, name, enabled):
        self.breakpoints[name].SetEnabled(enabled)
        active = sum(point.IsEnabled() for point in self.breakpoints.values())
        self.maximum_active = max(self.maximum_active, active)
        if active > ACTIVE_LIMIT:
            raise ValueError("hardware breakpoint budget exceeded")

    def blob(self, *, name, address):
        from face_preprocess_memory import unpack_mat
        metadata, pixels = unpack_mat(read=self.read, address=address)
        return self.save_blob(name=name, metadata=metadata, pixels=pixels)

    def save_blob(self, *, name, metadata, pixels):
        self.trace_bytes += len(pixels)
        if self.trace_bytes > TRACE_LIMIT:
            raise ValueError("trace byte budget exceeded")
        path = self.out / f"prediction-{self.prediction:02d}-{name}.bgr"
        with path.open("xb") as stream:
            stream.write(pixels)
        return {**metadata, "file": path.name, "sha256": hashlib.sha256(pixels).hexdigest()}

    def handle(self, *, frame, location):
        from face_preprocess_memory import unpack_detection_call, unpack_rect
        self.callbacks += 1
        if self.callbacks > 128 or time.monotonic() - self.started > 300:
            raise ValueError("bounded callback/watchdog limit exceeded")
        point = location.GetBreakpoint()
        if not point.IsHardware() or not location.IsResolved():
            raise ValueError("unresolved or nonhardware breakpoint hit")
        offset = file_address(address=frame.GetPCAddress())
        name = next((key for key, value in POINTS.items() if value == offset), None)
        if name is None or self.breakpoints[name].GetID() != point.GetID():
            raise ValueError("unexpected breakpoint location")
        tid = frame.GetThread().GetThreadID()
        if self.thread is not None and self.thread != tid:
            raise ValueError("cross-thread capture refused")
        self.thread = tid
        module = frame.GetPCAddress().GetModule()
        slide = frame.GetPC() - offset
        if name == "prediction":
            if self.pending is not None or self.prediction >= 63:
                raise ValueError("unfinished or excessive prediction")
            self.prediction += 1
            self.owner = register(frame=frame, name="x0")
            self.predictions.append(dict(index=self.prediction, owner=self.owner, thread=tid,
                                         slide=slide, uuid=module.GetUUIDString(),
                                         request=[register(frame=frame, name=f"w{i}") for i in range(2, 7)]))
            return
        if self.prediction < 0:
            raise ValueError("preprocessing outside a prediction")
        if name == "entry":
            if register(frame=frame, name="w3") != 160 or register(frame=frame, name="w4") != 160:
                return
            if self.pending is not None:
                raise ValueError("reentrant detection crop refused")
            registers = {key: register(frame=frame, name=key)
                         for key in ("x0", "x1", "x2", "x29", "lr", "w3", "w4", "w5", "w6", "w7")}
            registers["s0_bits"] = register(frame=frame, name="s0")
            # LLDB's platform unwinder handles return-address authentication; never guess a PAC mask.
            caller = file_address(address=frame.GetThread().GetFrameAtIndex(1).GetPCAddress())
            if caller not in CALLERS:
                raise ValueError("unverified detection caller")
            call = unpack_detection_call(read=self.read, registers=registers)
            call["rect_address"] = registers["x2"]
            source = self.save_blob(name="source", metadata=call["source_mat"],
                                    pixels=call.pop("source_bytes"))
            self.pending = dict(prediction=self.prediction, owner=self.owner, thread=tid,
                                caller=caller, raw_lr=registers["lr"], slide=slide, call=call,
                                source=source)
            self.arm(name="crop", enabled=True)
            self.arm(name="resized", enabled=True)
            return
        if self.pending is None or self.pending["prediction"] != self.prediction:
            raise ValueError("unassociated intermediate crop")
        call = self.pending["call"]
        if name == "crop":
            if "crop" in self.pending:
                raise ValueError("duplicate crop event")
            fp = register(frame=frame, name="x29")
            if self.scalar(address=fp - 0x30, kind="<Q") != call["rect_address"]:
                raise ValueError("crop Rect ownership changed")
            self.pending["post_crop_rect"] = unpack_rect(read=self.read, address=call["rect_address"])
            self.pending["crop"] = self.blob(name="crop", address=fp - 0xb0)
            self.arm(name="crop", enabled=False)
            return
        if name == "resized":
            address = register(frame=frame, name="x0")
            if "crop" not in self.pending or address != call["preprocessor"] + 0x80:
                raise ValueError("resize without its crop/output Mat")
            self.pending["resized"] = self.blob(name="resized", address=address)
            if [self.pending["resized"][key] for key in ("cols", "rows")] != [160, 160]:
                raise ValueError("unexpected actual resize dimensions")
            self.arm(name="resized", enabled=False)
            self.arm(name="predictor", enabled=True)
            return
        if name == "predictor":
            predictor, address = [register(frame=frame, name=key) for key in ("x0", "x1")]
            dimensions = [self.scalar(address=predictor + offset, kind="<i") for offset in (0x3c, 0x40)]
            if dimensions != [160, 160] or "resized" not in self.pending:
                raise ValueError("wrong predictor associated with crop")
            prepared = self.blob(name="prepared", address=address)
            resized = self.pending["resized"]
            if (prepared["sha256"] != resized["sha256"] or
                    [prepared[key] for key in ("cols", "rows")] != [160, 160]):
                raise ValueError("prepared predictor Mat differs from returned resize")
            provider = self.scalar(address=predictor + 0x110, kind="<Q")
            network = self.scalar(address=provider + 0x48, kind="<Q")
            self.pending.update(prepared=prepared, predictor=predictor, provider=provider,
                                network=network, mode=register(frame=frame, name="w2"),
                                prepared_same_header=address == resized["address"],
                                prepared_same_storage=prepared["data"] == resized["data"])
            self.events.append(self.pending)
            self.pending = None
            self.arm(name="predictor", enabled=False)


def on_breakpoint(frame, location, internal_dict):
    try:
        STATE.process = frame.GetThread().GetProcess()
        STATE.handle(frame=frame, location=location)
        return False
    except Exception as error:
        STATE.failures.append(f"{type(error).__name__}: {error}")
        return True


def run(*, debugger, config_path):
    import lldb
    global STATE
    STATE = None
    config = json.loads(Path(config_path).read_text())
    out = Path(config["trace"])
    report = dict(passed=False, software_breakpoints_used=False, target_memory_written=False,
                  target_functions_evaluated=False, failures=[])
    process = None
    try:
        debugger.SetAsync(False)
        target = debugger.CreateTarget(config["host"])
        if not target.IsValid() or not target.GetTriple().startswith("arm64"):
            raise ValueError("pinned arm64 host target required")
        command(debugger=debugger, text="settings set target.disable-aslr false")
        command(debugger=debugger, text="target modules add " + json.dumps(config["lens"]))
        STATE = Observer(debugger=debugger, target=target, out=out)
        STATE.install()
        info = lldb.SBLaunchInfo(config["arguments"])
        info.SetEnvironmentEntries([f"{key}={value}" for key, value in config["environment"].items()], False)
        info.SetLaunchFlags(info.GetLaunchFlags() & ~lldb.eLaunchFlagDisableASLR)
        for fd, path, reading in ((0, config["stdin"], True), (1, config["stdout"], False),
                                  (2, config["stderr"], False)):
            if not info.AddOpenFileAction(fd, path, reading, not reading):
                raise ValueError("stdio launch redirection refused")
        error = lldb.SBError()
        process = target.Launch(info, error)
        if error.Fail():
            raise RuntimeError(error.GetCString() or "LLDB launch failed")
        STATE.process = process
        report.update(pid=process.GetProcessID(), state=process.GetState(), exit_status=process.GetExitStatus())
        if process.GetState() != lldb.eStateExited:
            report["unexpected_stops"] = [dict(thread=thread.GetThreadID(), reason=thread.GetStopReason(),
                                              description=thread.GetStopDescription(1024),
                                              pc=thread.GetFrameAtIndex(0).GetPC(),
                                              symbol=thread.GetFrameAtIndex(0).GetFunctionName())
                                          for thread in process if thread.GetStopReason() != lldb.eStopReasonNone]
        if STATE.failures:
            raise RuntimeError(STATE.failures[-1])
        if process.GetState() != lldb.eStateExited or process.GetExitStatus() != 0:
            raise RuntimeError("host stopped unexpectedly or exited unsuccessfully")
        if STATE.pending is not None or len(STATE.predictions) != 26 or len(STATE.events) != 2:
            raise ValueError("locked 26-prediction/two-crop profile incomplete")
        report["passed"] = True
    except Exception as error:
        report["failures"].append(f"{type(error).__name__}: {error}")
    finally:
        if process is not None and process.IsValid() and process.GetState() != lldb.eStateExited:
            process.Kill()
        if STATE is not None:
            report.update(predictions=STATE.predictions, events=STATE.events, callbacks=STATE.callbacks,
                          trace_bytes=STATE.trace_bytes, maximum_active_breakpoints=STATE.maximum_active,
                          observer_failures=STATE.failures, pending=STATE.pending)
        (out / "trace.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    print(json.dumps(dict(passed=report["passed"], failures=report["failures"])))


def __lldb_init_module(debugger, internal_dict):
    sys.path.insert(0, str(Path(__file__).resolve().parent))
