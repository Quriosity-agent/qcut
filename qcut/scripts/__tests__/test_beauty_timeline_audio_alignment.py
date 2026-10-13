import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import numpy as np


SPEC = importlib.util.spec_from_file_location(
    "beauty_audio_alignment", Path(__file__).parents[1] / "analyze-beauty-timeline-audio-alignment.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class BeautyAudioAlignmentTests(unittest.TestCase):
    def test_known_positive_and_negative_lag_with_gain_and_dc_change(self):
        rng = np.random.default_rng(1234)
        reference = rng.normal(0, 0.1, 4000)
        margin = 500
        for delay in (-200, 150):
            candidate = rng.normal(0, 0.01, 5000)
            candidate[margin + delay:margin + delay + len(reference)] = reference * 0.7 + 0.02
            report = MODULE.correlate_window(reference=reference, candidate=candidate, margin_samples=margin, sample_rate=1000)
            self.assertEqual(report["lag_ms"], delay)
            self.assertAlmostEqual(report["correlation"], 1)
            self.assertAlmostEqual(report["best_fit_gain"], 0.7)
            self.assertLess(report["gain_adjusted_residual_rms"], 1e-12)
            self.assertFalse(report["ambiguous_peak"])

    def test_silence_is_not_an_alignment_pass(self):
        report = MODULE.correlate_window(reference=np.ones(1000), candidate=np.ones(1200), margin_samples=100)
        self.assertFalse(report["informative"])
        self.assertNotIn("lag_ms", report)

    def test_periodic_signal_reports_ambiguous_lag(self):
        candidate = np.sin(np.arange(3000) * 2 * np.pi / 50)
        report = MODULE.correlate_window(reference=candidate[500:2500], candidate=candidate, margin_samples=500, sample_rate=1000)
        self.assertTrue(report["ambiguous_peak"])

    def test_search_edge_is_censored(self):
        reference = np.random.default_rng(42).normal(size=1000)
        report = MODULE.correlate_window(reference=reference, candidate=np.pad(reference, (0, 200)), margin_samples=100)
        self.assertTrue(report["at_search_boundary"])

    def test_project_mapping_requires_explicit_opt_in(self):
        with self.assertRaisesRegex(ValueError, "contiguous-source"):
            MODULE.build_report(evidence_root=Path("/not-read"))

    def test_missing_decoded_audio_pts_is_not_replaced_by_stream_metadata(self):
        metadata = {"streams": [{"codec_type": "audio", "start_time": "0"},
                                {"codec_type": "video", "start_time": "0.033"}]}
        replies = [subprocess.CompletedProcess([], 0, stdout=json.dumps(metadata)),
                   subprocess.CompletedProcess([], 0, stdout=json.dumps({"frames": []}))]
        with patch.object(MODULE.subprocess, "run", side_effect=replies):
            with self.assertRaisesRegex(ValueError, "Missing decoded audio presentation origin"):
                MODULE.probe_audio(path=Path("/fixture.mp4"))

    def test_drift_does_not_use_silent_or_ambiguous_windows(self):
        windows = []
        for time, lag in ((1, 10), (5, 14), (9, 18)):
            windows.append({"start_seconds": time, "duration_seconds": 2,
                            "padding": {}, "measurement": {"informative": True, "lag_ms": lag,
                            "correlation": 0.99, "ambiguous_peak": False, "at_search_boundary": False}})
        report = MODULE.drift_summary(windows=windows)
        self.assertEqual(report["first_to_last_lag_change_ms"], 8)
        self.assertAlmostEqual(report["slope_ms_per_minute"], 60)
        windows[1]["measurement"]["ambiguous_peak"] = True
        windows[2]["measurement"]["informative"] = False
        self.assertFalse(MODULE.drift_summary(windows=windows)["available"])

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "Requires FFmpeg")
    def test_video_origin_does_not_shift_container_audio_clock(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            baseline = root / "baseline.mp4"
            subprocess.run([
                "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=size=16x32:rate=5:duration=3",
                "-f", "lavfi", "-i", "anoisesrc=duration=3:sample_rate=48000:amplitude=0.1:seed=93",
                "-c:v", "libx264", "-bf", "0", "-c:a", "aac", "-shortest", str(baseline)], check=True)
            for mode in MODULE.MODES:
                (root / mode).mkdir()
                shutil.copyfile(baseline, root / mode / "export.mp4")
            for audio_offset in (0, 0.08):
                with self.subTest(source_audio_offset=audio_offset):
                    source = root / f"source-{audio_offset}.mp4"
                    subprocess.run([
                        "ffmpeg", "-v", "error", "-itsoffset", "0.033", "-i", str(baseline),
                        "-itsoffset", str(audio_offset), "-i", str(baseline),
                        "-map", "0:v:0", "-map", "1:a:0", "-c", "copy",
                        "-video_track_timescale", "1000000", str(source)], check=True)
                    (root / "e2e-evidence.json").write_text(json.dumps({"source": str(source), "duration": 3}))
                    report = MODULE.build_report(evidence_root=root, contiguous_source=True)
                    self.assertAlmostEqual(float(report["media"]["source"]["video"]["start_time"]), 0.033, places=6)
                    for mode in MODULE.MODES:
                        for row in report["passes"][mode]["windows"]:
                            self.assertAlmostEqual(row["measurement"]["lag_ms"], -audio_offset * 1000, delta=1)
                    self.assertEqual(report["mapping"]["clock"], "container-presentation-timestamp-zero")
                    self.assertFalse(report["mapping"]["normalize_first_video_timestamp"])
                    source_metadata = report["media"]["source"]
                    self.assertEqual(source_metadata["audio_start_seconds"], source_metadata["first_decoded_audio_pts_seconds"])
                    if audio_offset:
                        self.assertGreater(source_metadata["audio_start_seconds"], 0.05)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "Requires FFmpeg")
    def test_encoded_identical_triplet_and_delayed_audio_pts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.mp4"
            subprocess.run([
                "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=size=16x32:rate=5:duration=3",
                "-f", "lavfi", "-i", "anoisesrc=duration=3:sample_rate=48000:amplitude=0.1:seed=42",
                "-c:v", "libx264", "-c:a", "aac", "-shortest", str(source)], check=True)
            for mode in MODULE.MODES:
                (root / mode).mkdir()
                shutil.copyfile(source, root / mode / "export.mp4")
            (root / "e2e-evidence.json").write_text(json.dumps({"source": str(source), "duration": 3}))
            report = MODULE.build_report(evidence_root=root, contiguous_source=True)
            for mode in MODULE.MODES:
                for row in report["passes"][mode]["windows"]:
                    self.assertEqual(row["measurement"]["lag_samples"], 0)
                    self.assertGreater(row["measurement"]["correlation"], 0.999)
            delayed = root / "delayed.mp4"
            subprocess.run([
                "ffmpeg", "-v", "error", "-i", str(source), "-itsoffset", "0.04", "-i", str(source),
                "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", str(delayed)], check=True)
            shutil.copyfile(delayed, root / "independent/export.mp4")
            report = MODULE.build_report(evidence_root=root, contiguous_source=True)
            self.assertGreater(report["media"]["independent"]["audio_start_relative_to_video_seconds"], 0.015)
            for row in report["passes"]["independent"]["windows"]:
                self.assertAlmostEqual(row["measurement"]["lag_ms"], 40, delta=1)


if __name__ == "__main__":
    unittest.main()
