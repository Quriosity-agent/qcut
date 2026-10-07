from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from liquefy_render import read_mask, run, validate_controls


class LiquefyRenderTests(unittest.TestCase):
    def test_zero_preserves_rgba_without_models(self):
        rgba=np.random.default_rng(34).integers(0,256,(10,12,4),np.uint8)
        with tempfile.TemporaryDirectory() as directory, patch('liquefy_render.single_face_prediction',side_effect=AssertionError('zero must not infer')):
            root=Path(directory)
            receipt=run(rgba=rgba,controls={},runtime=root,assets_path=root/'missing.npz',output=root/'result.png',report=root/'result.json')
            self.assertEqual(receipt['inputRgbaSha256'],receipt['outputRgbaSha256'])
            self.assertFalse(receipt['privateAssetDependency'])

    def test_bad_controls_and_unverified_combinations_are_rejected(self):
        for controls in (None, [], {'TotalFace':10}, {'mid_atrium':True}, {'mid_atrium':float('nan')}, {'mid_atrium':51}):
            with self.assertRaises(ValueError):
                validate_controls(values=controls)
        with self.assertRaises(ValueError):
            run(rgba=np.full((10,12,4),255,np.uint8),controls={'mid_atrium':20,'underjaw':30},
                runtime=Path('.'),assets_path=Path('missing'),output=Path('unused.png'),report=Path('unused.json'))

    def test_modified_mask_is_rejected_before_decode(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'MidAtrium_Neg_mask.png'
            path.write_bytes(b'not the pinned mask')
            with self.assertRaises(ValueError):
                read_mask(path=path)


if __name__=='__main__':
    unittest.main()
