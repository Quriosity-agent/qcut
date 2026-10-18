"""Native slot allocation, detector cadence, recovery and duplicate suppression."""
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import body_video_face_sequence as module
from body_face_slots import BodyFaceSlot


def prediction(*, box, seeded=False, confidence=.95):
    x, y, width, height = box
    points = np.column_stack((np.linspace(x, x + width, 106, dtype=np.float32),
                              np.linspace(y, y + height, 106, dtype=np.float32)))
    return {'points': points, 'tracked': points.copy(),
            'heads': {160 if seeded else 120: {'prob': np.asarray([1 - confidence, confidence, 0], np.float32)}}}


class VideoFaceSequence(unittest.TestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        self.sequence = module.BodyVideoFaceSequence.__new__(module.BodyVideoFaceSequence)
        self.sequence.root, self.sequence.assets, self.sequence.models = Path('/unused-runtime'), {}, {}
        self.sequence.detector = Mock()
        self.box = np.asarray([20, 20, 30, 40], np.float32)
        self.sequence.detector.detect.return_value = {'rects': self.box[None]}
        self.sequence.reset()
        self.algorithm = np.zeros((100, 100, 4), np.uint8)
        self.spawned = []
        self.start = patch.object(module, 'start_video_face', side_effect=self.seed).start()

    def seed(self, *, box, **unused):
        engine = Mock()
        engine.process.return_value = prediction(box=box)
        self.spawned.append(engine)
        return engine, prediction(box=box, seeded=True), {'mode': 'update'}, (100, 100)

    def ready(self, *, frame_counter=0, recovery=None):
        self.sequence.frame_counter, self.sequence.size = frame_counter, (100, 100)
        if recovery is not None:
            self.sequence.recovery = module.VideoFaceRecovery(active=True, counter=recovery)

    def track(self, *, position=0, box=None, index=8, failure=None, confidence=.95):
        box = self.box if box is None else np.asarray(box, np.float32)
        engine = Mock()
        engine.process.side_effect = failure
        engine.process.return_value = prediction(box=box, confidence=confidence)
        slot = BodyFaceSlot(engine=engine, face={'mode': 'update'}, identifier=position, persistent_id=position)
        slot.accept(result=prediction(box=box, confidence=confidence), size=(100, 100))
        slot.index, slot.age = index, index
        self.sequence.slots[position] = slot
        self.ready()
        self.sequence.next_identifier = max(self.sequence.next_identifier, position + 1)
        return slot

    def test_initial_warmup_seeds_160_then_tracks_120_on_the_same_image(self):
        data, receipt = self.sequence.update(algorithm=self.algorithm)
        self.start.assert_called_once()
        self.assertTrue(self.start.call_args.kwargs['seed_only'])
        self.assertEqual(self.start.call_args.kwargs['identifier'], 0)
        slot = self.sequence.slots[0]
        slot.engine.process.assert_called_once_with(rgba=self.algorithm, size=(100, 100), index=1, face=slot.face)
        self.assertEqual((slot.index, slot.age, slot.new), (2, 2, False))
        self.assertEqual(receipt['frameCounter'], 1)
        self.assertEqual(data['faces'].shape, (1, 106, 2))

    def test_tracking_rejection_redetects_once_then_retains_the_new_history(self):
        old = self.track(failure=module.RejectedVideoFace('rejected tracking'))
        _, receipt = self.sequence.update(algorithm=self.algorithm)
        self.assertEqual(receipt['status'], 'redetected')
        old.engine.process.assert_called_once()
        self.sequence.detector.detect.assert_called_once()
        slot = self.sequence.slots[0]
        self.assertIsNot(slot, old)
        self.assertEqual((slot.index, slot.age), (2, 2))
        self.assertEqual(receipt['recovery'], {'active': True, 'counter': 1})
        roll, face = slot.roll, slot.face
        order = []
        slot.engine.process.side_effect = lambda **unused: order.append('track') or prediction(box=self.box)
        self.sequence.detector.detect.side_effect = lambda **unused: order.append('detect') or {'rects': self.box[None]}
        data, receipt = self.sequence.update(algorithm=self.algorithm)
        self.assertEqual(order, ['track', 'detect'])
        self.assertIs(self.sequence.slots[0], slot)
        self.assertIs(slot.roll, roll)
        self.assertIs(slot.face, face)
        self.assertEqual((slot.index, slot.age), (3, 3))
        self.assertEqual(receipt['status'], 'recovery-retained')
        self.assertEqual(receipt['matchedDetection'], 0)
        self.assertEqual(receipt['recovery'], {'active': True, 'counter': 2})
        self.assertEqual(data['faces'].shape, (1, 106, 2))
        self.start.assert_called_once()
        self.assertNotIn('retainedFaceDropped', receipt)

    def test_recovery_without_detection_keeps_tracking_history(self):
        slot = self.track()
        self.ready(recovery=9)
        self.sequence.detector.detect.return_value = {'rects': np.empty((0, 4), np.float32)}
        data, receipt = self.sequence.update(algorithm=self.algorithm)
        self.assertIs(self.sequence.slots[0], slot)
        self.assertEqual(slot.index, 9)
        self.assertEqual(receipt['matchedDetection'], -1)
        self.assertEqual(receipt['recovery'], {'active': True, 'counter': 10})
        self.assertIsNotNone(data)
        self.start.assert_not_called()

    def test_rejected_tracking_inside_recovery_does_not_restart_counter(self):
        old = self.track(failure=module.RejectedVideoFace('lost tracking'))
        self.ready(recovery=17)
        _, receipt = self.sequence.update(algorithm=self.algorithm)
        old.engine.process.assert_called_once()
        self.assertEqual(receipt['status'], 'redetected')
        self.assertTrue(receipt['relaxed'])
        self.assertEqual(receipt['recovery'], {'active': True, 'counter': 18})
        self.assertEqual(self.sequence.slots[0].index, 2)

    def test_counter_thirty_tracks_relaxed_then_expires(self):
        self.track()
        self.ready(recovery=30)
        _, receipt = self.sequence.update(algorithm=self.algorithm)
        self.assertTrue(receipt['relaxed'])
        self.assertEqual(receipt['recovery'], {'active': False, 'counter': 30})
        self.sequence.detector.detect.reset_mock()
        _, receipt = self.sequence.update(algorithm=self.algorithm)
        self.assertFalse(receipt['relaxed'])
        self.sequence.detector.detect.assert_not_called()

    def test_new_accepted_slot_uses_first_free_slot_and_native_output_order(self):
        old = self.track(position=3)
        self.ready(recovery=4)
        self.sequence.next_identifier = 11
        self.sequence.detector.detect.return_value = {'rects': np.asarray([self.box, [75, 20, 20, 40]], np.float32)}
        data, receipt = self.sequence.update(algorithm=self.algorithm)
        new = self.sequence.slots[0]
        self.assertIs(self.sequence.slots[3], old)
        self.assertEqual((new.identifier, new.persistent_id, new.index), (11, 11, 2))
        self.assertEqual([slot['index'] for slot in receipt['slots']], [0, 3])
        self.assertEqual([slot['id'] for slot in receipt['slots']], [11, 3])
        self.assertLess(data['faces'][0, 0, 0], data['faces'][1, 0, 0])
        self.assertEqual(receipt['recovery'], {'active': False, 'counter': 4})
        self.assertIsNot(new.engine, old.engine)
        self.assertIsNot(new.roll, old.roll)

    def test_cold_detection_preserves_holes_from_rejected_160_candidates(self):
        self.ready(frame_counter=1)
        self.sequence.detector.detect.return_value = {'rects': np.asarray([self.box, [75, 20, 20, 40]], np.float32)}
        accepted = self.seed(box=[75, 20, 20, 40])
        self.start.side_effect = [module.RejectedVideoFace('first candidate rejected'), accepted]
        data, receipt = self.sequence.update(algorithm=self.algorithm)
        self.assertIsNone(data)
        self.assertEqual([slot['index'] for slot in receipt['slots']], [1])
        self.assertEqual([slot['id'] for slot in receipt['slots']], [0])
        self.assertFalse(self.sequence.slots[0].active)
        self.assertEqual(self.sequence.next_identifier, 1)
        accepted[0].process.assert_not_called()
        self.assertTrue(self.sequence.slots[1].new)

    def test_identifier_is_consumed_after_160_even_if_120_rejects(self):
        self.track(failure=module.RejectedVideoFace('old tracking rejected'))
        self.sequence.next_identifier = 7
        engine, result, face, size = self.seed(box=self.box)
        engine.process.side_effect = module.RejectedVideoFace('fresh tracking rejected')
        self.start.side_effect = None
        self.start.return_value = engine, result, face, size
        data, receipt = self.sequence.update(algorithm=self.algorithm)
        self.assertIsNone(data)
        self.assertEqual(self.sequence.next_identifier, 8)
        self.assertEqual(self.sequence.slots[0].identifier, 7)
        self.assertFalse(self.sequence.slots[0].active)
        self.assertEqual(receipt['recovery'], {'active': True, 'counter': 1})

    def test_periodic_detection_only_seeds_new_slot_until_next_frame(self):
        old = self.track()
        self.ready(frame_counter=23)
        self.sequence.detector.detect.return_value = {'rects': np.asarray([self.box, [75, 20, 20, 40]], np.float32)}
        data, receipt = self.sequence.update(algorithm=self.algorithm)
        self.assertEqual(data['faces'].shape, (1, 106, 2))
        old.engine.process.assert_called_once()
        new = self.sequence.slots[1]
        new.engine.process.assert_not_called()
        self.assertEqual((new.index, new.age, new.new), (1, 1, True))
        self.assertFalse(receipt['recovery']['active'])
        data, _ = self.sequence.update(algorithm=self.algorithm)
        self.assertEqual(data['faces'].shape, (2, 106, 2))
        new.engine.process.assert_called_once()
        self.assertEqual((new.index, new.age, new.new), (2, 2, False))

    def test_duplicate_filter_suppresses_lower_confidence_slot_without_compacting_history(self):
        first = self.track(position=0, confidence=.8)
        fourth = self.track(position=3, confidence=.9)
        self.ready(recovery=6)
        data, receipt = self.sequence.update(algorithm=self.algorithm)
        self.assertEqual(receipt['suppressedSlots'], [0])
        self.assertEqual([slot['index'] for slot in receipt['slots']], [3])
        self.assertFalse(first.active)
        self.assertTrue(fourth.active)
        self.assertIs(self.sequence.slots[0], first)
        self.assertIs(self.sequence.slots[3], fourth)
        self.assertEqual(data['faces'].shape, (1, 106, 2))
        self.assertEqual(receipt['recovery'], {'active': True, 'counter': 7})

    def test_recovery_accepts_one_or_multiple_candidates_without_swapping_old_slots(self):
        self.ready(recovery=7)
        self.sequence.detector.detect.return_value = {'rects': np.asarray([self.box, [75, 20, 20, 40]], np.float32)}
        data, receipt = self.sequence.update(algorithm=self.algorithm)
        self.assertEqual(data['faces'].shape, (2, 106, 2))
        self.assertEqual([slot['id'] for slot in receipt['slots']], [0, 1])
        self.assertEqual([slot.index for slot in self.sequence.slots[:2]], [2, 2])
        self.assertEqual(receipt['recovery'], {'active': False, 'counter': 7})

    def test_rejected_false_positive_preserves_accepted_history_and_attempt_log(self):
        old = self.track()
        self.ready(recovery=4)
        self.sequence.detector.detect.return_value = {'rects': np.asarray([self.box, [75, 20, 20, 40]], np.float32)}
        self.sequence.policy = Mock()
        self.sequence.policy.validate.side_effect = module.RejectedVideoFace('false-positive candidate')
        model = module._AcceptedVideoModel(owner=self.sequence, size=160, model=Mock())
        self.start.side_effect = lambda **unused: model.infer(tensor=np.zeros((1, 160, 160, 3), np.int8))
        _, receipt = self.sequence.update(algorithm=self.algorithm)
        self.assertIs(self.sequence.slots[0], old)
        self.assertEqual(old.index, 9)
        self.assertEqual(receipt['recovery'], {'active': True, 'counter': 5})
        self.assertEqual(receipt['attempts'], [{'size': 160, 'accepted': False, 'reason': 'false-positive candidate'}])

    def test_recovery_accepts_a_valid_slot_after_a_rejected_candidate(self):
        self.ready(recovery=3)
        self.sequence.detector.detect.return_value = {'rects': np.asarray([self.box, [75, 20, 20, 40]], np.float32)}
        self.start.side_effect = [module.RejectedVideoFace('false positive'), self.seed(box=[75, 20, 20, 40])]
        data, receipt = self.sequence.update(algorithm=self.algorithm)
        self.assertEqual(data['faces'].shape, (1, 106, 2))
        self.assertEqual([slot['index'] for slot in receipt['slots']], [0])
        self.assertEqual(self.sequence.next_identifier, 1)
        self.assertEqual(receipt['recovery'], {'active': False, 'counter': 3})

    def test_more_than_five_detections_keep_the_first_five_without_sorting(self):
        self.ready(frame_counter=1)
        boxes = np.asarray([[x, 10, 8, 8] for x in (75, 45, 5, 60, 30, 15)], np.float32)
        self.sequence.detector.detect.return_value = {'rects': boxes}
        data, receipt = self.sequence.update(algorithm=self.algorithm)
        self.assertIsNone(data)
        self.assertEqual(self.start.call_count, 5)
        self.assertEqual([slot['id'] for slot in receipt['slots']], [0, 1, 2, 3, 4])
        for call, box in zip(self.start.call_args_list, boxes[:5], strict=True):
            np.testing.assert_array_equal(call.kwargs['box'], box)
        data, _ = self.sequence.update(algorithm=self.algorithm)
        self.assertEqual(data['faces'].shape, (5, 106, 2))
        np.testing.assert_allclose(data['faces'][:, 0, 0], boxes[:5, 0] / 100, atol=1e-7, rtol=0)

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
        self.start.side_effect = self.seed
        _, recovered = self.sequence.update(algorithm=self.algorithm)
        self.assertTrue(recovered['relaxed'])
        self.assertEqual(recovered['recovery'], {'active': False, 'counter': 1})

    def test_no_face_detection_cadence_is_two_then_four_then_eight_frames(self):
        self.ready()
        self.sequence.detector.detect.return_value = {'rects': np.empty((0, 4), np.float32)}
        detected = []
        for _ in range(40):
            before = self.sequence.detector.detect.call_count
            self.sequence.update(algorithm=self.algorithm)
            if self.sequence.detector.detect.call_count > before:
                detected.append(self.sequence.frame_counter)
        self.assertEqual(detected, [2, 4, 6, 8, 12, 16, 20, 24, 28, 32, 40])

    def test_explicit_reset_clears_slots_identifiers_cadence_and_recovery(self):
        self.track(position=3)
        self.ready(frame_counter=23, recovery=9)
        self.sequence.reset()
        self.assertTrue(all(not slot.active and slot.engine is None for slot in self.sequence.slots))
        self.assertEqual(self.sequence.next_identifier, 0)
        self.assertEqual(self.sequence.frame_counter, -1)
        self.assertEqual(self.sequence.recovery.snapshot(), {'active': False, 'counter': 0})

    def test_initial_rejection_does_not_retry_indefinitely(self):
        self.start.side_effect = module.RejectedVideoFace('seed failure')
        self.sequence.update(algorithm=self.algorithm)
        self.sequence.detector.detect.assert_called_once()
        self.start.assert_called_once()

    def test_size_change_needs_explicit_reset_even_after_missing_face(self):
        self.sequence.detector.detect.return_value = {'rects': np.empty((0, 4), np.float32)}
        self.sequence.update(algorithm=self.algorithm)
        with self.assertRaisesRegex(ValueError, 'dimensions changed'):
            self.sequence.update(algorithm=np.zeros((101, 100, 4), np.uint8))
        self.sequence.reset()
        self.sequence.update(algorithm=np.zeros((101, 100, 4), np.uint8))

    def test_model_rejection_happens_before_decoder_consumes_heads(self):
        self.sequence.policy = Mock()
        self.sequence.policy.validate.side_effect = module.RejectedVideoFace('video rejection')
        wrapped = module._AcceptedVideoModel(owner=self.sequence, size=160, model=Mock())
        with self.assertRaisesRegex(module.RejectedVideoFace, 'video rejection'):
            wrapped.infer(tensor=np.zeros((1, 160, 160, 3), np.int8))
        self.assertEqual(self.sequence.attempts, [{'size': 160, 'accepted': False, 'reason': 'video rejection'}])


if __name__ == '__main__':
    unittest.main()
