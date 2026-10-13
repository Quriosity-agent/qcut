import copy
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

import numpy as np


SPEC = importlib.util.spec_from_file_location(
    "beauty_timeline_video", Path(__file__).parents[1] / "analyze-beauty-timeline-video.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ShortReads(io.BytesIO):
    def read(self, size=-1):
        return super().read(min(size, 2))


class BeautyTimelineVideoTests(unittest.TestCase):
    def test_partial_pipe_reads_form_one_complete_frame(self):
        pipe = ShortReads(b"abcdef")
        self.assertEqual(MODULE.read_frame(pipe=pipe, frame_bytes=6), b"abcdef")
        self.assertIsNone(MODULE.read_frame(pipe=pipe, frame_bytes=6))

    def test_partial_final_frame_is_an_error(self):
        with self.assertRaisesRegex(ValueError, "Truncated"):
            MODULE.read_frame(pipe=ShortReads(b"abcde"), frame_bytes=6)

    def test_signed_residual_change_does_not_hide_sign_flip(self):
        reference = [np.full((1, 1, 3), 100, np.uint8)] * 3
        candidate = [np.full((1, 1, 3), value, np.uint8) for value in (90, 110, 110)]
        report = MODULE.measure_residuals(reference_frames=iter(reference),
                                         candidate_frames=iter(candidate), fps=30)
        self.assertEqual(report["per_frame_mean_abs_rgb"]["mean"], 10)
        self.assertEqual(report["per_frame_mean_residual_change"]["max"], 20)
        self.assertEqual(report["worst_residual_change_by_mean"]["frame"], 1)

    def test_extra_frames_are_counted_not_silently_truncated(self):
        frame = np.zeros((1, 1, 3), np.uint8)
        report = MODULE.measure_residuals(reference_frames=iter([frame, frame]),
                                         candidate_frames=iter([frame]), fps=30)
        self.assertFalse(report["frame_counts_equal"])
        self.assertEqual(report["reference_frames"], 2)
        self.assertEqual(report["paired_frames"], 1)
        self.assertIsNone(report["per_frame_mean_residual_change"])

    def test_empty_video_is_not_a_zero_error_pass(self):
        with self.assertRaisesRegex(ValueError, "No paired"):
            MODULE.measure_residuals(reference_frames=iter([]), candidate_frames=iter([]), fps=30)

    def test_no_audio_is_unverified(self):
        report = MODULE.compare_audio(audio={mode: None for mode in MODULE.MODES})
        self.assertFalse(report["audio_unchanged"])

    def test_compression_metrics_have_known_full_rgb_error_and_json_safe_psnr(self):
        original = np.full((2, 3, 3), 100, np.uint8)
        decoded = np.full((2, 3, 3), 110, np.uint8)
        report = MODULE.compression_metrics(reference=original, decoded=decoded)
        self.assertEqual(report["max_abs_rgb"], 10)
        self.assertEqual(report["mean_abs_rgb"], 10)
        self.assertEqual(report["p99_abs_rgb"], 10)
        self.assertAlmostEqual(report["psnr_db"], 28.130803608679106)
        exact = MODULE.compression_metrics(reference=original, decoded=original)
        self.assertTrue(exact["psnr_infinite"])
        self.assertIsNone(exact["psnr_db"])
        json.dumps(exact, allow_nan=False)
        with self.assertRaisesRegex(ValueError, "identical dimensions"):
            MODULE.compression_metrics(reference=original, decoded=decoded[:1])

    def test_compression_selection_is_unique_and_bounded(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "export-frame-000000.png").touch()
            (root / "export-frame-0.png").touch()
            with self.assertRaisesRegex(ValueError, "Duplicate"):
                MODULE.preencode_pngs(directory=root)
            (root / "export-frame-0.png").unlink()
            for index in range(1, 33):
                (root / f"export-frame-{index:06}.png").touch()
            with self.assertRaisesRegex(ValueError, "at most 32"):
                MODULE.preencode_pngs(directory=root)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "Requires FFmpeg")
    def test_lossy_encoded_frames_are_compared_to_their_own_preencode_pngs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "original"
            output.mkdir()
            yy, xx = np.indices((80, 48))
            frames = np.array([np.stack(((xx * 5 + index * 17) % 256,
                                         (yy * 3 + index * 11) % 256,
                                         (xx + yy + index * 31) % 256), axis=-1)
                               for index in range(8)], dtype=np.uint8)
            video = output / "export.mp4"
            raw_input = ["ffmpeg", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
                         "-s", "48x80", "-r", "8", "-i", "pipe:0"]
            subprocess.run([*raw_input, "-c:v", "libx264", "-crf", "28", "-pix_fmt", "yuv420p", str(video)],
                           input=frames.tobytes(), check=True)
            for index in (0, 3, 7):
                subprocess.run([*raw_input, "-frames:v", "1", str(output / f"export-frame-{index:06}.png")],
                               input=frames[index].tobytes(), check=True, capture_output=True)
            report = MODULE.compression_report(evidence=root)
            measured = report["passes"]["original"]
            self.assertEqual(measured["sample_count"], 3)
            self.assertEqual(measured["selected_indices"], [0, 3, 7])
            self.assertEqual(measured["unique_index_count"], 3)
            self.assertEqual(measured["unique_timestamp_count"], 3)
            self.assertEqual(measured["unique_preencode_rgb_count"], 3)
            self.assertEqual(measured["unique_decoded_rgb_count"], 3)
            self.assertEqual([row["presentation_timestamp_seconds"] for row in measured["frames"]], [0, 0.375, 0.875])
            for row in measured["frames"]:
                self.assertGreater(row["mean_abs_rgb"], 0)
                self.assertGreater(row["psnr_db"], 20)
            self.assertFalse(report["passes"]["native"]["available"])
            self.assertIsNone(report["acceptance_verdict"])
            for mode in ("native", "independent"):
                shutil.copytree(output, root / mode)
            complete = MODULE.build_report(evidence=root, sample_width=24)
            for mode in MODULE.MODES:
                self.assertEqual(complete["compression_diagnostic"]["passes"][mode]["sample_count"], 3)
            bad_size = output / "bad.png"
            subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=size=16x16",
                            "-frames:v", "1", str(bad_size)], check=True, capture_output=True)
            with self.assertRaisesRegex(ValueError, "dimensions differ"):
                MODULE.read_png_rgb(path=bad_size, width=48, height=80)
            with self.assertRaisesRegex(ValueError, "missing"):
                MODULE.selected_frame_timestamps(path=video, indices=[8])

    def test_identical_pcm_with_shifted_timestamp_does_not_preserve_sync(self):
        baseline = {"sha256": "same", "bytes": 192000, "sample_frames": 48000,
                    "sample_rate": 48000, "channels": 1, "channel_layout": "mono",
                    "stream_start_seconds": 0, "stream_duration_seconds": 1}
        audio = {mode: copy.deepcopy(baseline) for mode in MODULE.MODES}
        self.assertTrue(MODULE.compare_audio(audio=audio)["audio_unchanged"])
        audio["independent"]["stream_start_seconds"] = 0.02
        report = MODULE.compare_audio(audio=audio)
        self.assertTrue(report["decoded_pcm_equal"])
        self.assertFalse(report["audio_unchanged"])
        audio["independent"]["sha256"] = "changed"
        self.assertFalse(MODULE.compare_audio(audio=audio)["decoded_pcm_equal"])

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "Requires FFmpeg")
    def test_real_encoded_triplet_audio_pts_and_video_decode(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for mode in MODULE.MODES:
                (root / mode).mkdir()
            source = root / "original/export.mp4"
            subprocess.run([
                "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=48x80:rate=8:duration=1",
                "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(source)], check=True)
            for mode in ("native", "independent"):
                shutil.copyfile(source, root / mode / "export.mp4")
            report = MODULE.build_report(evidence=root, sample_width=24)
            self.assertTrue(report["video_comparison"]["matching_timeline"])
            self.assertEqual(report["video_comparison"]["frame_counts"]["original"], 8)
            self.assertTrue(report["audio_comparison"]["audio_unchanged"])
            self.assertEqual(report["temporal_diagnostic"]["paired_frames"], 8)
            self.assertEqual(report["temporal_diagnostic"]["per_frame_mean_abs_rgb"]["max"], 0)
            self.assertIsNone(report["temporal_diagnostic"]["acceptance_verdict"])
            shifted = copy.deepcopy(report["media"])
            shifted["independent"]["video_timestamps"]["sha256"] = "different"
            self.assertFalse(MODULE.compare_video_metadata(media=shifted)["matching_timeline"])


if __name__ == "__main__":
    unittest.main()
