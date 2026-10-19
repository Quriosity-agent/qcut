"""Native face-size transitions retain tracking history and reset output filters."""
import copy
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from body_face_metadata import DEGREE_TO_RADIAN, raw_roll
from body_face_slots import BodyFaceSlot
import body_video_face_sequence as module
from test_alignment_transform import owned_core, owned_face
import test_body_video_face_sequence as sequence_tests


class AlignmentResizeTests(unittest.TestCase):
    def setUp(self):
        self.engine, self.face = owned_core(), owned_face()
        self.pixels = np.full((32, 32, 4), 128, np.uint8)
        self.result = self.engine.process(rgba=self.pixels, size=(32, 32), index=0, face=self.face)
        self.face.update(mode='update', initialization=None)

    def test_only_raw_input_scales_and_success_resets_base_to_current_prediction(self):
        engine = self.engine
        state, tracking, transform = engine.state, engine.tracking_state, engine.transform
        raw, seen = engine.tracking_points.copy(), engine.seen.copy()
        resized, status = engine.resize_tracking(size=(64, 64), face=self.face)
        self.assertEqual(status, 1)
        self.assertIs(engine.state, state)
        self.assertIs(engine.tracking_state, tracking)
        self.assertIs(engine.transform, transform)
        np.testing.assert_array_equal(engine.tracking_points, np.float32(raw * 2))
        self.assertEqual(engine.index, 0)
        self.assertEqual(engine.seen, seen)
        self.assertEqual(self.face['smoothing'][0]['width'], 32)
        self.assertEqual(resized['smoothing'][0]['width'], 64)
        result = engine.process(rgba=np.zeros((64, 64, 4), np.uint8), size=(64, 64), index=1, face=resized)
        np.testing.assert_array_equal(result['points'], result['tracked'])
        np.testing.assert_array_equal(engine.state.first33.current, result['tracked'][:33])
        self.assertTrue(engine.state.first33.first)
        self.assertTrue(engine.state.last73.first)
        self.assertEqual(engine.tracking_state.scale, tracking.scale)
        self.assertNotEqual(engine.state.first33.scale, state.first33.scale)

    def test_aspect_status_uses_float32_ratios_then_double_threshold(self):
        for size, expected in (((32, 32), 0), ((64, 64), 1), ((64, 32), 2)):
            with self.subTest(size=size):
                engine, face = owned_core(), owned_face()
                engine.process(rgba=self.pixels, size=(32, 32), index=0, face=face)
                face.update(mode='update', initialization=None)
                _, status = engine.resize_tracking(size=size, face=face)
                self.assertEqual(status, expected)
        engine, face = owned_core(), owned_face()
        engine.process(rgba=self.pixels, size=(32, 32), index=0, face=face)
        face.update(mode='update', initialization=None)
        resized, _ = engine.resize_tracking(size=(100, 100), face=face)
        engine.process(rgba=np.zeros((100, 100, 4), np.uint8), size=(100, 100), index=1, face=resized)
        resized['mode'] = 'update'
        _, status = engine.resize_tracking(size=(101, 100), face=resized)
        self.assertEqual(status, 1)

    def test_invalid_resize_or_identity_does_not_mutate_history(self):
        before = self.engine.tracking_points.copy()
        original_profile = copy.deepcopy(self.engine.profile)
        for size in ([64, 64], (True, 32), (0, 32), (4097, 32), (64.0, 32)):
            with self.subTest(size=size), self.assertRaises(ValueError):
                self.engine.resize_tracking(size=size, face=self.face)
        changed = {**self.face, 'identity': (1, 4096, 0)}
        with self.assertRaisesRegex(ValueError, 'current owned'):
            self.engine.resize_tracking(size=(64, 64), face=changed)
        np.testing.assert_array_equal(self.engine.tracking_points, before)
        self.assertEqual(self.engine.profile, original_profile)
        self.assertEqual(self.engine.decode_profile[0], (32, 32))

    def test_resize_roll_starts_at_current_raw_pose_and_then_retains_delta(self):
        result = sequence_tests.prediction(box=(20, 20, 30, 40))
        slot = BodyFaceSlot(face={'mode': 'reset-120'}, size_status=1)
        slot.roll.pose.current[:] = 30
        slot.roll.pose.delta = np.full(3, 8, np.float32)
        slot.accept(result=result, size=(100, 100))
        degrees = raw_roll(points=result['tracked'])
        np.testing.assert_array_equal(slot.roll.pose.current, [0, 0, degrees])
        self.assertIsNone(slot.roll.pose.delta)
        self.assertEqual(slot.roll_value, np.float32(degrees * DEGREE_TO_RADIAN))
        self.assertEqual(slot.face['mode'], 'update')
        slot.size_status = 0
        slot.accept(result=result, size=(100, 100))
        np.testing.assert_array_equal(slot.roll.pose.delta, [0, 0, 0])


