"""Local pinned-binary skeleton observations; imported by LLDB, never shipped."""
import hashlib
import json
from pathlib import Path
import struct

import lldb


LIBRARY_SHA256 = "0c39324edc0d8997d7c998c6a0867803b667fd40969e231a90ea502cc1e815b9"
STATE = {}


def read(*, process, address, size):
    if not 0 <= size <= 16 * 1024 * 1024:
        raise ValueError("bounded capture required")
    error = lldb.SBError()
    data = process.ReadMemory(address, size, error)
    if error.Fail() or len(data) != size:
        raise RuntimeError(str(error))
    return data


def register(*, frame, name):
    return frame.FindRegister(name).GetValueAsUnsigned()


def numbers(*, process, address, format):
    return struct.unpack(format, read(process=process, address=address, size=struct.calcsize(format)))


def write_integer(*, process, address, value):
    error = lldb.SBError()
    if process.WriteMemory(address, struct.pack("<i", value), error) != 4 or error.Fail():
        raise RuntimeError(str(error))


def capture_vector(*, process, address, stride):
    begin, end, capacity = numbers(process=process, address=address, format="<QQQ")
    if not begin <= end <= capacity or (end - begin) % stride or end - begin > 65536:
        raise ValueError("invalid native vector")
    return begin, (end - begin) // stride


def guarded(callback):
    def wrapped(frame, location, internal):
        try:
            callback(frame=frame)
            return False
        except Exception as error:
            STATE["errors"].append(repr(error))
            return True
    return wrapped


@guarded
def on_parameter(*, frame):
    key = register(frame=frame, name="w1")
    error = lldb.SBError()
    value = frame.FindRegister("s0").GetData().GetFloat(error, 0)
    row = {"key": key, "value": value}
    if key == 3 and STATE["config"].get("forceZero"):
        if not frame.FindRegister("s0").SetValueFromCString("0"):
            raise RuntimeError("cannot apply explicit research force-zero intervention")
        row["intervention"] = 0
    STATE["parameters"].append(row)


@guarded
def on_tracking(*, frame):
    process = frame.GetThread().GetProcess()
    handle = register(frame=frame, name="x0")
    pointer = register(frame=frame, name="x1")
    image_format, width, height, stride, orientation = [register(frame=frame, name="w" + str(n)) for n in range(2, 7)]
    if not 16 <= width <= 1280 or not 16 <= height <= 1280 or not width <= stride <= width * 4:
        raise ValueError("unexpected skeleton raster")
    index = len(STATE["calls"])
    data = read(process=process, address=pointer, size=stride * height)
    path = Path(STATE["config"]["output"]) / ("algorithm-%03d.bin" % index)
    path.write_bytes(data)
    row = {"index": index, "format": image_format, "width": width, "height": height,
           "stride": stride, "orientation": orientation, "algorithmSha256": hashlib.sha256(data).hexdigest(),
           "algorithmFile": path.name, "detectors": [], "passes": [], "public": [],
           "iterationBudget": numbers(process=process, address=handle + 0x118, format="<i")[0]}
    for offset in (0, 16):
        detector = numbers(process=process, address=handle + offset, format="<Q")[0]
        backend, input_width, input_height = numbers(process=process, address=detector + 0x278, format="<iii")
        if backend not in range(4) or not 32 <= input_width <= 512 or not 32 <= input_height <= 512:
            raise ValueError("pinned detector layout mismatch")
        row["detectors"].append({"address": detector, "backend": backend,
                                 "effectiveBackend": 1 if STATE["config"].get("cpu") else backend,
                                 "size": [input_width, input_height]})
        if STATE["config"].get("cpu"):
            write_integer(process=process, address=detector + 0x278, value=1)
    STATE["calls"].append(row)
    STATE["pending"] = {"handle": handle, "public": register(frame=frame, name="x7"), "row": row}
    target = process.GetTarget()
    address = register(frame=frame, name="lr")
    if address not in STATE["returnBreakpoints"]:
        breakpoint = target.BreakpointCreateByAddress(address)
        breakpoint.SetScriptCallbackFunction(__name__ + ".on_return")
        STATE["returnBreakpoints"].append(address)


