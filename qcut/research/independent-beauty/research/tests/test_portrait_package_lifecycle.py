import hashlib
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import liquefy_combination_render
from portrait_features_render import render_rgba, split_controls


def rgba_hash(*, rgba):
    return hashlib.sha256(rgba.tobytes()).hexdigest()


def package_receipt(*, source, result, local=False):
    return {'predictionCount': 1, 'meshPassCount': 2 if local else 1,
        'inputRgbaSha256': rgba_hash(rgba=source), 'outputRgbaSha256': rgba_hash(rgba=result),
        'sharedLocalPredictionCount': 1 if local else 0,
        'passOrder': ['underjaw', 'lower_atrium'] if local else ['LinkedOrgans'],
        'photoSamplePassCount': 1, 'alignment': {'source': 'independent'},
        'gpu': {'private_native_images': []}}


class PortraitPackageLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.rgba = np.full((10, 12, 4), 255, np.uint8)
        self.rgba[..., :3] = 40
        self.runtime = Path('unused-runtime')

    def test_common_only_preserves_the_original_18_control_fast_path(self):
        result = self.rgba.copy()
        result[..., 0] = 80
        original_receipt = {'scope': 'original-18', 'predictionCount': 1}
        with patch('portrait_features_render.face_features_render.render_rgba',
                   return_value=(result, original_receipt)) as common, \
                patch('portrait_features_render.liquefy_combination_render.render_rgba') as local:
            actual, receipt = render_rgba(rgba=self.rgba,
                controls={'TotalFace': 25, 'EnlargeEye': 35, 'underjaw': 0}, runtime=self.runtime)
        self.assertIs(actual, result)
        self.assertIs(receipt, original_receipt)
        common.assert_called_once_with(rgba=self.rgba,
            controls={'TotalFace': 25.0, 'EnlargeEye': 35.0}, runtime=self.runtime)
        local.assert_not_called()

    def test_mixed_packages_predict_each_package_input_in_native_order(self):
        face_pixels, final_pixels = self.rgba.copy(), self.rgba.copy()
        face_pixels[..., 0], final_pixels[..., 1] = 80, 120
        face_receipt = package_receipt(source=self.rgba, result=face_pixels)
        local_receipt = package_receipt(source=face_pixels, result=final_pixels, local=True)
        observed = []

        def common_render(**arguments):
            observed.append(('face', rgba_hash(rgba=arguments['rgba'])))
            return face_pixels, face_receipt

        def local_render(**arguments):
            observed.append(('features', rgba_hash(rgba=arguments['rgba'])))
            np.testing.assert_array_equal(arguments['rgba'], face_pixels)
            return final_pixels, local_receipt

        with patch('portrait_features_render.face_features_render.render_rgba', side_effect=common_render), \
                patch('portrait_features_render.liquefy_combination_render.render_rgba', side_effect=local_render):
            actual, receipt = render_rgba(rgba=self.rgba,
                controls={'TotalFace': 25, 'underjaw': 25, 'lower_atrium': -25}, runtime=self.runtime)
        self.assertEqual(observed, [('face', rgba_hash(rgba=self.rgba)),
                                    ('features', rgba_hash(rgba=face_pixels))])
        self.assertEqual(receipt['packageStages'], ['face', 'features'])
        self.assertEqual(receipt['predictionCount'], 2)
        self.assertEqual(receipt['sharedLocalPredictionCount'], 1)
        self.assertEqual(receipt['meshPassCount'], 3)
        self.assertEqual(receipt['photoSamplePassCount'], 2)
        self.assertEqual(receipt['packageReceipts']['face']['outputRgbaSha256'],
                         receipt['packageReceipts']['features']['inputRgbaSha256'])
        self.assertEqual(receipt['inputRgbaSha256'], rgba_hash(rgba=self.rgba))
        self.assertEqual(receipt['outputRgbaSha256'], rgba_hash(rgba=actual))
        np.testing.assert_array_equal(actual, final_pixels)

    def test_local_only_bypasses_inactive_common_prediction(self):
        local_receipt = package_receipt(source=self.rgba, result=self.rgba, local=True)
        with patch('portrait_features_render.face_features_render.render_rgba') as common, \
                patch('portrait_features_render.liquefy_combination_render.render_rgba',
                      return_value=(self.rgba.copy(), local_receipt)) as local:
            _, receipt = render_rgba(rgba=self.rgba,
                controls={'TotalFace': 0, 'underjaw': 25, 'lower_atrium': -25}, runtime=self.runtime)
        common.assert_not_called()
        self.assertEqual(local.call_count, 1)
        self.assertEqual(receipt['packageStages'], ['features'])
        self.assertEqual(receipt['predictionCount'], 1)
        self.assertEqual(receipt['sharedLocalPredictionCount'], 1)
        self.assertEqual(receipt['photoSamplePassCount'], 1)

    def test_zero_and_subthreshold_packages_need_no_models_or_gpu(self):
        for controls in ({}, {'TotalFace': 0, 'underjaw': 0},
                         {'TotalFace': .1, 'MoveEye': -.01, 'upper_atrium': .01}):
            with patch('face_features_render.single_face_prediction') as common_predict, \
                    patch('liquefy_combination_render.single_face_prediction') as local_predict, \
                    patch('face_features_render.render') as common_gpu, \
                    patch('liquefy_combination_render.render_passes') as local_gpu:
                actual, receipt = render_rgba(rgba=self.rgba, controls=controls, runtime=self.runtime)
            np.testing.assert_array_equal(actual, self.rgba)
            self.assertTrue(receipt['zeroControlsIdentity'])
            self.assertEqual(receipt['predictionCount'], 0)
            self.assertEqual(receipt['meshPassCount'], 0)
            for mocked in (common_predict, local_predict, common_gpu, local_gpu):
                mocked.assert_not_called()

    def test_invalid_mixed_requests_fail_before_either_package(self):
        invalid = (None, [], {1: 20}, {'unknown': 5}, {'underjaw': True},
            {'TotalFace': np.nan}, {'underjaw': np.inf}, {'TotalFace': 101}, {'underjaw': -51})
        with patch('portrait_features_render.face_features_render.render_rgba') as common, \
                patch('portrait_features_render.liquefy_combination_render.render_rgba') as local:
            for controls in invalid:
                with self.subTest(controls=controls), self.assertRaises(ValueError):
                    render_rgba(rgba=self.rgba, controls=controls, runtime=self.runtime)
            for rgba in (np.zeros((10, 12, 4), np.uint8), np.full((1, 1281, 4), 255, np.uint8)):
                with self.assertRaises(ValueError):
                    render_rgba(rgba=rgba, controls={'TotalFace': 25, 'underjaw': 25}, runtime=self.runtime)
        common.assert_not_called()
        local.assert_not_called()

    def test_split_controls_validates_both_packages_before_any_render(self):
        common, local = split_controls(values={'Nose': 60, 'underjaw': -25})
        self.assertEqual(common, {'Nose': 60.0})
        self.assertEqual(local['underjaw'], -25.0)
        self.assertEqual(sum(value != 0 for value in local.values()), 1)

    def test_local_entities_share_one_prediction_and_one_support(self):
        points = np.arange(212, dtype=np.float32).reshape(106, 2) / 1000
        prediction = {'normalized_points': points.tolist(), 'yaw': 12.5}
        support, assets = {'uv': np.zeros((2270, 2), np.float32)}, {}
        with tempfile.TemporaryDirectory() as directory:
            runtime = Path(directory)
            with patch.dict(sys.modules, {'worker': SimpleNamespace(MODELS=runtime / 'research')}), \
                    patch('liquefy_combination_render.single_face_prediction', return_value=prediction) as predict, \
                    patch('liquefy_combination_render.load_assets', return_value=assets), \
                    patch('liquefy_combination_render.generate_support', return_value=support) as generate, \
                    patch('liquefy_combination_render.build_control_pass', return_value={}) as build, \
                    patch('liquefy_combination_render.render_passes',
                          return_value=(self.rgba.copy(), {'private_native_images': []})) as gpu:
                _, receipt = liquefy_combination_render.render_rgba(rgba=self.rgba,
                    controls={'underjaw': 25, 'pointy_chin': -25}, runtime=runtime)
        predict.assert_called_once_with(rgba=self.rgba)
        self.assertEqual(generate.call_count, 1)
        self.assertEqual(build.call_count, 2)
        self.assertEqual(gpu.call_count, 1)
        first, second = build.call_args_list
        self.assertIs(first.kwargs['points'], second.kwargs['points'])
        self.assertIs(first.kwargs['support'], second.kwargs['support'])
        self.assertEqual(first.kwargs['yaw_radians'], second.kwargs['yaw_radians'])
        self.assertEqual(receipt['predictionCount'], 1)
        self.assertEqual(receipt['sharedLocalPredictionCount'], 1)
        self.assertEqual(receipt['photoSamplePassCount'], 1)
        self.assertEqual(receipt['meshPassCount'], 2)


if __name__ == '__main__':
    unittest.main()
