from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from features_geometry import (ANCHOR_INDICES, corner_eye_support, eye_support_anchors,
                               mouth_corner_landmarks)


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

    def mouth_coefficients(self):
        values = np.zeros((20, 3), np.float32)
        values[:, 0] = np.arange(84, 104)
        values[:, 1:] = [.1, -.2]
        return {'mouth_corner': values}

    def test_mouth_corners_use_original_eye_axis_and_preserve_input_landmarks(self):
        source, target = self.points(), self.points()
        source[74], source[77] = [10, 10], [110, 20]
        target[74], target[77] = [30, 30], [50, 30]
        original = target.copy()
        result = mouth_corner_landmarks(source=source, target=target, degree=np.float32(-.12),
                                        assets=self.mouth_coefficients())
        expected_bits = np.tile(np.array([3214514585, 3226048921], np.uint32), (20, 1))
        np.testing.assert_array_equal(result[84:104].view(np.uint32), expected_bits)
        np.testing.assert_array_equal(result[:84], original[:84])
        np.testing.assert_array_equal(result[104:], original[104:])
        np.testing.assert_array_equal(target, original)

    def test_mouth_corner_visibility_threshold_is_strict_and_assets_validate(self):
        points = self.points()
        result = mouth_corner_landmarks(source=points, target=points, degree=-.001, assets={})
        np.testing.assert_array_equal(result, points)
        for degree in (True, np.nan, .01, -.121):
            with self.assertRaises(ValueError):
                mouth_corner_landmarks(source=points, target=points, degree=degree,
                                        assets=self.mouth_coefficients())
        coefficients = self.mouth_coefficients()
        coefficients['mouth_corner'][0, 0] = 105
        with self.assertRaises(ValueError):
            mouth_corner_landmarks(source=points, target=points, degree=-.12, assets=coefficients)

    def test_corner_eye_changes_uv_and_spreads_positions_in_a_second_pass(self):
        source = self.points()
        source[74], source[77] = [10, 10], [110, 10]
        positions = np.zeros((78, 2), np.float32)
        positions[[0, 33, 5, 34]] = [[20, 10], [120, 10], [40, 10], [100, 10]]
        uv_pixels = positions.copy()
        original_positions, original_uv = positions.copy(), uv_pixels.copy()
        mesh_assets = {'left_eye_spacing': np.array([5]), 'right_eye_spacing': np.array([34])}
        result, result_uv = corner_eye_support(source=source, positions=positions,
            uv_pixels=uv_pixels, degree=np.float32(-.4), mesh_assets=mesh_assets)
        np.testing.assert_array_equal(result[[5, 34]],
                                      np.array([[41.225, 10], [98.775, 10]], np.float32))
        delta = np.float32(1.75)
        np.testing.assert_array_equal(result_uv[[5, 12, 21, 28], 0],
                                      original_uv[[5, 12, 21, 28], 0] - delta)
        np.testing.assert_array_equal(result_uv[[34, 42, 50, 58], 0],
                                      original_uv[[34, 42, 50, 58], 0] + delta)
        np.testing.assert_array_equal(result_uv[:, 1], original_uv[:, 1])
        np.testing.assert_array_equal(positions, original_positions)
        np.testing.assert_array_equal(uv_pixels, original_uv)

    def test_corner_eye_invalid_data_and_inactive_identity(self):
        positions = np.zeros((78, 2), np.float32)
        result, uv = corner_eye_support(source=self.points(), positions=positions,
            uv_pixels=positions, degree=0, mesh_assets={})
        np.testing.assert_array_equal(result, positions)
        np.testing.assert_array_equal(uv, positions)
        for degree in (True, np.nan, .01, -.401):
            with self.assertRaises(ValueError):
                corner_eye_support(source=self.points(), positions=positions,
                    uv_pixels=positions, degree=degree, mesh_assets={})
        with self.assertRaises(ValueError):
            corner_eye_support(source=self.points().astype(np.float64), positions=positions,
                uv_pixels=positions, degree=0, mesh_assets={})


if __name__ == '__main__':
    unittest.main()
