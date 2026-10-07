from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from facefitting_image import decode_image


class FittingImageTests(unittest.TestCase):
    def test_exif_rotation_preserves_full_resolution_dimension_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "oriented.png"
            data = np.zeros((400, 800, 3), np.uint8)
            data[:200, :400] = [255, 0, 0]
            exif = Image.Exif()
            exif[274] = 6
            Image.fromarray(data).save(path, exif=exif)
            result = decode_image(image=path, max_edge=200)
            self.assertEqual(result["source_size"], [800, 400])
            self.assertEqual(result["oriented_source_size"], [400, 800])
            self.assertEqual(result["decoded_size"], [100, 200])
            np.testing.assert_array_equal(result["rgba"][20, 80], [255, 0, 0, 255])

    def test_small_images_are_not_upscaled(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "small.png"
            Image.new("RGB", (80, 40)).save(path)
            result = decode_image(image=path, max_edge=1280)
            self.assertEqual(result["decoded_size"], [80, 40])
            self.assertEqual(result["oriented_source_size"], [80, 40])

    def test_invalid_edge_and_frame_budget_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "large.png"
            Image.new("RGB", (2200, 2200)).save(path)
            for edge in (0, 100, 4097, True):
                with self.assertRaises(ValueError):
                    decode_image(image=path, max_edge=edge)
            with self.assertRaisesRegex(ValueError, "16 MiB"):
                decode_image(image=path, max_edge=4096)


if __name__ == "__main__":
    unittest.main()
