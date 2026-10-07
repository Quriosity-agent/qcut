from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from look_render import run


class LookRenderTests(unittest.TestCase):
    def test_zero_and_epsilon_need_no_private_assets_or_gpu(self):
        rgba = np.arange(64, dtype=np.uint8).reshape(4, 4, 4)
        with tempfile.TemporaryDirectory() as temporary, patch('look_render.predict_iris_photo') as infer, patch('look_render.render') as gpu:
            root = Path(temporary)
            for strength in (0, .001):
                png, report = root/f'{strength}.png', root/f'{strength}.json'
                receipt = run(rgba=rgba, card='look-oxygen', strength=strength, runtime=root/'missing', output=png, report=report)
                np.testing.assert_array_equal(np.asarray(Image.open(png)), rgba)
                self.assertIsNone(receipt['iris'])
                self.assertEqual(receipt['inputRgbaSha256'], receipt['outputRgbaSha256'])
            infer.assert_not_called()
            gpu.assert_not_called()

    def test_invalid_card_strength_and_alpha_fail_before_inference(self):
        rgba = np.zeros((4, 4, 4), np.uint8)
        with tempfile.TemporaryDirectory() as temporary, patch('look_render.predict_iris_photo') as infer:
            root = Path(temporary)
            for card, strength in (('other', 0), ('look-oxygen', True), ('look-oxygen', -1),
                    ('look-oxygen', np.nan), ('look-oxygen', 1.01), ('look-oxygen', .5)):
                with self.assertRaises(ValueError):
                    run(rgba=rgba, card=card, strength=strength, runtime=root, output=root/'none.png', report=root/'none.json')
            infer.assert_not_called()


if __name__ == '__main__':
    unittest.main()
