"""Original-mode pixel preservation and frame-budget boundary regressions."""
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image, ImageOps

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from facefitting_image import decode_image
from independent_pipeline import read_rgba
from render_resolution import RESOLUTION_ENV, frame_byte_limit, gpu_request_fields, resolution_mode, source_edge_limit, verify_gpu_resolution
from skin_mask_frontend import algorithm_size
from slimface_render import validate_rgba


class ResolutionTests(unittest.TestCase):
    def test_original_gpu_receipt_is_bound_to_the_full_source_frame(self):
        rgba = np.zeros((160, 2048, 4), np.uint8)
        receipt = {'resolutionMode': 'original', 'sourceFrameSize': [2048, 160],
                   'sourceRgbaBytes': rgba.nbytes, 'maxSourceEdge': 4096}
        with patch.dict(os.environ, {RESOLUTION_ENV: 'original'}):
            verify_gpu_resolution(receipt=receipt, rgba=rgba)
            for name, wrong in [('resolutionMode', 'preview'), ('sourceFrameSize', [1280, 100]),
                                ('sourceRgbaBytes', 1280*100*4), ('maxSourceEdge', 1280)]:
                with self.subTest(field=name), self.assertRaises(ValueError):
                    verify_gpu_resolution(receipt={**receipt, name: wrong}, rgba=rgba)
            with self.assertRaises(ValueError):
                verify_gpu_resolution(receipt={}, rgba=rgba)

    def test_explicit_profile_budgets_and_gpu_transport(self):
        for mode, edge, budget, fields in [('preview', 1280, 16, {}),
                                          ('original', 4096, 64, {'resolutionMode': 'original'})]:
            with self.subTest(mode=mode), patch.dict(os.environ, {RESOLUTION_ENV: mode}):
                self.assertEqual(source_edge_limit(), edge)
                self.assertEqual(frame_byte_limit(), budget*1024**2)
                self.assertEqual(gpu_request_fields(), fields)
        for mode in ['', 'native', '4096', True, 4096, None]:
            with self.subTest(mode=mode), self.assertRaises(ValueError):
                resolution_mode(mode=mode)
        with patch.dict(os.environ, {RESOLUTION_ENV: 'invalid'}), self.assertRaises(ValueError):
            gpu_request_fields()

    def test_original_decoder_keeps_exif_oriented_pixels_and_does_not_thumbnail(self):
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory)/'original.png'
            pixels = np.zeros((160, 2048, 3), np.uint8)
            pixels[..., 0] = np.arange(2048, dtype=np.uint16) % 251
            exif = Image.Exif()
            exif[274] = 6
            Image.fromarray(pixels).save(image, exif=exif)
            with Image.open(image) as source:
                expected = np.asarray(ImageOps.exif_transpose(source).convert('RGBA'))
            with patch.dict(os.environ, {RESOLUTION_ENV: 'original'}):
                decoded = decode_image(image=image, max_edge=1280)
            np.testing.assert_array_equal(decoded['rgba'], expected)
            self.assertEqual(decoded['decoded_size'], [160, 2048])
            with patch.dict(os.environ, {RESOLUTION_ENV: 'preview'}):
                self.assertEqual(decode_image(image=image, max_edge=1280)['decoded_size'], [100, 1280])
                with self.assertRaises(ValueError):
                    read_rgba(path=image)

    def test_4096_square_exact_budget_and_analysis_remains_640(self):
        rgba = np.zeros((4096, 4096, 4), np.uint8)
        with patch.dict(os.environ, {RESOLUTION_ENV: 'original'}):
            validate_rgba(rgba=rgba)
            self.assertEqual(rgba.nbytes, frame_byte_limit())
            self.assertEqual(algorithm_size(width=4096, height=4096), (640, 640))
            self.assertEqual(algorithm_size(width=2048, height=1536), (640, 480))
        with patch.dict(os.environ, {RESOLUTION_ENV: 'preview'}):
            with self.assertRaises(ValueError):
                validate_rgba(rgba=rgba)
            with self.assertRaises(ValueError):
                algorithm_size(width=2048, height=1536)

    def test_original_oversize_rejects_instead_of_resizing_and_alpha_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory)/'oversize.png'
            Image.new('RGB', (4097, 160)).save(image)
            with patch.dict(os.environ, {RESOLUTION_ENV: 'original'}):
                with self.assertRaisesRegex(ValueError, 'resizing is not performed'):
                    decode_image(image=image, max_edge=1280)
            with self.assertRaises(ValueError):
                read_rgba(path=image, resolution='original')
            Image.new('RGBA', (2048, 160), (1, 2, 3, 254)).save(image)
            with self.assertRaisesRegex(ValueError, 'opaque'):
                read_rgba(path=image, resolution='original')


if __name__ == '__main__':
    unittest.main()
