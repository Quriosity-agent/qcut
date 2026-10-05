"""Read-only type-4 getter stacks; observations are never consumption receipts."""
from __future__ import annotations

import json

from face_preprocess_lldb import command, register

CORE_UUID = "D6342ECD-5432-33F0-A2AD-0C28F5699994"
RAW_GETTER = 0xc15cd4
MAX_HITS = 512
MAX_FRAMES = 24


def observe(*, frame, location, prediction):
    address = frame.GetPCAddress()
    if (not location.GetBreakpoint().IsHardware() or not address.IsValid() or
            address.GetModule().GetUUIDString() != CORE_UUID or address.GetFileAddress() != RAW_GETTER):
        raise ValueError("unverified face reader breakpoint")
    if register(frame=frame, name="w1") != 4:
        return None
    graph = register(frame=frame, name="x0")
    if not 4096 <= graph < 2**53:
        raise ValueError("invalid face reader graph")
    thread = frame.GetThread()
    stack = []
    for depth in range(min(thread.GetNumFrames(), MAX_FRAMES)):
        caller = thread.GetFrameAtIndex(depth)
        pc = caller.GetPCAddress()
        module = pc.GetModule()
        stack.append(dict(module=(module.GetFileSpec().GetFilename() or "")[:128],
                          uuid=module.GetUUIDString(), offset=pc.GetFileAddress(),
                          symbol=(caller.GetFunctionName() or "")[:512]))
    return dict(prediction=prediction, thread=thread.GetThreadID(), graph=graph,
                buffer_type=4, stack=stack, renderer_consumption=False,
                candidate_injected=False, observation="getter-entry-only")


def install(*, debugger, target, core, callback, address=RAW_GETTER):
    command(debugger=debugger, text="target modules add " + json.dumps(core))
    modules = [module for module in target.modules if module.GetUUIDString() == CORE_UUID]
    if len(modules) != 1:
        raise ValueError("pinned face reader image required")
    before = target.GetNumBreakpoints()
    command(debugger=debugger,
            text=f"breakpoint set --hardware -s libcccreator.dylib -a {address:#x}")
    if target.GetNumBreakpoints() != before + 1:
        raise ValueError("face reader breakpoint creation failed")
    point = target.GetBreakpointAtIndex(before)
    if not point.IsHardware():
        raise ValueError("face reader software breakpoint forbidden")
    point.SetScriptCallbackFunction(callback)
