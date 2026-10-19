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
        self.rgba = np.full((32, 32, 4), 255, np.uint8)
        self.base = np.asarray([[[0, 0], [24, 0]], [[0, 32], [24, 32]]], np.float32)
        self.mesh = {'base': self.base, 'positions': self.base.copy(),
                     'uv': self.base / np.asarray([24, 32], np.float32),
                     'tri': np.asarray([[0, 1, 2], [1, 2, 3]], np.int32)}
        self.engine = module.BodySmartSequence(runtime=Path('/unused-runtime'))
        self.skeletons = []

        def initialize():
            self.engine.skeleton = Mock()
            self.engine.skeleton.update.return_value = None
            self.engine.skeleton.last_debug = {'network': 'coarse', 'plan': {'mode': 0}, 'state': {'objects': 1}}
            self.engine.face = Mock()
            self.engine.face.update.return_value = (None, {'status': 'no-face'})
            self.engine.composition = Mock()
            self.engine.composition.update.return_value = self.mesh
            self.skeletons.append(self.engine.skeleton)

        self.addCleanup(patch.stopall)
        patch.object(self.engine, '_initialize', side_effect=initialize).start()
        patch.object(module, 'algorithm_image', return_value=(self.rgba, {})).start()
        patch.object(module, 'process_images', return_value={'loaded_images': [], 'private_native_images': []}).start()

    def frame(self, *, index=0, stream='clip-a', timestamp=None, cancelled=None, controls=None,
              control_events=()):
        return self.engine.process(rgba=self.rgba, controls=controls or {}, stream=stream,
                                   frame=index, timestamp=index / 24 if timestamp is None else timestamp,
                                   cancelled=cancelled, control_events=control_events)

    def test_suppressed_seed_advances_missing_body_geometry_and_timestamp(self):
        result, receipt = self.frame()
        np.testing.assert_array_equal(result, self.rgba)
        self.assertIsNot(result, self.rgba)
        self.assertEqual(receipt['frame'], 0)
        self.assertFalse(receipt['bodyReported'])
        self.assertEqual(self.engine.next_frame, 1)
        inputs = self.engine.composition.update.call_args.kwargs
        self.assertFalse(inputs['body_present'])
        np.testing.assert_array_equal(inputs['visibility'], np.zeros(18, np.uint8))

    def test_supplied_segmentation_is_copied_before_inference_and_forwarded(self):
        mask = np.arange(35, dtype=np.uint8).reshape(5, 7)
        expected = mask.copy()
        with patch.object(module, 'algorithm_image', side_effect=lambda **kwargs: (
                mask.fill(0) or self.rgba, {})):
            self.engine.process(rgba=self.rgba, controls={}, stream='mask', frame=0,
                                timestamp=0, segmentation_mask=mask)
        passed = self.engine.composition.update.call_args.kwargs['segmentation_mask']
        np.testing.assert_array_equal(passed, expected)
        self.assertFalse(np.shares_memory(passed, mask))

    def test_invalid_segmentation_is_rejected_before_loading_or_advancing(self):
        for mask in ([], np.zeros((2, 2), np.float32), np.zeros((0, 2), np.uint8),
                     np.zeros((2, 2, 1), np.uint8)):
            with self.subTest(shape=getattr(mask, 'shape', None)), self.assertRaises(ValueError):
                self.engine.process(rgba=self.rgba, controls={}, stream='mask', frame=0,
                                    timestamp=0, segmentation_mask=mask)
        self.engine._initialize.assert_not_called()
        self.assertFalse(self.engine.invalid)
        self.assertEqual(self.engine.next_frame, 0)

    def test_missing_body_renders_retained_deformation_instead_of_returning_original(self):
        self.frame()
        self.engine.composition.update.return_value = {
            **self.mesh, 'positions': self.base + np.float32(1),
        }
        rendered = np.full_like(self.rgba, 80)
        with patch.object(module, 'draw_mesh', return_value=(rendered, {})) as draw:
            result, receipt = self.frame(index=1)
        self.assertFalse(receipt['bodyReported'])
        self.assertFalse(receipt['identity'])
        self.assertIs(result, rendered)
        draw.assert_called_once()
        self.assertEqual(self.engine.composition.update.call_count, 2)
        self.assertFalse(self.engine.composition.update.call_args.kwargs['body_present'])

    def test_invalid_order_stream_and_unbounded_size_do_not_mutate_history(self):
        self.frame()
        invalid = [dict(index=0), dict(index=2), dict(index=True), dict(index=1, stream='clip-b')]
        for arguments in invalid:
            with self.subTest(arguments=arguments), self.assertRaises(ValueError):
                self.frame(**arguments)
        with self.assertRaises(ValueError):
            self.engine.process(rgba=np.full((33, 4097, 4), 255, np.uint8), controls={},
                                stream='clip-a', frame=1, timestamp=1 / 24)
        self.assertEqual(self.skeletons[0].update.call_count, 1)
        self.assertEqual(self.engine.next_frame, 1)
        self.assertFalse(self.engine.invalid)
        self.frame(index=1)
        self.assertEqual(self.skeletons[0].update.call_count, 2)

    def test_source_resize_uses_transient_extent_then_returns_to_active_extent(self):
        sizes = ((1080, 1920), (720, 1280), (720, 1280), (1280, 720))
        with patch.object(module, 'source_edge_limit', return_value=4096), \
                patch.object(module, 'algorithm_image', return_value=(self.rgba, {})) as raster:
            for index, (width, height) in enumerate(sizes):
                self.engine.process(rgba=np.full((height, width, 4), 255, np.uint8), controls={},
                                    stream='resize', frame=index, timestamp=index / 30)
        self.assertEqual([call.kwargs['output_size'] for call in raster.call_args_list],
                         [(360, 640), (128, 227), (360, 640), (227, 128)])
        self.assertEqual(self.engine.next_frame, 4)
        self.engine._initialize.assert_called_once()
        self.engine.skeleton.reset.assert_not_called()
        self.engine.face.reset.assert_not_called()

    def test_resize_validates_the_current_extent_without_admitting_an_unbounded_steady_frame(self):
        resized = np.full((1281, 360, 4), 255, np.uint8)
        with patch.object(module, 'source_edge_limit', return_value=4096), \
                patch.object(module, 'algorithm_image', return_value=(self.rgba, {})) as raster:
            with self.assertRaisesRegex(ValueError, 'bounded algorithm image dimensions'):
                self.engine.process(rgba=resized, controls={}, stream='clip-a', frame=0, timestamp=0)
            self.engine._initialize.assert_not_called()
            raster.assert_not_called()
            self.assertEqual((self.engine.next_frame, self.engine.size, self.engine.timestamp), (0, None, None))
            self.assertFalse(self.engine.invalid)

            self.frame()
            self.engine.process(rgba=resized, controls={}, stream='clip-a', frame=1, timestamp=1 / 24)
            self.assertEqual(raster.call_args.kwargs['output_size'], (128, 455))
            self.assertEqual((self.engine.next_frame, self.engine.size, self.engine.timestamp),
                             (2, (1281, 360), 1 / 24))
            raster.reset_mock()
            with self.assertRaisesRegex(ValueError, 'bounded algorithm image dimensions'):
                self.engine.process(rgba=resized, controls={}, stream='clip-a', frame=2, timestamp=2 / 24)
            raster.assert_not_called()
            self.assertEqual((self.engine.next_frame, self.engine.size, self.engine.timestamp),
                             (2, (1281, 360), 1 / 24))
            self.assertFalse(self.engine.invalid)
            for part in (self.engine.skeleton, self.engine.face, self.engine.composition):
                self.assertEqual(part.update.call_count, 2)
                part.reset.assert_not_called()
            self.assertEqual(self.engine.composition.configure_frame.call_count, 2)
            self.frame(index=2)
            self.assertEqual(self.engine.next_frame, 3)
            self.engine._initialize.assert_called_once()

    def test_zero_controls_keep_tracking_for_later_keyframes(self):
        self.frame()
        self.frame(index=1)
        self.assertEqual(self.skeletons[0].update.call_count, 2)
        self.assertEqual(self.engine.face.update.call_count, 2)

    def test_frame_timestamps_reach_native_input_selection(self):
        for index, timestamp in enumerate((0, .01, .03)):
            self.frame(index=index, timestamp=timestamp)
            self.engine.composition.configure_frame.assert_called_with(timestamp=timestamp, reset_clock=False)

    def test_time_repeats_reversals_and_jumps_keep_submission_order_and_perception(self):
        timestamps = (0, .03, .75, .75, .2, .199, 0)
        self.frame(timestamp=timestamps[0])
        skeleton, face, composition = self.engine.skeleton, self.engine.face, self.engine.composition
        with patch.object(self.engine, 'restart', wraps=self.engine.restart) as restart:
            for index, timestamp in enumerate(timestamps[1:], start=1):
                with self.subTest(frame=index, timestamp=timestamp):
                    _, receipt = self.frame(index=index, timestamp=timestamp)
                    self.assertEqual(receipt['timestampSeconds'], timestamp)
                    self.assertEqual(self.engine.next_frame, index + 1)
                    self.assertEqual(self.engine.timestamp, timestamp)
                    composition.configure_frame.assert_called_with(timestamp=timestamp, reset_clock=False)
            restart.assert_not_called()
        self.assertIs(self.engine.skeleton, skeleton)
        self.assertIs(self.engine.face, face)
        self.assertIs(self.engine.composition, composition)
        self.engine._initialize.assert_called_once()
        for part in (skeleton, face, composition):
            self.assertEqual(part.update.call_count, len(timestamps))
            part.reset.assert_not_called()
        self.assertFalse(self.engine.invalid)

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

    def test_skeleton_failures_cannot_silently_skip_the_composition_frame(self):
        self.frame()
        self.engine.skeleton.update.side_effect = ValueError('invalid body result')
        with self.assertRaisesRegex(ValueError, 'invalid body result'):
            self.frame(index=1)
        self.assertTrue(self.engine.invalid)
        self.assertEqual(self.engine.next_frame, 1)
        self.assertEqual(self.engine.face.update.call_count, 1)
        self.assertEqual(self.engine.composition.update.call_count, 1)

    def test_restart_keeps_loaded_networks_for_a_new_stream(self):
        self.frame()
        skeleton, face, composition = self.engine.skeleton, self.engine.face, self.engine.composition
        self.engine.restart()
        self.assertIs(self.engine.skeleton, skeleton)
        for part in (skeleton, face, composition):
            part.reset.assert_called_once_with()
        self.assertEqual((self.engine.next_frame, self.engine.stream, self.engine.timestamp), (0, None, None))
        self.frame(stream='clip-b')
        self.assertEqual(len(self.skeletons), 1)
        self.assertEqual(skeleton.update.call_count, 2)

    def test_restart_loads_networks_when_none_are_loaded(self):
        self.engine.restart()
        self.assertEqual(len(self.skeletons), 1)
        self.assertEqual(self.engine.next_frame, 0)

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
