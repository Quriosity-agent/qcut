import sys
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lip_render import render_lip, run


class LipRenderTests(unittest.TestCase):
    def test_zero_lip_preserves_transparent_rgba_without_models(self):
        rgba = np.random.default_rng(30).integers(0, 256, (10, 12, 4), np.uint8)
        with tempfile.TemporaryDirectory() as temporary, patch('lip_render.predict_extra_photo', side_effect=AssertionError('zero must not load models')):
            root = Path(temporary)
            receipt = run(rgba=rgba, strength=0, runtime=root, assets_path=root/'missing.npz',
                texture_state='Close', output=root/'result.png', report=root/'result.json')
            self.assertEqual(receipt['inputRgbaSha256'], receipt['outputRgbaSha256'])
            self.assertIsNone(receipt['extra'])
            self.assertFalse(receipt['privateAssetDependency'])
            self.assertFalse(receipt['nativeGeometryUsed'])

    def test_rejects_bad_strength_texture_state_and_unverified_alpha(self):
        rgba = np.full((10, 12, 4), 255, np.uint8)
        points = np.ones((240, 2), np.float32)
        for strength in (True, -1, 2, float('nan'), '1'):
            with self.assertRaises(ValueError):
                render_lip(rgba=rgba, points=points, assets={}, runtime=Path('.'), strength=strength)
        with self.assertRaises(ValueError):
            render_lip(rgba=rgba, points=points, assets={}, runtime=Path('.'), strength=0, texture_state='auto')
        rgba[0, 0, 3] = 100
        with self.assertRaises(ValueError):
            render_lip(rgba=rgba, points=points, assets={}, runtime=Path('.'), strength=.8)


if __name__ == '__main__':
    unittest.main()
