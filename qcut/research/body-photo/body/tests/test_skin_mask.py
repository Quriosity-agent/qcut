import unittest

import numpy as np
from PIL import Image, ImageDraw

from body.skin_mask import build_skin_mask, lab_to_rgb, normalize_person_mask, rgb_to_lab
from body.tests.test_body_skin import scene


class SkinMaskTests(unittest.TestCase):
    def test_lab_roundtrip_including_dark_skin(self):
        source = np.array([[0, 0, 0], [255, 255, 255], [52, 34, 27], [218, 170, 145]], np.uint8)
        actual = np.rint(lab_to_rgb(lab=rgb_to_lab(rgb=source))).astype(np.uint8)
        np.testing.assert_array_equal(actual, source)

    def test_uint8_float_and_binary_masks_have_same_selection(self):
        data = scene()
        first, _ = build_skin_mask(**data)
        for mask in (data["person_mask"].astype(np.float32) / 255, data["person_mask"] > 0):
            second, _ = build_skin_mask(**{**data, "person_mask": mask})
            np.testing.assert_array_equal(first, second)

    def test_masks_validate_shape_range_and_type(self):
        for mask in (np.ones((3, 4)), np.ones((4, 4), np.int16), np.full((4, 4), -1.),
                     np.full((4, 4), 1.1), np.full((4, 4), np.nan)):
            with self.subTest(dtype=mask.dtype), self.assertRaises(ValueError):
                normalize_person_mask(person_mask=mask, shape=(4, 4))

    def test_invalid_or_aspect_mismatched_pose_unavailable(self):
        for change in ({"pose": None}, {"pose": np.zeros((17, 4))},
                       {"pose": np.full((18, 4), np.nan)}, {"algorithm_size": (192, 512)}):
            mask, diagnostics = build_skin_mask(**{**scene(), **change})
            self.assertEqual(np.count_nonzero(mask), 0)
            self.assertFalse(diagnostics["available"])

    def test_skin_like_background_excluded_by_person_support(self):
        data = scene()
        background = data["person_mask"] == 0
        data["rgba"][background, :3] = [188, 132, 105]
        mask, diagnostics = build_skin_mask(**data)
        self.assertTrue(diagnostics["available"])
        self.assertFalse(np.any(mask[background]))

    def test_no_visible_body_and_no_skin_fail_closed(self):
        for no_pose in (True, False):
            data = scene()
            if no_pose:
                data["pose"][:, 3] = 0
            else:
                data["rgba"][74:, :, :3] = [30, 65, 135]
            mask, diagnostics = build_skin_mask(**data)
            self.assertFalse(diagnostics["available"])
            self.assertEqual(np.count_nonzero(mask), 0)

    def test_small_and_collapsed_face_rejected(self):
        for patch in ({"box": [72, 12, 4, 8]}, {"landmarks": np.full((106, 2), 90)},
                      {"landmarks": np.full((106, 2), np.nan)}):
            data = scene()
            data["faces"].update(patch)
            _, diagnostics = build_skin_mask(**data)
            self.assertFalse(diagnostics["available"])

    def test_raised_arm_above_face_is_not_removed_by_head_protection(self):
        data = scene()
        image, person = Image.fromarray(data["rgba"]), Image.fromarray(data["person_mask"])
        for canvas, fill in ((image, (188, 132, 105, 255)), (person, 255)):
            ImageDraw.Draw(canvas).line([(70, 83), (43, 39), (48, 12)], fill=fill, width=15)
        data.update(rgba=np.array(image), person_mask=np.array(person))
        data["pose"][3, :2], data["pose"][4, :2] = [43, 39], [48, 12]
        mask, diagnostics = build_skin_mask(**data)
        self.assertTrue(diagnostics["available"])
        self.assertGreater(mask[26:36, 44:48].min(), .8)
        self.assertEqual(mask[12:70, 72:120].max(), 0)

    def test_illumination_and_chroma_variation_do_not_create_skin_holes(self):
        data = scene()
        lab = rgb_to_lab(rgb=data["rgba"][..., :3])
        rows, columns = np.mgrid[0:256, 0:192]
        leg = (rows >= 170) & (rows <= 225) & (columns >= 75) & (columns <= 89)
        lab[leg, 0] -= (12 * np.sin(rows[leg] / 5) + 8)
        lab[leg, 1:] *= (1 + .35 * np.sin(rows[leg] / 6))[:, None]
        data["rgba"][..., :3] = np.rint(lab_to_rgb(lab=lab)).astype(np.uint8)
        mask, diagnostics = build_skin_mask(**data)
        self.assertTrue(diagnostics["available"])
        self.assertGreater(mask[174:222, 80:85].min(), .9)

    def test_high_saturation_fabric_with_skin_hue_is_rejected(self):
        data = scene()
        fabric = rgb_to_lab(rgb=np.array([188, 132, 105], np.uint8))
        fabric[1:] *= 2
        data["rgba"][82:156, 74:118, :3] = np.rint(lab_to_rgb(lab=fabric)).astype(np.uint8)
        mask, diagnostics = build_skin_mask(**data)
        self.assertTrue(diagnostics["available"])
        self.assertEqual(np.count_nonzero(mask[84:154, 76:116]), 0)

    def test_hand_support_continues_beyond_wrist_and_fades_at_tip(self):
        data = scene()
        image, person = Image.fromarray(data["rgba"]), Image.fromarray(data["person_mask"])
        for canvas, fill in ((image, (188, 132, 105, 255)), (person, 255)):
            ImageDraw.Draw(canvas).ellipse((44, 148, 60, 184), fill=fill)
        data.update(rgba=np.array(image), person_mask=np.array(person))
        mask, diagnostics = build_skin_mask(**data)
        self.assertTrue(diagnostics["available"])
        self.assertGreater(mask[169, 51], .6)
        self.assertLess(np.max(np.abs(np.diff(mask[160:185, 51]))), .35)
        self.assertEqual(mask[185, 51], 0)

    def test_selection_has_explicit_semantic_limit(self):
        _, diagnostics = build_skin_mask(**scene())
        self.assertIn("fabric", diagnostics["limitation"])
        self.assertIn("not a learned skin segmentation", diagnostics["limitation"])


if __name__ == "__main__":
    unittest.main()
