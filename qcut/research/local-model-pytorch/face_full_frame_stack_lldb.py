"""Bounded read-only call stacks at the existing verified prediction breakpoint."""
from pathlib import Path
import json
import sys

import face_preprocess_lldb as base


def stack_frames(*, thread):
    count = thread.GetNumFrames()
    if type(count) is not int or not 1 <= count <= 64:
        raise ValueError("bounded initialized prediction stack required")
    rows = []
    for index in range(count):
        frame = thread.GetFrameAtIndex(index)
        address = frame.GetPCAddress()
        if not frame.IsValid() or not address.IsValid():
            raise ValueError("unreadable prediction stack frame")
        module = address.GetModule()
        if not module.IsValid():
            raise ValueError("unidentified prediction stack module")
        pc = address.GetFileAddress()
        symbol = frame.GetFunctionName() or ""
        name = module.GetFileSpec().GetFilename()
        uuid = module.GetUUIDString()
        if (type(pc) is not int or not 0 <= pc < 2**63 or not isinstance(name, str) or
                not 1 <= len(name) <= 1024 or not isinstance(symbol, str) or len(symbol) > 4096 or
                not isinstance(uuid, str) or not 1 <= len(uuid) <= 128):
            raise ValueError("unbounded prediction stack identity")
        rows.append(dict(index=index, module=name, uuid=uuid, file_address=pc, symbol=symbol))
    return rows


class StackObserver(base.Observer):
    def handle(self, *, frame, location):
        super().handle(frame=frame, location=location)
        if base.file_address(address=frame.GetPCAddress()) != base.POINTS["prediction"]:
            return
        self.predictions[-1]["stack"] = stack_frames(thread=frame.GetThread())


def run(*, debugger, config_path):
    base.command(debugger=debugger, text="command script import " + json.dumps(str(Path(base.__file__).resolve())))
    original = base.Observer
    try:
        base.Observer = StackObserver
        base.run(debugger=debugger, config_path=config_path)
    finally:
        base.Observer = original


def __lldb_init_module(debugger, internal_dict):
    sys.path.insert(0, str(Path(__file__).resolve().parent))
