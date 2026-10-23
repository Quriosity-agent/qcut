import copy
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

from body.glute_detection import _mesh_safe, detect_glute_contours
from body.portable_leg import _areas
from body.glute_lift import build_glute_delta


def _fixture(*, view="side-left", scale=1):
    width, height = 400, 600
    rgba = np.full((height, width, 4), 255, dtype=np.uint8)
    mask = np.zeros((height, width), dtype=np.uint8)
    rows = np.arange(height)
    if view == "rear":
        knots = [0, 120, 220, 250, 290, 320, 350, 380, 599]
        left = np.interp(rows, knots, [190, 140, 155, 150, 135, 130, 140, 150, 160])
        right = 400 - left
    else:
        knots = [0, 120, 220, 250, 290, 310, 340, 365, 599]
        left = np.interp(rows, knots, [200, 185, 190, 185, 150, 148, 170, 183, 180])
        right = np.interp(rows, knots, [220, 240, 245, 245, 240, 235, 232, 230, 225])
    for y in range(70, 590):
        mask[y, round(left[y]):round(right[y]) + 1] = 255
        rgba[y, mask[y] != 0, :3] = [140, 150, 160]
    if view == "rear":
        for y in range(346, 354):
            rgba[y, 150:190, :3] = [80, 90, 100]
            rgba[y, 210:250, :3] = [80, 90, 100]
    pose = np.zeros((18, 4), dtype=float)
    pose[:, 2:] = [1., 1.]
    pose[:, :2] = [200, 100]
    if view == "rear":
        pose[[2, 5, 8, 11], :2] = [[250, 150], [150, 150], [230, 290], [170, 290]]
    else:
        pose[[2, 5, 8, 11], :2] = [[205, 150], [220, 150], [210, 290], [214, 290]]
    pose[[3, 4, 6, 7], :2] = [[170, 100], [170, 75], [230, 100], [230, 75]]
    if view == "side-right":
        rgba, mask = rgba[:, ::-1].copy(), mask[:, ::-1].copy()
        pose[:, 0] = width - 1 - pose[:, 0]
    if scale != 1:
        rgba = np.asarray(Image.fromarray(rgba).resize((round(width * scale), round(height * scale)), Image.Resampling.NEAREST))
        mask = np.asarray(Image.fromarray(mask).resize((round(width * scale), round(height * scale)), Image.Resampling.NEAREST))
    return {"rgba": rgba, "person_mask": mask, "pose": pose, "algorithm_size": [width, height]}


