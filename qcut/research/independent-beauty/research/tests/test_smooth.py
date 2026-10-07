import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

RESEARCH = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RESEARCH))

from smooth_math import control_mask, hue_value, line_filter, recombine
from smooth_metal import render, validate_mesh
from smooth_geometry import positions
from smooth_render import render_image
from PIL import Image


class SmoothMathTest(unittest.TestCase):
    def test_hue_primaries_gray_and_zero(self):
        rgb = np.array([[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1], [0, 0, 0]], np.float32)
        hue, value = hue_value(rgb=rgb)
        np.testing.assert_allclose(hue, [0, .33333, .66667, 0, 0], atol=1e-7)
        np.testing.assert_array_equal(value, [1, 1, 1, 1, 0])

    def test_face_coverage_hue_rejection_and_dark_transition(self):
        rgb = np.array([[.8, .4, .4], [0, 1, 0], [.31, 0, 0], [.3, 0, 0]], np.float32)
        face = np.tile(np.array([.25, .5, .75], np.float32), (4, 1))
        skin = np.full(4, .6, np.float32)
        result = control_mask(rgb=rgb, face_rgb=face, skin_alpha=skin, strength=.5, has_face=True)
        np.testing.assert_allclose(result, [[.25, .5, .75, .25], [.25, .5, 0, .25],
                                          [.25, .5, .5, .25], [.25, .5, 0, .25]], atol=2e-6)
        np.testing.assert_array_equal(face, np.tile([.25, .5, .75], (4, 1)))

    def test_no_face_uses_skin_and_low_face_green_falls_back_to_skin(self):
        rgb = np.array([[.8, .4, .4]], np.float32)
        face = np.array([[.2, .099, .8]], np.float32)
        skin = np.array([.6], np.float32)
        result = control_mask(rgb=rgb, face_rgb=face, skin_alpha=skin, strength=.5, has_face=False)
        np.testing.assert_allclose(result, [[0, 0, .6, .3]], atol=1e-7)
        with_face = control_mask(rgb=rgb, face_rgb=face, skin_alpha=skin, strength=.5, has_face=True)
        self.assertAlmostEqual(float(with_face[0, 3]), .3, places=7)

    def test_line_rejects_high_contrast_and_preserves_inactive_samples(self):
        samples = np.ones((2, 9, 4), np.float32)
        samples[:, 0] = [0, 0, 0, .25]
        active = np.array([True, False])
        horizontal = line_filter(samples=samples, active=active, vertical=False)
        vertical = line_filter(samples=samples, active=active, vertical=True)
        np.testing.assert_array_equal(horizontal[:, :3], np.zeros((2, 3)))
        np.testing.assert_allclose(horizontal[:, 3], [.8888, .25], atol=1e-7)
        np.testing.assert_array_equal(vertical[:, 3], [1, .25])

    def test_flat_line_normalization_and_variance_are_distinct(self):
        samples = np.full((1, 9, 4), .5, np.float32)
        active = np.array([True])
        horizontal = line_filter(samples=samples, active=active, vertical=False)
        vertical = line_filter(samples=samples, active=active, vertical=True)
        np.testing.assert_allclose(horizontal[0], [.5, .5, .5, .49995], atol=1e-7)
        np.testing.assert_allclose(vertical[0, :3], [.5, .5, .5], atol=1e-7)
        self.assertGreater(float(vertical[0, 3]), 0)
        self.assertLess(float(vertical[0, 3]), 2e-7)

    def test_recombination_preserves_detail_operation_order_and_source_alpha(self):
        original = np.array([[.9, .2, .1, .23]], np.float32)
        corrected = np.array([[.4, .4, .4, 0]], np.float32)
        broad = np.array([[.2, .2, .2, 1]], np.float32)
        repeated = np.array([[.3, .3, .3, 1]], np.float32)
        control = np.ones((1, 4), np.float32)
        result = recombine(original=original, corrected=corrected, broad=broad,
                           repeated=repeated, control=control, skin_alpha=np.ones(1, np.float32))
        np.testing.assert_allclose(result, [[.36, .36, .36, .23]], atol=1e-7)
        control[:, 3] = 0
        zero = recombine(original=original, corrected=corrected, broad=broad,
                         repeated=repeated, control=control, skin_alpha=np.ones(1, np.float32))
        np.testing.assert_array_equal(zero, original)
        self.assertFalse(np.shares_memory(zero, original))

    def test_nonfinite_pixels_mismatched_coverage_and_invalid_strength_rejected(self):
        rgb = np.ones((1, 3), np.float32)
        skin = np.ones(1, np.float32)
        for value in (True, -1, 1.01, float('nan'), float('inf'), '1'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                control_mask(rgb=rgb, face_rgb=rgb, skin_alpha=skin, strength=value, has_face=True)
        for value in (rgb.astype(np.float64), np.full((1, 3), np.nan, np.float32), rgb * 2, rgb[:, :2]):
            with self.assertRaises(ValueError):
                hue_value(rgb=value)
        with self.assertRaises(ValueError):
            control_mask(rgb=rgb, face_rgb=rgb, skin_alpha=skin.astype(np.float64), strength=1, has_face=True)
        with self.assertRaises(ValueError):
            line_filter(samples=np.ones((1, 8, 4), np.float32), active=np.array([True]), vertical=True)

    def test_mesh_rejects_cardinality_nonfinite_and_out_of_range_indices(self):
        mesh = {'vertices': np.zeros((145, 4), np.float32), 'indices': np.zeros((256, 3), np.uint16)}
        validate_mesh(mesh=mesh)
        for vertices in (mesh['vertices'][:144], mesh['vertices'].astype(np.float64),
                         np.full((145, 4), np.nan, np.float32)):
            with self.assertRaises(ValueError):
                validate_mesh(mesh=mesh | {'vertices': vertices})
        invalid = mesh['indices'].copy()
        invalid[0, 0] = 145
        with self.assertRaises(ValueError):
            validate_mesh(mesh=mesh | {'indices': invalid})

    def test_145_geometry_pixels_forehead_and_outer_ring(self):
        normalized = np.full((106, 2), .5, np.float32)
        normalized[0], normalized[32] = [.2, .4], [.8, .4]
        normalized[74], normalized[77] = [.3, .7], [.7, .7]
        normalized[43], normalized[46] = [.4, .6], [.6, .6]
        forehead = np.column_stack((np.linspace(0, 1, 11), np.full(11, -.2))).astype(np.float32)
        original = normalized.copy()
        mesh = positions(normalized=normalized, size=(100, 200), forehead=forehead)
        self.assertEqual(mesh.shape, (145, 2))
        np.testing.assert_allclose(mesh[[0, 32, 106, 116]], [[20, 120], [80, 120], [25, 81.5], [75, 81.5]], atol=2e-5)
        center = (mesh[43]+mesh[46])/np.float32(2)
        np.testing.assert_allclose(mesh[117:134], mesh[:33:2]+(center-mesh[:33:2])*np.float32(-.4))
        np.testing.assert_allclose(mesh[134:], mesh[106:117]+(mesh[43]-mesh[106:117])*np.float32(-.4))
        np.testing.assert_array_equal(normalized, original)
        with self.assertRaises(ValueError):
            positions(normalized=normalized, size=(0, 200), forehead=forehead)
        with self.assertRaises(ValueError):
            positions(normalized=normalized*3, size=(100, 200), forehead=forehead)

    @unittest.skipUnless(sys.platform == 'darwin', 'process image inventory requires macOS')
    def test_zero_entry_preserves_transparency_without_private_assets(self):
        rgba = np.array([[[12, 34, 56, 0], [77, 88, 99, 128]]], np.uint8)
        with tempfile.TemporaryDirectory() as temporary:
            image = Path(temporary)/'source.png'
            Image.fromarray(rgba).save(image)
            result, receipt, stages = render_image(image=image, strength=0, runtime=Path(temporary)/'missing')
        np.testing.assert_array_equal(result, rgba)
        self.assertTrue(receipt['zeroStrengthIdentity'])
        self.assertEqual(receipt['diagnostics'], {})
        self.assertEqual(stages, {})


@unittest.skipUnless(sys.platform == 'darwin', 'Metal requires macOS')
class SmoothMetalTest(unittest.TestCase):
    def render_fixture(self, *, source, alpha):
        skin = np.full((1, 1, 4), alpha, np.uint8)
        face = np.zeros((256, 256, 4), np.uint8)
        cube = np.full((512, 512, 4), 255, np.uint8)
        with tempfile.TemporaryDirectory() as temporary:
            return render(rgba=source, skin=skin, face=face, cube=cube, strength=1,
                          runtime=Path(temporary), retain_stages=True)

    def test_zero_skin_identity_odd_frame_and_distinct_repeated_stage_receipts(self):
        source = np.random.default_rng(722).integers(0, 256, (13, 19, 4), dtype=np.uint8)
        source[..., 3] = 255
        result, receipt, stages = self.render_fixture(source=source, alpha=0)
        np.testing.assert_array_equal(result, source)
        self.assertEqual(receipt['reducedSize'], [8, 5])
        self.assertEqual(receipt['private_native_images'], [])
        self.assertFalse(receipt['hasFace'])
        self.assertEqual(len(stages), 7)
        self.assertIn('5.broadPixel', stages)
        self.assertIn('6.broadPixel', stages)

    def test_flat_color_stays_flat_and_grain_has_a_visible_effect(self):
        flat = np.empty((17, 21, 4), np.uint8)
        flat[:] = [141, 70, 60, 255]
        result, _, _ = self.render_fixture(source=flat, alpha=255)
        self.assertLessEqual(int(np.abs(result.astype(np.int16)-flat.astype(np.int16)).max()), 1)
        grain = flat.copy()
        perturbation = np.random.default_rng(823).integers(-12, 13, grain.shape[:2])
        grain[..., :3] = np.clip(grain[..., :3].astype(np.int16)+perturbation[..., None], 0, 255)
        output, receipt, _ = self.render_fixture(source=grain, alpha=255)
        self.assertGreater(int(np.any(output[..., :3] != grain[..., :3], axis=-1).sum()), 50)
        np.testing.assert_array_equal(output[..., 3], grain[..., 3])
        self.assertEqual(receipt['private_native_images'], [])

    def test_top_row_skin_texture_does_not_receive_a_second_flip(self):
        source = np.full((20, 20, 4), 128, np.uint8)
        source[..., 3] = 255
        skin = np.zeros((2, 1, 4), np.uint8)
        skin[0, :, 3] = 255
        with tempfile.TemporaryDirectory() as temporary:
            _, receipt, stages = render(rgba=source, skin=skin, face=np.zeros((256, 256, 4), np.uint8),
                cube=np.full((512, 512, 4), 255, np.uint8), strength=1, runtime=Path(temporary), retain_stages=True)
        control = stages['1.controlPixel']
        self.assertEqual(int(control[0, 0, 3]), 255)
        self.assertEqual(int(control[-1, 0, 3]), 0)
        self.assertEqual(receipt['skinCoordinate'], 'source-u,source-v-top-zero')


if __name__ == '__main__':
    unittest.main()
