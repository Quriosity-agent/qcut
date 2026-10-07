import unittest
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from iris_solver import solve


class IrisSolverTests(unittest.TestCase):
    def test_two_point_similarity_reprojection_and_input_immutability(self):
        matrix = np.array([[50, 55, 1, 0], [55, -50, 0, 1],
            [68, 58, 1, 0], [58, -68, 0, 1]], np.float32)
        values = np.array([0, 100, 100, 100], np.float32)
        original = matrix.copy()
        result = solve(matrix=matrix, values=values)
        np.testing.assert_allclose(matrix@result, values, atol=.0002)
        np.testing.assert_array_equal(matrix, original)

    def test_identity_system_and_zero_rhs(self):
        identity = np.eye(4, dtype=np.float32)
        values = np.array([-100, 0, 1, 42], np.float32)
        np.testing.assert_array_equal(solve(matrix=identity, values=values), values)
        np.testing.assert_array_equal(solve(matrix=identity, values=values*0), values*0)

    def test_singular_nonfinite_wrong_shape_and_dtype_are_rejected(self):
        values = np.ones(4, np.float32)
        for matrix in (np.zeros((4, 4), np.float32), np.eye(4), np.eye(3, dtype=np.float32),
                       np.eye(4, dtype=np.float32)*np.nan, np.eye(4, dtype=np.float32)*32769):
            with self.assertRaises(ValueError):
                solve(matrix=matrix, values=values)


if __name__ == '__main__':
    unittest.main()
