import copy
import json
import unittest

import numpy as np

from body.portable_pose import evaluate_long_leg


def fixture(*, width=480, height=640):
    pose = np.tile([-1., -1., -1., 0.], (18, 1))
    for joint, x, y in (
        (2, .36, .22), (5, .64, .22),
        (8, .42, .43), (9, .40, .64), (10, .38, .86),
        (11, .58, .43), (12, .60, .64), (13, .62, .86),
    ):
        pose[joint] = [x * width, y * height, .9, 1]
    return {"pose": pose, "perception": {"coarsePeople": 1, "algorithmSize": [width, height]},
            "width": width, "height": height}


class PortableLongLegEligibilityTests(unittest.TestCase):
    def test_complete_rear_body_does_not_require_a_face(self):
        result = evaluate_long_leg(**fixture())
        self.assertTrue(result["eligible"])
        self.assertEqual(result["reasonCode"], "complete-legs")
        self.assertEqual(len(result["points"]["ankles"]), 2)
        self.assertAlmostEqual(result["minimumAnkleY"], .86 * 640)

    def test_missing_shoulders_leave_complete_legs_eligible(self):
        inputs = fixture()
        inputs["pose"][[2, 5]] = [-1, -1, -1, 0]
        result = evaluate_long_leg(**inputs)
        self.assertTrue(result["eligible"])
        self.assertEqual(result["points"]["shoulders"], [])

    def test_both_ankles_missing_rejects_cropped_knee_visible_body(self):
        inputs = fixture()
        inputs["pose"][[10, 13]] = [-1, -1, -1, 0]
        result = evaluate_long_leg(**inputs)
        self.assertFalse(result["eligible"])
        self.assertEqual(result["reasonCode"], "missing-leg-joints")
        self.assertEqual(result["diagnostics"]["missingJoints"], ["rightAnkle", "leftAnkle"])

    def test_every_leg_joint_is_required(self):
        for joint in (8, 9, 10, 11, 12, 13):
            with self.subTest(joint=joint):
                inputs = fixture()
                inputs["pose"][joint, 3] = 0
                self.assertFalse(evaluate_long_leg(**inputs)["eligible"])

    def test_one_occluded_ankle_cannot_reuse_the_other_leg(self):
        inputs = fixture()
        inputs["pose"][10] = [-1, -1, 0, 0]
        self.assertEqual(evaluate_long_leg(**inputs)["reasonCode"], "missing-leg-joints")

    def test_joint_scores_are_heatmap_values_not_capped_probabilities(self):
        inputs = fixture()
        inputs["pose"][8:14, 2] = 1.08
        self.assertTrue(evaluate_long_leg(**inputs)["eligible"])

    def test_low_score_rejects_visible_joint(self):
        inputs = fixture()
        inputs["pose"][12, 2] = .19
        self.assertEqual(evaluate_long_leg(**inputs)["reasonCode"], "low-confidence")
        inputs["pose"][12, 2] = .2
        self.assertTrue(evaluate_long_leg(**inputs)["eligible"])

    def test_exactly_one_person_is_required(self):
        for count in (None, 0, 2, True, 1.0, "1"):
            with self.subTest(count=count):
                inputs = fixture()
                inputs["perception"]["coarsePeople"] = count
                self.assertEqual(evaluate_long_leg(**inputs)["reasonCode"], "ambiguous-person")

    def test_invalid_pose_fails_closed(self):
        for pose in (None, [], [[0, 0, 1, 1]], np.zeros((18, 3)), [["0"] * 4] * 18):
            with self.subTest(shape=np.shape(pose)):
                inputs = fixture()
                inputs["pose"] = pose
                self.assertFalse(evaluate_long_leg(**inputs)["eligible"])

    def test_nonfinite_pose_is_never_reported_as_eligible(self):
        for value in (float("nan"), float("inf"), -float("inf")):
            inputs = fixture()
            inputs["pose"][10, 0] = value
            self.assertEqual(evaluate_long_leg(**inputs)["reasonCode"], "invalid-pose")

    def test_malformed_dimensions_fail_closed(self):
        for width, height in ((0, 640), (-1, 640), (480, float("inf")), (True, 640), ("480", 640)):
            with self.subTest(width=width, height=height):
                inputs = fixture()
                inputs.update(width=width, height=height)
                self.assertFalse(evaluate_long_leg(**inputs)["eligible"])

    def test_missing_algorithm_dimensions_fail_closed(self):
        for size in (None, [], [640], [0, 640], [480, float("nan")]):
            inputs = fixture()
            inputs["perception"]["algorithmSize"] = size
            self.assertFalse(evaluate_long_leg(**inputs)["eligible"])

    def test_incompatible_coordinate_aspect_fails_closed(self):
        inputs = fixture()
        inputs["perception"]["algorithmSize"] = [640, 480]
        self.assertEqual(evaluate_long_leg(**inputs)["reasonCode"], "aspect-mismatch")

    def test_source_scaling_and_algorithm_rounding_are_respected(self):
        inputs = fixture(width=473, height=640)
        inputs.update(width=1136, height=1536)
        result = evaluate_long_leg(**inputs)
        self.assertTrue(result["eligible"])
        np.testing.assert_allclose(result["points"]["ankles"], [[.38 * 1136, .86 * 1536],
                                                                [.62 * 1136, .86 * 1536]])

    def test_portrait_square_landscape_and_resolution_scaling(self):
        for width, height in ((360, 640), (640, 640), (640, 360), (320, 1280), (96, 128)):
            with self.subTest(width=width, height=height):
                inputs = fixture(width=width, height=height)
                self.assertTrue(evaluate_long_leg(**inputs)["eligible"])
                inputs.update(width=width * 2, height=height * 2)
                self.assertTrue(evaluate_long_leg(**inputs)["eligible"])

    def test_frame_bounds_are_strict_at_right_and_bottom(self):
        for joint, axis, value in ((8, 0, -1), (10, 0, 480), (13, 1, 640)):
            inputs = fixture()
            inputs["pose"][joint, axis] = value
            self.assertEqual(evaluate_long_leg(**inputs)["reasonCode"], "outside-photo")

    def test_collapsed_leg_segment_is_rejected(self):
        inputs = fixture()
        inputs["pose"][10, :2] = inputs["pose"][9, :2]
        self.assertEqual(evaluate_long_leg(**inputs)["reasonCode"], "short-segment")

    def test_raised_or_horizontal_shin_is_rejected(self):
        inputs = fixture()
        inputs["pose"][10, :2] = [330, 375]
        self.assertEqual(evaluate_long_leg(**inputs)["reasonCode"], "non-upright-legs")

    def test_moderately_bent_and_crossing_legs_remain_eligible(self):
        inputs = fixture()
        inputs["pose"][9, :2] = [260, 410]
        inputs["pose"][10, :2] = [180, 550]
        inputs["pose"][12, :2] = [215, 410]
        inputs["pose"][13, :2] = [300, 550]
        self.assertTrue(evaluate_long_leg(**inputs)["eligible"])

    def test_implausibly_short_shin_relative_to_thigh_is_rejected(self):
        inputs = fixture()
        inputs["pose"][9, :2] = [195, 500]
        inputs["pose"][10, :2] = [190, 540]
        self.assertEqual(evaluate_long_leg(**inputs)["reasonCode"], "implausible-proportions")

    def test_ankles_against_bottom_edge_do_not_prove_complete_feet(self):
        inputs = fixture()
        inputs["pose"][[10, 13], 1] = 634
        self.assertEqual(evaluate_long_leg(**inputs)["reasonCode"], "cropped-feet")

    def test_input_pose_and_metadata_are_not_mutated(self):
        inputs = fixture()
        before = copy.deepcopy(inputs)
        evaluate_long_leg(**inputs)
        np.testing.assert_array_equal(inputs["pose"], before["pose"])
        self.assertEqual(inputs["perception"], before["perception"])

    def test_diagnostics_are_json_serializable(self):
        for inputs in (fixture(), {**fixture(), "pose": None}):
            result = evaluate_long_leg(**inputs)
            json.dumps(result, allow_nan=False)


if __name__ == "__main__":
    unittest.main()
