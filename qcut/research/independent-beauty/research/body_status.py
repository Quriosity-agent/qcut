"""Per-joint status over frames: validity, motion and transition records, and the
shoulder-order stability and swap flags. One person, upright frames."""
import numpy as np
F = np.float32

class StatusSequence:

    def __init__(self):
        self.bones = np.zeros((18, 40), np.uint8)
        self.bones[:, 4:28] = np.tile(np.array([-1] * 6, F).view('u1'), (18, 1))
        self.bones[:, 28:32] = np.tile(np.array([7], np.int32).view('u1'), (18, 1))
        self.initialized = False
        self.present = False
        self.blocked = False
        self.block_count = 0
        self.swapped = False
        self.swap_count = 0
        self.ratio = F(-1)

    def update(self, coords, visibility, width, height, present=True):
        coords = np.asarray(coords, F)
        vis = np.asarray(visibility, np.uint8)
        if coords.shape != (18, 2) or vis.shape != (18,) or min(width, height) <= 0:
            raise ValueError('18 normalized joints with visibility and a positive image size required')
        self.present = bool(present)
        if not present:
            return self.describe()
        pixels = F(coords * F([width, height]))
        ints = self.bones.view('i4').reshape(18, 10)
        floats = self.bones.view('f4').reshape(18, 10)
        for k, p in enumerate(pixels):
            previous = bool(self.bones[k, 0])
            valid = bool(vis[k] and F(0) < p[0] < F(width) and (F(0) < p[1] < F(height)))
            if self.initialized and previous != valid:
                self.bones[k, 32] = 1
            if valid:
                if previous:
                    d = F(floats[k, 5:7] - p)
                    distance = F(np.sqrt(F(F(d[0] * d[0]) + F(d[1] * d[1]))))
                    self.bones[k, 1] = distance != 0
                floats[k, 1:3] = floats[k, 3:5]
                floats[k, 3:5] = p
                old = floats[k, 5:7].copy()
                floats[k, 5:7] = np.where(abs(F(old + F(1))) > F(2 ** (-23)), F(p + F(F(old - p) * F(0.95))), p)
            else:
                floats[k, 1:7] = F(-1)
                self.bones[k, 1] = 0
            self.bones[k, 0] = valid
            count = int(ints[k, 9])
            count = (count + 1) % int(ints[k, 7]) if self.bones[k, 32] else count
            ints[k, 9] = count
            self.bones[k, 32] = count != 0
        left, right = (floats[2], floats[5])
        if all((not np.all(row[off:off + 2] == F(-1)) for row in (left, right) for off in (1, 3))):

            def length(v):
                return F(np.sqrt(F(F(v[0] * v[0]) + F(v[1] * v[1]))))

            def distance(a, b):
                return length(F(a - b))

            def unit(v):
                n = length(v)
                return F(v / n) if n > F(1e-05) else np.zeros(2, F)
            oldvec = unit(F(left[1:3] - right[1:3]))
            newvec = unit(F(left[3:5] - right[3:5]))
            dot = F(F(oldvec[0] * newvec[0]) + F(oldvec[1] * newvec[1]))
            incoming = F(1)
            if dot < F(0):
                numerator = F(float(distance(left[1:3], right[3:5])) + float(distance(right[1:3], left[3:5])))
                denominator = F(float(distance(left[1:3], right[1:3])) + float(distance(right[3:5], left[3:5])))
                incoming = F(numerator / denominator)
            self.ratio = F(incoming + F(F(self.ratio - incoming) * F(0.8))) if abs(F(self.ratio + F(1))) > F(2 ** (-23)) else incoming
        if self.bones[2, 32] or self.bones[5, 32] or F(0) < self.ratio < F(0.8):
            self.blocked = True
        if self.blocked:
            self.block_count = (self.block_count + 1) % 7
        self.blocked = self.block_count != 0
        if not self.blocked:
            if vis[2] and vis[5] and (coords[2, 0] > coords[5, 0]):
                if self.initialized:
                    if not self.swapped:
                        self.swap_count += 1
                    if self.swap_count == 10:
                        self.swapped = True
                        self.swap_count = 0
                else:
                    self.swapped = True
                    self.swap_count = 0
            else:
                self.swapped = False
                self.swap_count = 0
        self.initialized = True
        return self.describe()

    def describe(self):
        return {'present': self.present, 'visibility': self.bones[:, 0].copy(), 'motion': self.bones[:, 1].copy(), 'transition': self.bones[:, 32].copy(), 'bone_records': self.bones.copy(), 'initialized': self.initialized, 'status48': self.blocked, 'status50': self.swapped, 'status4c': self.block_count, 'status54': self.swap_count, 'status78': self.ratio}
