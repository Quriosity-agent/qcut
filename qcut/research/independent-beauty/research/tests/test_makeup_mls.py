from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from makeup_mls import affine_point
from lashes_geometry import validate_template


class MakeupMlsTests(unittest.TestCase):
    def test_affine_reproduction_and_source_immutability(self):
        source = np.array([[0, 0], [8, 0], [8, 6], [0, 6]], np.float32)
        matrix = np.array([[1.2, .3], [-.2, .9]], np.float32)
        offset = np.array([5, -2], np.float32)
        target = source@matrix.T+offset
        saved = source.copy()
        for query in (np.array([2, 3], np.float32), np.array([12, -2], np.float32)):
            result = affine_point(source=source, target=target, query=query)
            np.testing.assert_allclose(result, query@matrix.T+offset, atol=5e-6, rtol=0)
        np.testing.assert_array_equal(source, saved)

    def test_exact_landmark_returns_copy_of_destination(self):
        source = np.array([[0, 0], [8, 0], [0, 6]], np.float32)
        target = source+np.array([3, -2], np.float32)
        result = affine_point(source=source, target=target, query=source[1])
        np.testing.assert_array_equal(result, target[1])
        result[0] = 123
        self.assertNotEqual(result[0], target[1, 0])

    def test_degenerate_nonfinite_and_mismatched_bases_are_rejected(self):
        source = np.array([[0, 0], [8, 0], [0, 6]], np.float32)
        for value, target, query in ((source.astype(np.float64), source, np.array([1, 2], np.float32)),
                (source, source[:-1], np.array([1, 2], np.float32)),
                (source, source, np.array([np.nan, 2], np.float32)),
                (np.array([[0, 0], [2, 0], [4, 0]], np.float32), source, np.array([1, 2], np.float32))):
            with self.assertRaises(ValueError):
                affine_point(source=value, target=target, query=query)
        with self.assertRaises(ValueError):
            validate_template(template=np.ones((87, 2), np.float32))


if __name__ == '__main__':
    unittest.main()
