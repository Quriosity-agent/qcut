"""Check actual old-outline removal as well as the distant-background invariant."""
import hashlib
import unittest

import numpy as np

from body.background import protect_background as legacy_protect
from body.portable_background import _dilate, protect_background, protection_alpha


class PortableBackgroundTests(unittest.TestCase):
    def setUp(self):
        self.shape = (384, 512)
        self.background = np.full((*self.shape, 4), [225, 230, 235, 255], dtype=np.uint8)
        self.original = self.background.copy()
        self.original[80:300, 140:220] = [31, 42, 53, 255]
        self.mask = np.zeros(self.shape, np.uint8)
        self.mask[88:292, 148:212] = 255

    def composite(self, *, target_box=(172, 80, 252, 300), target_mask_box=(180, 88, 244, 292)):
        target = self.background.copy()
        left, top, right, bottom = target_box
        target[top:bottom, left:right] = [31, 42, 53, 255]
        mask = np.zeros(self.shape, np.uint8)
        left, top, right, bottom = target_mask_box
        mask[top:bottom, left:right] = 255
        result, report = protect_background(original=self.original, warped=target,
            source_mask=self.mask, warped_mask=mask)
        return result, target, mask, report

    def test_translated_subject_with_undersegmented_edges_leaves_no_old_outline(self):
        result, target, mask, report = self.composite()
        legacy, _ = legacy_protect(original=self.original, warped=target,
            source_mask=self.mask, warped_mask=mask)
        old_person = np.any(self.original != self.background, axis=-1)
        vacated = old_person & np.all(target == self.background, axis=-1)
        self.assertGreater(np.count_nonzero(np.any(legacy[vacated] != target[vacated], axis=-1)), 0)
        np.testing.assert_array_equal(result[vacated], target[vacated])
        np.testing.assert_array_equal(result, target)
        self.assertFalse(report["backgroundReconstruction"])

    def test_shrunken_subject_does_not_restore_its_larger_original_outline(self):
        result, target, _, _ = self.composite(target_box=(155, 110, 205, 270),
                                              target_mask_box=(162, 118, 198, 262))
        np.testing.assert_array_equal(result, target)

    def test_every_pixel_outside_bounded_corridor_remains_exact_even_if_warp_changes_it(self):
        _, _, mask, _ = self.composite()
        random = np.random.default_rng(42)
        target = random.integers(0, 256, self.original.shape, dtype=np.uint8)
        target[..., 3] = 255
        result, report = protect_background(original=self.original, warped=target,
            source_mask=self.mask, warped_mask=mask)
        alpha, _ = protection_alpha(source_mask=self.mask, warped_mask=mask)
        np.testing.assert_array_equal(result[alpha == 0], self.original[alpha == 0])
        np.testing.assert_array_equal(result[alpha == 255], target[alpha == 255])
        self.assertEqual(report["changedProtectedPixels"], 0)
        self.assertEqual(report["protectedPixels"], int(np.count_nonzero(alpha == 0)))
        self.assertEqual(report["blendMaskSha256"], hashlib.sha256(alpha.tobytes()).hexdigest())
        self.assertLess(report["editablePixels"], self.mask.size // 3)
        self.assertTrue(np.any((alpha > 0) & (alpha < 255)))

    def test_corridor_is_resolution_aware_bounded_and_has_no_distant_feather(self):
        _, _, shifted, _ = self.composite()
        alpha, report = protection_alpha(source_mask=self.mask, warped_mask=shifted)
        self.assertEqual(report["fullWarpMarginPixels"], 8)
        bound = report["maxBoundaryCorridorPixels"]
        support = (self.mask >= 16) | (shifted >= 16)
        outer = _dilate(support=support, radius=bound)
        np.testing.assert_array_equal(alpha[~outer], 0)
        large = np.repeat(np.repeat(self.mask, 4, axis=0), 4, axis=1)
        _, large_report = protection_alpha(source_mask=large, warped_mask=large)
        self.assertEqual(large_report["fullWarpMarginPixels"], 32)

    def test_separable_dilation_matches_brute_force_including_border_and_zero_radius(self):
        support = np.zeros((9, 13), bool)
        support[0, 0] = support[4, 6] = support[8, 12] = True
        for radius in (0, 1, 3, 20):
            expected = np.zeros_like(support)
            for y, x in zip(*np.nonzero(support)):
                expected[max(0, y-radius):y+radius+1, max(0, x-radius):x+radius+1] = True
            np.testing.assert_array_equal(_dilate(support=support, radius=radius), expected)

    def test_inputs_are_unchanged_noncontiguous_views_work_and_identity_is_exact(self):
        result, target, mask, _ = self.composite()
        before = [value.copy() for value in (self.original, target, self.mask, mask)]
        flipped, _ = protect_background(original=self.original[:, ::-1], warped=target[:, ::-1],
            source_mask=self.mask[:, ::-1], warped_mask=mask[:, ::-1])
        np.testing.assert_array_equal(flipped[:, ::-1], result)
        identity, _ = protect_background(original=self.original, warped=self.original,
            source_mask=self.mask, warped_mask=self.mask)
        np.testing.assert_array_equal(identity, self.original)
        for value, saved in zip((self.original, target, self.mask, mask), before):
            np.testing.assert_array_equal(value, saved)
            self.assertFalse(np.shares_memory(result, value))
        self.assertTrue(np.all(result[..., 3] == 255))

    def test_invalid_photo_and_masks_fail_closed(self):
        _, target, mask, _ = self.composite()
        valid = dict(original=self.original, warped=target, source_mask=self.mask, warped_mask=mask)
        for name in ("source_mask", "warped_mask"):
            for bad in (None, self.mask[:-1], self.mask.astype(float), np.zeros_like(self.mask),
                        np.full_like(self.mask, 255)):
                with self.subTest(name=name, type=type(bad)), self.assertRaises(ValueError):
                    protect_background(**{**valid, name: bad})
        invalid = target.copy()
        invalid[10, 10, 3] = 254
        for bad in (None, invalid, target.astype(float), target[:-1]):
            with self.subTest(photo=type(bad)), self.assertRaises(ValueError):
                protect_background(**{**valid, "warped": bad})

    def test_protection_refuses_a_mask_with_no_distant_background_left(self):
        mask = np.full((32, 32), 255, np.uint8)
        mask[12:20, 12:20] = 0
        with self.assertRaisesRegex(ValueError, "insufficient distant background"):
            protection_alpha(source_mask=mask, warped_mask=mask)


if __name__ == "__main__":
    unittest.main()
