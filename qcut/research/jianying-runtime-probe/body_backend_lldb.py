"""Pinned local observations of asynchronous body backend selection."""
import hashlib
import json
from pathlib import Path
import time

import lldb

import body_profile_lldb as profile


STATE = {}
ADDRESSES = {
    "listener": 0x12E6638,
    "poll": 0x12E94DC,
    "dynamic": 0x12EC73C,
    "cpu": 0x12EC404,
    "coreml": 0x12F0668,
    "load": 0x12E7398,
    "reset": 0x12FA830,
}


def integer(*, process, address, format="<Q"):
    return profile.numbers(process=process, address=address, format=format)[0]


def detector_state(*, frame, detector):
    process = frame.GetThread().GetProcess()
    listener = integer(process=process, address=detector + 0x30)
    return {
        "detector": detector,
        "cpuEngine": integer(process=process, address=detector + 0x10),
        "coremlEngine": integer(process=process, address=detector + 0x20),
        "listener": listener,
        "listenerReady": integer(process=process, address=listener + 8, format="<B") if listener else None,
        "latchedReady": integer(process=process, address=detector + 0x58, format="<B"),
        "configuredBackend": integer(process=process, address=detector + 0x278, format="<i"),
    }


def event(*, frame, kind, **data):
    STATE["events"].append({
        "event": kind, "elapsedNs": time.monotonic_ns() - STATE["startedNs"],
        "thread": frame.GetThread().GetThreadID(), "call": len(profile.STATE["calls"]) - 1,
        **data,
    })


def callback(function):
    def wrapped(frame, location, internal):
        try:
            function(frame=frame)
            return False
        except Exception as error:
            profile.STATE["errors"].append(repr(error))
            return True
    return wrapped


def wait_for_loaders(*, frame, reason):
    if len(STATE["readyListeners"]) >= 2:
        return
    thread = frame.GetThread()
    if not thread.Suspend():
        raise RuntimeError("cannot suspend labelled detector wait")
    STATE["waitingDetector"] = thread.GetThreadID()
    event(frame=frame, kind="detector-waiting", reason=reason, expectedReadyListeners=2)


def return_hook(*, frame, kind, **data):
    thread = frame.GetThread().GetThreadID()
    address = profile.register(frame=frame, name="lr")
    STATE["pending"].setdefault((thread, address), []).append({"kind": kind, **data})
    if address not in STATE["returns"]:
        point = frame.GetThread().GetProcess().GetTarget().BreakpointCreateByAddress(address)
        point.SetScriptCallbackFunction(__name__ + ".on_function_return")
        STATE["returns"].add(address)


@callback
def on_function_return(*, frame):
    key = (frame.GetThread().GetThreadID(), frame.GetPC())
    stack = STATE["pending"].get(key)
    if not stack:
        return
    pending = stack.pop()
    kind = pending.pop("kind")
    if kind == "coreml" and STATE["config"].get("failFirstCoremlReturn") and not STATE.get("predictionFailureInjected"):
        if not frame.FindRegister("w0").SetValueFromCString("4294967291"):
            raise RuntimeError("cannot inject labelled prediction error")
        STATE["predictionFailureInjected"] = True
        pending["interventionReturnCode"] = -5
    detector = pending.get("detector")
    if detector:
        pending["state"] = detector_state(frame=frame, detector=detector)
    if "listener" in pending:
        pending["listenerReady"] = integer(process=frame.GetThread().GetProcess(), address=pending["listener"] + 8, format="<B")
    event(frame=frame, kind=kind + "-return", returnCode=frame.FindRegister("w0").GetValueAsSigned(), **pending)
    if kind == "listener" and pending["listenerReady"] == 1:
        STATE["readyListeners"].add(pending["listener"])
        if STATE.get("waitingDetector") and len(STATE["readyListeners"]) >= 2:
            thread_id = STATE.pop("waitingDetector")
            if not frame.GetThread().GetProcess().GetThreadByID(thread_id).Resume():
                raise RuntimeError("cannot resume labelled detector wait")
            event(frame=frame, kind="detector-released", releasedThread=thread_id, readyListeners=sorted(STATE["readyListeners"]))


