from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from makeup_metal import premultiply_rgba8, render


class MakeupMetalTests(unittest.TestCase):
    def test_integer_png_decode_matches_observed_vectors_without_mutating_input(self):
        rgba = np.array([[[181, 180, 180, 2], [52, 26, 18, 69], [176, 203, 120, 3],
            [52, 36, 18, 3], [255, 129, 125, 255], [255, 255, 255, 1], [255, 255, 255, 0]]], np.uint8)
        original = rgba.copy()
        expected = np.array([[[2, 2, 2, 2], [14, 7, 4, 69], [2, 3, 1, 3],
            [0, 0, 0, 3], [255, 129, 125, 255], [1, 1, 1, 1], [0, 0, 0, 0]]], np.uint8)
        np.testing.assert_array_equal(premultiply_rgba8(rgba=rgba), expected)
        np.testing.assert_array_equal(rgba, original)

    def test_non_rgba_bytes_are_rejected(self):
        for rgba in (np.zeros((1, 1, 4), np.float32), np.zeros((1, 1, 3), np.uint8)):
            with self.assertRaises(ValueError):
                premultiply_rgba8(rgba=rgba)

    def passes(self, *, darken=False):
        entries = []
        for name in ('Brow', 'Eyeshadow', 'Eyeline', 'Eyemazing', 'Eyelash', 'Cutoff', 'Pupil', 'Stereo', 'Blusher', 'Lip'):
            count = 78 if name == 'Pupil' else 248 if name in ('Brow', 'Stereo', 'Blusher', 'Lip') else 174
            indices = 342 if count == 78 else 1113 if count == 248 else 1002
            vertices = np.zeros((count, 8), np.float32)
            vertices[:4, :2] = [[0, 0], [2, 0], [0, 2], [2, 2]]
            vertices[:4, 2:4] = [[0, 0], [1, 0], [0, 1], [1, 1]]
            vertices[:, 4] = 1
            triangles = np.zeros((indices//3, 3), np.uint16)
            triangles[:2] = [[0, 1, 2], [2, 1, 3]]
            color = [64, 128, 192, 255] if name == 'Lip' else [0, 0, 0, 0]
            mode = 0
            if name == 'Brow' and darken:
                color, mode = [128, 128, 128, 255], 1
            texture = np.array([[color]], np.uint8)
            entries.append({'name': name, 'vertices': vertices, 'triangles': triangles, 'textures': [texture],
                'modes': [mode], 'cutoff': name == 'Cutoff', 'pupil': name == 'Pupil',
                'strength': .5 if name == 'Lip' else 1.})
        return entries

    def test_real_owned_gpu_preserves_layer_order_and_opaque_alpha(self):
        rgba = np.full((2, 2, 4), 128, np.uint8)
        rgba[..., 3] = 255
        with tempfile.TemporaryDirectory() as temporary:
            for darken, expected in ((False, [96, 128, 160, 255]), (True, [64, 96, 128, 255])):
                result, receipt = render(rgba=rgba, passes=self.passes(darken=darken), runtime=Path(temporary))
                np.testing.assert_array_equal(result, np.broadcast_to(np.array(expected, np.uint8), rgba.shape))
                self.assertEqual(receipt['private_native_images'], [])
                self.assertEqual(receipt['pixelFormat'], 'RGBA8Unorm')
                self.assertEqual(receipt['layers'][-1], 'Lip')

    def test_asymmetric_original_keeps_orientation_through_transparent_passes(self):
        rgba = np.array([[[10, 20, 30, 255], [80, 100, 120, 255]],
            [[160, 180, 200, 255], [220, 230, 240, 255]]], np.uint8)
        entries = self.passes()
        entries[-1]['textures'] = [np.zeros((1, 1, 4), np.uint8)]
        with tempfile.TemporaryDirectory() as temporary:
            result, _ = render(rgba=rgba, passes=entries, runtime=Path(temporary))
        np.testing.assert_array_equal(result, rgba)

    def test_transparent_active_input_is_rejected(self):
        with self.assertRaises(ValueError):
            render(rgba=np.zeros((2, 2, 4), np.uint8), passes=[], runtime=Path('missing'))

    def test_shared_dynamic_gpu_uses_custom_color_and_fixed_order(self):
        rgba = np.full((2, 2, 4), 128, np.uint8)
        rgba[..., 3] = 255
        entries = [entry for entry in self.passes(darken=True) if entry['name'] in ('Brow', 'Blusher', 'Lip')]
        entries[1]['textures'] = [np.zeros((1, 1, 4), np.uint8)] * 2
        entries[1]['modes'] = [1, 0]
        entries[2]['modes'] = [1]
        entries[2]['customColor'] = [1., .5, 0.]
        entries.sort(key=lambda entry: ('Blusher', 'Brow', 'Lip').index(entry['name']))
        with tempfile.TemporaryDirectory() as temporary:
            result, receipt = render(rgba=rgba, passes=entries, runtime=Path(temporary))
            np.testing.assert_array_equal(result, np.broadcast_to(np.array([64, 48, 32, 255], np.uint8), rgba.shape))
            self.assertEqual(receipt['layers'], ['Blusher', 'Brow', 'Lip'])
            with self.assertRaises(subprocess.CalledProcessError):
                render(rgba=rgba, passes=entries[::-1], runtime=Path(temporary))

    def test_custom_pigment_color_rejects_invalid_vectors_and_nonlip_dispatch(self):
        rgba = np.full((2, 2, 4), 255, np.uint8)
        entry = self.passes()[-1]
        entry['modes'] = [1]
        with tempfile.TemporaryDirectory() as temporary:
            for color in ([1, 0], [1, 0, float('nan')], [1, 0, 1.1], [-.1, 0, 0]):
                with self.assertRaises(ValueError):
                    render(rgba=rgba, passes=[entry | {'customColor': color}], runtime=Path(temporary))
            with self.assertRaises(subprocess.CalledProcessError):
                render(rgba=rgba, passes=[entry | {'name': 'Brow', 'customColor': [1, .5, 0]}], runtime=Path(temporary))


if __name__ == '__main__':
    unittest.main()
