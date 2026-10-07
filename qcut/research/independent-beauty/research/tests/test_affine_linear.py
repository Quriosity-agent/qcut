import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from affine_linear import sample_bgr


class AffineLinearTests(unittest.TestCase):
    def setUp(self):
        self.frame = np.arange(4*3*4, dtype=np.uint8).reshape(3, 4, 4)
        self.identity = np.eye(2, 3, dtype=np.float32)

    def test_identity_preserves_bytes_and_changes_channel_order(self):
        source = self.frame.copy()
        actual = sample_bgr(frame=self.frame, forward=self.identity, size=(4, 3))
        np.testing.assert_array_equal(actual, self.frame[..., :3][..., ::-1])
        np.testing.assert_array_equal(self.frame, source)

    def test_fractional_pixel_uses_joint_weights_and_half_up_bytes(self):
        forward = self.identity.copy()
        forward[0, 2] = -.25
        actual = sample_bgr(frame=self.frame, forward=forward, size=(3, 3))
        expected = (self.frame[:, :3, :3].astype(int)*3+self.frame[:, 1:, :3]+2)//4
        np.testing.assert_array_equal(actual, expected[..., ::-1])

    def test_outside_image_has_constant_zero_border(self):
        forward = self.identity.copy()
        forward[0, 2] = 1
        actual = sample_bgr(frame=self.frame, forward=forward, size=(4, 3))
        np.testing.assert_array_equal(actual[:, 0], 0)
        np.testing.assert_array_equal(actual[:, 1:], self.frame[:, :3, :3][..., ::-1])

    def test_invalid_destination_and_singular_matrix_are_rejected(self):
        for size in ((641, 1), (False, 3), (4, 0), [4, 3]):
            with self.assertRaises(ValueError):
                sample_bgr(frame=self.frame, forward=self.identity, size=size)
        with self.assertRaises(ValueError):
            sample_bgr(frame=self.frame, forward=self.identity*0, size=(4, 3))


if __name__ == '__main__':
    unittest.main()
