import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from face_features_render import ASSET_NAMES, MODEL_NAMES, build_face_feature_mesh, render_rgba, run
from face_features_controls import combined_degrees
from features_render import build_feature_mesh
from test_slimface_mesh import fixture


class FaceFeaturesRenderTests(unittest.TestCase):
    def test_zero_and_subthreshold_controls_need_no_detection_assets_or_gpu(self):
        rgba = np.arange(64, dtype=np.uint8).reshape(4, 4, 4)
        rgba[..., 3] = 255
        original = rgba.copy()
        for controls in ({'TotalFace': 0, 'Nose': 0}, {'TotalFace': .1, 'MoveEye': -.03}):
            with patch('face_features_render.single_face_prediction') as predict, patch('face_features_render.render') as gpu:
                result, receipt = render_rgba(rgba=rgba, controls=controls, runtime=Path('missing'))
            np.testing.assert_array_equal(result, original)
            np.testing.assert_array_equal(rgba, original)
            self.assertTrue(receipt['zeroControlsIdentity'])
            self.assertEqual(receipt['predictionCount'], 0)
            self.assertEqual(receipt['meshPassCount'], 0)
            self.assertFalse(receipt['nativePixelsUsed'])
            self.assertFalse(receipt['nativeGeometryUsed'])
            self.assertIsNone(receipt['alignment'])
            predict.assert_not_called()
            gpu.assert_not_called()

    def test_invalid_input_fails_before_prediction(self):
        for rgba, controls in ((np.zeros((2, 2, 4), np.uint8), {'TotalFace': 50, 'Nose': 50}),
                (np.full((1, 1281, 4), 255, np.uint8), {'TotalFace': 50}),
                (np.full((2, 2, 4), 255, np.uint8), {'EnlargeEye': np.nan}),
                (np.full((2, 2, 4), 255, np.uint8), {'unknown': 10})):
            with patch('face_features_render.single_face_prediction') as predict, self.assertRaises(ValueError):
                render_rgba(rgba=rgba, controls=controls, runtime=Path('missing'))
            predict.assert_not_called()

    def test_combined_controls_detect_original_once_and_submit_one_mesh(self):
        rgba = np.full((2, 2, 4), 255, np.uint8)
        original = rgba.copy()
        controls = {'TotalFace': 50, 'EyeSpacing': -20, 'Nose': 50}
        prediction = {'points': np.zeros((106, 2), np.float32).tolist(),
                      'consumer_pose': {'yaw': 0, 'pitch': 0}}
        mesh = {'clip_positions': np.zeros((315, 3), np.float32),
                'texcoords': np.zeros((315, 2), np.float32),
                'triangles': np.zeros((597, 3), np.uint16)}
        with tempfile.TemporaryDirectory() as temporary:
            runtime = Path(temporary)
            (runtime / 'research').mkdir()
            for name in (*ASSET_NAMES, *MODEL_NAMES):
                (runtime / 'research' / name).write_bytes(b'fixture')
            with patch.dict(sys.modules, {'worker': SimpleNamespace(MODELS=runtime / 'research')}), \
                    patch('face_features_render.single_face_prediction', return_value=prediction) as predict, \
                    patch('face_features_render.build_face_feature_mesh', return_value=mesh) as build, \
                    patch('face_features_render.render', return_value=(rgba.copy(), {'profile': 'features'})) as gpu:
                result, receipt = render_rgba(rgba=rgba, controls=controls, runtime=runtime)
            predict.assert_called_once_with(rgba=rgba)
            build.assert_called_once_with(prediction=prediction, size=[2, 2],
                                          controls={name: float(value) for name, value in controls.items()}, runtime=runtime.resolve())
            self.assertEqual(gpu.call_count, 1)
            passes = gpu.call_args.kwargs['passes']
            self.assertEqual(len(passes), 1)
            self.assertEqual(passes[0]['name'], 'LinkedOrgans')
            self.assertEqual(passes[0]['vertices'].shape, (315, 5))
            self.assertEqual(gpu.call_args.kwargs['profile'], 'features')
            self.assertEqual(receipt['predictionCount'], 1)
            self.assertEqual(receipt['meshPassCount'], 1)
            np.testing.assert_array_equal(receipt['degrees'], combined_degrees(values=controls))
            self.assertEqual(set(receipt['assets']), set((*ASSET_NAMES, *MODEL_NAMES)))
            np.testing.assert_array_equal(result, original)
            np.testing.assert_array_equal(rgba, original)

    def test_existing_features_mesh_matches_combined_renderer_with_original_points(self):
        runtime = Path(__file__).resolve().parents[2] / 'runtime'
        points, _ = fixture()
        prediction = {'points': points.tolist(), 'consumer_pose': {'yaw': 0, 'pitch': 0}}
        original = json.loads(json.dumps(prediction))
        for controls in ({'EnlargeEye': 70, 'Nose': 60, 'ZoomMouth': -20},
                         {'EyeSpacing': -50, 'MoveEye': 50, 'MoveMouth': -25}):
            existing = build_feature_mesh(prediction=prediction, size=[640, 640], controls=controls, runtime=runtime)
            combined = build_face_feature_mesh(prediction=prediction, size=[640, 640], controls=controls, runtime=runtime)
            for key in existing:
                np.testing.assert_array_equal(combined[key], existing[key])
        self.assertEqual(prediction, original)

    def test_cli_run_preserves_source_and_rejects_existing_or_equal_outputs(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            image, output, report = directory / 'input.png', directory / 'output.png', directory / 'report.json'
            rgba = np.full((160, 170, 4), 255, np.uint8)
            rgba[0, 0, :3] = [4, 8, 12]
            Image.fromarray(rgba).save(image)
            original = image.read_bytes()
            receipt = run(image=image, output=output, report=report, controls={'TotalFace': 0, 'Nose': 0}, runtime=directory)
            np.testing.assert_array_equal(np.array(Image.open(output)), rgba)
            self.assertEqual(receipt, json.loads(report.read_text()))
            self.assertEqual(image.read_bytes(), original)
            for png, json_path in ((output, directory / 'next.json'), (directory / 'next.png', report),
                                   (directory / 'same', directory / 'same')):
                with self.assertRaises(ValueError):
                    run(image=image, output=png, report=json_path, controls={}, runtime=directory)


if __name__ == '__main__':
    unittest.main()
