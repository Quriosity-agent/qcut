from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from eye_assets import validate_assets
from eye_render import run
from eye_support import distance_ratio, eye_mesh, support


def eyes(*, opening=.3):
    theta = np.arange(22, dtype=np.float32)*np.float32(np.pi/11)
    left = np.column_stack((np.float32(100)+np.cos(theta)*np.float32(20),
                            np.float32(100)-np.sin(theta)*np.float32(20*opening))).astype(np.float32)
    right = left+np.array([80, 0], np.float32)
    return np.vstack((left, right))


class EyeGeometryTests(unittest.TestCase):
    def test_supports_follow_translation_and_scale_without_mutating_controls(self):
        original = eyes()
        saved = original.copy()
        for side in (0, 1):
            result = support(eyes=original, side=side)
            self.assertEqual(result.shape, (87, 2))
            np.testing.assert_array_equal(result[:22], original[:22] if side else original[22:])
            shifted = support(eyes=original+np.array([4, -8], np.float32), side=side)
            np.testing.assert_allclose(shifted, result+[4, -8], atol=.0001, rtol=0)
            scaled = support(eyes=original*np.float32(2), side=side)
            np.testing.assert_array_equal(scaled, result*np.float32(2))
        np.testing.assert_array_equal(original, saved)

    def test_closed_eyes_have_finite_supports_and_zero_opening(self):
        controls = eyes(opening=0)
        for side in (0, 1):
            self.assertTrue(np.isfinite(support(eyes=controls, side=side)).all())
        self.assertEqual(distance_ratio(numerator=np.zeros(2, np.float32), denominator=np.array([10, 0], np.float32)), 0)

    def test_original_eye_packing_preserves_corner_y_and_scales_interior(self):
        points = np.zeros((240, 2), np.float32)
        points[196:240] = eyes()
        before = points.copy()
        result = eye_mesh(points=points)
        for start, raw_start, scale in ((0, 196, 1.0015), (87, 218, .999)):
            np.testing.assert_array_equal(result[start:start+22, 0], points[raw_start:raw_start+22, 0])
            np.testing.assert_array_equal(result[[start, start+11]], points[[raw_start, raw_start+11]])
            self.assertEqual(result[start+1, 1], np.float32(float(points[raw_start+1, 1])*scale))
        np.testing.assert_array_equal(points, before)

    def test_malformed_and_coincident_eye_controls_fail_closed(self):
        controls = eyes()
        for value in (controls.astype(np.float64), controls[:-1], np.full((44, 2), np.nan, np.float32), np.zeros((44, 2), np.float32)):
            with self.assertRaises(ValueError):
                support(eyes=value, side=1)
        for side in (True, 2, -1):
            with self.assertRaises(ValueError):
                support(eyes=controls, side=side)
        with self.assertRaises(ValueError):
            validate_assets(card='aegyo-doll', values={})

    def test_all_cards_zero_preserves_rgba_without_private_assets(self):
        rgba = np.random.default_rng(21).integers(0, 256, (12, 14, 4), np.uint8)
        from eye_assets import CARDS
        with tempfile.TemporaryDirectory() as directory, patch('makeup_photo.predict_extra_photo', side_effect=AssertionError('zero must not infer')):
            root = Path(directory)
            for card in CARDS:
                receipt = run(rgba=rgba, card=card, strength=0, runtime=root, output=root/'out.png', report=root/'out.json')
                self.assertEqual(receipt['inputRgbaSha256'], receipt['outputRgbaSha256'])
                self.assertFalse(receipt['privateAssetDependency'])

    def test_active_transparency_bad_cards_and_strengths_are_rejected(self):
        rgba = np.full((12, 14, 4), 255, np.uint8)
        for card, strength in (('unknown', 0), ('aegyo-doll', True), ('eyeliner-cat', float('nan')), ('aegyo-natural', -1), ('eyeliner-natural', 2)):
            with self.assertRaises(ValueError):
                run(rgba=rgba, card=card, strength=strength, runtime=Path('.'), output=Path('unused.png'), report=Path('unused.json'))
        rgba[0, 0, 3] = 254
        with self.assertRaises(ValueError):
            run(rgba=rgba, card='aegyo-doll', strength=.8, runtime=Path('.'), output=Path('unused.png'), report=Path('unused.json'))


if __name__ == '__main__':
    unittest.main()
