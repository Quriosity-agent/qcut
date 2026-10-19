"""Frame ordering and expiry boundaries of the native video recovery window."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from body_face_recovery import VideoFaceRecovery


class FaceRecoveryWindow(unittest.TestCase):
    def test_failed_retry_relaxes_next_frame_and_new_face_closes_window(self):
        state = VideoFaceRecovery()
        self.assertFalse(state.active)
        state.finish(previous_faces=1, current_faces=0, detector_retry=True)
        self.assertEqual(state.snapshot(), {'active': True, 'counter': 1})
        state.finish(previous_faces=0, current_faces=1)
        self.assertEqual(state.snapshot(), {'active': False, 'counter': 1})

    def test_successful_same_frame_retry_keeps_recovery_window(self):
        state = VideoFaceRecovery()
        state.finish(previous_faces=1, current_faces=1, detector_retry=True)
        self.assertEqual(state.snapshot(), {'active': True, 'counter': 1})
        state.finish(previous_faces=1, current_faces=1)
        self.assertEqual(state.snapshot(), {'active': True, 'counter': 2})

    def test_counter_thirty_uses_relaxed_gate_then_expires(self):
        state = VideoFaceRecovery()
        state.finish(previous_faces=1, current_faces=0, detector_retry=True)
        for expected in range(2, 31):
            self.assertTrue(state.active)
            state.finish(previous_faces=0, current_faces=0)
            self.assertEqual(state.counter, expected)
        self.assertTrue(state.active)
        state.finish(previous_faces=0, current_faces=0)
        self.assertEqual(state.snapshot(), {'active': False, 'counter': 30})
        state.finish(previous_faces=0, current_faces=0)
        self.assertEqual(state.counter, 30)

    def test_another_tracking_failure_restarts_window(self):
        state = VideoFaceRecovery(active=True, counter=29)
        state.finish(previous_faces=1, current_faces=0, detector_retry=True)
        self.assertEqual(state.snapshot(), {'active': True, 'counter': 1})

    def test_gaining_another_valid_face_ends_recovery(self):
        state = VideoFaceRecovery(active=True, counter=8)
        state.finish(previous_faces=2, current_faces=3)
        self.assertEqual(state.snapshot(), {'active': False, 'counter': 8})

    def test_partial_face_loss_keeps_recovery_counter(self):
        state = VideoFaceRecovery(active=True, counter=8)
        state.finish(previous_faces=5, current_faces=2)
        self.assertEqual(state.snapshot(), {'active': True, 'counter': 9})

    def test_initial_empty_detection_does_not_start_window(self):
        state = VideoFaceRecovery()
        state.finish(previous_faces=0, current_faces=0)
        self.assertEqual(state.snapshot(), {'active': False, 'counter': 0})
        for previous, current in ((-1, 0), (0, 6), (True, 1), (1, 1.0)):
            with self.subTest(previous=previous, current=current), self.assertRaisesRegex(ValueError, 'bounded native'):
                state.finish(previous_faces=previous, current_faces=current)


if __name__ == '__main__':
    unittest.main()