@callback
def on_load(*, frame):
    detector = profile.register(frame=frame, name="x0")
    stack = [{"function": item.GetFunctionName(), "fileAddress": item.GetPCAddress().GetFileAddress()}
             for item in frame.GetThread()][:24]
    event(frame=frame, kind="load", detector=detector, stack=stack)
    return_hook(frame=frame, kind="load", detector=detector)


@callback
def on_listener(*, frame):
    listener = profile.register(frame=frame, name="x0")
    code = frame.FindRegister("w1").GetValueAsSigned()
    row = {"listener": listener, "code": code}
    if code == 0 and STATE["config"].get("failSuccessEvents"):
        if not frame.FindRegister("w1").SetValueFromCString("4294967295"):
            raise RuntimeError("cannot inject labelled listener failure")
        row["interventionCode"] = -1
    event(frame=frame, kind="listener-event", **row)
    return_hook(frame=frame, kind="listener", listener=listener)
    until = STATE["config"].get("holdSuccessUntilCall", 0)
    if code == 0 and len(profile.STATE["calls"]) < until:
        thread = frame.GetThread()
        if not thread.Suspend():
            raise RuntimeError("cannot suspend labelled readiness callback")
        STATE["heldThreads"].append(thread.GetThreadID())
        event(frame=frame, kind="listener-held", untilCall=until, listener=listener)


@callback
def on_poll(*, frame):
    detector = profile.register(frame=frame, name="x0")
    event(frame=frame, kind="poll", state=detector_state(frame=frame, detector=detector))
    return_hook(frame=frame, kind="poll", detector=detector)
    if STATE["config"].get("waitBeforeFirstPoll") and not STATE.get("waitScheduled"):
        STATE["waitScheduled"] = True
        wait_for_loaders(frame=frame, reason="before-first-ready-read")


@callback
def on_latch(*, frame):
    event(frame=frame, kind="ready-latch", detector=profile.register(frame=frame, name="x19"),
          observedReady=profile.register(frame=frame, name="w8"))


@callback
def on_inference(*, frame):
    detector = profile.register(frame=frame, name="x0")
    name = frame.GetFunctionName()
    kind = "coreml" if "runBytennCoreMLNet" in name else "cpu" if "runBytennCPUNet" in name else "dynamic"
    event(frame=frame, kind=kind, state=detector_state(frame=frame, detector=detector))
    if kind != "dynamic":
        return_hook(frame=frame, kind=kind, detector=detector)
    if kind == "cpu" and STATE["config"].get("waitAfterFirstPoll") and not STATE.get("waitScheduled"):
        STATE["waitScheduled"] = True
        wait_for_loaders(frame=frame, reason="after-first-coarse-ready-read")


@callback
def on_reset(*, frame):
    event(frame=frame, kind="reset", tracker=profile.register(frame=frame, name="x0"))


def on_tracking(frame, location, internal):
    try:
        index = len(profile.STATE["calls"])
        process = frame.GetThread().GetProcess()
        if index >= STATE["config"].get("holdSuccessUntilCall", 0):
            for thread_id in STATE["heldThreads"]:
                if not process.GetThreadByID(thread_id).Resume():
                    raise RuntimeError("cannot resume labelled readiness callback")
                event(frame=frame, kind="listener-released", releasedThread=thread_id, nextCall=index)
            STATE["heldThreads"].clear()
        reset_calls = STATE["config"].get("resetBeforeCalls", [])
        if index in reset_calls:
            handle = profile.register(frame=frame, name="x0")
            address = STATE["module"].ResolveFileAddress(0x1303264).GetLoadAddress(process.GetTarget())
            options = lldb.SBExpressionOptions()
            options.SetIgnoreBreakpoints(True)
            options.SetTimeoutInMicroSeconds(5_000_000)
            result = frame.EvaluateExpression(
                "((int(*)(void*,int,float))%d)((void*)%d,1,0.0f)" % (address, handle), options)
            if result.GetError().Fail() or result.GetValueAsSigned() != 0:
                raise RuntimeError("explicit native reset failed: " + str(result.GetError()))
            event(frame=frame, kind="explicit-SK-reset", nextCall=index, tracker=handle)
        if profile.on_tracking(frame, location, internal):
            return True
        row = profile.STATE["calls"][-1]
        event(frame=frame, kind="tracking", index=index, iterationBudget=row["iterationBudget"],
              detectors=[detector_state(frame=frame, detector=d["address"]) for d in row["detectors"]])
        return False
    except Exception as error:
        profile.STATE["errors"].append(repr(error))
        return True


