import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from iris_geometry import decode_pupil, eye_crop


class IrisGeometryTests(unittest.TestCase):
    def setUp(self):
        self.corners = np.array([[20, 24], [36, 24]], np.float32)
        self.identity = np.eye(2, 3, dtype=np.float32)

    def test_eye_midpoint_and_mirror_profile(self):
        left = eye_crop(controls=self.corners, stage2_forward=self.identity, mirrored=False)
        right = eye_crop(controls=self.corners, stage2_forward=self.identity, mirrored=True)
        center = np.r_[self.corners.mean(axis=0), np.float32(1)]
        np.testing.assert_allclose(left['eye_forward']@center, [24, 24], atol=.00001)
        np.testing.assert_allclose(right['eye_forward']@center, [23, 24], atol=.00001)
        np.testing.assert_array_equal(right['forward'][1], left['forward'][1])

    def test_decode_maps_crop_center_back_and_reorders_right_ring(self):
        raw = np.zeros((20, 2), np.float32)
        mean = np.tile(np.array([24, 24], np.float32), (20, 1))
        mean[:, 1] += np.arange(20, dtype=np.float32)
        left = eye_crop(controls=self.corners, stage2_forward=self.identity, mirrored=False)
        decoded = decode_pupil(raw=raw, mean=mean, crop=left, stage2_inverse=self.identity, mirrored=False)
        mirrored = decode_pupil(raw=raw, mean=mean, crop=left, stage2_inverse=self.identity, mirrored=True)
        np.testing.assert_allclose(decoded[0], self.corners.mean(axis=0), atol=.00001)
        np.testing.assert_array_equal(mirrored[:, 1], decoded[np.r_[0, 1, np.arange(19, 1, -1)], 1])

    def test_degenerate_corners_and_implicit_mirror_are_rejected(self):
        for corners, mirrored in ((self.corners*0, False), (self.corners, 1), (self.corners.astype(float), False)):
            with self.assertRaises(ValueError):
                eye_crop(controls=corners, stage2_forward=self.identity, mirrored=mirrored)


if __name__ == '__main__':
    unittest.main()
