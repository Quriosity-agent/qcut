import hashlib
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

RESEARCH = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RESEARCH))

from whiten_assets import load_lut, PACKAGE
from whiten_math import compose, map_rgb, sample_linear
from whiten_metal import render
from whiten_render import render_image


def identity_cube():
    lut = np.full((512, 512, 4), 255, np.uint8)
    levels = np.rint(np.arange(64) * 255 / 63).astype(np.uint8)
    for blue in range(64):
        row, column = divmod(blue, 8)
        block = lut[row * 64:(row + 1) * 64, column * 64:(column + 1) * 64]
        block[..., 0] = levels[None, :]
        block[..., 1] = levels[:, None]
        block[..., 2] = levels[blue]
    return lut


class WhitenMathTest(unittest.TestCase):
    def setUp(self):
        self.lut = identity_cube()
        self.rgba = np.array([[[0, 255, 128, 17], [255, 0, 255, 255]],
                              [[51, 170, 0, 0], [83, 77, 42, 128]]], np.uint8)

    def test_cube_axes_and_endpoints(self):
        rgb = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1]], np.float32)
        np.testing.assert_array_equal(map_rgb(rgb=rgb, lut=self.lut), rgb)

    def test_blue_interpolates_across_tile_row_boundary(self):
        lut = np.zeros((512, 512, 4), np.uint8)
        lut[..., 3] = 255
        lut[0:64, 448:512, :3] = [0, 64, 128]
        lut[64:128, 0:64, :3] = [128, 192, 255]
        color = np.array([[.27, .71, 7.5 / 63]], np.float32)
        expected = (np.array([[0, 64, 128]], np.float32) + [128, 192, 255]) / 510
        np.testing.assert_allclose(map_rgb(rgb=color, lut=lut), expected, atol=1e-7)

    def test_identity_cube_error_is_only_byte_grid_quantization(self):
        rng = np.random.default_rng(820)
        rgb = rng.random((13, 19, 3), dtype=np.float32)
        self.assertLessEqual(float(np.abs(map_rgb(rgb=rgb, lut=self.lut) - rgb).max()), .5 / 255 + 1e-6)

    def test_linear_sampling_centers_edges_and_channel_alpha(self):
        uv = np.array([[0, 0], [1, 1], [.25, .25], [.5, .5]], np.float32)
        sampled = sample_linear(texture=self.rgba, uv=uv)
        np.testing.assert_array_equal(sampled[0], self.rgba[0, 0].astype(np.float32) / 255)
        np.testing.assert_array_equal(sampled[1], self.rgba[1, 1].astype(np.float32) / 255)
        np.testing.assert_array_equal(sampled[2], sampled[0])
        np.testing.assert_allclose(sampled[3], self.rgba.mean(axis=(0, 1)) / 255, atol=1e-7)

    def test_strength_and_coverage_are_two_blends_preserving_alpha(self):
        lut = np.full((512, 512, 4), 255, np.uint8)
        mask = np.array([[0, 1], [.5, .25]], np.float32)
        original = self.rgba.copy()
        result = compose(rgba=self.rgba, lut=lut, mask_alpha=mask, strength=.8)
        expected = self.rgba.copy()
        expected[..., :3] = np.rint(self.rgba[..., :3] + (255 - self.rgba[..., :3]) * (.8 * mask[..., None])).astype(np.uint8)
        np.testing.assert_array_equal(result, expected)
        np.testing.assert_array_equal(self.rgba, original)

    def test_zero_strength_and_zero_mask_are_identity_copies(self):
        for strength, mask in ((0, np.ones((2, 2), np.float32)), (1, np.zeros((2, 2), np.float32))):
            result = compose(rgba=self.rgba, lut=self.lut, mask_alpha=mask, strength=strength)
            np.testing.assert_array_equal(result, self.rgba)
            self.assertFalse(np.shares_memory(result, self.rgba))

    def test_reject_invalid_scalar_lut_mask_and_color(self):
        mask = np.ones((2, 2), np.float32)
        for value in (True, False, -1, 1.01, np.nan, np.inf, '1'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                compose(rgba=self.rgba, lut=self.lut, mask_alpha=mask, strength=value)
        for invalid in (mask.astype(np.float64), mask[:1], np.full((2, 2), np.nan, np.float32), mask * 2):
            with self.assertRaises(ValueError):
                compose(rgba=self.rgba, lut=self.lut, mask_alpha=invalid, strength=1)
        with self.assertRaises(ValueError):
            map_rgb(rgb=np.array([[2, 0, 0]], np.float32), lut=self.lut)
        with self.assertRaises(ValueError):
            map_rgb(rgb=np.array([[0, 0, 0]], np.float32), lut=self.lut[:64])
        transparent = self.lut.copy()
        transparent[0, 0, 3] = 0
        with self.assertRaises(ValueError):
            map_rgb(rgb=np.array([[0, 0, 0]], np.float32), lut=transparent)

    def test_missing_or_tampered_local_asset_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            runtime = Path(temporary)
            with self.assertRaises(FileNotFoundError):
                load_lut(runtime=runtime)
            package = runtime / 'Cache/effect' / PACKAGE
            package.mkdir(parents=True)
            (package / 'config.json').write_text('{}')
            with self.assertRaises(ValueError):
                load_lut(runtime=runtime)

    @unittest.skipUnless(sys.platform == 'darwin', 'process image inventory requires macOS')
    def test_zero_entry_uses_no_model_or_lut_and_is_original_identity(self):
        rgba = self.rgba.copy()
        rgba[..., 3] = 255
        with tempfile.TemporaryDirectory() as temporary:
            image = Path(temporary) / 'original.png'
            Image.fromarray(rgba).save(image)
            output, receipt = render_image(image=image, strength=0, runtime=Path(temporary) / 'missing-runtime')
        np.testing.assert_array_equal(output, rgba)
        self.assertTrue(receipt['zeroStrengthIdentity'])
        self.assertFalse(receipt['nativePixelsUsed'])
        self.assertEqual(receipt['diagnostics'], {})
        self.assertIsNone(receipt['assets'])

    def test_transparent_photo_and_nonfinite_entry_strength_are_rejected_before_inference(self):
        with tempfile.TemporaryDirectory() as temporary:
            image = Path(temporary) / 'original.png'
            Image.fromarray(self.rgba).save(image)
            with self.assertRaises(ValueError):
                render_image(image=image, strength=1, runtime=Path(temporary))
            with self.assertRaises(ValueError):
                render_image(image=image, strength=np.nan, runtime=Path(temporary))


@unittest.skipUnless(sys.platform == 'darwin', 'Metal requires macOS')
class WhitenMetalTest(unittest.TestCase):
    def test_native_uv_y_flip_maps_top_mask_to_top_photo_and_preserves_alpha(self):
        rgba = np.array([[[20, 30, 40, 17], [60, 80, 100, 255]],
                         [[120, 140, 160, 0], [180, 200, 220, 128]]], np.uint8)
        mask = np.zeros((2, 2, 4), np.uint8)
        mask[0, :, 3] = 255
        lut = np.full((512, 512, 4), 255, np.uint8)
        with tempfile.TemporaryDirectory() as temporary:
            output, receipt = render(rgba=rgba, lut=lut, mask_texture=mask, strength=1, runtime=Path(temporary))
        expected = rgba.copy()
        expected[0, :, :3] = 255
        np.testing.assert_array_equal(output, expected)
        self.assertEqual(receipt['private_native_images'], [])

    def test_real_lut_gpu_against_independent_math_on_odd_rectangle(self):
        runtime = RESEARCH.parent / 'runtime'
        if not (runtime / 'Cache/effect' / PACKAGE).exists():
            self.skipTest('private local LUT not installed')
        lut, identity = load_lut(runtime=runtime)
        rng = np.random.default_rng(3521)
        rgba = rng.integers(0, 256, (7, 9, 4), dtype=np.uint8)
        rgba[..., 3] = 255
        mask = np.full((1, 1, 4), 128, np.uint8)
        alpha = np.full((7, 9), np.float32(128 / 255), np.float32)
        cpu = compose(rgba=rgba, lut=lut, mask_alpha=alpha, strength=.8)
        gpu, receipt = render(rgba=rgba, lut=lut, mask_texture=mask, strength=.8, runtime=runtime)
        delta = np.abs(cpu.astype(np.int16) - gpu.astype(np.int16))
        self.assertLessEqual(int(delta.max()), 1)
        np.testing.assert_array_equal(cpu[..., 3], gpu[..., 3])
        self.assertEqual(receipt['private_native_images'], [])
        self.assertEqual(identity['lutRgbaSha256'], hashlib.sha256(lut.tobytes()).hexdigest())


if __name__ == '__main__':
    unittest.main()