@guarded
def on_detector(*, frame):
    pending = STATE.get("pending")
    if not pending:
        return
    pointer = register(frame=frame, name="x0")
    detectors = pending["row"]["detectors"]
    part = next(("coarse" if i == 0 else "refine" for i, d in enumerate(detectors) if d["address"] == pointer), "unknown")
    row = {"network": part, "symbol": frame.GetFunctionName(), "people": []}
    pending["row"]["passes"].append(row)
    STATE["detectorPending"] = {"row": row, "output": register(frame=frame, name="x3")}
    address = register(frame=frame, name="lr")
    if address not in STATE["detectorReturnBreakpoints"]:
        breakpoint = frame.GetThread().GetProcess().GetTarget().BreakpointCreateByAddress(address)
        breakpoint.SetScriptCallbackFunction(__name__ + ".on_detector_return")
        STATE["detectorReturnBreakpoints"].append(address)


@guarded
def on_detector_return(*, frame):
    pending = STATE.pop("detectorPending", None)
    if pending is None:
        return
    process = frame.GetThread().GetProcess()
    begin, count = capture_vector(process=process, address=pending["output"], stride=24)
    for index in range(count):
        points, joints = capture_vector(process=process, address=begin + index * 24, stride=16)
        data = read(process=process, address=points, size=joints * 16)
        pending["row"]["people"].append([list(point) for point in struct.iter_unpack("<iifi", data)])


def capture_tensors(*, frame, detector, kind):
    pending = STATE.get("detectorPending")
    if pending is None:
        return
    process = frame.GetThread().GetProcess()
    address = detector + (0x248 if kind == "input" else 0x260)
    begin, count = capture_vector(process=process, address=address, stride=64)
    if not 1 <= count <= 4:
        raise ValueError("unexpected body tensor count")
    tensors = []
    call_index = len(STATE["calls"]) - 1
    pass_index = len(STATE["calls"][-1]["passes"]) - 1
    for index in range(count):
        header = read(process=process, address=begin + index * 64, size=64)
        pointer, layout, storage, batch, height, width, channels, fraction = struct.unpack("<Q7i", header[:36])
        if storage not in (2, 4) or batch != 1 or not all(0 < n <= 512 for n in (height, width, channels)):
            raise ValueError("unexpected bounded body tensor layout: " + header.hex())
        data = read(process=process, address=pointer, size=batch * height * width * channels * (2 if storage == 2 else 4))
        name = "tensor-%03d-%02d-%s-%d.bin" % (call_index, pass_index, kind, index)
        Path(STATE["config"]["output"], name).write_bytes(data)
        tensors.append({"file": name, "layout": layout, "storage": storage,
                        "shape": [batch, height, width, channels], "fraction": fraction,
                        "sha256": hashlib.sha256(data).hexdigest()})
    pending["row"][kind + "Tensors"] = tensors


@guarded
def on_tensor_input(*, frame):
    detector = register(frame=frame, name="x19")
    capture_tensors(frame=frame, detector=detector, kind="input")
    pending = STATE.get("detectorPending")
    if not pending or not STATE["config"].get("coremlCpuNormalization"):
        return
    tensor = pending["row"]["inputTensors"][0]
    if tensor["storage"] != 4:
        return
    path = Path(STATE["config"]["output"], tensor["file"])
    values = [value[0] for value in struct.iter_unpack("<f", path.read_bytes())]
    normalized = [(round((value + 2) * 63.75) - 128) / 64 for value in values]
    data = struct.pack("<%df" % len(normalized), *normalized)
    process = frame.GetThread().GetProcess()
    begin = numbers(process=process, address=detector + 0x248, format="<Q")[0]
    pointer = numbers(process=process, address=begin, format="<Q")[0]
    error = lldb.SBError()
    if process.WriteMemory(pointer, data, error) != len(data) or error.Fail():
        raise RuntimeError("could not apply explicit CoreML input intervention")
    pending["row"]["originalInputTensors"] = pending["row"]["inputTensors"]
    path.rename(path.with_name(path.name.replace("input", "original-input")))
    pending["row"]["originalInputTensors"][0]["file"] = path.name.replace("input", "original-input")
    capture_tensors(frame=frame, detector=detector, kind="input")


