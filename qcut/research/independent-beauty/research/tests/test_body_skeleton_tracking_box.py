"""Synthetic coverage for the default native tracker recovery crop."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from body_skeleton_decode import next_body_box, tracking_body_box


def compact_pose(*, missing=()):
    points = [[100 + i * 4, 200 + (i % 3) * 10, .9, 1] for i in range(18)]
    points[1][1] = 260
    for index in missing:
        points[index] = [-1, -1, -1., 0]
    return points


class TrackingCropRecovery(unittest.TestCase):
    def test_visible_limbs_keep_base_joint_bounds(self):
        self.assertEqual(tracking_body_box(compact_pose(), (360, 640)), [86, 187, 96, 86])

    def test_missing_both_ankles_expands_lower_crop(self):
        points = compact_pose(missing=(10, 13))
        self.assertEqual(next_body_box(points, (360, 640)), [86, 187, 96, 86])
        self.assertEqual(tracking_body_box(points, (360, 640)), [86, 187, 96, 137])

    def test_one_visible_ankle_does_not_expand_lower_crop(self):
        for missing in ((10,), (13,)):
            with self.subTest(missing=missing):
                self.assertEqual(tracking_body_box(compact_pose(missing=missing), (360, 640)),
                                 [86, 187, 96, 86])

    def test_either_missing_knee_recovers_top_using_nose_and_neck(self):
        for missing in ((9,), (12,), (9, 12)):
            with self.subTest(missing=missing):
                self.assertEqual(tracking_body_box(compact_pose(missing=missing), (360, 640)),
                                 [86, 140, 96, 133])

    def test_missing_nose_prevents_top_recovery(self):
        self.assertEqual(tracking_body_box(compact_pose(missing=(0, 9)), (360, 640)),
                         [91, 187, 91, 86])

    def test_recovery_clamps_to_image_and_preserves_input(self):
        points = compact_pose(missing=(9, 10, 12, 13))
        original = [point[:] for point in points]
        self.assertEqual(tracking_body_box(points, (360, 300)), [86, 140, 96, 160])
        self.assertEqual(points, original)

    def test_recovery_top_is_clamped_at_zero(self):
        points = compact_pose(missing=(9,))
        points[1][1] = 500
        self.assertEqual(tracking_body_box(points, (360, 640))[1], 0)

    def test_missing_and_degenerate_tracks_still_reject(self):
        self.assertIsNone(tracking_body_box([[-1, -1, -1., 0]] * 18, (360, 640)))
        self.assertIsNone(tracking_body_box(compact_pose(missing=(1, 9)), (360, 640)))


if __name__ == '__main__':
    unittest.main()
