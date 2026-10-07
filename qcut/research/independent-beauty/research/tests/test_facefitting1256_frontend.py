from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from extra_photo import extra_inference, extra_pass
from facefitting1256_frontend import fitting_face
from facefitting1256_solver import classical_camera


class ClassicalCameraTests(unittest.TestCase):
    def test_odd_algorithm_dimensions_truncate_each_principal_coordinate(self):
        np.testing.assert_array_equal(classical_camera(size=(479, 640)), [640, 239, 320])
        np.testing.assert_array_equal(classical_camera(size=(640, 541)), [640, 320, 270])
        np.testing.assert_array_equal(classical_camera(size=(541, 479)), [541, 270, 239])
        self.assertEqual(classical_camera(size=(640, 640)).dtype, np.float32)

    def test_invalid_dimensions_fail_before_fitting(self):
        for size in ([640, 640], (640,), (True, 640), (0, 640), (640, 4097), (479.5, 640)):
            with self.subTest(size=size), self.assertRaises(ValueError):
                classical_camera(size=size)


class FittingFrontendTests(unittest.TestCase):
    def test_fitting_tracks_raw_extra_and_solves_smoothed_targets(self):
        pixels = np.full((32, 32, 4), 128, np.uint8)
        warm = {'tracked': np.full((106, 2), 10, np.float32),
            'seed': np.full((106, 2), 7, np.float32), 'algorithm': pixels}
        raw = np.full((240, 2), 12, np.float32)
        targets = raw.copy()
        targets[:33] = 8
        final = np.full((240, 2), 16, np.float32)
        result = {'tracked': np.full((106, 2), 14, np.float32), 'algorithm': pixels}
        order = []
        engine = Mock()
        engine.refine_tracking.side_effect = lambda **kwargs: order.append('raw-feedback')
        engine.process.side_effect = lambda **kwargs: order.append('reset') or result

        def infer_warm(**kwargs):
            order.append('warm-inference')
            self.assertTrue(kwargs['fitting_history'])
            self.assertTrue(kwargs['reset'])
            np.testing.assert_array_equal(kwargs['primary'], warm['tracked'])
            return raw, {'reset': True, 'points': raw.tolist()}

        def smooth_targets(**kwargs):
            order.append('targets')
            np.testing.assert_array_equal(kwargs['points'], raw)
            return targets

        def infer_final(**kwargs):
            order.append('final-inference')
            self.assertTrue(kwargs['fitting_history'])
            self.assertFalse(kwargs['reset'])
            np.testing.assert_array_equal(kwargs['primary'], result['tracked'])
            np.testing.assert_array_equal(kwargs['seed'], warm['seed'])
            return final, {'reset': False, 'points': final.tolist()}

        with patch('facefitting1256_frontend.start_photo',
                return_value=(engine, warm, {'mode': 'reset-120'}, (32, 32))), \
                patch('facefitting1256_frontend.describe_photo', return_value={}), \
                patch('facefitting1256_frontend.extra_inference', side_effect=infer_warm) as inference, \
                patch('facefitting1256_frontend.warm_fitting_points', side_effect=smooth_targets), \
                patch('facefitting1256_frontend.extra_pass', side_effect=infer_final):
            prediction = fitting_face(rgba=pixels, face={'box': [1, 1, 20, 20],
                'algorithm_box': [1, 1, 20, 20]}, model_root=Path('unused'), means={},
                model=Mock(), alignment_assets={}, alignment_models={})
        self.assertEqual(order, ['warm-inference', 'targets', 'raw-feedback', 'reset', 'final-inference'])
        inference.assert_called_once()
        np.testing.assert_array_equal(engine.refine_tracking.call_args.kwargs['points'], raw[:106])
        np.testing.assert_array_equal(prediction['extraPasses'][0]['points'], targets)
        np.testing.assert_array_equal(prediction['extraPoints'], final)
        np.testing.assert_array_equal(raw, np.full((240, 2), 12, np.float32))

    def test_shared_extra_inference_preserves_raw_points_and_runs_model_once(self):
        geometry = {key: np.eye(2, 3, dtype=np.float32) for key in
            ('forward', 'inverse', 'stage2_forward', 'stage2_inverse')}
        points = np.full((240, 2), 12, np.float32)
        tensor = np.zeros((1, 160, 160, 3), np.int16)
        model = Mock(infer=Mock(return_value=np.zeros((240, 2), np.float32)))
        with patch('extra_photo.crop_geometry', return_value=geometry), \
                patch('extra_photo.signed_extra_input', return_value=tensor), \
                patch('extra_photo.decode_extra', return_value=points), \
                patch('extra_photo.warm_fitting_points') as smoothing:
            result, receipt = extra_inference(primary=np.empty((106, 2)), seed=np.empty((106, 2)),
                means={'part': None, 'extra': None}, model=model, frame=None, size=(640, 640),
                reset=True, fitting_history=True)
        model.infer.assert_called_once_with(tensor=tensor)
        smoothing.assert_not_called()
        np.testing.assert_array_equal(result, points)
        np.testing.assert_array_equal(receipt['points'], points)

    def test_shared_extra_pass_keeps_each_existing_profile(self):
        raw = np.full((240, 2), 12, np.float32)
        filtered = np.full((240, 2), 10, np.float32)
        for fitting_history, reset in ((False, True), (False, False), (True, True), (True, False)):
            with self.subTest(fitting_history=fitting_history, reset=reset), \
                    patch('extra_photo.extra_inference', return_value=(raw, {'points': raw.tolist()})) as infer, \
                    patch('extra_photo.warm_fitting_points', return_value=filtered) as smoothing:
                result, receipt = extra_pass(primary=None, seed=None, means=None, model=None,
                    frame=None, size=(640, 640), reset=reset, fitting_history=fitting_history)
                expected = filtered if fitting_history and reset else raw
                np.testing.assert_array_equal(result, expected)
                np.testing.assert_array_equal(receipt['points'], expected)
                infer.assert_called_once()
                self.assertEqual(smoothing.call_count, int(fitting_history and reset))


if __name__ == '__main__':
    unittest.main()
