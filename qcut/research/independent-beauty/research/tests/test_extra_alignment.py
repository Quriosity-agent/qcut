from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from extra_photo import interleaved_face, predict_extra_photo
from slimface_detection import single_face_prediction
from test_alignment_transform import owned_core, owned_face


class ExtraAlignmentTests(unittest.TestCase):
    def test_refinement_keeps_filter_history_and_owns_fresh_points(self):
        engine = owned_core()
        pixels = np.full((32, 32, 4), 128, np.uint8)
        engine.process(rgba=pixels, size=(32, 32), index=0, face=owned_face())
        history, transform = engine.tracking_state, engine.transform
        refined = engine.tracking_points+np.float32(3)
        expected = refined.copy()
        engine.refine_tracking(points=refined)
        refined.fill(0)
        np.testing.assert_array_equal(engine.tracking_points, expected)
        self.assertIs(engine.tracking_state, history)
        self.assertIs(engine.transform, transform)

    def test_refinement_rejects_invalid_points_or_lifecycle_without_mutation(self):
        engine = owned_core()
        points = np.ones((106, 2), np.float32)
        with self.assertRaisesRegex(ValueError, 'fresh owned seed'):
            engine.refine_tracking(points=points)
        pixels = np.full((32, 32, 4), 128, np.uint8)
        packet = owned_face()
        engine.process(rgba=pixels, size=(32, 32), index=0, face=packet)
        original = engine.tracking_points.copy()
        for invalid in (points.astype(np.float64), points[:105], points*np.nan, points*40000):
            with self.assertRaises(ValueError):
                engine.refine_tracking(points=invalid)
            np.testing.assert_array_equal(engine.tracking_points, original)
        engine.process(rgba=pixels, size=(32, 32), index=1,
            face={**packet, 'mode': 'reset-120', 'initialization': None})
        with self.assertRaisesRegex(ValueError, 'fresh owned seed'):
            engine.refine_tracking(points=points)

    def test_extra_warmup_refines_tracking_before_reset_and_uses_each_base_result(self):
        pixels = np.full((32, 32, 4), 128, np.uint8)
        warm = {'tracked': np.full((106, 2), 10, np.float32),
            'seed': np.full((106, 2), 7, np.float32), 'algorithm': pixels}
        refined = np.full((240, 2), 12, np.float32)
        final = np.full((240, 2), 16, np.float32)
        result = {'tracked': np.full((106, 2), 14, np.float32), 'algorithm': pixels}
        order = []
        engine = Mock()
        engine.refine_tracking.side_effect = lambda **kwargs: order.append('refine')
        engine.process.side_effect = lambda **kwargs: order.append('reset') or result

        def extra_step(**kwargs):
            if kwargs['reset']:
                order.append('extra-warm')
                np.testing.assert_array_equal(kwargs['primary'], warm['tracked'])
                return refined, {'reset': True}
            order.append('extra-final')
            np.testing.assert_array_equal(kwargs['primary'], result['tracked'])
            np.testing.assert_array_equal(kwargs['seed'], warm['seed'])
            return final, {'reset': False}

        with patch('alignment_photo.start_photo', return_value=(engine, warm, {'mode': 'reset-120'}, (32, 32))), \
                patch('alignment_photo.describe_photo', return_value={'prob': [.1], 'seed_prob': [.1]}), \
                patch('extra_photo.extra_pass', side_effect=extra_step):
            prediction = interleaved_face(rgba=pixels, face={'box': [1, 1, 20, 20],
                'algorithm_box': [1, 1, 20, 20]}, model_root=Path('unused'), means={},
                model=Mock(), alignment_assets={}, alignment_models={})
        self.assertEqual(order, ['extra-warm', 'refine', 'reset', 'extra-final'])
        np.testing.assert_array_equal(engine.refine_tracking.call_args.kwargs['points'], refined[:106])
        np.testing.assert_array_equal(prediction['extraPoints'], final)
        self.assertEqual(prediction['extraPasses'], [{'reset': True}, {'reset': False}])

    def test_custom_prediction_keeps_seed_and_final_acceptance_checks(self):
        outputs = [{'prob': [.1], 'seed_prob': [.9]}, {'prob': [.2], 'seed_prob': [.1]}]
        predictor = Mock(side_effect=outputs)
        worker = Mock(detect=Mock(return_value=[{}, {}]), landmarks=Mock())
        with patch.dict(sys.modules, worker=worker):
            selected = single_face_prediction(rgba=np.full((32, 32, 4), 255, np.uint8), predictor=predictor)
        self.assertEqual(selected['prob'], [.2])
        worker.landmarks.assert_not_called()
        self.assertEqual(predictor.call_count, 2)

    def test_unverified_or_untyped_profiles_reject_before_models(self):
        for fitting, interleave in ((False, 1), (1, False), (True, True)):
            with patch('extra_photo.ExtraHeads') as model, self.assertRaises(ValueError):
                predict_extra_photo(rgba=np.full((32, 32, 4), 255, np.uint8), model_root=Path('missing'),
                    fitting_history=fitting, interleave_alignment=interleave)
            model.assert_not_called()


if __name__ == '__main__':
    unittest.main()
