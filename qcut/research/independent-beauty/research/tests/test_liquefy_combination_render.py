from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import liquefy_combination_render as renderer


class LocalPackageLifecycleTests(unittest.TestCase):
    def test_active_controls_share_one_prediction_and_support(self):
        rgba = np.full((3, 4, 4), 255, np.uint8)
        output = rgba.copy()
        output[0, 0, 0] = 42
        runtime = Path('/bounded-runtime')
        prediction = {'normalized_points': np.full((106, 2), .5, np.float32).tolist(), 'yaw': 12.5}
        assets = {'mean_points': np.zeros((106, 2), np.float32)}
        support, mean = {'positions': object(), 'uv': object()}, {'positions': object(), 'uv': object()}
        specifications = []

        def build(**parameters):
            self.assertIs(parameters['support'], support)
            self.assertIs(parameters['mean_uv'], mean['uv'])
            self.assertIs(parameters['rgba'], rgba)
            specifications.append(parameters)
            return {'control': parameters['control']}

        with patch.dict(sys.modules, {'worker': types.SimpleNamespace(MODELS=runtime / 'research')}), \
                patch.object(renderer, 'single_face_prediction', return_value=prediction) as predict, \
                patch.object(renderer, 'load_assets', return_value=assets), \
                patch.object(renderer, 'generate_support', side_effect=[support, mean]) as generate, \
                patch.object(renderer, 'build_control_pass', side_effect=build), \
                patch.object(renderer, 'render_passes', return_value=(output, {'private_native_images': []})) as gpu, \
                patch.object(renderer, 'native_images', return_value={'private_native_images': []}):
            result, receipt = renderer.render_rgba(rgba=rgba, controls={name: -25 for name in renderer.PASS_ORDER}, runtime=runtime)
        self.assertIs(result, output)
        predict.assert_called_once_with(rgba=rgba)
        self.assertEqual(generate.call_count, 2)
        self.assertEqual([item['control'] for item in specifications], list(renderer.PASS_ORDER))
        self.assertEqual(len({id(item['points']) for item in specifications}), 1)
        self.assertEqual(gpu.call_args.kwargs['passes'], [{'control': name} for name in renderer.PASS_ORDER])
        self.assertEqual(receipt['predictionCount'], 1)
        self.assertEqual(receipt['sharedLocalPredictionCount'], 1)
        self.assertEqual(receipt['meshPassCount'], 6)
        self.assertEqual(receipt['photoSamplePassCount'], 1)

    def test_zero_and_subthreshold_controls_do_not_load_models_or_gpu(self):
        rgba = np.full((3, 4, 4), 255, np.uint8)
        with patch.object(renderer, 'single_face_prediction') as predict, \
                patch.object(renderer, 'load_assets') as assets, \
                patch.object(renderer, 'generate_support') as support, \
                patch.object(renderer, 'render_passes') as gpu, \
                patch.object(renderer, 'native_images', return_value={'private_native_images': []}):
            for controls in ({}, {'upper_atrium': .02}, {'underjaw': -0.}):
                result, receipt = renderer.render_rgba(rgba=rgba, controls=controls, runtime=Path('/missing'))
                np.testing.assert_array_equal(result, rgba)
                self.assertIsNot(result, rgba)
                self.assertEqual(receipt['predictionCount'], 0)
                self.assertEqual(receipt['meshPassCount'], 0)
                self.assertTrue(receipt['zeroControlsIdentity'])
            for function in (predict, assets, support, gpu):
                function.assert_not_called()

    def test_input_validation_precedes_prediction(self):
        rgba = np.full((3, 4, 4), 255, np.uint8)
        with patch.object(renderer, 'single_face_prediction') as predict:
            for controls in ({'unknown': 20}, {'underjaw': True}, {'underjaw': float('nan')}, {'lower_atrium': 51}):
                with self.assertRaises(ValueError):
                    renderer.render_rgba(rgba=rgba, controls=controls, runtime=Path('/missing'))
            transparent = rgba.copy()
            transparent[0, 0, 3] = 254
            with self.assertRaises(ValueError):
                renderer.render_rgba(rgba=transparent, controls={'underjaw': 25}, runtime=Path('/missing'))
            predict.assert_not_called()


if __name__ == '__main__':
    unittest.main()
