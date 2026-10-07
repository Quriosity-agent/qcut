from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from features_geometry import ANCHOR_INDICES, eye_support_anchors


class FeaturesGeometryTests(unittest.TestCase):
    def points(self):
        points = np.zeros((106, 2), np.float32)
        points[74], points[77] = [30, 60], [70, 120]
        points[list(ANCHOR_INDICES[:5])] = [10, 20]
        points[list(ANCHOR_INDICES[5:])] = [50, 80]
        return points

    def test_upward_endpoint_changes_support_and_preserves_float32_rounding(self):
        actual = eye_support_anchors(points=self.points(), height_degree=np.float32(-.3))
        expected_bits = [[1093622825, 1102011433], [1093622825, 1102011433],
            [1093622825, 1102011433], [1093522161, 1101910769], [1093220172, 1101608780],
            [1112165843, 1117933011], [1112241340, 1118008508], [1112266506, 1118033674],
            [1112266506, 1118033674], [1112266506, 1118033674]]
        np.testing.assert_array_equal(actual.view(np.uint32), np.asarray(expected_bits, np.uint32))
        self.assertLess(actual[0, 0], 11)

    def test_zero_and_downward_height_keep_base_support(self):
        for degree in (0, np.float32(.3)):
            actual = eye_support_anchors(points=self.points(), height_degree=degree)
            np.testing.assert_array_equal(actual[[0, 3, 4, 5, 6, 9]],
                np.array([[16, 32], [15.4, 30.8], [13.6, 27.2],
                          [53.6, 87.2], [55.4, 90.8], [56, 92]], np.float32))

    def test_original_landmarks_unchanged(self):
        points = self.points()
        original = points.copy()
        eye_support_anchors(points=points, height_degree=np.float32(-.3))
        np.testing.assert_array_equal(points, original)

    def test_bad_landmarks_and_degrees_rejected(self):
        for degree in (True, '0', np.nan, np.inf, -.31, .31):
            with self.assertRaises(ValueError):
                eye_support_anchors(points=self.points(), height_degree=degree)
        for points in (self.points().astype(np.float64), self.points()[:105], np.full((106, 2), np.nan, np.float32)):
            with self.assertRaises(ValueError):
                eye_support_anchors(points=points, height_degree=0)


if __name__ == '__main__':
    unittest.main()
