"""Detection association uses the native inclusive rectangle score and ordering."""
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from body_face_matching import nearest_detection, overlap, tracked_rectangle


class DetectionMatching(unittest.TestCase):
    def test_exact_threshold_does_not_match(self):
        retained, detection = [0, 0, 12, 9], [7, 0, 12, 9]
        self.assertEqual(overlap(first=retained, second=detection), np.float32(.3))
        self.assertEqual(nearest_detection(retained=retained, detections=[detection], capacity=5), -1)
        self.assertEqual(nearest_detection(retained=retained, detections=[[6.99999, 0, 12, 9]], capacity=5), 0)
        self.assertEqual(nearest_detection(retained=retained, detections=[[7.00001, 0, 12, 9]], capacity=5), -1)

    def test_inclusive_edges_can_overlap_when_geometric_edges_only_touch(self):
        score = overlap(first=[1, 1, 1, 1], second=[2, 1, 1, 1])
        self.assertEqual(score, np.float32(1 / 3))
        self.assertEqual(nearest_detection(retained=[1, 1, 1, 1], detections=[[2, 1, 1, 1]], capacity=5), 0)

    def test_equal_scores_keep_the_first_candidate(self):
        self.assertEqual(nearest_detection(retained=[20, 20, 30, 40],
                         detections=[[22, 20, 30, 40], [22, 20, 30, 40]], capacity=5), 0)
        self.assertEqual(nearest_detection(retained=[20, 20, 30, 40],
                         detections=[[22, 20, 30, 40], [20, 20, 30, 40]], capacity=5), 1)

    def test_candidates_beyond_capacity_are_not_considered(self):
        boxes = [[80, 80, 10, 10]] * 5 + [[20, 20, 30, 40]]
        self.assertEqual(nearest_detection(retained=[20, 20, 30, 40], detections=boxes, capacity=5), -1)
        self.assertEqual(nearest_detection(retained=[20, 20, 30, 40], detections=boxes, capacity=6), 5)
        self.assertEqual(nearest_detection(retained=[20, 20, 30, 40], detections=boxes, capacity=0), -1)
        self.assertEqual(nearest_detection(retained=[20, 20, 30, 40],
                         detections=np.empty((0, 4), np.float32), capacity=5), -1)

    def test_zero_rectangle_has_no_association(self):
        self.assertEqual(overlap(first=[0, 0, 0, 0], second=[0, 0, 10, 10]), np.float32(0))

    def test_invalid_geometry_and_capacity_are_rejected(self):
        for box in ([0, 0, -1, 1], [0, 0, np.nan, 1], [0, 0, 40000, 1]):
            with self.subTest(box=box), self.assertRaises(ValueError):
                overlap(first=box, second=[0, 0, 1, 1])
        for capacity in (-1, 73, 1.0, True):
            with self.subTest(capacity=capacity), self.assertRaises(ValueError):
                nearest_detection(retained=[0, 0, 1, 1], detections=[[0, 0, 1, 1]], capacity=capacity)


class TrackingRectangle(unittest.TestCase):
    def test_fractional_origin_survives_truncated_extent_and_image_clamp(self):
        points = np.tile(np.asarray([4, 8], np.float32), (106, 1))
        points[0], points[1] = [-2.75, 2.25], [20.5, 51.9]
        np.testing.assert_array_equal(tracked_rectangle(points=points, size=(13, 48)),
                                      np.asarray([0, 2.25, 13, 45.75], np.float32))
        points[0], points[1] = [1.75, 2.25], [20.5, 51.9]
        np.testing.assert_array_equal(tracked_rectangle(points=points, size=(100, 100)),
                                      np.asarray([1.75, 2.25, 18, 49], np.float32))

    def test_points_outside_the_image_produce_a_clamped_empty_rectangle(self):
        points = np.tile(np.asarray([125.5, 103.25], np.float32), (106, 1))
        np.testing.assert_array_equal(tracked_rectangle(points=points, size=(100, 100)), [100, 100, 0, 0])

    def test_invalid_points_or_dimensions_are_rejected(self):
        valid = np.zeros((106, 2), np.float32)
        for points, size in ((valid[:105], (100, 100)), (np.full_like(valid, np.inf), (100, 100)),
                             (valid, (0, 100)), (valid, (100.0, 100)), (valid, (100, True))):
            with self.subTest(size=size), self.assertRaises(ValueError):
                tracked_rectangle(points=points, size=size)


if __name__ == '__main__':
    unittest.main()