def run(*, debugger, configuration):
    global STATE
    config = json.loads(Path(configuration).read_text())
    if hashlib.sha256(Path(config["library"]).read_bytes()).hexdigest() != profile.LIBRARY_SHA256:
        raise ValueError("unsupported binary; address hooks require pinned SHA-256")
    profile.STATE = {"config": config, "parameters": [], "calls": [], "errors": [],
                     "returnBreakpoints": [], "detectorReturnBreakpoints": []}
    STATE = {"config": config, "events": [], "startedNs": time.monotonic_ns(),
             "pending": {}, "returns": set(), "heldThreads": [], "readyListeners": set()}
    debugger.SetAsync(False)
    target = debugger.CreateTarget(config["host"])
    if not target.GetTriple().startswith("arm64-"):
        raise ValueError("arm64 host required")
    module = target.AddModule(config["library"], None, None)
    STATE["module"] = module
    for name, callback_name in (("SK_DoSkeletonTracking", "on_tracking"),):
        target.BreakpointCreateByName(name).SetScriptCallbackFunction(__name__ + "." + callback_name)
    for symbol, callback_name in (("SK_SetParamF", "on_parameter"),):
        target.BreakpointCreateByName(symbol).SetScriptCallbackFunction("body_profile_lldb." + callback_name)
    for expression, callback_name in ((r"KeypointDetector::detectSkeletonOpt\(", "on_detector"),
                                      (r"KeypointDetector::detectSkeleton\(", "on_detector"),
                                      (r"KeypointDetector::getBytennresult\(", "on_tensor_output")):
        target.BreakpointCreateByRegex(expression).SetScriptCallbackFunction("body_profile_lldb." + callback_name)
    for address in (0x12EC5FC, 0x12F09D0):
        target.BreakpointCreateBySBAddress(module.ResolveFileAddress(address)).SetScriptCallbackFunction("body_profile_lldb.on_tensor_input")
    target.BreakpointCreateBySBAddress(module.ResolveFileAddress(0x12E9514)).SetScriptCallbackFunction(__name__ + ".on_latch")
    for kind, address in ADDRESSES.items():
        name = "on_inference" if kind in ("dynamic", "cpu", "coreml") else "on_" + kind
        target.BreakpointCreateBySBAddress(module.ResolveFileAddress(address)).SetScriptCallbackFunction(__name__ + "." + name)
    launch = lldb.SBLaunchInfo(config["arguments"])
    launch.SetEnvironmentEntries(config["environment"], False)
    launch.SetLaunchFlags(launch.GetLaunchFlags() & ~lldb.eLaunchFlagDisableASLR)
    for descriptor, name in ((0, "stdin"), (1, "stdout"), (2, "stderr")):
        launch.AddOpenFileAction(descriptor, config[name], descriptor == 0, descriptor != 0)
    error = lldb.SBError()
    process = target.Launch(launch, error)
    profile.STATE.update({"launchError": str(error), "exitCode": process.GetExitStatus(), "processState": process.GetState()})
    if process.GetState() != lldb.eStateExited:
        profile.STATE["stops"] = [thread.GetStopDescription(1000) for thread in process]
        process.Kill()
    Path(config["output"], "trace.json").write_text(json.dumps(profile.STATE, indent=2))
    Path(config["output"], "backend-events.json").write_text(json.dumps(STATE["events"], indent=2))
    print(json.dumps({"calls": len(profile.STATE["calls"]), "events": len(STATE["events"]),
                      "errors": profile.STATE["errors"], "exitCode": profile.STATE["exitCode"]}))
