import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from contacts_render import run


class ContactsRenderTests(unittest.TestCase):
    def test_zero_and_epsilon_preserve_rgba_without_private_models(self):
        rgba = np.arange(4*4*4, dtype=np.uint8).reshape(4, 4, 4)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for strength in (0, .001):
                png, receipt = root/f'{strength}.png', root/f'{strength}.json'
                result = run(rgba=rgba, card='contacts-natural', strength=strength,
                    runtime=root/'missing-private-runtime', output=png, report=receipt)
                np.testing.assert_array_equal(np.asarray(Image.open(png)), rgba)
                self.assertIsNone(result['iris'])
                self.assertFalse(result['privateAssetDependency'])
                self.assertEqual(json.loads(receipt.read_text())['inputRgbaSha256'], result['outputRgbaSha256'])

    def test_invalid_card_and_strength_are_rejected_before_inference(self):
        rgba = np.zeros((4, 4, 4), np.uint8)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for card, strength in (('other', 0), ('contacts-natural', True), ('contacts-natural', -1), ('contacts-natural', np.nan)):
                with self.assertRaises(ValueError):
                    run(rgba=rgba, card=card, strength=strength, runtime=root,
                        output=root/'none.png', report=root/'none.json')


if __name__ == '__main__':
    unittest.main()
