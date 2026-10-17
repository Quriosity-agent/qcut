"""Slim arms state from its descriptor: populated straight or bent limbs and their radius."""
import math
import numpy as np
from body_arm_straight_limb import F, length
from body_arm_bent_limb import angle

def unit(v):
    v = F(v)
    n = length(v)
    return F(v / n) if n >= F(2 ** (-23)) else np.zeros(2, np.float32)

def side_weight(s, e, reverse):
    direction = F(e - s)
    a = angle(direction, np.array([1, 0], np.float32))
    if direction[1] > F(0):
        a = F(-a)
    if reverse:
        a = F((math.pi if a >= 0 else -math.pi) - float(a))
    if a <= F(0):
        if abs(float(a)) >= math.pi / 2:
            return (F(1), F(min((abs(float(a)) - math.pi / 2) / (math.pi / 4), 1.0)))
        v = F(max(1.0 - (float(a) + math.pi / 2) * 6.0 / math.pi, 0.0))
        return (v, F(max((float(a) + math.pi / 6) * 6.0 / math.pi, 0.0)))
    if float(a) >= math.pi / 4:
        return (F(min(abs(float(a) - math.pi / 2) / (math.pi / 4), 1.0)), F(1))
    return (F(float(a) / (math.pi / 4)), F(1))

def limb(points, visibility, radius, intensity, width, height, reverse=False):
    flags = list(map(int, visibility))
    original = np.array(points, np.float32)
    s, e, w = original.copy()
    r = F(radius)
    f = {hex(o): 0.0 for o in range(36, 116, 4)}
    values = original if flags[2] else original[:2]
    low = np.maximum(F(np.min(values, axis=0) - r), F(0))
    high = np.minimum(F(np.max(values, axis=0) + r), F([width - 1, height - 1]))
    for k, v in zip([100, 104, 108, 112], [low[0], high[0], low[1], high[1]]):
        f[hex(k)] = float(v)
    s = F(e + F(F(unit(F(s - e)) * length(F(s - e))) * F(0.88)))
    start = F(s + F(unit(F(s - e)) * r))
    extmid = F(e + F(unit(F(e - s)) * r))
    u = unit(F(e - s))
    n = F([-u[1], u[0]])
    pairs = {36: u, 44: n, 60: start, 68: extmid}
    single = True
    if flags[2]:
        w = F(e + F(F(unit(F(w - e)) * length(F(w - e))) * F(0.8)))
        v = unit(F(w - e))
        end = F(w + F(v * r))
        pairs.update({52: v, 76: end})
        theta = F((math.pi - float(angle(u, v))) * 0.5)
        f['0x58'] = float(theta)
        single = abs(float(theta) - math.pi / 2) <= float(F(0.001))
    for k, p in pairs.items():
        f[hex(k)], f[hex(k + 4)] = map(float, p)
    f['0x5c'], f['0x60'] = map(float, side_weight(s, e, reverse))
    if not flags[2]:
        w = np.zeros(2, np.float32)
    return {'intensity': float(F(intensity)), 'radius': float(r), 'flags': flags, 'shoulder_elbow_wrist': np.array([s, e, w], np.float32).tolist(), 'float_fields': f, 'byte54': int(single)}

def prepare(points, width, height, radius, target=1.0, visibility=None, arm_validity=None, flip=False):
    points = np.asarray(points, np.float32)
    vis = np.ones(18, np.uint8) if visibility is None else np.asarray(visibility, np.uint8)
    state = {'enabled': True, 'valid': True, 'protection': False, 'strategy': 65536, 'global': {'0x18c': 0.25, '0x190': float(F(0.8)), '0x194': 0.5, '0x198': float(F(0.8)), 'strategy': 65536, 'flip': bool(flip), 'special': False}}
    for name, keys, rev in [('left', [2, 3, 4], False), ('right', [5, 6, 7], True)]:
        valid = bool(vis[keys[0]] and vis[keys[1]])
        if arm_validity is not None:
            valid = bool(arm_validity[int(name == 'right')])
        if not valid:
            state[name] = {'intensity': 0.0, 'radius': 0.0, 'flags': [0, 0, 0], 'shoulder_elbow_wrist': np.zeros((3, 2), np.float32).tolist(), 'float_fields': {hex(o): 0.0 for o in range(36, 116, 4)}, 'byte54': 1}
            continue
        state[name] = limb(points[keys], vis[keys], radius, target, width, height, bool(rev) ^ bool(flip))
    state['valid'] = bool(state['left']['flags'][0] or state['right']['flags'][0])
    return state

def from_descriptor(part, width, height, target=1.0):
    points = np.zeros((18, 2), np.float32)
    points[2:8] = part['points']
    vis = np.zeros(18, np.uint8)
    vis[2:8] = part['point_valid']
    return prepare(points, width, height, part['radius'], target, vis, (part['left_valid'], part['right_valid']), flip=part.get('status50', False))
