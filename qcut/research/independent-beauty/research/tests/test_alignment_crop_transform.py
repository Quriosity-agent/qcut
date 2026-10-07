from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from alignment_crop_transform import _solve_endpoints, crop_matrices
from alignment_decode import crop_inverse


class CropTransformTests(unittest.TestCase):
    def test_identity_minimum_size_and_negative_origin(self):
        for side in (2, 160, 32768):
            centered, _ = crop_matrices(rect=(0, 0, side, side), network_size=(side, side))
            np.testing.assert_array_equal(centered, [[1, 0, 0], [0, 1, 0]])
            forward, inverse = crop_matrices(rect=(-17, 23, side, side), network_size=(side, side))
            np.testing.assert_allclose(forward, [[1, 0, 17], [0, 1, -23]], atol=3e-5, rtol=0)
            np.testing.assert_allclose(inverse, [[1, 0, -17], [0, 1, 23]], atol=3e-5, rtol=0)
            self.assertEqual(forward.dtype, np.float32)
            self.assertEqual(inverse.dtype, np.float32)

    def test_rectangular_crop_and_network_endpoints_roundtrip(self):
        for rect, size in (((-71, 123, 80, 319), (160, 240)), ((0, 0, 2, 32768), (2, 120)),
                           ((32768, -32768, 32768, 2), (240, 160))):
            forward, inverse = crop_matrices(rect=rect, network_size=size)
            origin = np.asarray(rect[:2], np.float64)
            far = origin + np.asarray(rect[2:]) - 1
            points = np.array([origin, far])
            warped = points @ forward[:, :2].astype(np.float64).T + forward[:, 2]
            np.testing.assert_allclose(warped, [[0, 0], np.asarray(size) - 1], atol=.005, rtol=0)
            mapped = warped @ inverse[:, :2].astype(np.float64).T + inverse[:, 2]
            np.testing.assert_allclose(mapped, points, atol=.005, rtol=0)

    def test_pivot_exchange_and_fused_back_substitution_keep_residual_small(self):
        matrix = np.array([[0, 0, 1, 0], [0, 123, 0, 1], [79, 0, 1, 0], [0, 441, 0, 1]], np.float32)
        target = np.array([0, 0, 159, 239], np.float32)
        before, before_target = matrix.copy(), target.copy()
        solution = _solve_endpoints(matrix=matrix, target=target)
        np.testing.assert_allclose(matrix.astype(np.float64) @ solution, target, atol=3e-5, rtol=0)
        np.testing.assert_array_equal(matrix, before)
        np.testing.assert_array_equal(target, before_target)
        with self.assertRaises(ValueError):
            _solve_endpoints(matrix=np.zeros((4, 4), np.float32), target=target)

    def test_endpoint_formula_and_generic_inverse_have_different_rounding(self):
        rect = (-71, 123, 80, 319)
        forward, inverse = crop_matrices(rect=rect, network_size=(160, 160))
        analytic = np.array([[79 / 159, 0, -71], [0, 318 / 159, 123]], np.float32)
        self.assertFalse(np.array_equal(inverse.view(np.uint32), analytic.view(np.uint32)))
        forward, inverse = crop_matrices(rect=(-124, 175, 14, 598), network_size=(160, 160))
        generic = np.linalg.inv(np.vstack((forward.astype(np.float64), [0, 0, 1])))[:2].astype(np.float32)
        self.assertFalse(np.array_equal(inverse.view(np.uint32), generic.view(np.uint32)))

    def test_inputs_are_not_mutated_and_matrices_do_not_share_storage(self):
        rect, size = [-2, -4, 160, 160], [160, 160]
        forward, inverse = crop_matrices(rect=rect, network_size=size)
        forward.fill(0)
        self.assertFalse(np.shares_memory(forward, inverse))
        np.testing.assert_array_equal(inverse, [[1, 0, -2], [0, 1, -4]])
        self.assertEqual(rect, [-2, -4, 160, 160])
        self.assertEqual(size, [160, 160])

    def test_typed_integer_budgets_reject_unsupported_geometry(self):
        bad_rects = (None, [], [0, 0, 1, 160], [0, 0, 160, 0], [32769, 0, 2, 2],
                     [0, -32769, 2, 2], [0, 0, 32769, 2], [0., 0, 2, 2],
                     [True, 0, 2, 2], [0, 0, float("nan"), 2], np.array([0, 0, 2, 2]))
        for rect in bad_rects:
            with self.subTest(rect=rect), self.assertRaises(ValueError):
                crop_matrices(rect=rect, network_size=(160, 160))
        for size in (None, [], (1, 160), (160, 32769), (True, 160), (160., 160), (160,)):
            with self.subTest(size=size), self.assertRaises(ValueError):
                crop_matrices(rect=(0, 0, 160, 160), network_size=size)

    def test_square_decoder_uses_same_inverse_and_rejects_rectangular_crop(self):
        rect = (-71, 123, 319, 319)
        np.testing.assert_array_equal(crop_inverse(rect=rect).view(np.uint32),
            crop_matrices(rect=rect, network_size=(160, 160))[1].view(np.uint32))
        with self.assertRaises(ValueError):
            crop_inverse(rect=(0, 0, 160, 120))


if __name__ == "__main__":
    unittest.main()
