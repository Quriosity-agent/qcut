"""A persistent render chain must not advance twice or survive an incomplete frame."""
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import body_smart_sequence as module


class BodySequenceContract(unittest.TestCase):
    def setUp(self):
        self.rgba = np.full((32, 24, 4), 255, np.uint8)
        self.engine = module.BodySmartSequence(runtime=Path('/unused-runtime'))
        self.skeletons = []

        def initialize():
            self.engine.skeleton = Mock()
            self.engine.skeleton.update.return_value = None
            self.engine.skeleton.last_debug = {'network': 'coarse', 'plan': {'mode': 0}, 'state': {'objects': 1}}
            self.engine.face = Mock()
            self.engine.face.update.return_value = (None, {'status': 'no-face'})
            self.engine.composition = Mock()
            self.skeletons.append(self.engine.skeleton)

        self.addCleanup(patch.stopall)
        patch.object(self.engine, '_initialize', side_effect=initialize).start()
        patch.object(module, 'algorithm_image', return_value=(self.rgba, {})).start()
        patch.object(module, 'process_images', return_value={'loaded_images': [], 'private_native_images': []}).start()

    def frame(self, *, index=0, stream='clip-a', timestamp=None, cancelled=None, controls=None):
        return self.engine.process(rgba=self.rgba, controls=controls or {}, stream=stream,
                                   frame=index, timestamp=index / 24 if timestamp is None else timestamp,
                                   cancelled=cancelled)

    def test_suppressed_seed_preserves_frame_and_timestamp(self):
        result, receipt = self.frame()
        np.testing.assert_array_equal(result, self.rgba)
        self.assertIsNot(result, self.rgba)
        self.assertEqual(receipt['frame'], 0)
        self.assertFalse(receipt['bodyReported'])
        self.assertEqual(self.engine.next_frame, 1)
        self.engine.composition.update.assert_not_called()

    def test_invalid_order_stream_size_and_time_do_not_mutate_history(self):
        self.frame()
        invalid = [dict(index=0), dict(index=2), dict(index=1, stream='clip-b'),
                   dict(index=1, timestamp=0), dict(index=1, timestamp=.25)]
        for arguments in invalid:
            with self.subTest(arguments=arguments), self.assertRaises(ValueError):
                self.frame(**arguments)
        with self.assertRaises(ValueError):
            self.engine.process(rgba=np.full((33, 24, 4), 255, np.uint8), controls={},
                                stream='clip-a', frame=1, timestamp=1 / 24)
        self.assertEqual(self.skeletons[0].update.call_count, 1)
        self.assertEqual(self.engine.next_frame, 1)
        self.assertFalse(self.engine.invalid)
        self.frame(index=1)
        self.assertEqual(self.skeletons[0].update.call_count, 2)

    def test_zero_controls_keep_tracking_for_later_keyframes(self):
        self.frame()
        self.frame(index=1)
        self.assertEqual(self.skeletons[0].update.call_count, 2)
        self.assertEqual(self.engine.face.update.call_count, 2)

    def test_cancel_after_inference_requires_reset_replay(self):
        checks = iter([False, True])
        with self.assertRaises(module.BodySequenceCancelled):
            self.frame(cancelled=lambda: next(checks))
        self.assertTrue(self.engine.invalid)
        self.assertEqual(self.engine.next_frame, 0)
        self.engine.face.update.assert_not_called()
        with self.assertRaisesRegex(ValueError, 'reset and replay'):
            self.frame()
        self.engine.reset()
        result, _ = self.frame()
        np.testing.assert_array_equal(result, self.rgba)
        self.assertEqual(len(self.skeletons), 2)

    def test_inference_failure_is_not_an_identity_success(self):
        self.frame()
        self.engine.face.update.side_effect = RuntimeError('model failed')
        with self.assertRaisesRegex(RuntimeError, 'model failed'):
            self.frame(index=1)
        self.assertTrue(self.engine.invalid)
        self.assertEqual(self.engine.next_frame, 1)

    def test_reset_allows_new_clip_and_restarts_frame_zero(self):
        first, _ = self.frame()
        self.frame(index=1)
        self.engine.reset()
        replay, receipt = self.frame(stream='clip-b')
        np.testing.assert_array_equal(first, replay)
        self.assertEqual(receipt['frame'], 0)
        self.assertEqual(self.engine.stream, 'clip-b')
        self.assertEqual(self.skeletons[0].update.call_count, 2)
        self.assertEqual(self.skeletons[1].update.call_count, 1)

    def test_controls_and_timestamp_validation_happen_before_inference(self):
        for controls in ({'SlimBody': 101}, {'unknown': 20}):
            with self.assertRaises(ValueError):
                self.frame(controls=controls)
        for value in (True, float('nan'), float('inf'), -1):
            with self.assertRaises(ValueError):
                self.frame(timestamp=value)
        self.engine._initialize.assert_not_called()


if __name__ == '__main__':
    unittest.main()
