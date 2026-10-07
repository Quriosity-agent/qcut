import sys
from pathlib import Path
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from makeup_geometry import original_pixels, spline


class MakeupGeometryTests(unittest.TestCase):
    def test_straight_spline_and_control_points(self):
        points = np.array([[0, 0], [2, 0], [4, 0], [6, 0]], np.float32)
        result = spline(points=points, counts=np.array([4, 4, 4], np.int32))
        np.testing.assert_array_equal(result[::4], points)
        np.testing.assert_allclose(result[:, 0], np.arange(13)*.5, atol=1e-6)
        np.testing.assert_array_equal(result[:, 1], 0)

    def test_nonuniform_curve_translation_and_source_immutability(self):
        points = np.array([[0, 0], [1, 3], [8, 2], [9, 5]], np.float32)
        original = points.copy()
        counts = np.array([3, 2, 4], np.int32)
        result = spline(points=points, counts=counts)
        translated = spline(points=points+np.array([2, -1], np.float32), counts=counts)
        np.testing.assert_allclose(translated, result+[2, -1], atol=2e-6)
        np.testing.assert_array_equal(points, original)
        np.testing.assert_array_equal(result[np.r_[0, np.cumsum(counts)]], points)

    def test_rejects_degenerate_and_malformed_splines(self):
        points = np.array([[0, 0], [1, 1], [2, 0]], np.float32)
        for counts in (np.array([0, 2]), np.array([1.5, 2]), np.array([1, 17]), np.array([1])):
            with self.assertRaises(ValueError):
                spline(points=points, counts=counts)
        with self.assertRaises(ValueError):
            spline(points=points.astype(np.float64), counts=np.array([2, 2]))
        with self.assertRaises(ValueError):
            spline(points=np.zeros((3, 2), np.float32), counts=np.array([2, 2]))

    def test_original_mapping_preserves_native_y_rounding(self):
        points = np.tile(np.array([[50, 75]], np.float32), (240, 1))
        result = original_pixels(points=points, algorithm_size=(100, 150), image_size=(400, 600))
        np.testing.assert_array_equal(result, np.tile([[200, 300]], (240, 1)))
        np.testing.assert_array_equal(points[0], [50, 75])

    def test_mapping_rejects_nonfinite_points_and_bad_sizes(self):
        points = np.ones((240, 2), np.float32)
        for size in ((0, 150), (True, 150), (100.5, 150), (100, 5000), [1]):
            with self.assertRaises(ValueError):
                original_pixels(points=points, algorithm_size=size, image_size=(400, 600))
        points[0, 0] = np.nan
        with self.assertRaises(ValueError):
            original_pixels(points=points, algorithm_size=(100, 150), image_size=(400, 600))


if __name__ == '__main__':
    unittest.main()
