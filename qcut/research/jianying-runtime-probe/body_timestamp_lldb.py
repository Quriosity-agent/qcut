"""Read-only mesh/state observations layered on the pinned Swing backend probe."""
import hashlib
import json
from pathlib import Path

import body_backend_lldb as backend
import body_profile_lldb as profile

STATE = {}
MESH_ADDRESS = 0xA57314
PART_NAMES = ('SmallHead', 'SlimArm', 'SlimLeg', 'LongLeg', 'SlimBody', 'SlimWaist',
              'SlimBreast', 'SlimHip', 'SwanNeck', 'WidenShoulder', 'OrthoShoulder')


def save_bytes(*, name, data):
    Path(STATE['output'], name).write_bytes(data)
    return {'file': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def snapshot(*, frame, pointer, index, stage):
    process = frame.GetThread().GetProcess()
    result = {'parts': []}
    for name, offset in (('base', 0x28), ('positions', 0x40), ('uv', 0x88)):
        start, count = profile.capture_vector(process=process, address=pointer + offset, stride=8)
        result[name] = save_bytes(name=f'mesh-{index:03d}-{stage}-{name}.f32',
                                 data=profile.read(process=process, address=start, size=count * 8))
    node = backend.integer(process=process, address=pointer + 0x10)
    visited = set()
    while node:
        if node in visited or len(visited) >= 20:
            raise ValueError('invalid bounded native part list')
        visited.add(node)
        key = backend.integer(process=process, address=node + 16, format='<i')
        part = backend.integer(process=process, address=node + 24)
        if not 0 <= key < len(PART_NAMES) or not part:
            raise ValueError('invalid native part identity')
        result['parts'].append({'name': PART_NAMES[key],
            'inputMode': backend.integer(process=process, address=part + 0x10, format='<i'),
            'rawState': save_bytes(name=f'mesh-{index:03d}-{stage}-{PART_NAMES[key]}.bin',
                data=profile.read(process=process, address=part, size=640))})
        node = backend.integer(process=process, address=node)
    return result


@profile.guarded
def on_mesh(*, frame):
    index = len(STATE['meshes'])
    pointer = profile.register(frame=frame, name='x0')
    row = {'index': index, 'skeletonCall': len(profile.STATE['calls']) - 1,
           'argument1': profile.register(frame=frame, name='w1'),
           'argument2': profile.register(frame=frame, name='w2'),
           'before': snapshot(frame=frame, pointer=pointer, index=index, stage='before')}
    STATE['meshes'].append(row)
    address = profile.register(frame=frame, name='lr')
    key = (frame.GetThread().GetThreadID(), address)
    STATE['pending'].setdefault(key, []).append((pointer, row))
    if address not in STATE['returns']:
        point = frame.GetThread().GetProcess().GetTarget().BreakpointCreateByAddress(address)
        point.SetScriptCallbackFunction(__name__ + '.on_mesh_return')
        STATE['returns'].add(address)


@profile.guarded
def on_mesh_return(*, frame):
    stack = STATE['pending'].get((frame.GetThread().GetThreadID(), frame.GetPC()))
    if stack:
        pointer, row = stack.pop()
        row['after'] = snapshot(frame=frame, pointer=pointer, index=row['index'], stage='after')


class ObservedTarget:
    def __init__(self, target):
        self.target = target

    def __getattr__(self, name):
        return getattr(self.target, name)

    def Launch(self, launch, error):
        module = backend.STATE['module']
        self.target.BreakpointCreateBySBAddress(module.ResolveFileAddress(MESH_ADDRESS)).SetScriptCallbackFunction(__name__ + '.on_mesh')
        return self.target.Launch(launch, error)


class ObservedDebugger:
    def __init__(self, debugger):
        self.debugger = debugger

    def SetAsync(self, value):
        self.debugger.SetAsync(value)

    def CreateTarget(self, host):
        return ObservedTarget(self.debugger.CreateTarget(host))


def run(*, debugger, configuration):
    global STATE
    config = json.loads(Path(configuration).read_text())
    STATE = {'output': config['output'], 'meshes': [], 'pending': {}, 'returns': set()}
    # The reused runner checks the exact library SHA and arm64 before creating hooks.
    backend.run(debugger=ObservedDebugger(debugger), configuration=configuration)
    Path(config['output'], 'meshes.json').write_text(json.dumps(STATE['meshes'], indent=2) + '\n')
