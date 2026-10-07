from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from eye_metal_layers import render_layers


class EyeMetalLayerTests(unittest.TestCase):
    def mesh(self):
        positions = np.zeros((174, 2), np.float32)
        positions[:4] = [[0, 0], [2, 0], [0, 2], [2, 2]]
        triangles = np.zeros((334, 3), np.uint16)
        triangles[:2] = [[0, 1, 2], [2, 1, 3]]
        assets = {'texture_transform': np.eye(4, dtype=np.float32),
            'uv': positions/np.float32(2), 'triangles': triangles,
            'position_scale': np.ones(2, np.float32)}
        return positions, assets

    def test_integer_low_alpha_multiply_keeps_asymmetric_source_and_alpha(self):
        rgba = np.array([[[10, 20, 30, 255], [80, 100, 120, 255]],
            [[160, 180, 200, 255], [220, 230, 240, 255]]], np.uint8)
        positions, assets = self.mesh()
        original = rgba.copy()
        pigment = np.array([[[181, 180, 180, 2]]], np.uint8)
        with tempfile.TemporaryDirectory() as directory, patch('makeup_pigment_pass.load_texture',
                return_value=pigment) as loader:
            result, receipt = render_layers(rgba=rgba, positions=positions, assets=assets,
                layers=[{'path': 'pigment.png', 'mode': 'multiply', 'sha256': 'unused'}],
                package=Path(directory), strength=1., runtime=Path(directory))
        np.testing.assert_array_equal(result, original)
        np.testing.assert_array_equal(rgba, original)
        np.testing.assert_array_equal(pigment, np.array([[[181, 180, 180, 2]]], np.uint8))
        self.assertFalse(loader.call_args.kwargs['premultiply'])
        self.assertEqual(receipt['gpu']['private_native_images'], [])
        self.assertEqual(receipt['gpu']['layers'], ['Eyeline'])

    def test_multiply_and_screen_share_one_quantization_boundary(self):
        rgba = np.full((2, 2, 4), 128, np.uint8)
        rgba[..., 3] = 255
        positions, assets = self.mesh()
        pigments = [np.array([[[128, 128, 128, 128]]], np.uint8),
            np.array([[[128, 128, 128, 2]]], np.uint8)]
        with tempfile.TemporaryDirectory() as directory, patch('makeup_pigment_pass.load_texture',
                side_effect=pigments):
            result, receipt = render_layers(rgba=rgba, positions=positions, assets=assets,
                layers=[{'path': 'pigment.png', 'mode': mode, 'sha256': 'unused'}
                    for mode in ('multiply', 'screen')], package=Path(directory), strength=1.,
                runtime=Path(directory), pass_name='Eyemazing')
        # Quantizing after multiply alone would make the screen result 97.
        np.testing.assert_array_equal(result,
            np.broadcast_to(np.array([96, 96, 96, 255], np.uint8), rgba.shape))
        self.assertEqual(receipt['gpu']['layers'], ['Eyemazing'])

    def test_unverified_modes_geometry_and_coverage_fail_before_asset_or_gpu(self):
        for positions, modes, coverage in [(np.zeros((248, 2)), ['multiply'], None),
                (np.zeros((174, 2)), ['normal'], None),
                (np.zeros((174, 2)), ['multiply', 'normal'], None),
                (np.zeros((174, 2)), ['multiply'], 8)]:
            with self.assertRaisesRegex(ValueError, 'pinned single-pass eye'):
                render_layers(rgba=None, positions=positions, assets=None,
                    layers=[{'mode': mode} for mode in modes], package=Path('missing'),
                    strength=1., runtime=Path('missing'), coverage_bits=coverage)


if __name__ == '__main__':
    unittest.main()