class GluteDetectionTests(unittest.TestCase):
    def test_detects_observed_side_bulge_and_lower_turn(self):
        result = detect_glute_contours(**_fixture())
        self.assertTrue(result["available"], result)
        self.assertEqual(result["selection"]["view"], "side-left")
        anchor = result["selection"]["anchors"][0]
        self.assertLess(anchor["peak"][0], anchor["fold"][0])
        self.assertGreater(anchor["fold"][1], anchor["peak"][1])
        self.assertTrue(result["diagnostics"]["fullStrengthMeshValidated"])
        self.assertFalse(result["diagnostics"]["anatomicalGroundTruth"])
        self.assertFalse(result["diagnostics"]["trainedGluteLandmarkModel"])

    def test_mirrored_side_uses_opposite_visible_contour(self):
        left = detect_glute_contours(**_fixture())
        right = detect_glute_contours(**_fixture(view="side-right"))
        self.assertTrue(right["available"], right)
        self.assertEqual(right["selection"]["view"], "side-right")
        for key in ("peak", "fold"):
            np.testing.assert_allclose(right["selection"]["anchors"][0][key],
                [1 - left["selection"]["anchors"][0][key][0], left["selection"]["anchors"][0][key][1]], atol=.01)

    def test_rear_requires_observed_lower_garment_transition(self):
        photo = _fixture(view="rear")
        result = detect_glute_contours(**photo)
        self.assertTrue(result["available"], result)
        self.assertEqual(result["selection"]["view"], "rear")
        self.assertEqual(len(result["diagnostics"]["anchorConfidence"]), 2)
        self.assertLess(result["selection"]["anchors"][0]["peak"][0], result["selection"]["anchors"][1]["peak"][0])
        photo["rgba"][photo["person_mask"] != 0, :3] = [140, 150, 160]
        self.assertFalse(detect_glute_contours(**photo)["available"])

    def test_front_facing_pose_does_not_become_a_rear_fold(self):
        photo = _fixture(view="rear")
        photo["pose"][[2, 5]] = photo["pose"][[5, 2]]
        photo["pose"][[8, 11]] = photo["pose"][[11, 8]]
        result = detect_glute_contours(**photo)
        self.assertFalse(result["available"])
        self.assertIn("front-facing", result["reason"])

    def test_missing_or_uncertain_pose_falls_back_to_manual(self):
        for value in (None, np.empty((0,)), np.zeros((18, 4))):
            with self.subTest(value=str(value)):
                photo = _fixture()
                photo["pose"] = value
                result = detect_glute_contours(**photo)
                self.assertFalse(result["available"])
                self.assertIsNone(result["selection"])

    def test_no_pose_coordinates_invented_for_crop(self):
        photo = _fixture()
        photo["rgba"], photo["person_mask"] = photo["rgba"][:340], photo["person_mask"][:340]
        photo["algorithm_size"] = [400, 340]
        result = detect_glute_contours(**photo)
        self.assertFalse(result["available"])
        self.assertIn("cropped", result["reason"])

    def test_hand_on_contour_prevents_automatic_warp(self):
        photo = _fixture()
        selected = detect_glute_contours(**photo)["selection"]["anchors"][0]
        photo["pose"][4, :2] = np.asarray(selected["fold"]) * [400, 600]
        result = detect_glute_contours(**photo)
        self.assertFalse(result["available"])
        self.assertIn("hand overlaps", result["reason"])
        self.assertIn("candidateSelection", result)

    def test_forearm_crossing_visible_contour_requires_correction(self):
        photo = _fixture()
        anchor = detect_glute_contours(**photo)["selection"]["anchors"][0]
        point = (np.asarray(anchor["peak"]) + np.asarray(anchor["fold"])) / 2 * [400, 600]
        photo["pose"][3, :2] = point + [-65, 0]
        photo["pose"][4, :2] = point + [65, 0]
        self.assertFalse(detect_glute_contours(**photo)["available"])

    def test_scaling_preserves_normalized_source_selection(self):
        reference = detect_glute_contours(**_fixture())
        for scale in (.75, 1.5, 2.):
            with self.subTest(scale=scale):
                result = detect_glute_contours(**_fixture(scale=scale))
                self.assertTrue(result["available"], result)
                for name in ("peak", "fold"):
                    np.testing.assert_allclose(result["selection"]["anchors"][0][name],
                        reference["selection"]["anchors"][0][name], atol=.012)

    def test_source_pixels_pose_and_mask_unchanged(self):
        photo = _fixture(view="rear")
        original = copy.deepcopy(photo)
        detect_glute_contours(**photo)
        for key in ("rgba", "person_mask", "pose"):
            np.testing.assert_array_equal(photo[key], original[key])

    def test_zero_reset_and_full_strength_grid_keep_safe_triangles(self):
        for view in ("rear", "side-left", "side-right"):
            with self.subTest(view=view):
                result = detect_glute_contours(**_fixture(view=view))
                self.assertTrue(result["available"], result)
                x, y = np.meshgrid(np.linspace(0, 400, 81), np.linspace(0, 600, 81))
                base = np.stack((x, y), axis=-1)
                zero, _ = build_glute_delta(base=base, width=400, height=600, intensity=0, selection=result["selection"])
                np.testing.assert_array_equal(zero, np.zeros_like(zero))
                delta, detail = build_glute_delta(base=base, width=400, height=600, intensity=100, selection=result["selection"])
                self.assertTrue(detail["moved"])
                self.assertTrue(np.isfinite(delta).all())
                np.testing.assert_array_equal(delta[0], 0)
                np.testing.assert_array_equal(delta[-1], 0)

    def test_mesh_safety_uses_renderer_diagonal_and_signed_area_ratios(self):
        x, y = np.meshgrid(np.linspace(0, 400, 81), np.linspace(0, 600, 81))
        base = np.stack((x, y), axis=-1)
        cells = np.arange(80)[:, None] * 81 + np.arange(80)[None, :]
        actual_triangles = np.stack((np.stack((cells, cells + 81, cells + 82), axis=-1),
                                    np.stack((cells, cells + 82, cells + 1), axis=-1)), axis=-2).reshape(-1, 3)
        opposite_triangles = np.stack((np.stack((cells, cells + 1, cells + 81), axis=-1),
                                      np.stack((cells + 82, cells + 81, cells + 1), axis=-1)), axis=-2).reshape(-1, 3)
        reference = _areas(positions=base, triangles=actual_triangles)
        self.assertTrue(np.all(reference < 0))
        delta = np.zeros_like(base)
        delta[0, 1] = [-4, 6]
        actual_ratios = _areas(positions=base + delta, triangles=actual_triangles) / reference
        opposite_ratios = (_areas(positions=base + delta, triangles=opposite_triangles)
                           / _areas(positions=base, triangles=opposite_triangles))
        self.assertLess(float(actual_ratios.min()), 0)
        self.assertGreater(float(opposite_ratios.min()), .15)
        with patch("body.glute_detection.build_glute_delta", return_value=(delta, {"maxMeshShiftPixelsBeforeCombinedSafety": 8.})):
            with self.assertRaisesRegex(ValueError, "safe full-strength mesh"):
                _mesh_safe(selection={}, width=400, height=600)
        delta[:] = 0
        delta[0, 0] = [4, 6]
        ratios = _areas(positions=base + delta, triangles=actual_triangles) / reference
        self.assertGreater(float(ratios.min()), .15)
        with patch("body.glute_detection.build_glute_delta", return_value=(delta, {"maxMeshShiftPixelsBeforeCombinedSafety": 8.})):
            detail = _mesh_safe(selection={}, width=400, height=600)
        self.assertAlmostEqual(detail["minimumTriangleAreaRatio"], float(ratios.min()))
        self.assertEqual(detail["triangleDiagonal"], "a-c-d/a-d-b")

    def test_ambiguous_and_incomplete_masks_fail_closed(self):
        for mask in (np.zeros((600, 400), dtype=np.uint8), np.full((600, 400), 255, dtype=np.uint8)):
            photo = _fixture()
            photo["person_mask"] = mask
            self.assertFalse(detect_glute_contours(**photo)["available"])
        photo = _fixture()
        photo["person_mask"][320:324] = 0
        self.assertFalse(detect_glute_contours(**photo)["available"])

    def test_transparent_photo_needs_manual_selection(self):
        photo = _fixture()
        photo["rgba"][0, 0, 3] = 0
        self.assertFalse(detect_glute_contours(**photo)["available"])

    def test_invalid_mask_and_source_raise_clear_errors(self):
        for key, value in (("person_mask", np.zeros((20, 20), dtype=np.uint8)),
                           ("person_mask", np.full((600, 400), np.nan)),
                           ("rgba", np.zeros((600, 400, 3), dtype=np.uint8))):
            with self.subTest(key=key):
                photo = _fixture()
                photo[key] = value
                with self.assertRaises(ValueError):
                    detect_glute_contours(**photo)

    def test_straight_silhouette_is_not_a_side_buttock(self):
        photo = _fixture()
        photo["person_mask"][:] = 0
        photo["person_mask"][:, 170:240] = 255
        self.assertFalse(detect_glute_contours(**photo)["available"])

    def test_ambiguous_torso_order_requires_manual(self):
        photo = _fixture(view="rear")
        photo["pose"][[8, 11]] = photo["pose"][[11, 8]]
        result = detect_glute_contours(**photo)
        self.assertFalse(result["available"])
        self.assertIn("ambiguous", result["reason"])


if __name__ == "__main__":
    unittest.main()
