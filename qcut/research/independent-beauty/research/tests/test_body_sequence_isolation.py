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
import body_smart_sequence as module
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

    def frame(self, *, index=0, controls=None, cancelled=None):
        return self.engine.process(
            rgba=self.rgba,
            controls={"SlimArm": 20} if controls is None else controls,
            stream="clip",
            frame=index,
            timestamp=index / 24,
            cancelled=cancelled,
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

    def test_cancel_after_draw_invalidates_the_advanced_geometry_until_replay(self):
        counter = 0

        def cancel_after_draw():
            nonlocal counter
            counter += 1
            return counter == 5

        with self.assertRaises(module.BodySequenceCancelled):
            self.frame(cancelled=cancel_after_draw)
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

    def test_no_body_frames_do_not_draw_or_advance_geometry_but_keep_the_timeline(self):
        self.frame()
        self.engine.skeleton.update.return_value = None
        result, receipt = self.frame(index=1)
        np.testing.assert_array_equal(result, self.rgba)
        self.assertFalse(receipt["bodyReported"])
        self.assertEqual(self.engine.next_frame, 2)
        self.assertEqual(self.engine.composition.update.call_count, 1)
        self.assertEqual(self.draw.call_count, 1)
        self.engine.skeleton.update.return_value = self.body
        self.frame(index=2)
        self.assertEqual(self.engine.composition.update.call_count, 2)
        self.assertEqual(self.draw.call_count, 2)

    def test_offline_runner_writes_every_frame_including_suppressed_seed(self):
        self.engine._initialize()
        self.engine.skeleton.update.side_effect = [None, self.body, self.body]
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
            self.assertEqual(self.engine.composition.update.call_count, 2)


if __name__ == "__main__":
    unittest.main()
