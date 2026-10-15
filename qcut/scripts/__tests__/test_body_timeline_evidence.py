import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image


SPEC = importlib.util.spec_from_file_location("body_timeline_evidence", Path(__file__).parents[1] / "compare-body-timeline-evidence.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class BodyTimelineEvidenceTests(unittest.TestCase):
    def create_evidence(self, *, root):
        for index, mode in enumerate(MODULE.MODE_LABELS):
            (root / mode).mkdir()
            for frame in (0, 90, 179):
                for kind, suffix in (("export", ""), ("preview", ""), ("preview", "-composition")):
                    Image.new("RGBA", (3, 5), (index * 10, frame, 20, 255)).save(
                        root / mode / f"{kind}-frame-{frame:06d}{suffix}.png")
        evidence = {"status": "captured", "width": 3, "height": 5, "duration": 6, "fps": 30,
                    "totalFrames": 180, "sampleIndices": [0, 90, 179],
                    "requestedPasses": list(MODULE.MODE_LABELS),
                    "completed": [{"pass": mode, "exported": {"probe": {"frameCount": 180}}}
                                  for mode in MODULE.MODE_LABELS]}
        self.save_evidence(root=root, evidence=evidence)
        return evidence

    def save_evidence(self, *, root, evidence):
        (root / "e2e-evidence.json").write_text(json.dumps(evidence))

    def assert_invalid(self, *, root):
        with self.assertRaises((ValueError, FileNotFoundError)):
            MODULE.build_report(evidence=root, verify_encoded=False)
        self.assertFalse((root / "body-comparison/metrics.json").exists())

    def media_probe(self):
        return {"video": {"width": 3, "height": 5, "nb_read_frames": "180", "avg_frame_rate": "30/1"},
                "audio": None, "video_timestamps": {"count": 180, "sha256": "same-pts",
                                                    "strictly_increasing": True}}

    def test_png_only_never_claims_video_or_overall_acceptance(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.create_evidence(root=root)
            report = MODULE.build_report(evidence=root, verify_encoded=False)
            self.assertTrue(report["png_samples_passed"])
            self.assertFalse(report["overall_verified"])
            self.assertEqual(report["verification_status"], "PNG_ONLY")
            self.assertFalse(report["encoded_video"]["verified"])
            self.assertEqual(report["sample_count"], 3)
            self.assertEqual(set(report["preview_export_summary"]), set(MODULE.MODE_LABELS))
            self.assertEqual(len(report["frames"][0]["comparisons"]), 14)
            with Image.open(root / "body-comparison/original_smart-000000.png") as image:
                self.assertEqual(image.getpixel((0, 0)), 40)
            page = (root / "body-comparison/index.html").read_text()
            for mode in MODULE.MODE_LABELS:
                self.assertIn(f'{mode}-ui-export-000000.png', page)
                self.assertIn(f'{mode}-composition-export-000000.png', page)
            self.assertIn("PNG_ONLY", page)
            self.assertIn("MP4 只检查", page)
            self.assertIn("并非未经编辑的源文件原图", page)
            self.assertTrue(report["combination_activity_passed"])
            self.assertIn("smart_combined-000000.png", page)
            self.assertIn("manual_combined-000000.png", page)

    def test_missing_failed_and_incomplete_evidence_cannot_pass(self):
        for status in (None, "running", "failed"):
            with self.subTest(status=status), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                evidence = self.create_evidence(root=root)
                if status is None:
                    (root / "e2e-evidence.json").unlink()
                else:
                    evidence["status"] = status
                    self.save_evidence(root=root, evidence=evidence)
                self.assert_invalid(root=root)

    def test_missing_duplicate_and_unknown_modes_are_rejected(self):
        for field in ("completed", "requestedPasses"):
            for defect in ("missing", "duplicate", "unknown"):
                with self.subTest(field=field, defect=defect), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    evidence = self.create_evidence(root=root)
                    if defect == "missing":
                        evidence[field].pop()
                    elif defect == "duplicate":
                        evidence[field][-1] = evidence[field][0]
                    else:
                        evidence[field].append("native" if field == "requestedPasses" else {"pass": "native"})
                    self.save_evidence(root=root, evidence=evidence)
                    self.assert_invalid(root=root)

    def test_three_frame_exports_cannot_claim_180_frame_completion(self):
        for mode in MODULE.MODE_LABELS:
            for count in (None, 3, 179, 181, 180.0, True):
                with self.subTest(mode=mode, count=count), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    evidence = self.create_evidence(root=root)
                    row = next(row for row in evidence["completed"] if row["pass"] == mode)
                    row["exported"]["probe"]["frameCount"] = count
                    self.save_evidence(root=root, evidence=evidence)
                    self.assert_invalid(root=root)

    def test_sample_manifest_rejects_duplicate_empty_outside_or_noninteger_indices(self):
        for samples in ([], [0, 0], [0, 180], [0, 1.0], [True], [-1]):
            with self.subTest(samples=samples), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                evidence = self.create_evidence(root=root)
                evidence["sampleIndices"] = samples
                self.save_evidence(root=root, evidence=evidence)
                self.assert_invalid(root=root)

    def test_every_png_set_must_match_the_manifest(self):
        for mode in MODULE.MODE_LABELS:
            for kind, suffix in (("export", ""), ("preview", ""), ("preview", "-composition")):
                for defect in ("missing", "extra", "alternate-padding"):
                    with self.subTest(mode=mode, kind=kind, suffix=suffix, defect=defect), tempfile.TemporaryDirectory() as directory:
                        root = Path(directory)
                        self.create_evidence(root=root)
                        if defect == "missing":
                            (root / mode / f"{kind}-frame-000090{suffix}.png").unlink()
                        else:
                            frame = "0" if defect == "alternate-padding" else "000001"
                            Image.new("RGBA", (3, 5)).save(root / mode / f"{kind}-frame-{frame}{suffix}.png")
                        self.assert_invalid(root=root)

    def test_pngs_cannot_pass_with_wrong_or_consistently_forged_dimensions(self):
        for defect in ("one-png", "manifest", "invalid-manifest"):
            with self.subTest(defect=defect), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                evidence = self.create_evidence(root=root)
                if defect == "one-png":
                    Image.new("RGBA", (5, 3)).save(root / "manual/preview-frame-000090-composition.png")
                else:
                    evidence["width"] = True if defect == "invalid-manifest" else 1080
                    self.save_evidence(root=root, evidence=evidence)
                self.assert_invalid(root=root)

    def test_ui_and_composition_each_fail_on_alpha_or_rgb_error(self):
        for suffix in MODULE.PREVIEW_KINDS.values():
            for pixel in ((20, 90, 20, 254), (22, 90, 20, 255)):
                with self.subTest(suffix=suffix, pixel=pixel), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    self.create_evidence(root=root)
                    Image.new("RGBA", (3, 5), pixel).save(root / "manual" / f"preview-frame-000090{suffix}.png")
                    report = MODULE.build_report(evidence=root, verify_encoded=False)
                    self.assertFalse(report["preview_export_passed"])
                    self.assertFalse(report["png_samples_passed"])
                    kind = "composition" if suffix else "ui"
                    self.assertEqual(report["preview_export_summary"]["manual"][kind]["failed_frames"], [90])

    def test_one_rgb_difference_is_allowed_for_both_preview_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.create_evidence(root=root)
            for suffix in MODULE.PREVIEW_KINDS.values():
                Image.new("RGBA", (3, 5), (21, 90, 20, 255)).save(root / "manual" / f"preview-frame-000090{suffix}.png")
            self.assertTrue(MODULE.build_report(evidence=root, verify_encoded=False)["png_samples_passed"])

    def test_unchanged_effect_modes_fail_even_when_every_preview_matches(self):
        for unchanged in (("smart",), ("smart", "manual", "combined")):
            with self.subTest(unchanged=unchanged), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.create_evidence(root=root)
                for mode in unchanged:
                    for frame in (0, 90, 179):
                        for kind, suffix in (("export", ""), ("preview", ""), ("preview", "-composition")):
                            Image.new("RGBA", (3, 5), (0, frame, 20, 255)).save(root / mode / f"{kind}-frame-{frame:06d}{suffix}.png")
                report = MODULE.build_report(evidence=root, verify_encoded=False)
                self.assertTrue(report["preview_export_passed"])
                self.assertFalse(report["effect_activity_passed"])
                self.assertFalse(report["png_samples_passed"])

    def test_matching_preview_alpha_cannot_hide_alpha_changed_by_effects(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.create_evidence(root=root)
            for kind, suffix in (("export", ""), ("preview", ""), ("preview", "-composition")):
                Image.new("RGBA", (3, 5), (20, 90, 20, 254)).save(root / "manual" / f"{kind}-frame-000090{suffix}.png")
            report = MODULE.build_report(evidence=root, verify_encoded=False)
            self.assertTrue(report["preview_export_passed"])
            self.assertFalse(report["effect_activity"]["manual"]["passed"])

    def test_combined_cannot_silently_drop_either_single_path(self):
        for retained_mode in ("smart", "manual"):
            with self.subTest(retained_mode=retained_mode), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.create_evidence(root=root)
                for source in (root / retained_mode).glob("*.png"):
                    shutil.copyfile(source, root / "combined" / source.name)
                report = MODULE.build_report(evidence=root, verify_encoded=False)
                self.assertTrue(report["preview_export_passed"])
                self.assertTrue(report["effect_activity_passed"])
                self.assertFalse(report["combination_activity_passed"])
                self.assertFalse(report["png_samples_passed"])
                self.assertEqual(report["verification_status"], "FAIL")
                result = report["combination_activity"][f"{retained_mode}_combined"]
                self.assertEqual(result["failures"], ["no_sampled_rgb_change"])

    def test_combination_rgb_difference_cannot_hide_alpha_change(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.create_evidence(root=root)
            for kind, suffix in (("export", ""), ("preview", ""), ("preview", "-composition")):
                Image.new("RGBA", (3, 5), (30, 90, 20, 254)).save(root / "combined" / f"{kind}-frame-000090{suffix}.png")
            report = MODULE.build_report(evidence=root, verify_encoded=False)
            self.assertTrue(report["preview_export_passed"])
            self.assertFalse(report["combination_activity_passed"])
            for result in report["combination_activity"].values():
                self.assertEqual(result["failures"], ["alpha_changed"])

    def test_full_audit_checks_all_four_actual_videos(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.create_evidence(root=root)
            with patch.object(MODULE, "decode_export") as decode, patch.object(MODULE.VIDEO, "probe_media", return_value=self.media_probe()) as probe:
                report = MODULE.build_report(evidence=root)
            self.assertTrue(report["overall_verified"])
            self.assertEqual(report["verification_status"], "PASS")
            self.assertEqual(decode.call_count, 4)
            self.assertEqual(probe.call_count, 4)
            self.assertEqual({call.kwargs["path"].parent.name for call in decode.call_args_list}, set(MODULE.MODE_LABELS))

    def test_encoded_counts_pts_rate_geometry_and_decode_errors_fail(self):
        defects = [("count", "video", "nb_read_frames", "3"),
                   ("pts-count", "video_timestamps", "count", 3),
                   ("pts-mismatch", "video_timestamps", "sha256", "other"),
                   ("pts-order", "video_timestamps", "strictly_increasing", False),
                   ("fps", "video", "avg_frame_rate", "24/1"),
                   ("geometry", "video", "width", 1080)]
        for name, section, field, value in defects:
            with self.subTest(defect=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.create_evidence(root=root)
                probes = [self.media_probe() for _ in MODULE.MODE_LABELS]
                probes[2][section][field] = value
                with patch.object(MODULE, "decode_export"), patch.object(MODULE.VIDEO, "probe_media", side_effect=probes):
                    report = MODULE.build_report(evidence=root)
                self.assertFalse(report["overall_verified"])
                self.assertFalse(report["encoded_video"]["passed"])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.create_evidence(root=root)
            with patch.object(MODULE, "decode_export", side_effect=subprocess.CalledProcessError(1, ["ffmpeg"])):
                with self.assertRaises(subprocess.CalledProcessError):
                    MODULE.build_report(evidence=root)
            self.assertFalse((root / "body-comparison/metrics.json").exists())

    def test_cli_png_only_explicitly_reports_partial_acceptance(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.create_evidence(root=root)
            result = subprocess.run([sys.executable, MODULE.__file__, str(root), "--png-only"],
                                    capture_output=True, text=True, timeout=30, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(json.loads(result.stdout)["overall_verified"])

    def test_failed_revalidation_removes_stale_success_report(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            evidence = self.create_evidence(root=root)
            with patch.object(MODULE, "decode_export"), patch.object(MODULE.VIDEO, "probe_media", return_value=self.media_probe()):
                self.assertTrue(MODULE.build_report(evidence=root)["overall_verified"])
            evidence["status"] = "failed"
            self.save_evidence(root=root, evidence=evidence)
            self.assert_invalid(root=root)
            self.assertFalse((root / "body-comparison/index.html").exists())

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg and ffprobe required")
    def test_real_encoded_decode_rejects_a_short_export_despite_recorded_count(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for mode in MODULE.MODE_LABELS:
                (root / mode).mkdir()
            baseline = root / "original/export.mp4"
            command = ["ffmpeg", "-v", "error", "-nostdin", "-f", "lavfi", "-i", "color=red:s=16x16:r=30",
                       "-frames:v", "180", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(baseline)]
            subprocess.run(command, check=True, capture_output=True, timeout=30)
            for mode in ("smart", "manual", "combined"):
                shutil.copyfile(baseline, root / mode / "export.mp4")
            validation = {"width": 16, "height": 16, "fps": 30, "total_frames": 180}
            result = MODULE.audit_encoded_exports(evidence=root, validation=validation)
            self.assertTrue(result["passed"])
            self.assertTrue(result["presentation_timestamps_equal"])
            self.assertTrue(all(row["frame_count"] == 180 for row in result["modes"].values()))
            command[command.index("180")] = "3"
            command[-1] = str(root / "manual/export.mp4")
            subprocess.run([*command[:-1], "-y", command[-1]], check=True, capture_output=True, timeout=30)
            result = MODULE.audit_encoded_exports(evidence=root, validation=validation)
            self.assertFalse(result["passed"])
            self.assertEqual(result["modes"]["manual"]["frame_count"], 3)
            self.assertFalse(result["presentation_timestamps_equal"])


if __name__ == "__main__":
    unittest.main()
