import unittest
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from nh_geometry import crop_transform
from nh_assets import validate_mean


class NHGeometryTests(unittest.TestCase):
    def test_identity_fit_preserves_margin_rounding_and_inverse(self):
        points = np.column_stack((np.arange(-53, 53)+.5, np.tile([-.5, .5], 53))).astype(np.float32)
        before = points.copy()
        result = crop_transform(points=points, mean=points)
        scale = np.float32(320)/np.float32(1.8)
        margin_y = np.float32(np.float32(.4)+np.float32(.5))-np.float32(.5)
        np.testing.assert_array_equal(result['forward'], [[scale, 0, np.float32(scale*np.float32(.4))],
            [0, scale, np.float32(scale*margin_y)+np.float32(18.75)]])
        homogeneous = np.vstack((result['forward'], [0, 0, 1]))
        inverse = np.vstack((result['inverse'], [0, 0, 1]))
        np.testing.assert_allclose(homogeneous@inverse, np.eye(3), atol=5e-6)
        np.testing.assert_array_equal(points, before)

    def test_degenerate_and_invalid_inputs_are_rejected(self):
        points = np.zeros((106, 2), np.float32)
        for invalid in (points, points.astype(np.float64), points[:105], points+np.nan):
            with self.assertRaises(ValueError):
                crop_transform(points=invalid, mean=points)
        with self.assertRaises(ValueError):
            validate_mean(mean=points)


if __name__ == '__main__':
    unittest.main()
