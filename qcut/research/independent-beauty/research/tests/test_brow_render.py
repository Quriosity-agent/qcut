from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from brow_assets import validate_assets
from brow_render import run


class BrowRenderTests(unittest.TestCase):
    def test_zero_preserves_rgba_without_private_assets(self):
        rgba=np.random.default_rng(35).integers(0,256,(10,12,4),np.uint8)
        with tempfile.TemporaryDirectory() as directory, patch('brow_render.predict_extra_photo',side_effect=AssertionError('zero must not infer')):
            root=Path(directory)
            receipt=run(rgba=rgba,card='brows-standard',strength=0,runtime=root,output=root/'result.png',report=root/'result.json')
            self.assertEqual(receipt['inputRgbaSha256'],receipt['outputRgbaSha256'])
            self.assertFalse(receipt['privateAssetDependency'])

    def test_invalid_card_strength_alpha_and_asset_identity_fail_closed(self):
        opaque=np.full((10,12,4),255,np.uint8)
        for card,strength in (('not-a-card',0),('brows-standard',True),('brows-standard',float('nan')),('brows-standard',2)):
            with self.assertRaises(ValueError):
                run(rgba=opaque,card=card,strength=strength,runtime=Path('.'),output=Path('unused.png'),report=Path('unused.json'))
        opaque[0,0,3]=0
        with self.assertRaises(ValueError):
            run(rgba=opaque,card='brows-standard',strength=.8,runtime=Path('.'),output=Path('unused.png'),report=Path('unused.json'))
        with self.assertRaises(ValueError):
            validate_assets(values={})


if __name__=='__main__':
    unittest.main()
