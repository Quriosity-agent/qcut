"""Bounded preparation only: no native matrices, fitting, or independence claim."""
import copy
import struct
import unittest

import numpy as np

from face_extra_crop_geometry import stage2_fit_inputs


class Stage2InputTests(unittest.TestCase):
    def setUp(self):
        self.published = [i / 8 for i in range(560)]
        self.mean = [struct.unpack("<f", struct.pack("<f", i / 7))[0] for i in range(212)]

    def test_fixed160_preparation_matches_independent_scalar(self):
        source, target = stage2_fit_inputs(published_xy=self.published, part_face_mean_xy=self.mean)
        expected = b"".join(struct.pack("<f", (float(value) / 256.0) * 160.0) for value in self.mean[:212])
        self.assertEqual(source.shape, (106, 2))
        self.assertEqual(target.shape, (106, 2))
        self.assertEqual(source.dtype, np.float32)
        self.assertEqual(source.tobytes(), struct.pack("<212f", *self.published[:212]))
        self.assertEqual(target.tobytes(), expected)

    def test_primary106_and_full280_prepare_identical_inputs(self):
        pairs = [stage2_fit_inputs(published_xy=points, part_face_mean_xy=self.mean)
                 for points in (self.published[:212], self.published)]
        for index in (0, 1):
            self.assertEqual(pairs[0][index].tobytes(), pairs[1][index].tobytes())

    def test_tail_changes_cannot_change_first106_inputs(self):
        expected = stage2_fit_inputs(published_xy=self.published, part_face_mean_xy=self.mean)
        self.published[212:] = [1234.0] * 348
        actual = stage2_fit_inputs(published_xy=self.published, part_face_mean_xy=self.mean)
        for index in (0, 1):
            self.assertEqual(actual[index].tobytes(), expected[index].tobytes())

    def test_source_and_mean_affect_separate_inputs_without_hidden_correction(self):
        original = stage2_fit_inputs(published_xy=self.published, part_face_mean_xy=self.mean)
        self.published[0] += 10
        actual = stage2_fit_inputs(published_xy=self.published, part_face_mean_xy=self.mean)
        self.assertNotEqual(actual[0].tobytes(), original[0].tobytes())
        self.assertEqual(actual[1].tobytes(), original[1].tobytes())
        self.mean[1] += 10
        changed_mean = stage2_fit_inputs(published_xy=self.published, part_face_mean_xy=self.mean)
        self.assertEqual(actual[0].tobytes(), changed_mean[0].tobytes())
        self.assertNotEqual(actual[1].tobytes(), changed_mean[1].tobytes())

    def test_no_mutation_or_returned_array_alias(self):
        original = copy.deepcopy((self.published, self.mean))
        source, target = stage2_fit_inputs(published_xy=self.published, part_face_mean_xy=self.mean)
        source[:] = 99
        target[:] = 99
        self.assertEqual((self.published, self.mean), original)

    def test_bad_shapes_types_and_nonfinite_values_fail(self):
        for points in ([], self.published[:210], tuple(self.published), [True] * 212,
                       [float("nan")] * 212, [32769.0] * 212):
            with self.subTest(points=points[:1]), self.assertRaises(ValueError):
                stage2_fit_inputs(published_xy=points, part_face_mean_xy=self.mean)
        for mean in ([], self.mean[:210], [0.0] * 480, [float("inf")] * 212, [True] * 212):
            with self.subTest(mean=mean[:1]), self.assertRaises(ValueError):
                stage2_fit_inputs(published_xy=self.published, part_face_mean_xy=mean)

    def test_signed_zero_and_subnormal_input_bits_survive(self):
        self.published[:3] = struct.unpack("<3f", struct.pack("<3I", 0x80000000, 1, 0x80000001))
        self.mean[0] = -0.0
        source, target = stage2_fit_inputs(published_xy=self.published, part_face_mean_xy=self.mean)
        self.assertEqual(source.tobytes()[:12], struct.pack("<3I", 0x80000000, 1, 0x80000001))
        self.assertEqual(target.tobytes()[:4], struct.pack("<I", 0x80000000))


if __name__ == "__main__":
    unittest.main()
