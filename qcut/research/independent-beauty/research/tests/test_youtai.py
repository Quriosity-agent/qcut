import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from youtai_assets import load_assets
from youtai_organs import transform_eyes, transform_mouth, transform_nose
from youtai_render import run, validate_intensity


class YouTaiTests(unittest.TestCase):
    def test_zero_needs_neither_landmarks_assets_nor_gpu(self):
        rgba = np.arange(64, dtype=np.uint8).reshape(4, 4, 4)
        rgba[..., 3] = 255
        with tempfile.TemporaryDirectory() as temporary, patch('youtai_render.single_face_prediction') as infer, patch('youtai_render.render') as gpu:
            root = Path(temporary)
            receipt = run(rgba=rgba, intensity=0, runtime=root/'missing', output=root/'zero.png', report=root/'zero.json')
            np.testing.assert_array_equal(np.asarray(Image.open(root/'zero.png')), rgba)
            self.assertIsNone(receipt['alignment'])
            self.assertEqual(receipt['changedPixels'], 0)
            self.assertEqual(receipt['inputRgbaSha256'], receipt['outputRgbaSha256'])
            self.assertEqual(json.loads((root/'zero.json').read_text())['gpu'], None)
            infer.assert_not_called()
            gpu.assert_not_called()

    def test_invalid_values_and_alpha_fail_before_inference(self):
        for value in (True, np.bool_(False), -1, 101, np.nan, np.inf, '50', None):
            with self.assertRaises(ValueError):
                validate_intensity(intensity=value)
        with tempfile.TemporaryDirectory() as temporary, patch('youtai_render.single_face_prediction') as infer:
            root = Path(temporary)
            with self.assertRaises(ValueError):
                run(rgba=np.zeros((2, 2, 4), np.uint8), intensity=100, runtime=root, output=root/'bad.png', report=root/'bad.json')
            infer.assert_not_called()

    def test_asset_identity_rejects_tampered_or_extra_fields(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)/'bad.npz'
            np.savez(path, eye_zoom=np.zeros((18, 3), np.float32))
            with self.assertRaises(ValueError):
                load_assets(path=path)

    def test_nose_width_updates_in_order_and_preserves_landmarks(self):
        points = np.zeros((106, 2), np.float32)
        points[77] = [10, 0]
        points[51], points[50], points[49] = [4, 5], [5, 5], [6, 5]
        degrees = np.zeros(23, np.float32)
        degrees[4] = .1
        original = points.copy()
        result = transform_nose(source=points, target=points, degrees=degrees, yaw=0,
                                assets={'constants': np.array([0, 0, .8, 0])})
        # The second side support reads the first support's updated position.
        first = np.float32(4) + np.float32(4-5)*np.float32(1.1)*np.float32(.2)
        second = np.float32(5) + (first-np.float32(5))*np.float32(1.1)*np.float32(.2)
        self.assertEqual(result[4, 0], first)
        self.assertEqual(result[5, 0], second)
        np.testing.assert_array_equal(points, original)

    def test_rotation_reads_updated_x_for_y(self):
        source = np.zeros((106, 2), np.float32)
        source[52] = [1, 1]
        target = source.copy()
        degrees = np.zeros(23, np.float32)
        degrees[2] = 1
        assets = {'constants': np.array([np.pi/2, .4, .8, .3]),
                  'eye_rotate_left': np.array([52]), 'eye_rotate_right': np.array([], np.int32)}
        with patch('youtai_organs.eyes', return_value=np.zeros((78, 2), np.float32)), patch('youtai_organs.space_eyes'):
            transform_eyes(source=source, target=target, degrees=degrees, pitch=0, mesh_assets={}, assets=assets)
        np.testing.assert_array_equal(target[52], [1, -1])
        np.testing.assert_array_equal(source[52], [1, 1])

    def test_degenerate_active_mouth_fails(self):
        degrees = np.zeros(23, np.float32)
        degrees[7] = -.2
        with self.assertRaises(ValueError):
            transform_mouth(target=np.zeros((106, 2), np.float32), degrees=degrees, assets={})

    def test_mouth_width_fades_when_one_corner_has_less_cheek_clearance(self):
        for left_clearance, right_clearance, expected_size in ((8, 1, -.025), (1, 8, -.025), (2, 1, -.2)):
            points = np.zeros((106, 2), np.float32)
            points[84], points[90] = [-2, 0], [2, 0]
            points[8], points[24] = [-2-left_clearance, 0], [2+right_clearance, 0]
            degrees = np.zeros(23, np.float32)
            degrees[7] = -.2
            assets = {'constants': np.array([0, 0, 0, .3]),
                'mouth_left': np.array([84]), 'mouth_right': np.array([90])}
            with patch('youtai_organs.mouth', side_effect=lambda *, points: points.copy()):
                result = transform_mouth(target=points.copy(), degrees=degrees, assets=assets)
            weight = np.float32(float(np.float32(expected_size))*.3)
            np.testing.assert_array_equal(result[[84, 90]], points[[84, 90]]*(np.float32(1)+weight))

    def test_nose_yaw_fades_the_opposite_side_after_twenty_degrees(self):
        source = np.zeros((106, 2), np.float32)
        source[77] = [10, 0]
        degrees = np.zeros(23, np.float32)
        degrees[4] = .1
        for yaw, left, right in ((20, .4, -.4), (-20, .4, -.4), (35, .4, -.2), (-35, .2, -.4)):
            with patch('youtai_organs.nose', return_value=np.zeros((28, 2), np.float32)):
                result = transform_nose(source=source, target=source, degrees=degrees, yaw=yaw, assets={
                    'constants': np.zeros(4)})
            self.assertEqual(result[2, 0], np.float32(left))
            self.assertEqual(result[9, 0], np.float32(right))


if __name__ == '__main__':
    unittest.main()
