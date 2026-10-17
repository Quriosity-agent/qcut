"""Head descriptor: head size and position from the face associated with the body, else from
the head joints, with the protected head region over frames."""
import struct
import numpy as np
f = np.float32

def ema(old, new, a):
    old, new, a = map(f, (old, new, a))
    return new if abs(f(old + f(1))) <= f(2 ** (-23)) else f(f(f(old - new) * a) + new)

def balanced_x(points):
    x = np.asarray(points, np.float32)[:, 0]
    if len(x) == 1:
        return x[0]
    center = f(f(max(x) + min(x)) * f(0.5))
    d = np.asarray(x - center, np.float32)
    left = right = f(0)
    for a in d:
        if a < 0:
            left = f(left - a)
        else:
            right = f(right + a)
    result = f(0)
    total = f(left + right)
    with np.errstate(divide='ignore', invalid='ignore'):
        for a, b in zip(d, x):
            numerator = f(right * f(-a)) if a < 0 else f(left * a)
            denom = left if a < 0 else right
            result = f(result + f(f(f(numerator / total) / denom) * b))
    return result

class SkeletonHead:

    def __init__(self):
        self.data = bytearray(512)
        self.puti(56, -1)
        for off in range(64, 88, 4):
            self.put(off, -1)
        for off in range(108, 148, 4):
            self.put(off, -1)
        for off in [148, 152, 156, 160, *range(168, 204, 4)]:
            self.put(off, -1)
        for off, val in zip(range(204, 228, 4), [1, 1, 1, 0.2, 0.9, 0.2]):
            self.put(off, val)
        self.puti(260, 30)

    def get(self, off):
        return f(struct.unpack_from('<f', self.data, off)[0])

    def put(self, off, value):
        struct.pack_into('<f', self.data, off, float(value))

    def puti(self, off, value):
        struct.pack_into('<i', self.data, off, int(value))

    def update(self, coords, visibility, width, height, public_scale=0, faces=None, rectangles=None, rolls=None, status_valid=True, status_blocked=False):
        self.data[52] = 0
        self.data[104] = 0
        self.data[60] = 0
        skeleton_enabled = bool(status_valid and (not status_blocked))
        if faces is not None:
            from body_head_faces import update
            update(self, coords, visibility, faces, rectangles, rolls, width, height, reject_distant=skeleton_enabled)
        if skeleton_enabled:
            p = np.asarray(coords, np.float32).reshape(18, 2) * np.array([width, height], np.float32)
            v = np.asarray(visibility, bool)
            ids = [i for i in [0, 14, 15, 16, 17] if v[i] and np.all(p[i] > 0) and np.all(p[i] < [width, height])]
            self.data[104] = int(bool(ids))
            if not ids:
                from body_head_faces import reset_face
                reset_face(self)
            else:
                pts = p[ids]
                mean = np.zeros(2, np.float32)
                for pt in pts:
                    mean = np.asarray(mean + pt, np.float32)
                mean = np.asarray(mean / f(len(pts)), np.float32)
                wx = balanced_x(pts)
                if v[1]:
                    wx = f(f(wx * f(0.5)) + f(p[1, 0] * f(0.5)))
                raw_y = mean[1]
                if self.data[60]:
                    mean = np.array([self.get(72), self.get(76)], np.float32)
                for off, val in zip([116, 120, 124, 128], [*mean, wx, raw_y]):
                    self.put(off, val)
                self.put(132, ema(self.get(132), mean[0], 0.35))
                self.put(136, ema(self.get(136), mean[1], 0.8))
                self.put(140, ema(self.get(140), wx, 0.5))
                self.put(144, ema(self.get(144), raw_y, 0.5))
                span = f(max(f(max(pts[:, 0]) - min(pts[:, 0])), f(max(pts[:, 1]) - min(pts[:, 1]))))
                self.put(112, ema(self.get(112), span, 0.1))
                target = f(self.get(112) * f(1.5))
                if public_scale > 0:
                    target = f(max(target, f(f(public_scale) * f(0.28))))
                self.put(108, ema(self.get(108), target, 0.8))
        valid = bool(self.data[104] if skeleton_enabled else self.data[60])
        if not valid:
            return self.result(False)
        self.data[52] = 1
        kind = 1 if self.data[60] else 2
        oldkind = struct.unpack_from('<i', self.data, 248)[0]
        if oldkind == 0:
            self.puti(248, kind)
        elif oldkind != kind:
            self.puti(248, kind)
            self.data[252] = 1
            self.puti(256, 0)
        if self.data[252]:
            counter = (struct.unpack_from('<i', self.data, 256)[0] + 1) % 30
            self.puti(256, counter)
            self.data[252] = int(counter != 0)
        from body_head_roi import update
        update(self, width, height)
        self.data[228] = 1
        if self.data[60]:
            for off, source, scale in [(232, 88, width), (236, 92, height), (240, 96, width), (244, 100, height)]:
                self.put(off, f(self.get(source) * f(scale)))
        else:
            half = f(self.get(112) * f(0.5))
            self.put(232, max(f(self.get(132) - half), f(0)))
            self.put(236, max(f(self.get(136) - half), f(0)))
            self.put(240, self.get(112))
            self.put(244, self.get(112))
        return self.result(True)

    def result(self, valid):
        return {'valid': valid, 'position': (float(self.get(140)), float(self.get(144))), 'public_position': (float(self.get(132)), float(self.get(136))), 'size': float(self.get(108)), 'public_face_size': float(self.get(64)) if self.data[60] else None}
