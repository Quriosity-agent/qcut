import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from smooth_metal import render


@unittest.skipUnless(sys.platform == 'darwin', 'Metal requires macOS')
class SmoothGpuCoordinateTests(unittest.TestCase):
    def test_attribute_offsets_round_before_interpolation_on_odd_frame(self):
        source = np.random.default_rng(445).integers(80, 190, (577, 431, 4), dtype=np.uint8)
        source[..., 3] = 255
        original = source.copy()
        with tempfile.TemporaryDirectory() as temporary:
            _, receipt, stages = render(rgba=source, skin=np.full((1, 1, 4), 255, np.uint8),
                face=np.zeros((256, 256, 4), np.uint8), cube=np.full((512, 512, 4), 255, np.uint8),
                strength=1, runtime=Path(temporary), retain_stages=True)
        horizontal = stages['2.horizontalPixel']
        observed = horizontal[[6, 84, 116, 136], [148, 123, 49, 128]]
        np.testing.assert_array_equal(observed, [[96, 112, 182, 139], [119, 140, 145, 149],
                                                [85, 113, 147, 129], [146, 144, 125, 139]])
        np.testing.assert_array_equal(source, original)
        self.assertEqual(receipt['reducedSize'], [193, 259])
        self.assertEqual(receipt['lineOffsetStage'], 'vertex-before-interpolation')
        self.assertEqual(receipt['originalReflectionStage'], 'fragment-after-interpolation')
        self.assertEqual(receipt['outputRows'], 'image-top-to-bottom')
        self.assertEqual(receipt['private_native_images'], [])

    def test_face_clear_is_transparent_and_material_opacity_ignores_asset_alpha(self):
        source = np.full((160, 160, 4), [141, 70, 60, 255], np.uint8)
        skin = np.full((1, 1, 4), 255, np.uint8)
        face = np.full((256, 256, 4), [64, 128, 192, 17], np.uint8)
        vertices = np.zeros((145, 4), np.float32)
        vertices[:3] = [[16, 16, .5, .5], [80, 16, .5, .5], [16, 80, .5, .5]]
        indices = np.tile(np.array([0, 1, 2], np.uint16), (256, 1))
        originals = [array.copy() for array in (source, skin, face, vertices, indices)]
        with tempfile.TemporaryDirectory() as temporary:
            _, receipt, stages = render(rgba=source, skin=skin, face=face,
                cube=np.full((512, 512, 4), 255, np.uint8), strength=1, runtime=Path(temporary),
                mesh={'vertices': vertices, 'indices': indices}, retain_stages=True)
        coverage = stages['1.facePixel']
        np.testing.assert_array_equal(coverage[12, 12], [64, 128, 192, 255])
        np.testing.assert_array_equal(coverage[[0, 60], [0, 60]], np.zeros((2, 4), np.uint8))
        for array, original in zip((source, skin, face, vertices, indices), originals):
            np.testing.assert_array_equal(array, original)
        self.assertTrue(receipt['hasFace'])
        self.assertEqual(receipt['private_native_images'], [])


if __name__ == '__main__':
    unittest.main()
