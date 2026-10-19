"""Ordinary video sampling keeps the native fused coordinate-table rounding."""
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from alignment_sampling import sample_bgr, signed_input
from alignment_sequence import Sequence


class OrdinarySampling(unittest.TestCase):
    def setUp(self):
        self.frame = np.zeros((568, 640, 4), np.uint8)
        columns = np.arange(640, dtype=np.uint16)
        self.frame[:, :, 0] = columns % 256
        self.frame[:, :, 1] = columns // 256
        self.frame[:, :, 3] = 255

    def test_fused_column_boundary_keeps_ordinary_and_fast_profiles_distinct(self):
        forward = np.array([[3.3334341049194336, .48175838589668274, -1549.096923828125],
                            [-.48175838589668274, 3.3334341049194336, -338.9764099121094]], np.float32)
        ordinary = sample_bgr(frame=self.frame, forward=forward, profile='ordinary')
        fast = sample_bgr(frame=self.frame, forward=forward)
        np.testing.assert_array_equal(ordinary[0, 67], [0, 1, 204])
        np.testing.assert_array_equal(fast[0, 67], [0, 1, 205])
        np.testing.assert_array_equal(signed_input(frame=self.frame, forward=forward, profile='ordinary'),
                                      ordinary.astype(np.int16)[None] - 128)

    def test_identity_and_outside_bounds_are_identical_for_both_profiles(self):
        for translation in (0, 640):
            forward = np.array([[1, 0, translation], [0, 1, 0]], np.float32)
            np.testing.assert_array_equal(sample_bgr(frame=self.frame, forward=forward, profile='ordinary'),
                                          sample_bgr(frame=self.frame, forward=forward))

    def test_ordinary_rejects_invalid_transform_and_unknown_profile(self):
        with self.assertRaisesRegex(ValueError, 'nonsingular'):
            sample_bgr(frame=self.frame, forward=np.zeros((2, 3), np.float32), profile='ordinary')
        with self.assertRaisesRegex(ValueError, 'profile'):
            sample_bgr(frame=self.frame, forward=np.eye(2, 3, dtype=np.float32), profile='guess')

    def test_sequence_persists_explicit_sampling_profile_and_keeps_old_default(self):
        for profile in ('fast', 'ordinary'):
            sequence = Sequence(model_root=Path('.'), models={120: object(), 160: object()},
                                sampling_profile=profile)
            self.assertEqual(vars(sequence)['sampling_profile'], profile)
        sequence = Sequence(model_root=Path('.'), models={120: object(), 160: object()})
        self.assertEqual(sequence.sampling_profile, 'fast')
        with self.assertRaisesRegex(ValueError, 'profile'):
            Sequence(model_root=Path('.'), models={}, sampling_profile='guess')


if __name__ == '__main__':
    unittest.main()
