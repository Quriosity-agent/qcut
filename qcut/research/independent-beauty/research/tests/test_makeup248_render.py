from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from makeup248_assets import validate_assets
from makeup248_render import run
from makeup_layers import compose_layers, load_texture


class Makeup248Tests(unittest.TestCase):
    def test_zero_and_threshold_preserve_rgba_without_models(self):
        rgba=np.random.default_rng(87).integers(0,256,(10,12,4),np.uint8)
        with tempfile.TemporaryDirectory() as directory, patch('makeup_photo.predict_extra_photo',side_effect=AssertionError('identity must not infer')):
            root=Path(directory)
            for card in ('blush-baby-pink','contour-mixed'):
                for strength in (0,.001):
                    receipt=run(rgba=rgba,card=card,strength=strength,runtime=root,output=root/'result.png',report=root/'result.json')
                    self.assertEqual(receipt['inputRgbaSha256'],receipt['outputRgbaSha256'])
                    self.assertFalse(receipt['privateAssetDependency'])

    def test_invalid_card_strength_and_transparent_active_fail_closed(self):
        rgba=np.full((10,12,4),255,np.uint8)
        for card,strength in (('unknown',0),('contour-mixed',True),('blush-baby-pink',float('nan')),('contour-mixed',-1),('contour-mixed',2)):
            with self.assertRaises(ValueError):
                run(rgba=rgba,card=card,strength=strength,runtime=Path('.'),output=Path('unused.png'),report=Path('unused.json'))
        rgba[0,0,3]=254
        with self.assertRaises(ValueError):
            run(rgba=rgba,card='blush-baby-pink',strength=.8,runtime=Path('.'),output=Path('unused.png'),report=Path('unused.json'))
        with self.assertRaises(ValueError):
            validate_assets(card='blush-baby-pink',values={})

    def test_single_pass_reflect_does_not_quantize_between_layers(self):
        base=np.array([.4,.3,.2,1],np.float32)
        pigment=np.array([.2,.1,.1,.4],np.float32)
        reflect=np.array([.1,.08,.06,.2],np.float32)
        strength=.8
        first=base[:3]*(1-pigment[3]*strength)+base[:3]*(pigment[:3]/pigment[3])*pigment[3]*strength
        expected=first*(1-reflect[3]*strength)+reflect[:3]*strength
        result=compose_layers(base=base,pigments=[(pigment,'multiply'),(reflect,'normal')],strength=strength)
        np.testing.assert_array_equal(result,np.rint(np.r_[expected,1]*255).astype(np.uint8))

    def test_texture_hash_is_checked_before_decoding(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'invalid.png'; path.write_bytes(b'not a texture')
            with self.assertRaisesRegex(ValueError,'identity'):
                load_texture(path=path,sha256='0'*64)


if __name__=='__main__':
    unittest.main()
