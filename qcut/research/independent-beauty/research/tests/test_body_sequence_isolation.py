"""Exercise the composition/draw branch and offline frame preservation contracts."""

import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import body_sequence_render as offline
import body_sequence_checkpoint as checkpoint
import body_smart_sequence as module
from body_composition.controls import validate_controls
from body_composition.grid import make_grid


class DrawLifecycle(unittest.TestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        self.rgba = np.full((64, 32, 4), 255, np.uint8)
        self.engine = module.BodySmartSequence(runtime=Path("/unused-runtime"))
        self.generations = []
        base, uv, tri = make_grid(32, 64)
        self.mesh = {
            "base": base,
            "uv": uv,
            "tri": tri,
            "positions": base + np.float32(0.2),
        }
        self.body = {
            "coords": np.zeros((18, 2), np.float32),
            "visibility": np.ones(18, np.uint8),
        }

        def initialize():
            self.engine.skeleton = Mock()
            self.engine.skeleton.update.return_value = self.body
            self.engine.skeleton.last_debug = {
                "network": "refine",
                "plan": {"mode": 1},
                "state": {"objects": 1},
            }
            self.engine.face = Mock()
            self.engine.face.update.return_value = (None, {"status": "no-face"})
            self.engine.composition = Mock()
            self.engine.composition.update.return_value = self.mesh
            self.generations.append((self.engine.skeleton, self.engine.composition))

        def draw(**kwargs):
            result = kwargs["rgba"].copy()
            result[0, 0, 0] = 17
            return result, {}

        patch.object(self.engine, "_initialize", side_effect=initialize).start()
        patch.object(
            module, "algorithm_image", return_value=(self.rgba.copy(), {})
        ).start()
        patch.object(
            module,
            "process_images",
            return_value={"loaded_images": [], "private_native_images": []},
        ).start()
        self.draw = patch.object(module, "draw_mesh", side_effect=draw).start()

    def frame(self, *, index=0, controls=None, cancelled=None, reapply_controls=False,
              timestamp=None, control_events=()):
        return self.engine.process(
            rgba=self.rgba,
            controls={"SlimArm": 20} if controls is None else controls,
            stream="clip",
            frame=index,
            timestamp=index / 24 if timestamp is None else timestamp,
            cancelled=cancelled,
            reapply_controls=reapply_controls,
            control_events=control_events,
        )

    def test_zero_targets_advance_warm_composition_and_draw_retained_deformation(self):
        self.frame()
        result, receipt = self.frame(index=1, controls={})
        self.assertEqual(self.engine.composition.update.call_count, 2)
        self.assertTrue(
            all(
                value == 0
                for value in self.engine.composition.update.call_args.kwargs[
                    "targets"
                ].values()
            )
        )
        self.assertEqual(self.draw.call_count, 2)
        self.assertFalse(receipt["identity"])
        self.assertNotEqual(receipt["inputRgbaSha256"], receipt["outputRgbaSha256"])
        self.assertEqual(result[0, 0, 0], 17)
        self.assertEqual(self.rgba[0, 0, 0], 255)

    def test_warped_video_uses_native_float_and_texture_orientation_policy(self):
        self.frame()
        supplied = self.draw.call_args.kwargs
        self.assertEqual(supplied["precision"], "float")
        self.assertIs(supplied["flip_source"], False)
        self.assertIs(supplied["flip_sample_y"], True)

    def test_explicit_same_value_reapply_reaches_composition_after_validation(self):
        self.frame(controls={"SlimArm": 20})
        self.engine.composition.configure_controls.assert_called_once_with(
            controls={"SlimArm": 20.0}, reapply=False)
        self.frame(index=1, controls={"SlimArm": 20}, reapply_controls=True)
        self.engine.composition.configure_controls.assert_called_with(
            controls={"SlimArm": 20.0}, reapply=True)
        self.assertEqual(self.engine.composition.update.call_count, 2)

    def test_invalid_reapply_is_rejected_before_loading_or_mutating_models(self):
        for invalid in (None, 0, 1, "true", np.bool_(True)):
            with self.subTest(invalid=invalid), self.assertRaisesRegex(ValueError, "reapply_controls"):
                self.frame(reapply_controls=invalid)
        self.engine._initialize.assert_not_called()
        self.frame()
        for invalid in (None, 0, 1, "true", np.bool_(True)):
            with self.subTest(warm=invalid), self.assertRaisesRegex(ValueError, "reapply_controls"):
                self.frame(index=1, reapply_controls=invalid)
        self.assertEqual(self.engine.skeleton.update.call_count, 1)
        self.assertEqual(self.engine.face.update.call_count, 1)
        self.assertEqual(self.engine.composition.configure_controls.call_count, 1)
        self.assertEqual(self.engine.composition.update.call_count, 1)
        self.assertFalse(self.engine.invalid)
        self.assertEqual(self.engine.next_frame, 1)

    def test_ordered_events_forward_effective_targets_reapply_and_native_clock_reset(self):
        reset = {'type': 'reset_params'}
        assign = {'type': 'set_control', 'name': 'SlimArm', 'value': 35}
        cases = [([reset], {}, True), ([reset, assign], {'SlimArm': 35.0}, True),
                 ([assign, reset], {}, True), ([assign], {'SlimArm': 35.0}, False)]
        for index, (events, expected, reset_clock) in enumerate(cases):
            with self.subTest(events=events):
                _, receipt = self.frame(index=index, controls={'SlimArm': 35}, control_events=events)
                self.assertEqual(receipt['controls'], expected)
                composition = self.engine.composition
                composition.configure_controls.assert_called_with(controls=expected, reapply=True)
                composition.configure_frame.assert_called_with(timestamp=index / 24, reset_clock=reset_clock)
                actual = composition.update.call_args.kwargs['targets']
                for name, value in validate_controls(controls=expected)[1].items():
                    self.assertEqual(actual[name].tobytes(), value.tobytes())
        self.assertEqual(len(self.generations), 1)

    def test_invalid_late_event_is_refused_before_cold_or_warm_state_mutation(self):
        events = [{'type': 'reset_params'}, {'type': 'set_control', 'name': 'SlimArm', 'value': 101}]
        with self.assertRaises(ValueError):
            self.frame(control_events=events)
        self.engine._initialize.assert_not_called()
        self.frame()
        before = (self.engine.next_frame, self.engine.timestamp, self.engine.stream)
        with self.assertRaises(ValueError):
            self.frame(index=1, control_events=events)
        for part in (self.engine.skeleton, self.engine.face, self.engine.composition):
            self.assertEqual(part.update.call_count, 1)
            part.reset.assert_not_called()
        self.assertEqual(self.engine.composition.configure_controls.call_count, 1)
        self.assertEqual(self.engine.composition.configure_frame.call_count, 1)
        self.assertEqual((self.engine.next_frame, self.engine.timestamp, self.engine.stream), before)
        self.assertFalse(self.engine.invalid)

    def test_cancellation_before_reset_event_leaves_event_unapplied_and_requires_replay(self):
        self.frame()
        def cancelled():
            return self.engine.face.update.call_count == 2
        with self.assertRaises(module.BodySequenceCancelled):
            self.frame(index=1, control_events=[{'type': 'reset_params'}], cancelled=cancelled)
        self.assertEqual(self.engine.composition.configure_frame.call_count, 1)
        self.assertEqual(self.engine.composition.configure_controls.call_count, 1)
        self.assertTrue(self.engine.invalid)
        self.assertEqual(self.engine.next_frame, 1)
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            checkpoint.capture(session=self.engine)

    def test_cancellation_after_reset_event_cannot_commit_or_retry_partial_history(self):
        self.frame()
        def cancelled():
            return self.engine.composition.configure_frame.call_count == 2
        with self.assertRaises(module.BodySequenceCancelled):
            self.frame(index=1, timestamp=.75, control_events=[{'type': 'reset_params'}], cancelled=cancelled)
        self.engine.composition.configure_frame.assert_called_with(timestamp=.75, reset_clock=True)
        self.engine.composition.configure_controls.assert_called_with(controls={}, reapply=True)
        self.assertEqual(self.engine.composition.update.call_count, 2)
        self.assertEqual(self.draw.call_count, 1)
        self.assertTrue(self.engine.invalid)
        self.assertEqual((self.engine.next_frame, self.engine.timestamp), (1, 0))
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            checkpoint.capture(session=self.engine)
        with self.assertRaisesRegex(ValueError, 'reset and replay'):
            self.frame(index=1, control_events=[{'type': 'reset_params'}])

    def test_gpu_failure_after_reset_event_requires_session_reconstruction(self):
        self.frame()
        self.draw.side_effect = RuntimeError('GPU process failed')
        with self.assertRaisesRegex(RuntimeError, 'GPU process failed'):
            self.frame(index=1, control_events=[{'type': 'reset_params'}])
        self.engine.composition.configure_frame.assert_called_with(timestamp=1 / 24, reset_clock=True)
        self.assertTrue(self.engine.invalid)
        self.assertEqual((self.engine.next_frame, self.engine.timestamp), (1, 0))
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            checkpoint.capture(session=self.engine)

    def test_cancel_after_draw_invalidates_the_advanced_geometry_until_replay(self):
        with self.assertRaises(module.BodySequenceCancelled):
            self.frame(cancelled=lambda: self.draw.call_count > 0)
        self.assertEqual(self.draw.call_count, 1)
        self.assertEqual(self.engine.composition.update.call_count, 1)
        self.assertTrue(self.engine.invalid)
        self.assertEqual(self.engine.next_frame, 0)
        with self.assertRaisesRegex(ValueError, "reset and replay"):
            self.frame()
        self.engine.reset()
        result, receipt = self.frame()
        self.assertEqual(len(self.generations), 2)
        self.assertIsNot(self.generations[0][1], self.generations[1][1])
        self.assertEqual(self.generations[0][1].update.call_count, 1)
        self.assertEqual(result[0, 0, 0], 17)
        self.assertEqual(receipt["frame"], 0)

    def test_gpu_failure_cannot_be_returned_as_a_success_or_reused(self):
        self.draw.side_effect = RuntimeError("GPU process failed")
        with self.assertRaisesRegex(RuntimeError, "GPU process failed"):
            self.frame()
        self.assertTrue(self.engine.invalid)
        self.assertEqual(self.engine.composition.update.call_count, 1)
        self.assertEqual(self.engine.next_frame, 0)
        with self.assertRaisesRegex(ValueError, "reset and replay"):
            self.frame()
        self.assertEqual(self.draw.call_count, 1)

    def test_no_body_frames_advance_and_draw_retained_geometry_on_the_timeline(self):
        self.frame()
        self.engine.skeleton.update.return_value = None
        result, receipt = self.frame(index=1)
        self.assertEqual(result[0, 0, 0], 17)
        self.assertFalse(receipt["bodyReported"])
        self.assertFalse(receipt["identity"])
        self.assertEqual(self.engine.next_frame, 2)
        self.assertEqual(self.engine.composition.update.call_count, 2)
        inputs = self.engine.composition.update.call_args.kwargs
        self.assertFalse(inputs["body_present"])
        np.testing.assert_array_equal(inputs["visibility"], np.zeros(18, np.uint8))
        self.assertEqual(self.draw.call_count, 2)
        self.engine.skeleton.update.return_value = self.body
        self.frame(index=2)
        self.assertEqual(self.engine.composition.update.call_count, 3)
        self.assertTrue(self.engine.composition.update.call_args.kwargs["body_present"])
        self.assertEqual(self.draw.call_count, 3)

    def assert_missing_body_cancellation(self, *, after_draw):
        self.frame()
        self.engine.skeleton.update.return_value = None
        self.draw.reset_mock()
        def cancelled():
            advanced = self.engine.composition.update.call_count == 2
            return advanced and bool(self.draw.call_count) == after_draw

        with self.assertRaises(module.BodySequenceCancelled):
            self.frame(index=1, cancelled=cancelled)
        self.assertEqual(self.engine.composition.update.call_count, 2)
        self.assertFalse(self.engine.composition.update.call_args.kwargs["body_present"])
        self.assertEqual(self.draw.call_count, int(after_draw))
        self.assertTrue(self.engine.invalid)
        self.assertEqual(self.engine.next_frame, 1)
        with self.assertRaisesRegex(ValueError, "incomplete"):
            checkpoint.capture(session=self.engine)
        with self.assertRaisesRegex(ValueError, "reset and replay"):
            self.frame(index=1)
        self.engine.reset()
        _, receipt = self.frame()
        self.assertEqual(receipt["frame"], 0)
        self.assertFalse(self.engine.invalid)
        self.assertIsNot(self.generations[0][1], self.generations[1][1])

    def test_missing_body_cancel_before_draw_invalidates_advanced_decay(self):
        self.assert_missing_body_cancellation(after_draw=False)

    def test_missing_body_cancel_after_draw_invalidates_advanced_decay(self):
        self.assert_missing_body_cancellation(after_draw=True)

    def test_missing_body_render_failure_requires_replay(self):
        self.frame()
        self.engine.skeleton.update.return_value = None
        self.draw.side_effect = RuntimeError("GPU process failed")
        with self.assertRaisesRegex(RuntimeError, "GPU process failed"):
            self.frame(index=1)
        self.assertTrue(self.engine.invalid)
        self.assertEqual(self.engine.next_frame, 1)
        self.assertEqual(self.engine.composition.update.call_count, 2)
        with self.assertRaisesRegex(ValueError, "incomplete"):
            checkpoint.capture(session=self.engine)

    def test_offline_runner_writes_every_frame_including_suppressed_seed(self):
        self.engine._initialize()
        self.engine.skeleton.update.side_effect = [None, self.body, self.body]
        self.engine.composition.update.side_effect = [
            {**self.mesh, "positions": self.mesh["base"].copy()}, self.mesh, self.mesh,
        ]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.png"
            Image.fromarray(self.rgba).save(source)
            manifest = root / "manifest.json"
            manifest.write_text(
                json.dumps(
                    {
                        "stream": "clip",
                        "frames": [
                            {
                                "image": str(source),
                                "timestampSeconds": frame / 24,
                                "controls": {"SlimArm": 20},
                            }
                            for frame in range(3)
                        ],
                    }
                )
            )
            with patch.object(offline, "BodySmartSequence", return_value=self.engine):
                report = offline.render_sequence(
                    manifest=manifest, runtime="/unused-runtime", output=root / "output"
                )
            self.assertEqual(report["inputFrames"], 3)
            self.assertEqual(report["outputFrames"], 3)
            self.assertEqual(report["frameDropCount"], 0)
            self.assertEqual(len(list((root / "output").glob("*.png"))), 3)
            with Image.open(root / "output/frame-000000.png") as first:
                np.testing.assert_array_equal(np.asarray(first), self.rgba)
            with Image.open(root / "output/frame-000002.png") as last:
                self.assertEqual(np.asarray(last)[0, 0, 0], 17)
            self.assertFalse(report["frames"][0]["bodyReported"])
            self.assertTrue(report["frames"][0]["identity"])
            self.assertEqual(self.engine.composition.update.call_count, 3)
            self.assertEqual(self.draw.call_count, 2)


if __name__ == "__main__":
    unittest.main()
