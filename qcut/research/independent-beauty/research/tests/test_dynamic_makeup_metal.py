import hashlib
import json
from pathlib import Path
import sys
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from makeup_metal import render


class DynamicMakeupMetalTests(unittest.TestCase):
    def lip_pass(self):
        vertices = np.zeros((248, 8), np.float32)
        vertices[:4, :2] = [[0, 0], [2, 0], [0, 2], [2, 2]]
        vertices[:4, 2:4] = [[0, 0], [1, 0], [0, 1], [1, 1]]
        vertices[:, 4] = 1
        triangles = np.zeros((371, 3), np.uint16)
        triangles[:2] = [[0, 1, 2], [2, 1, 3]]
        return {'name': 'Lip', 'vertices': vertices, 'triangles': triangles,
            'textures': [np.array([[[80, 30, 20, 128]]], np.uint8)],
            'modes': [1], 'cutoff': False, 'pupil': False, 'strength': 1.,
            'customColor': [.5, 1., 0.]}

    def image(self):
        rgba = np.full((2, 2, 4), 100, np.uint8)
        rgba[..., 3] = 255
        return rgba

    def test_real_gpu_custom_color_uses_texture_alpha_and_respects_strength(self):
        rgba = self.image()
        original = rgba.copy()
        pigment = self.lip_pass()
        texture, vertices = pigment['textures'][0].copy(), pigment['vertices'].copy()
        with tempfile.TemporaryDirectory() as temporary:
            for strength, expected in ((1., [75, 100, 50, 255]), (.5, [87, 100, 75, 255])):
                pigment['strength'] = strength
                result, receipt = render(rgba=rgba, passes=[pigment], runtime=Path(temporary))
                np.testing.assert_array_equal(result, np.broadcast_to(np.array(expected, np.uint8), rgba.shape))
                self.assertEqual(receipt['layers'], ['Lip'])
                self.assertEqual(receipt['private_native_images'], [])
                self.assertEqual(receipt['pixelFormat'], 'RGBA8Unorm')
        np.testing.assert_array_equal(rgba, original)
        np.testing.assert_array_equal(pigment['textures'][0], texture)
        np.testing.assert_array_equal(pigment['vertices'], vertices)

    def test_malformed_custom_color_rejects_before_render_process(self):
        with tempfile.TemporaryDirectory() as temporary:
            host = Path(temporary)/'host'
            host.write_bytes(b'bounded-test-host')
            pigment = self.lip_pass()
            with patch('makeup_metal.build_host', return_value=(host, {}, 'source')), \
                    patch('makeup_metal.subprocess.run') as process:
                for color in ([0, 1], [0, 1, 2], [-.001, 0, 1], [0, np.nan, 1], [0, np.inf, 1]):
                    pigment['customColor'] = color
                    with self.subTest(color=color), self.assertRaises(ValueError):
                        render(rgba=self.image(), passes=[pigment], runtime=Path(temporary))
                process.assert_not_called()

    def test_real_gpu_rejects_reversed_dynamic_order_and_unpinned_blend(self):
        lip = self.lip_pass()
        brow = {key: value for key, value in lip.items() if key != 'customColor'} | {'name': 'Brow'}
        wrong_blend = lip | {'modes': [0]}
        with tempfile.TemporaryDirectory() as temporary:
            for passes in ([lip, brow], [wrong_blend]):
                with self.subTest(order=[entry['name'] for entry in passes]), self.assertRaises(subprocess.CalledProcessError):
                    render(rgba=self.image(), passes=passes, runtime=Path(temporary))

    def test_contour_group_is_canonical_and_uses_only_soft_light(self):
        lip = self.lip_pass()
        plain = {key: value for key, value in lip.items() if key != 'customColor'}
        brow = plain | {'name': 'Brow'}
        contour = plain | {'name': 'Stereo', 'modes': [3]}
        blush = plain | {'name': 'Blusher', 'modes': [1, 0], 'textures': plain['textures']*2}
        with tempfile.TemporaryDirectory() as temporary:
            result, receipt = render(rgba=self.image(), passes=[contour, blush, brow, lip], runtime=Path(temporary))
            self.assertEqual(receipt['layers'], ['Stereo', 'Blusher', 'Brow', 'Lip'])
            self.assertTrue(np.all(result[..., 3] == 255))
            for passes in ([brow, contour, blush, lip], [brow, blush, contour, lip], [contour, contour],
                           [contour | {'modes': [1]}], [contour | {'modes': [2]}]):
                with self.subTest(order=[entry['name'] for entry in passes]), self.assertRaises(subprocess.CalledProcessError):
                    render(rgba=self.image(), passes=passes, runtime=Path(temporary))

    def test_eye_family_uses_observed_dynamic_order_and_rejects_wrong_meshes(self):
        lip = self.lip_pass()
        plain = {key: value for key, value in lip.items() if key != 'customColor'}
        contour = plain | {'name': 'Stereo', 'modes': [3]}
        blush = plain | {'name': 'Blusher', 'modes': [1, 0], 'textures': plain['textures']*2}
        brow = plain | {'name': 'Brow'}
        eye = plain | {'vertices': plain['vertices'][:174].copy(),
                       'triangles': plain['triangles'][:334].copy()}
        line = eye | {'name': 'Eyeline'}
        shadow = eye | {'name': 'Eyeshadow', 'modes': [1, 2], 'textures': eye['textures']*2}
        aegyo = shadow | {'name': 'Eyemazing'}
        ordered = [contour, blush, brow, line, shadow, aegyo, lip]
        with tempfile.TemporaryDirectory() as temporary:
            result, receipt = render(rgba=self.image(), passes=ordered, runtime=Path(temporary))
            self.assertEqual(receipt['layers'], ['Stereo', 'Blusher', 'Brow', 'Eyeline', 'Eyeshadow', 'Eyemazing', 'Lip'])
            self.assertTrue(np.all(result[..., 3] == 255))
            for passes in ([shadow, line], [line | {'vertices': plain['vertices']}],
                           [aegyo | {'modes': [1, 0]}], [line, line]):
                with self.subTest(order=[entry['name'] for entry in passes]), self.assertRaises(subprocess.CalledProcessError):
                    render(rgba=self.image(), passes=passes, runtime=Path(temporary))

    def test_private_gpu_receipt_is_rejected_even_when_output_pixels_exist(self):
        rgba = self.image()

        def forbidden_receipt(command, **kwargs):
            request = json.loads(Path(command[1]).read_text())
            rgba.tofile(request['output'])
            Path(request['output']+'.json').write_text(json.dumps({'private_native_images': ['libAGFX.dylib']}))

        with tempfile.TemporaryDirectory() as temporary:
            host = Path(temporary)/'host'
            host.write_bytes(b'bounded-test-host')
            identity = hashlib.sha256(host.read_bytes()).hexdigest()
            with patch('makeup_metal.build_host', return_value=(host, {}, 'source')), \
                    patch('makeup_metal.subprocess.run', side_effect=forbidden_receipt):
                with self.assertRaisesRegex(ValueError, 'host integrity failed'):
                    render(rgba=rgba, passes=[self.lip_pass()], runtime=Path(temporary))
            self.assertEqual(hashlib.sha256(host.read_bytes()).hexdigest(), identity)


if __name__ == '__main__':
    unittest.main()