class FaceResizeOrchestrationTests(unittest.TestCase):
    setUp = sequence_tests.VideoFaceSequence.setUp
    seed = sequence_tests.VideoFaceSequence.seed
    ready = sequence_tests.VideoFaceSequence.ready
    track = sequence_tests.VideoFaceSequence.track

    def test_size_change_reuses_active_engine_and_advances_once(self):
        slot = self.track(index=8)
        slot.engine.resize_tracking.return_value = ({'mode': 'reset-120'}, 1)
        data, receipt = self.sequence.update(algorithm=np.zeros((200, 200, 4), np.uint8))
        slot.engine.resize_tracking.assert_called_once_with(size=(200, 200), face={'mode': 'update'})
        self.assertIs(self.sequence.slots[0], slot)
        self.assertEqual((slot.index, slot.age, slot.identifier), (9, 9, 0))
        self.assertEqual(self.sequence.size_status, 1)
        self.assertEqual(slot.size_status, 0)
        self.assertNotIn('warmup', receipt)
        self.assertIsNotNone(data)
        self.start.assert_not_called()

    def test_aspect_rejection_runs_cold_then_retained_detection_on_same_frame(self):
        slot = self.track(failure=module.RejectedVideoFace('aspect tracking rejected'))
        slot.size_status = 2
        self.start.side_effect = module.RejectedVideoFace('candidate rejected')
        with patch.object(self.sequence, '_detect', wraps=self.sequence._detect) as detect:
            self.sequence.update(algorithm=self.algorithm)
        self.assertEqual([call.kwargs['keep'] for call in detect.call_args_list], [False, True])
        self.assertTrue(all(call.kwargs['initialize_tracking'] for call in detect.call_args_list))
        self.assertEqual(self.start.call_count, 2)
        self.assertFalse(self.sequence.dimension_failure_pending)
        self.assertEqual(self.sequence.size_status, 2)

    def test_periodic_and_recovery_paths_do_not_run_extra_cold_detection(self):
        for scheduled, recovering in ((True, False), (False, True)):
            with self.subTest(scheduled=scheduled, recovering=recovering):
                self.sequence.reset()
                slot = self.track(failure=module.RejectedVideoFace('aspect tracking rejected'))
                slot.size_status = 2
                self.ready(frame_counter=23 if scheduled else 0, recovery=4 if recovering else None)
                with patch.object(self.sequence, '_detect', wraps=self.sequence._detect) as detect:
                    self.sequence.update(algorithm=self.algorithm)
                self.assertEqual([call.kwargs['keep'] for call in detect.call_args_list], [True])
                self.assertTrue(self.sequence.dimension_failure_pending)
                with patch.object(self.sequence, '_detect', wraps=self.sequence._detect) as detect:
                    self.sequence.update(algorithm=self.algorithm)
                self.assertFalse(self.sequence.dimension_failure_pending)
                self.assertTrue(all(call.kwargs['keep'] for call in detect.call_args_list))

    def test_last_tracked_slot_controls_recovery_match_override(self):
        for last_status in (0, 2):
            with self.subTest(last_status=last_status):
                self.sequence.reset()
                old = self.track(position=3)
                old.size_status = last_status
                self.ready(recovery=4)
                self.start.reset_mock()
                _, receipt = self.sequence.update(algorithm=self.algorithm)
                self.assertEqual(self.sequence.size_status, last_status)
                self.assertEqual(self.start.call_count, int(last_status == 2))
                self.assertEqual(self.sequence.slots[3].index, 9)
                self.assertEqual(len(receipt['slots']), 1)

    def test_cold_rejected_candidate_deactivates_its_physical_slot(self):
        old = self.track()
        self.start.side_effect = module.RejectedVideoFace('cold candidate rejected')
        receipt = self.sequence._detect(algorithm=self.algorithm, keep=False, initialize_tracking=True)
        self.assertFalse(old.active)
        self.assertFalse(old.new)
        self.assertIs(self.sequence.slots[0], old)
        self.assertEqual(len(receipt['rejections']), 1)
        self.assertEqual(self.sequence.next_identifier, 1)


if __name__ == '__main__':
    unittest.main()
