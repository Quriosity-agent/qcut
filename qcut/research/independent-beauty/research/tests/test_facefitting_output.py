from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from facefitting_output import decode_output, inverse_affine, map_output, resize_forward


class FittingOutputTests(unittest.TestCase):
    def setUp(self):
        self.raw = np.arange(442, dtype=np.float32).reshape(1, 442)
        self.identity = np.array([[1, 0, 0], [0, 1, 0]], np.float32)

    def test_pairs_keep_all_221_slots_and_do_not_alias_the_raw_output(self):
        decoded = decode_output(values=self.raw)
        self.assertEqual(decoded.shape, (221, 2))
        np.testing.assert_array_equal(decoded[:, 0], np.arange(0, 442, 2))
        np.testing.assert_array_equal(decoded[:, 1], np.arange(1, 442, 2))
        decoded[0, 0] = 5
        self.assertEqual(self.raw[0, 0], 0)

    def test_identity_does_not_renormalize_flip_or_clip(self):
        original = self.raw.copy()
        self.raw[0, :2] = [-20, 300]
        result = map_output(values=self.raw, matrix=self.identity)
        np.testing.assert_array_equal(result["image_points"], self.raw.reshape(221, 2))
        np.testing.assert_array_equal(result["inverse"], self.identity)
        np.testing.assert_array_equal(self.raw[0, 2:], original[0, 2:])

    def test_translation_scale_rotation_and_shear_are_inverted(self):
        matrix = np.array([[0, -2, 50], [4, 0, 90]], np.float32)
        expected = np.column_stack(((self.raw.reshape(221, 2)[:, 1] - 90) / 4,
                                    (50 - self.raw.reshape(221, 2)[:, 0]) / 2))
        result = map_output(values=self.raw, matrix=matrix)
        np.testing.assert_array_equal(result["image_points"], expected)
        np.testing.assert_array_equal(result["inverse"], [[0, 0.25, -22.5], [-0.5, 0, 25]])

    def test_inverse_times_forward_is_identity_for_a_general_affine(self):
        matrix = np.array([[0.75, -0.125, 350], [0.0625, 1.25, -120]], np.float32)
        inverse = inverse_affine(matrix=matrix)
        product = np.vstack((inverse, [0, 0, 1])) @ np.vstack((matrix, [0, 0, 1]))
        np.testing.assert_allclose(product, np.eye(3), atol=3e-5, rtol=0)

    def test_rejects_bad_output_shape_type_and_nonfinite_values(self):
        for values in (self.raw.astype(np.float64), self.raw.reshape(442), np.zeros((1, 440), np.float32),
                       np.full((1, 442), np.nan, np.float32), np.full((1, 442), np.inf, np.float32)):
            with self.subTest(shape=values.shape), self.assertRaises(ValueError):
                map_output(values=values, matrix=self.identity)

    def test_rejects_bad_matrix_and_singular_geometry(self):
        for matrix in (np.zeros((2, 3), np.float32), np.ones((2, 3), np.float32),
                       self.identity.astype(np.float64), np.eye(3, dtype=np.float32),
                       np.full((2, 3), np.nan, np.float32), np.full((2, 3), np.inf, np.float32)):
            with self.subTest(shape=matrix.shape), self.assertRaises(ValueError):
                map_output(values=self.raw, matrix=matrix)

    def test_rejects_float32_overflow(self):
        matrix = np.array([[1e20, 0, 0], [0, 1e20, 0]], np.float32)
        with self.assertRaises(ValueError):
            inverse_affine(matrix=matrix)

    def test_does_not_mutate_matrix_or_output(self):
        matrix, raw = self.identity.copy(), self.raw.copy()
        map_output(values=raw, matrix=matrix)
        np.testing.assert_array_equal(raw, self.raw)
        np.testing.assert_array_equal(matrix, self.identity)

    def test_resize_inverse_preserves_pixel_centers_and_original_dimensions(self):
        matrix = resize_forward(source_size=(4000, 6000), analyzed_size=(1000, 1500))
        raw = np.tile(np.array([0, 0], np.float32), 221).reshape(1, 442)
        raw[0, 2:4] = [999, 1499]
        points = map_output(values=raw, matrix=matrix)["image_points"]
        np.testing.assert_array_equal(points[:2], [[1.5, 1.5], [3997.5, 5997.5]])

    def test_identity_resize_is_identity(self):
        np.testing.assert_array_equal(resize_forward(source_size=(1448, 1086), analyzed_size=(1448, 1086)), self.identity)

    def test_resize_rejects_noninteger_empty_and_unbounded_dimensions(self):
        for size in ((0, 600), (1000000, 600), (640.0, 600), (True, 600), (640,)):
            with self.assertRaises(ValueError):
                resize_forward(source_size=size, analyzed_size=(640, 600))


if __name__ == "__main__":
    unittest.main()
