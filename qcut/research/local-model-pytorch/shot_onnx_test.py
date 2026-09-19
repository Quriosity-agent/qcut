import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from shot_onnx import load_model, score_frames
from shot_postprocess import cut_points
from shot_video import decoded_frames, read_frame, resize_frame


class ShotVideoTests(unittest.TestCase):
    def test_identity_resize(self):
        frame = np.random.default_rng(14).integers(0, 256, (96, 96, 3), dtype=np.uint8)
        np.testing.assert_array_equal(resize_frame(frame=frame), frame.transpose(2, 0, 1))

    def test_constant_extremes_and_shapes(self):
        for height, width in ((16, 16), (180, 320), (1920, 1080), (73, 119)):
            for value in (0, 127, 255):
                result = resize_frame(frame=np.full((height, width, 3), value, dtype=np.uint8))
                self.assertEqual(result.shape, (3, 96, 96))
                self.assertEqual(result.dtype, np.float32)
                np.testing.assert_array_equal(result, value)

    def test_reject_invalid_images(self):
        for frame in (np.zeros((96, 96, 3)), np.zeros((1, 96, 3), np.uint8), np.zeros((96, 96, 4), np.uint8)):
            with self.assertRaises(ValueError):
                resize_frame(frame=frame)

    def test_partial_reads_and_truncation(self):
        class SmallReads(io.BytesIO):
            def read(self, size):
                return super().read(min(size, 2))
        stream = SmallReads(b"abcdef")
        self.assertEqual(read_frame(stream=stream, size=6), b"abcdef")
        self.assertIsNone(read_frame(stream=stream, size=6))
        with self.assertRaisesRegex(ValueError, "truncated"):
            read_frame(stream=io.BytesIO(b"a"), size=6)

    def test_invalid_decode_args_fail_before_spawn(self):
        for kwargs in ({"fps": float("nan")}, {"fps": 0}, {"width": 3}, {"height": 180.5}):
            options = {"fps": 24, "width": 320, "height": 180, **kwargs}
            with patch("shot_video.subprocess.Popen") as spawn, self.assertRaises(ValueError):
                with decoded_frames(video="unused", ffmpeg="unused", **options):
                    pass
            spawn.assert_not_called()

    def test_window_alignment_and_normalization(self):
        windows = []
        def model(inputs):
            windows.append(inputs["frames"])
            return {"probability": np.asarray(.5, dtype=np.float32)}
        frames = (np.full((96, 96, 3), value, dtype=np.uint8) for value in range(10))
        count, scores, differences = score_frames(model=model, frames=frames)
        self.assertEqual(count, 10)
        self.assertEqual(list(scores), [4, 5, 6])
        np.testing.assert_allclose(windows[0][:, 0, 0, 0], np.arange(1, 8, dtype=np.float32) / 127.5 - 1)
        self.assertEqual(differences, [1.] * 9)

    def test_short_video_never_scores(self):
        for size in (1, 6, 7):
            model = unittest.mock.Mock()
            count, scores, _ = score_frames(model=model, frames=[np.zeros((96, 96, 3), np.uint8)] * size)
            self.assertEqual(count, size)
            self.assertFalse(scores)
            model.assert_not_called()

    def test_empty_and_invalid_probability(self):
        with self.assertRaises(ValueError):
            score_frames(model=None, frames=[])
        for probability in (float("nan"), -1, 2):
            with self.assertRaises(ValueError):
                score_frames(model=lambda _: {"probability": probability}, frames=[np.zeros((96, 96, 3), np.uint8)] * 8)

    def test_peak_plateau_and_threshold(self):
        self.assertEqual(cut_points({4: .1, 5: .9, 6: .1}, [], .35), [5])
        self.assertEqual(cut_points({4: .1, 5: .9, 6: .9, 7: .1}, [], .35), [6])
        self.assertEqual(cut_points({4: .1, 5: .35, 6: .1}, [], .35), [])
        self.assertEqual(cut_points({4: .9, 5: .9, 6: .1}, [], .35), [])

    def test_pixel_difference_boundary_shift(self):
        differences = [0.] * 9
        differences[4] = 3
        self.assertEqual(cut_points({4: .85, 5: .9, 6: .1}, differences, .35), [4])
        differences[6] = 3
        self.assertEqual(cut_points({4: .1, 5: .9, 6: .85}, differences, .35), [6])

    def test_model_rejects_unapproved_identity_before_session(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "contract.json"
            path.write_text(json.dumps({"source_format": "another-model"}))
            with patch("shot_onnx.ONNXModel") as model, self.assertRaisesRegex(ValueError, "approved"):
                load_model(contract=path)
            model.assert_not_called()


if __name__ == "__main__":
    unittest.main()
