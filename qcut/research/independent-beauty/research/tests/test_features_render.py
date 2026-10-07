from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from face_metal import render
from features_render import render_rgba


def identity_mesh():
    vertices = np.zeros((315, 5), np.float32)
    vertices[:4, :2] = [[-1, 1], [1, 1], [-1, -1], [1, -1]]
    vertices[:4, 3:] = [[0, 1], [1, 1], [0, 0], [1, 0]]
    triangles = np.zeros((597, 3), np.uint16)
    triangles[:2] = [[0, 1, 2], [2, 1, 3]]
    return {'name': 'LinkedOrgans', 'vertices': vertices, 'triangles': triangles}


class FeaturesRenderTests(unittest.TestCase):
    def test_zero_is_identity_without_prediction_assets_or_gpu(self):
        rgba = np.arange(64, dtype=np.uint8).reshape(4, 4, 4)
        rgba[..., 3] = 255
        original = rgba.copy()
        with patch('features_render.single_face_prediction') as predict, patch('features_render.render') as gpu:
            result, receipt = render_rgba(rgba=rgba, controls={'Nose': 0}, runtime=Path('missing'))
        np.testing.assert_array_equal(result, original)
        np.testing.assert_array_equal(rgba, original)
        self.assertTrue(receipt['zeroControlsIdentity'])
        self.assertFalse(receipt['nativePixelsUsed'])
        self.assertFalse(receipt['nativeGeometryUsed'])
        self.assertEqual(receipt['independence']['private_native_images'], [])
        self.assertIsNone(receipt['alignment'])
        predict.assert_not_called()
        gpu.assert_not_called()

    def test_invalid_input_fails_before_prediction(self):
        with patch('features_render.single_face_prediction') as predict:
            for rgba, controls in ((np.zeros((2, 2, 4), np.uint8), {'Nose': 50}),
                    (np.full((1, 1281, 4), 255, np.uint8), {'Nose': 50}),
                    (np.full((2, 2, 4), 255, np.uint8), {'EnlargeEye': np.nan})):
                with self.assertRaises(ValueError):
                    render_rgba(rgba=rgba, controls=controls, runtime=Path('missing'))
            predict.assert_not_called()

    def test_features_gpu_is_one_pass_with_correct_orientation_and_no_private_library(self):
        rgba = np.array([[[10, 20, 30, 255], [80, 100, 120, 255]],
                         [[160, 180, 200, 255], [220, 230, 240, 255]]], np.uint8)
        with tempfile.TemporaryDirectory() as temporary:
            result, receipt = render(rgba=rgba, passes=[identity_mesh()], runtime=Path(temporary), profile='features')
        np.testing.assert_array_equal(result, rgba)
        self.assertEqual(receipt['profile'], 'features')
        self.assertEqual(receipt['passes'], ['LinkedOrgans'])
        self.assertEqual(receipt['private_native_images'], [])
        self.assertEqual(len(receipt['sourceSha256']), 64)
        self.assertEqual(len(receipt['hostSha256']), 64)

    def test_features_rejects_legacy_two_pass_shape_and_default_requires_it(self):
        rgba = np.full((2, 2, 4), 255, np.uint8)
        with patch('face_metal.build_host') as compile_host:
            with self.assertRaises(ValueError):
                render(rgba=rgba, passes=[identity_mesh()], runtime=Path('missing'))
            with self.assertRaises(ValueError):
                render(rgba=rgba, passes=[identity_mesh(), identity_mesh()], runtime=Path('missing'), profile='features')
            compile_host.assert_not_called()


if __name__ == '__main__':
    unittest.main()
