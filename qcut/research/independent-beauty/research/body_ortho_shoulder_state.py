"""Square shoulders state from the shoulder descriptor, the torso basis and the per-joint status."""
import struct, numpy as np
F = np.float32

def prepare(part, public, target=0.5, status50=False, initial_turn=0.0):
    pts = np.asarray(part['points'], np.float32)
    vis = np.asarray(part['point_valid'], np.uint8)
    order = [0, 1, 3, 2, 4]
    turn = F(initial_turn)
    if isinstance(public, (bytes, bytearray)):
        angle = struct.unpack_from('f', public, 332)[0]
        if angle > 0:
            turn = F(struct.unpack_from('f', public, 364)[0])
    elif public.get('basis_angle', 0) > 0:
        turn = F(public['turnvar'])
    return {'intensity': float(F(target)), 'points': pts[order].tolist(), 'flags': vis[order].tolist(), 'status50': bool(status50), 'turn': float(turn), 'dirty': True}
