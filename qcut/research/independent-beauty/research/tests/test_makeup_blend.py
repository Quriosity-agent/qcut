import os
import sys
from pathlib import Path
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from makeup_blend import MODES, compose
from render_resolution import RESOLUTION_ENV, frame_byte_limit


class MakeupBlendTests(unittest.TestCase):
    def test_transparent_pigment_and_zero_controls_preserve_source(self):
        base = np.array([[.1, .2, .3, .5]], np.float32)
        pigment = np.zeros_like(base)
        for mode in MODES:
            np.testing.assert_array_equal(compose(base=base, pigment=pigment, strength=1, mode=mode), base)
            np.testing.assert_array_equal(compose(base=base, pigment=base, strength=0, mode=mode), base)
            np.testing.assert_array_equal(compose(base=base, pigment=base, strength=1, opacity=0, mode=mode), base)

    def test_normal_half_opaque_pigment(self):
        base = np.array([[0, 0, 1, 1]], np.float32)
        pigment = np.array([[1, 0, 0, 1]], np.float32)
        np.testing.assert_array_equal(compose(base=base, pigment=pigment, strength=.5, mode="normal"), [[.5, 0, .5, 1]])

    def test_screen_and_multiply_endpoints(self):
        base = np.array([[.2, .4, .6, 1]], np.float32)
        white, black = np.ones_like(base), np.array([[0, 0, 0, 1]], np.float32)
        np.testing.assert_array_equal(compose(base=base, pigment=white, strength=1, mode="multiply"), base)
        np.testing.assert_array_equal(compose(base=base, pigment=black, strength=1, mode="multiply"), black)
        np.testing.assert_array_equal(compose(base=base, pigment=white, strength=1, mode="screen"), white)
        np.testing.assert_allclose(compose(base=base, pigment=black, strength=1, mode="screen"), base, atol=1e-7)

    def test_color_preserves_base_lightness(self):
        base = np.array([[.2, .4, .6, 1], [.1, .8, .2, 1], [0, 0, 0, 1]], np.float32)
        pigment = np.tile(np.array([[.8, .1, .3, 1]], np.float32), (3, 1))
        result = compose(base=base, pigment=pigment, strength=1, mode="color")
        lightness = lambda values: (values[:, :3].max(axis=1) + values[:, :3].min(axis=1)) / 2
        np.testing.assert_allclose(lightness(result), lightness(base), atol=1e-7)
        self.assertGreater(result[0, 0], result[0, 1])

    def test_translucent_composite_and_all_transparent_are_finite(self):
        base = np.array([[0, 0, .5, .5], [0, 0, 0, 0]], np.float32)
        pigment = np.array([[.5, 0, 0, .5], [0, 0, 0, 0]], np.float32)
        for mode in MODES:
            result = compose(base=base, pigment=pigment, strength=1, mode=mode)
            self.assertTrue(np.isfinite(result).all())
            self.assertEqual(result[0, 3], .75)
            np.testing.assert_array_equal(result[1], [0, 0, 0, 0])
            self.assertTrue(np.all(result[:, :3] <= result[:, 3:4] + 1e-7))

    def test_original_row_tiles_are_exact_and_validate_later_tiles(self):
        rng = np.random.default_rng(159)
        base = rng.random((513, 31, 4), dtype=np.float32)
        pigment = rng.random(base.shape, dtype=np.float32)
        base[..., :3] *= base[..., 3:4]
        pigment[..., :3] *= pigment[..., 3:4]
        for mode in MODES:
            with self.subTest(mode=mode), patch.dict(os.environ, {RESOLUTION_ENV: 'preview'}):
                expected = compose(base=base, pigment=pigment, strength=.7, mode=mode, opacity=.8)
            with patch.dict(os.environ, {RESOLUTION_ENV: 'original'}), patch('makeup_blend.MAX_BLEND_ELEMENTS', 32768):
                actual = compose(base=base, pigment=pigment, strength=.7, mode=mode, opacity=.8)
            np.testing.assert_array_equal(actual, expected)
        pigment[512, 0, 0] = np.nan
        with patch.dict(os.environ, {RESOLUTION_ENV: 'original'}), patch('makeup_blend.MAX_BLEND_ELEMENTS', 32768):
            with self.assertRaisesRegex(ValueError, 'premultiplied RGBA'):
                compose(base=base, pigment=pigment, strength=.7, mode='normal')

    def test_original_budget_counts_rgba8_source_bytes_at_exact_boundary(self):
        base = np.broadcast_to(np.array([.1, .2, .3, 1], np.float32), (257, 8, 4))
        source_rgba8_bytes = base.shape[0] * base.shape[1] * 4
        self.assertEqual(base.nbytes, source_rgba8_bytes * 4)
        with patch.dict(os.environ, {RESOLUTION_ENV: 'preview'}):
            expected = compose(base=base, pigment=base, strength=.7, mode='screen')
        with patch.dict(os.environ, {RESOLUTION_ENV: 'original'}), patch('makeup_blend.MAX_BLEND_ELEMENTS', 8192):
            with patch('makeup_blend.frame_byte_limit', return_value=source_rgba8_bytes):
                actual = compose(base=base, pigment=base, strength=.7, mode='screen')
            np.testing.assert_array_equal(actual, expected)
            with patch('makeup_blend.frame_byte_limit', return_value=source_rgba8_bytes - 1):
                with self.assertRaisesRegex(ValueError, 'bounded original'):
                    compose(base=base, pigment=base, strength=.7, mode='screen')

    def test_original_uhd_portrait_and_landscape_preserve_source(self):
        pixel = np.array([.1, .2, .3, 1], np.float32)
        for height, width in ((2160, 3840), (3840, 2160)):
            with self.subTest(width=width, height=height), patch.dict(os.environ, {RESOLUTION_ENV: 'original'}):
                base = np.broadcast_to(pixel, (height, width, 4))
                self.assertGreater(base.nbytes, frame_byte_limit())
                self.assertLess(base.size * np.dtype(np.uint8).itemsize, frame_byte_limit())
                actual = compose(base=base, pigment=base, strength=0, mode='normal')
                self.assertEqual(actual.shape, base.shape)
                self.assertEqual(actual.dtype, np.float32)
                self.assertFalse(np.shares_memory(actual, base))
                for start in range(0, height, 256):
                    np.testing.assert_array_equal(actual[start:start + 256], base[start:start + 256])

    def test_original_tiled_source_still_rejects_oversized_edge(self):
        base = np.broadcast_to(np.array([.1, .2, .3, 1], np.float32), (4097, 1025, 4))
        with patch.dict(os.environ, {RESOLUTION_ENV: 'original'}):
            self.assertLess(base.size * np.dtype(np.uint8).itemsize, frame_byte_limit())
            with self.assertRaisesRegex(ValueError, 'bounded original'):
                compose(base=base, pigment=base, strength=0, mode='normal')

    def test_invalid_parameters_fail(self):
        base = np.array([[.2, .3, .4, 1]], np.float32)
        for strength in (True, float("nan"), float("inf"), -1, 2, "1"):
            with self.subTest(strength=strength), self.assertRaises(ValueError):
                compose(base=base, pigment=base, strength=strength, mode="normal")
        for pigment in (base.astype(np.float64), np.array([[1, 0, 0, 0]], np.float32), np.ones((2, 4), np.float32)):
            with self.assertRaises(ValueError):
                compose(base=base, pigment=pigment, strength=1, mode="normal")
        with self.assertRaises(ValueError):
            compose(base=base, pigment=base, strength=1, mode="unknown")


if __name__ == "__main__":
    unittest.main()
