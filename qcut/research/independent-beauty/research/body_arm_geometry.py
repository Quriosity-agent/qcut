"""Slim arms: the arm state's limb displacements added to the mesh."""
import json, argparse
from pathlib import Path
import numpy as np
from body_arm_straight_limb import displace_limb as straight
from body_arm_bent_limb import displace_limb as bent

def deform(source, state, destination=None):
    src = np.asarray(source, np.float32)
    out = np.zeros_like(src) if destination is None else np.array(destination, np.float32, copy=True)
    if state.get('protection', False):
        raise NotImplementedError('Body protection constraints need a separately populated protection state')
    if not state.get('enabled', True) or not state.get('valid', True):
        return (False, out)
    deltas = []
    active = False
    for index, name in enumerate(['left', 'right']):
        limb = state[name]
        if not limb['flags'][0] or not limb['flags'][1] or abs(limb['intensity']) < 2 ** (-23):
            deltas.append(np.zeros_like(src))
            continue
        if not limb['flags'][2] or limb['byte54']:
            on, delta = straight(src, limb, state['global'], index)
        else:
            on, delta, _ = bent(src, limb, state['global'], index)
        active |= on
        deltas.append(delta)
    return (active, np.float32(out + np.float32(deltas[0] + deltas[1])))

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--state', type=Path, required=True)
    p.add_argument('--source', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    active, delta = deform(np.load(a.source), json.loads(a.state.read_text()))
    np.save(a.output, delta)
    print(json.dumps({'active': bool(active), 'output': str(a.output), 'scope': 'Explicit populated state; independent geometry only'}))
