"""Face rejection retries detection without leaking the rejected tracking history."""
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import body_video_face_sequence as module


class VideoFaceSequence(unittest.TestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        patch.object(module, 'RollFilter', side_effect=lambda: Mock(update=Mock(return_value=0))).start()
        self.sequence = module.BodyVideoFaceSequence.__new__(module.BodyVideoFaceSequence)
        self.sequence.root = Path('/unused-runtime')
        self.sequence.assets = {}
        self.sequence.models = {}
        self.sequence.detector = Mock()
        self.sequence.detector.detect.return_value = {'rects': np.asarray([[20, 20, 30, 40]], np.float32)}
        self.sequence.reset()
        self.algorithm = np.zeros((100, 100, 4), np.uint8)
        self.points = np.full((106, 2), 40, np.float32)
        self.result = {'points': self.points, 'tracked': self.points}
        self.fresh = Mock()
        self.fresh.process.return_value = self.result
        self.start = patch.object(module, 'start_video_face',
                                  return_value=(self.fresh, self.result, {'mode': 'update'}, (100, 100))).start()

    def track(self, *, failure=None):
        old = Mock()
        old.process.side_effect = failure
        old.process.return_value = self.result
        self.sequence.engine = old
        self.sequence.face = {'mode': 'update'}
        self.sequence.size = (100, 100)
        self.sequence.index = 8
        return old

    def test_tracking_rejection_redetects_once_on_the_same_image(self):
        old = self.track(failure=module.RejectedVideoFace('rejected tracking'))
        data, receipt = self.sequence.update(algorithm=self.algorithm)
        self.assertEqual(receipt['status'], 'redetected')
        self.assertEqual(data['faces'].shape, (1, 106, 2))
        self.assertEqual(old.process.call_count, 1)
        self.assertEqual(self.sequence.detector.detect.call_count, 1)
        self.assertIs(self.sequence.engine, self.fresh)
        self.assertEqual(self.sequence.index, 1)
        self.assertTrue(receipt['recovery']['active'])
        # The face kept through the retry is not tracked on: the recovery window re-detects it.
        data, receipt = self.sequence.update(algorithm=self.algorithm)
        self.fresh.process.assert_not_called()
        self.assertTrue(receipt['retainedFaceDropped'])
        self.assertEqual(receipt['status'], 'tracked')
        self.assertTrue(receipt['relaxed'])
        self.assertEqual(data['faces'].shape, (1, 106, 2))
        self.assertEqual(self.start.call_count, 2)
        self.assertEqual(self.sequence.detector.detect.call_count, 2)
        self.assertFalse(receipt['recovery']['active'])
        third, receipt = self.sequence.update(algorithm=self.algorithm)
        self.assertNotIn('retainedFaceDropped', receipt)
        self.assertEqual(receipt['status'], 'tracked')

    def test_failed_redetection_has_no_points_or_old_history(self):
        self.track(failure=module.RejectedVideoFace('tracking failure'))
        self.start.side_effect = module.RejectedVideoFace('seed failure')
        data, receipt = self.sequence.update(algorithm=self.algorithm)
        self.assertIsNone(data)
        self.assertEqual(receipt['status'], 'rejected-reset')
        self.assertEqual(receipt['reason'], 'seed failure')
        self.assertIsNone(self.sequence.engine)
        self.assertIsNone(self.sequence.face)
        self.assertEqual(self.sequence.index, 0)
        self.assertEqual(self.start.call_count, 1)

    def test_recovery_gate_is_sampled_before_same_frame_retry(self):
        self.track(failure=module.RejectedVideoFace('tracking failure'))
        gates = []

        def reject_seed(**unused):
            gates.append(self.sequence.relaxed)
            raise module.RejectedVideoFace('seed failure')

        self.start.side_effect = reject_seed
        _, failed = self.sequence.update(algorithm=self.algorithm)
        self.assertEqual(gates, [False])
        self.assertEqual(failed['recovery'], {'active': True, 'counter': 1})
        self.start.side_effect = None
        _, recovered = self.sequence.update(algorithm=self.algorithm)
        self.assertTrue(recovered['relaxed'])
        self.assertEqual(recovered['recovery'], {'active': False, 'counter': 1})
        _, tracked = self.sequence.update(algorithm=self.algorithm)
        self.assertFalse(tracked['relaxed'])

    def test_explicit_reset_clears_recovery_window(self):
        self.track(failure=module.RejectedVideoFace('tracking failure'))
        self.start.side_effect = module.RejectedVideoFace('seed failure')
        self.sequence.update(algorithm=self.algorithm)
        self.sequence.reset()
        self.assertEqual(self.sequence.recovery.snapshot(), {'active': False, 'counter': 0})
        self.assertFalse(self.sequence.relaxed)

    def test_ambiguous_redetection_does_not_choose_another_person(self):
        self.track(failure=module.RejectedVideoFace('tracking failure'))
        self.sequence.detector.detect.return_value = {'rects': np.zeros((2, 4), np.float32)}
        data, receipt = self.sequence.update(algorithm=self.algorithm)
        self.assertIsNone(data)
        self.assertEqual(receipt['status'], 'ambiguous-faces')
        self.start.assert_not_called()
        self.assertIsNone(self.sequence.engine)

    def test_initial_seed_failure_does_not_retry_indefinitely(self):
        self.start.side_effect = module.RejectedVideoFace('seed failure')
        self.sequence.update(algorithm=self.algorithm)
        self.assertEqual(self.sequence.detector.detect.call_count, 1)
        self.assertEqual(self.start.call_count, 1)

    def test_size_change_needs_explicit_reset_even_after_missing_face(self):
        self.sequence.detector.detect.return_value = {'rects': np.empty((0, 4), np.float32)}
        self.sequence.update(algorithm=self.algorithm)
        with self.assertRaisesRegex(ValueError, 'dimensions changed'):
            self.sequence.update(algorithm=np.zeros((101, 100, 4), np.uint8))
        self.sequence.reset()
        self.sequence.update(algorithm=np.zeros((101, 100, 4), np.uint8))

    def test_model_rejection_happens_before_decoder_can_consume_heads(self):
        self.sequence.policy = Mock()
        self.sequence.policy.validate.side_effect = module.RejectedVideoFace('video rejection')
        wrapped = module._AcceptedVideoModel(owner=self.sequence, size=160, model=Mock())
        with self.assertRaisesRegex(module.RejectedVideoFace, 'video rejection'):
            wrapped.infer(tensor=np.zeros((1, 160, 160, 3), np.int8))
        self.assertEqual(self.sequence.attempts, [{'size': 160, 'accepted': False, 'reason': 'video rejection'}])


if __name__ == '__main__':
    unittest.main()
