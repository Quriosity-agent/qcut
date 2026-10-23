"""Background protection has a compact editable region and fails closed."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from body.background import get_person_mask, protect_background, protection_alpha


class BackgroundTests(unittest.TestCase):
    def setUp(self):
        random = np.random.default_rng(734)
        self.original = random.integers(0, 256, (96, 128, 4), dtype=np.uint8)
        self.original[..., 3] = 255
        self.warped = 255 - self.original
        self.warped[..., 3] = 255
        self.mask = np.zeros((96, 128), np.uint8)
        self.mask[16:80, 40:88] = 255
        self.shifted = np.zeros_like(self.mask)
        self.shifted[16:80, 48:96] = 255

    def composite(self, **overrides):
        args = {"original": self.original, "warped": self.warped,
                "source_mask": self.mask, "warped_mask": self.shifted}
        return protect_background(**{**args, **overrides})

    def test_background_is_byte_identical_even_when_warp_changed_every_pixel(self):
        result, report = self.composite()
        alpha, _ = protection_alpha(source_mask=self.mask, warped_mask=self.shifted)
        np.testing.assert_array_equal(result[alpha == 0], self.original[alpha == 0])
        np.testing.assert_array_equal(result[alpha == 255], self.warped[alpha == 255])
        self.assertGreater(np.count_nonzero(result != self.original), 0)
        self.assertEqual(report["changedProtectedPixels"], 0)
        self.assertEqual(report["protectedPixels"], int(np.count_nonzero(alpha == 0)))
        self.assertFalse(report["backgroundReconstruction"])
        self.assertTrue(report["boundaryCorridorMayMove"])

    def test_same_image_stays_identical_including_feathered_pixels(self):
        result, _ = self.composite(warped=self.original.copy())
        np.testing.assert_array_equal(result, self.original)

    def test_source_and_target_silhouettes_are_fully_warped_to_avoid_ghosts(self):
        result, _ = self.composite()
        union = (self.mask > 0) | (self.shifted > 0)
        np.testing.assert_array_equal(result[union], self.warped[union])
        self.assertGreater(np.count_nonzero((self.mask > 0) & (self.shifted == 0)), 0)

    def test_feather_is_bounded_and_preserves_opaque_alpha_without_overflow(self):
        white = np.full_like(self.original, 255)
        black = np.zeros_like(self.original)
        black[..., 3] = 255
        result, report = self.composite(original=white, warped=black)
        alpha, _ = protection_alpha(source_mask=self.mask, warped_mask=self.shifted)
        np.testing.assert_array_equal(result[..., 0], 255 - alpha)
        np.testing.assert_array_equal(result[..., 3], 255)
        self.assertTrue(np.any((alpha > 0) & (alpha < 255)))
        margin = report["dilationPixels"] + report["featherPixels"]
        np.testing.assert_array_equal(alpha[:16 - margin], 0)
        np.testing.assert_array_equal(alpha[80 + margin:], 0)
        np.testing.assert_array_equal(alpha[:, :40 - margin], 0)
        np.testing.assert_array_equal(alpha[:, 96 + margin:], 0)

    def test_inputs_are_not_mutated_and_output_does_not_alias(self):
        before = [value.copy() for value in (self.original, self.warped, self.mask, self.shifted)]
        result, _ = self.composite()
        for actual, expected in zip((self.original, self.warped, self.mask, self.shifted), before):
            np.testing.assert_array_equal(actual, expected)
            self.assertFalse(np.shares_memory(result, actual))

    def test_non_contiguous_inputs_remain_supported(self):
        result, _ = self.composite()
        reversed_result, _ = self.composite(original=self.original[:, ::-1], warped=self.warped[:, ::-1],
                                             source_mask=self.mask[:, ::-1], warped_mask=self.shifted[:, ::-1])
        np.testing.assert_array_equal(reversed_result, result[:, ::-1])

    def test_blank_full_uncertain_and_tiny_masks_fail_closed(self):
        tiny = np.zeros_like(self.mask)
        tiny[20:22, 20:22] = 255
        masks = [np.zeros_like(self.mask), np.full_like(self.mask, 255),
                 np.full_like(self.mask, 128), tiny]
        for key in ("source_mask", "warped_mask"):
            for mask in masks:
                with self.subTest(key=key, mask_max=int(mask.max())):
                    with self.assertRaises(ValueError):
                        self.composite(**{key: mask})

    def test_mask_shape_dtype_and_non_finite_values_are_rejected(self):
        masks = [self.mask.astype(float), np.full(self.mask.shape, np.nan),
                 self.mask[..., None], self.mask[:-1], self.mask.tolist(), None]
        for key in ("source_mask", "warped_mask"):
            for mask in masks:
                with self.subTest(key=key, type=type(mask)):
                    with self.assertRaises(ValueError):
                        self.composite(**{key: mask})

    def test_photo_shape_dtype_alpha_and_size_are_rejected(self):
        transparent = self.original.copy()
        transparent[0, 0, 3] = 254
        photos = [self.original[..., :3], self.original.astype(float), self.original[:-1],
                  self.original[:16], transparent, None]
        for key in ("original", "warped"):
            for photo in photos:
                with self.subTest(key=key, type=type(photo)):
                    with self.assertRaises(ValueError):
                        self.composite(**{key: photo})

    def test_soft_person_boundaries_do_not_expand_to_remote_low_confidence_noise(self):
        mask = self.mask.copy()
        mask[2:8, 2:8] = 15
        alpha, _ = protection_alpha(source_mask=mask, warped_mask=self.shifted)
        np.testing.assert_array_equal(alpha[:8, :8], 0)
        mask[8, 8] = 16
        alpha, _ = protection_alpha(source_mask=mask, warped_mask=self.shifted)
        self.assertEqual(alpha[8, 8], 255)

    def test_segmentation_resize_keeps_top_left_orientation(self):
        small = np.zeros((32, 32), np.uint8)
        small[3:12, 2:10] = 255
        details = {"width": 32, "height": 32, "orientation": "top-left", "framework": "Apple Vision"}

        def fake_run(*, arguments, timeout):
            request = json.loads(Path(arguments[-1]).read_text())
            Path(request["output"]).write_bytes(small.tobytes())
            return json.dumps(details).encode()

        with tempfile.TemporaryDirectory() as temporary:
            with patch("body.background._build_helper", return_value=(Path("/helper"), {})), \
                    patch("body.background._run", side_effect=fake_run):
                mask, report = get_person_mask(rgba=self.original, work=temporary)
        self.assertEqual(mask.shape, self.original.shape[:2])
        self.assertEqual(mask.dtype, np.uint8)
        self.assertGreater(mask[15, 20], 224)
        self.assertEqual(mask[75, 20], 0)
        self.assertFalse(report["downloadedModels"])
        self.assertTrue(report["operatingSystemModel"])

    def test_malformed_segmenter_response_and_wrong_byte_count_fail_closed(self):
        responses = [b"not-json", b"{}", b"[]",
                     json.dumps({"width": True, "height": 32, "orientation": "top-left",
                                 "framework": "Apple Vision"}).encode(),
                     json.dumps({"width": 32, "height": 32, "orientation": "top-left",
                                 "framework": "Apple Vision"}).encode()]

        def fake_run(*, arguments, timeout):
            request = json.loads(Path(arguments[-1]).read_text())
            Path(request["output"]).write_bytes(b"bad")
            return current

        with tempfile.TemporaryDirectory() as temporary:
            with patch("body.background._build_helper", return_value=(Path("/helper"), {})), \
                    patch("body.background._run", side_effect=fake_run):
                for current in responses:
                    with self.subTest(response=current), self.assertRaises(ValueError):
                        get_person_mask(rgba=self.original, work=temporary)

    def test_segmentation_refuses_non_macos_before_running_any_commands(self):
        with tempfile.TemporaryDirectory() as temporary:
            with patch.object(sys, "platform", "linux"), patch("body.background.subprocess.run") as run:
                with self.assertRaisesRegex(ValueError, "requires macOS"):
                    get_person_mask(rgba=self.original, work=temporary)
                run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
