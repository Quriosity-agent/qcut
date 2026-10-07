from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from consumer_points import total_face_points


class ConsumerPointsTests(unittest.TestCase):
    def test_image_boundaries_and_anisotropic_original_size(self):
        points = np.zeros((106, 2), np.float32)
        points[1] = [50, 100]
        points[2] = [100, 200]
        result = total_face_points(points=points, algorithm_size=(100, 200), original_size=(300, 400))
        np.testing.assert_array_equal(result[:3], [[0, 0], [150, 200], [300, 400]])
        self.assertEqual(result.dtype, np.float32)
        self.assertFalse(np.shares_memory(result, points))

    def test_list_dimensions_match_tuple_dimensions(self):
        points = np.full((106, 2), 20, np.float32)
        listed = total_face_points(points=points, algorithm_size=[100, 200], original_size=[300, 400])
        paired = total_face_points(points=points, algorithm_size=(100, 200), original_size=(300, 400))
        np.testing.assert_array_equal(listed, paired)

    def test_normalized_roundtrip_float_bits(self):
        points = np.full((106, 2), np.float32(123.4567))
        result = total_face_points(points=points, algorithm_size=(426, 640), original_size=(853, 1280))
        np.testing.assert_array_equal(result[0].view(np.uint32), [1131885573, 1131866584])
        direct = points * np.array([853 / 426, 2], np.float32)
        self.assertFalse(np.array_equal(result, direct))

    def test_outside_image_nonfinite_wrong_shape_and_wrong_dtype_reject(self):
        valid = np.ones((106, 2), np.float32)
        bad_values = [valid.astype(np.float64), valid[:105], valid.reshape(212)]
        for value in (-1, 101, np.nan, np.inf):
            modified = valid.copy()
            modified[0, 0] = value
            bad_values.append(modified)
        for points in bad_values:
            with self.subTest(shape=points.shape), self.assertRaises(ValueError):
                total_face_points(points=points, algorithm_size=(100, 200), original_size=(300, 400))

    def test_bad_dimensions_reject(self):
        for dimensions in ((0, 1), (1, 4097), (1.0, 2), (True, 2), (1,), np.array([1, 2])):
            for key in ("algorithm_size", "original_size"):
                kwargs = {"points": np.ones((106, 2), np.float32), "algorithm_size": (100, 200), "original_size": (300, 400)}
                kwargs[key] = dimensions
                with self.subTest(key=key, dimensions=dimensions), self.assertRaises(ValueError):
                    total_face_points(**kwargs)


if __name__ == "__main__":
    unittest.main()
