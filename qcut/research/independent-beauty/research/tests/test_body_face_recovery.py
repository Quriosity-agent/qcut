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

    def test_initial_empty_detection_does_not_start_window(self):
        state = VideoFaceRecovery()
        state.finish(previous_faces=0, current_faces=0)
        self.assertEqual(state.snapshot(), {'active': False, 'counter': 0})
        with self.assertRaisesRegex(ValueError, 'single-person'):
            state.finish(previous_faces=1, current_faces=2)


if __name__ == '__main__':
    unittest.main()
