"""Small head state from the head descriptor."""
import struct, numpy as np
F = np.float32

def prepare(head, target=0.5):
    data = head.data if hasattr(head, 'data') else head
    f = lambda o: struct.unpack_from('f', data, o)[0]
    valid = bool(data[52])
    if not valid:
        return {'enabled': True, 'valid': False, 'protection': False, 'intensity': 0.0, 'center': [0.0, 0.0], 'radii': [0.0] * 4, 'bounds': [0.0] * 4, 'limit': float(F(0.4)), 'gain': 0.0}
    return {'enabled': True, 'valid': valid, 'protection': False, 'intensity': float(F(target)) if valid else 0.0, 'center': [f(148), f(152)], 'radii': [f(o) for o in [168, 172, 180, 176]], 'bounds': [f(o) for o in [184, 188, 192, 196]], 'limit': float(F(0.4)), 'gain': f(200)}
