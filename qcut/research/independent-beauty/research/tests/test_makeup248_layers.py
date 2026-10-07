from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from makeup248_layers import render_layers


class Makeup248LayerTests(unittest.TestCase):
    def render_blush(self, *, pigment, reflect):
        rgba = np.full((2, 2, 4), 128, np.uint8)
        rgba[..., 3] = 255
        positions = np.zeros((248, 2), np.float32)
        positions[:4] = [[0, 0], [2, 0], [0, 2], [2, 2]]
        uv = positions / np.float32(2)
        triangles = np.zeros((371, 3), np.uint16)
        triangles[:2] = [[0, 1, 2], [2, 1, 3]]
        assets = {'texture_transform': np.eye(4, dtype=np.float32), 'uv': uv,
                  'triangles': triangles, 'position_scale': np.ones(2, np.float32)}
        layers = [{'path': 'pigment.png', 'mode': 'multiply', 'sha256': 'unused'},
                  {'path': 'reflect.png', 'mode': 'normal', 'sha256': 'unused'}]
        original = pigment.copy()
        with tempfile.TemporaryDirectory() as directory, patch('makeup_pigment_pass.load_texture',
                side_effect=[pigment, reflect]) as loader:
            result, diagnostics = render_layers(rgba=rgba, positions=positions, assets=assets,
                layers=layers, package=Path(directory), strength=1., runtime=Path(directory),
                pass_name='Blusher')
        self.assertTrue(all(call.kwargs['premultiply'] is False for call in loader.call_args_list))
        np.testing.assert_array_equal(pigment, original)
        self.assertEqual(diagnostics['gpu']['private_native_images'], [])
        self.assertEqual(diagnostics['gpu']['layers'], ['Blusher'])
        self.assertEqual(diagnostics['gpu']['pixelFormat'], 'RGBA8Unorm')
        return result

    def test_low_alpha_integer_decode_preserves_white_multiply(self):
        result = self.render_blush(pigment=np.array([[[181, 180, 180, 2]]], np.uint8),
                                  reflect=np.zeros((1, 1, 4), np.uint8))
        expected = np.broadcast_to(np.array([128, 128, 128, 255], np.uint8), result.shape)
        np.testing.assert_array_equal(result, expected)

    def test_two_blends_quantize_only_after_reflect(self):
        result = self.render_blush(pigment=np.array([[[128, 128, 128, 128]]], np.uint8),
                                  reflect=np.array([[[0, 0, 0, 1]]], np.uint8))
        # An intermediate RGBA8 render target changes this observed boundary from 95 to 96.
        expected = np.broadcast_to(np.array([95, 95, 95, 255], np.uint8), result.shape)
        np.testing.assert_array_equal(result, expected)

    def test_unverified_pass_modes_and_cpu_coverage_are_rejected(self):
        for name, layers, coverage in [('Lip', [], None), ('Blusher', [], None),
                                       ('Stereo', [{'mode': 'normal'}], None),
                                       ('Stereo', [{'mode': 'soft-light'}], 8)]:
            with self.assertRaisesRegex(ValueError, 'pinned single-pass'):
                render_layers(rgba=None, positions=None, assets=None, layers=layers,
                    package=Path('.'), strength=1., runtime=Path('.'), pass_name=name,
                    coverage_bits=coverage)


if __name__ == '__main__':
    unittest.main()
