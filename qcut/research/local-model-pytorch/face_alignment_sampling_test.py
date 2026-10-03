"""Synthetic affine controls; runtime parity is measured by the separate probe."""
import unittest

import numpy as np

from face_alignment_sampling import inverse_forward, quantize, sample_bgr, signed_input


def identity():
    return np.array([[1, 0, 0], [0, 1, 0]], np.float32)


def pixels():
    return np.arange(6 * 7 * 4, dtype=np.uint8).reshape(6, 7, 4)


class SamplingTests(unittest.TestCase):
    def test_identity_preserves_pixels_in_bgr_and_signed_layout(self):
        frame = pixels()
        expected = frame[:, :, :3][:, :, ::-1]
        np.testing.assert_array_equal(sample_bgr(frame=frame, forward=identity(), size=(7, 6)), expected)
        result = signed_input(frame=frame, forward=identity(), size=(7, 6))
        self.assertEqual(result.dtype, np.int16)
        self.assertEqual(result.shape, (1, 6, 7, 3))
        np.testing.assert_array_equal(result[0] + 128, expected)
        self.assertEqual(result.min(), -128)

    def test_rounding_is_split_biased_and_half_even_before_bias(self):
        values = np.array([0.49, 0.5, -0.5, -0.51, 0.5 - 0.5 / 1024, 0.5 - 1.5 / 1024], np.float32)
        np.testing.assert_array_equal(quantize(values=values), [0, 1, 0, -1, 1, 0])
        contribution = np.array([0.4], np.float32)
        self.assertNotEqual(int(quantize(values=contribution)[0] * 2), int(quantize(values=contribution * 2)[0]))

    def test_signed_short_storage_wraps_instead_of_saturating(self):
        values = np.array([32767, 32768, 65535, 65536, -32769, -65536], np.float32)
        np.testing.assert_array_equal(quantize(values=values), [32767, -32768, -1, 0, 32767, 0])

    def test_integer_translation_and_zero_border(self):
        matrix = identity()
        matrix[:, 2] = [2, -1]
        result = sample_bgr(frame=pixels(), forward=matrix, size=(7, 6))
        np.testing.assert_array_equal(result[:5, 2:], pixels()[1:, :5, :3][:, :, ::-1])
        self.assertFalse(result[:, :2].any())
        self.assertFalse(result[5].any())

    def test_scale_and_quarter_turn_have_fixed_index_coordinates(self):
        frame = pixels()
        scale = np.array([[0.5, 0, 0], [0, 0.5, 0]], np.float32)
        np.testing.assert_array_equal(sample_bgr(frame=frame, forward=scale, size=(3, 3)), frame[:6:2, :6:2, :3][:, :, ::-1])
        rotation = np.array([[0, -1, 5], [1, 0, 0]], np.float32)
        np.testing.assert_array_equal(sample_bgr(frame=frame, forward=rotation, size=(6, 7)), np.rot90(frame[:, :, :3][:, :, ::-1], k=-1))

    def test_noncontiguous_rgba_and_alpha_do_not_affect_bgr(self):
        frame = pixels()[:, ::-1]
        before = frame.copy()
        actual = sample_bgr(frame=frame, forward=identity(), size=(7, 6))
        altered = frame.copy()
        altered[:, :, 3] = 0
        np.testing.assert_array_equal(actual, sample_bgr(frame=altered, forward=identity(), size=(7, 6)))
        np.testing.assert_array_equal(frame, before)

    def test_inverse_preserves_instruction_order(self):
        matrix = np.array([[0.45021921, -0.0049751378, -84.128815],
                           [0.0049751378, 0.45021921, -51.184742]], np.float32)
        expected = np.array([[2.2208690643310547, 0.024541666731238365, 188.09524536132812],
                             [-0.024541666731238365, 2.2208690643310547, 111.60994720458984]], np.float32)
        np.testing.assert_array_equal(inverse_forward(forward=matrix), expected)
        self.assertEqual(inverse_forward(forward=matrix).dtype, np.float32)

    def test_invalid_matrices_do_not_reach_sampling(self):
        for matrix in (identity().astype(np.float64), np.zeros((2, 3), np.float32),
                       np.full((2, 3), np.nan, np.float32), np.full((2, 3), np.inf, np.float32),
                       np.ones((3, 3), np.float32), identity() * 32769):
            with self.subTest(matrix=matrix), self.assertRaises(ValueError):
                sample_bgr(frame=pixels(), forward=matrix)

    def test_invalid_frame_and_size_fail_closed(self):
        for frame in (pixels().astype(np.int16), pixels()[:, :, :3], np.empty((0, 7, 4), np.uint8),
                      np.empty((4097, 1, 4), np.uint8), np.empty((6, 7, 4, 1), np.uint8)):
            with self.subTest(shape=frame.shape), self.assertRaises(ValueError):
                sample_bgr(frame=frame, forward=identity())
        for size in ((1, 120), (161, 120), (True, 120), (120.0, 120), [120, 120], (120,)):
            with self.subTest(size=size), self.assertRaises(ValueError):
                sample_bgr(frame=pixels(), forward=identity(), size=size)

    def test_unsafe_quantization_is_rejected_not_clipped(self):
        for value in (np.array([np.nan], np.float32), np.array([np.inf], np.float32),
                      np.array([2**21], np.float32), np.array([0.5], np.float64)):
            with self.subTest(value=value), self.assertRaises(ValueError):
                quantize(values=value)


if __name__ == "__main__":
    unittest.main()