@guarded
def on_tensor_output(*, frame):
    capture_tensors(frame=frame, detector=register(frame=frame, name="x0"), kind="output")


@guarded
def on_return(*, frame):
    pending = STATE.pop("pending", None)
    if pending is None:
        return
    process = frame.GetThread().GetProcess()
    row = pending["row"]
    row["returnCode"] = register(frame=frame, name="w0")
    begin, count = capture_vector(process=process, address=pending["public"], stride=24)
    for index in range(count):
        points, joints = capture_vector(process=process, address=begin + index * 24, stride=16)
        data = read(process=process, address=points, size=joints * 16)
        row["public"].append([list(point) for point in struct.iter_unpack("<fffi", data)])
    row["trackerSha256"] = hashlib.sha256(read(process=process, address=pending["handle"], size=0x1e8)).hexdigest()


def run(*, debugger, configuration):
    global STATE
    config = json.loads(Path(configuration).read_text())
    if hashlib.sha256(Path(config["library"]).read_bytes()).hexdigest() != LIBRARY_SHA256:
        raise ValueError("probe only supports the pinned original library")
    STATE = {"config": config, "parameters": [], "calls": [], "errors": [],
             "returnBreakpoints": [], "detectorReturnBreakpoints": []}
    debugger.SetAsync(False)
    target = debugger.CreateTarget(config["host"])
    if not target.GetTriple().startswith("arm64-"):
        raise ValueError("probe requires the pinned arm64 process layout")
    for symbol, callback in (("SK_SetParamF", "on_parameter"), ("SK_DoSkeletonTracking", "on_tracking")):
        target.BreakpointCreateByName(symbol).SetScriptCallbackFunction(__name__ + "." + callback)
    for expression in (r"KeypointDetector::detectSkeletonOpt\(", r"KeypointDetector::detectSkeleton\("):
        target.BreakpointCreateByRegex(expression).SetScriptCallbackFunction(__name__ + ".on_detector")
    target.BreakpointCreateByRegex(r"KeypointDetector::getBytennresult\(").SetScriptCallbackFunction(__name__ + ".on_tensor_output")
    module = target.AddModule(config["library"], None, None)
    for address in (0x12EC5FC, 0x12F09D0):
        target.BreakpointCreateBySBAddress(module.ResolveFileAddress(address)).SetScriptCallbackFunction(__name__ + ".on_tensor_input")
    launch = lldb.SBLaunchInfo(config["arguments"])
    launch.SetEnvironmentEntries(config["environment"], False)
    launch.SetLaunchFlags(launch.GetLaunchFlags() & ~lldb.eLaunchFlagDisableASLR)
    for descriptor, name in ((0, "stdin"), (1, "stdout"), (2, "stderr")):
        launch.AddOpenFileAction(descriptor, config[name], descriptor == 0, descriptor != 0)
    error = lldb.SBError()
    process = target.Launch(launch, error)
    STATE["launchError"] = str(error)
    STATE["exitCode"] = process.GetExitStatus()
    STATE["processState"] = process.GetState()
    if process.GetState() != lldb.eStateExited:
        STATE["stops"] = [thread.GetStopDescription(1000) for thread in process]
        process.Kill()
    Path(config["output"], "trace.json").write_text(json.dumps(STATE, indent=2))
    print(json.dumps({"calls": len(STATE["calls"]), "errors": STATE["errors"], "exitCode": STATE["exitCode"]}))
