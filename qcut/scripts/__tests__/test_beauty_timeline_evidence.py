import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

SPEC = importlib.util.spec_from_file_location("beauty_timeline_evidence", Path(__file__).parents[1] / "compare-beauty-timeline-evidence.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class BeautyTimelineEvidenceTests(unittest.TestCase):
    def create_cli_evidence(self, *, root):
        for mode, value in [("original", 0), ("native", 10), ("independent", 15)]:
            (root / mode).mkdir()
            for frame in [0, 1]:
                for kind in ["export", "preview"]:
                    Image.new("RGBA", (2, 2), (value, value, value, 255)).save(
                        root / mode / f"{kind}-frame-{frame:06d}.png"
                    )
        evidence = {
            "status": "captured", "duration": 1, "fps": 30, "totalFrames": 30,
            "sampleIndices": [0, 1], "requestedPasses": list(MODULE.MODE_LABELS),
            "completed": [{"pass": mode, "exported": {"probe": {"frameCount": 30}}}
                          for mode in MODULE.MODE_LABELS],
        }
        (root / "e2e-evidence.json").write_text(json.dumps(evidence))
        return evidence

    def assert_invalid_evidence(self, *, root, evidence):
        (root / "e2e-evidence.json").write_text(json.dumps(evidence))
        with self.assertRaises(ValueError):
            MODULE.build_report(evidence=root)
        self.assertFalse((root / "comparison/index.html").exists())
        self.assertFalse((root / "comparison/metrics.json").exists())

    def run_cli(self, *, root):
        return subprocess.run(
            [sys.executable, str(Path(MODULE.__file__)), str(root)],
            capture_output=True, text=True, timeout=30, check=False,
        )

    def test_exact_rgba_and_fixed_difference_gain(self):
        before = Image.new("RGBA", (2, 2), (255, 100, 100, 255))
        after = before.copy()
        after.putpixel((0, 0), (0, 101, 99, 254))
        metrics, difference = MODULE.compare_pixels(reference=before, candidate=after)
        self.assertEqual(metrics["max_rgb"], 255)
        self.assertEqual(metrics["changed_pixels"], 1)
        self.assertEqual(metrics["max_alpha"], 1)
        self.assertFalse(metrics["within_one_rgb"])
        self.assertEqual(difference.getpixel((0, 0)), 255)
        self.assertEqual(difference.getpixel((1, 0)), 0)

    def test_one_level_rgb_is_allowed_but_alpha_difference_is_not(self):
        before = Image.new("RGBA", (1, 1), (0, 0, 0, 255))
        for alpha, expected in [(255, True), (254, False)]:
            metrics, difference = MODULE.compare_pixels(reference=before, candidate=Image.new("RGBA", (1, 1), (1, 0, 0, alpha)))
            self.assertEqual(metrics["within_one_rgb"], expected)
            self.assertEqual(difference.getpixel((0, 0)), 4)

    def test_mismatched_dimensions_are_not_resized_to_pass(self):
        with self.assertRaises(ValueError):
            MODULE.compare_pixels(reference=Image.new("RGB", (1, 1)), candidate=Image.new("RGB", (2, 2)))

    def test_missing_native_sample_cannot_be_silently_omitted(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.create_cli_evidence(root=root)
            (root / "native/export-frame-000000.png").unlink()
            with self.assertRaises(ValueError):
                MODULE.build_report(evidence=root)

    def test_cli_missing_or_unfinished_e2e_cannot_pass_identical_pngs(self):
        for status in [None, "running", "failed"]:
            with self.subTest(status=status), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                evidence = self.create_cli_evidence(root=root)
                if status is None:
                    (root / "e2e-evidence.json").unlink()
                else:
                    evidence["status"] = status
                    (root / "e2e-evidence.json").write_text(json.dumps(evidence))
                result = self.run_cli(root=root)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('"preview_export_passed": true', result.stdout)
                self.assertFalse((root / "comparison/index.html").exists())

    def test_each_mode_must_be_requested_and_completed_exactly_once(self):
        for field in ["requestedPasses", "completed"]:
            for defect in ["missing", "duplicate", "unknown"]:
                with self.subTest(field=field, defect=defect), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    evidence = self.create_cli_evidence(root=root)
                    values = evidence[field]
                    if defect == "missing":
                        values.pop()
                    elif defect == "duplicate":
                        values[-1] = values[0]
                    else:
                        values.append("other" if field == "requestedPasses" else {"pass": "other"})
                    self.assert_invalid_evidence(root=root, evidence=evidence)

    def test_incomplete_export_counts_cannot_pass_sampled_pngs(self):
        for mode in MODULE.MODE_LABELS:
            for count in [None, 29, 31, 30.0, True]:
                with self.subTest(mode=mode, count=count), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    evidence = self.create_cli_evidence(root=root)
                    row = next(row for row in evidence["completed"] if row["pass"] == mode)
                    row["exported"]["probe"]["frameCount"] = count
                    self.assert_invalid_evidence(root=root, evidence=evidence)

    def test_total_frames_must_match_finite_positive_duration_and_fps(self):
        for field, value in [("duration", None), ("duration", 0), ("duration", float("nan")),
                             ("fps", "30"), ("fps", float("inf")), ("fps", False),
                             ("totalFrames", 29), ("totalFrames", 30.0), ("totalFrames", True)]:
            with self.subTest(field=field, value=value), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                evidence = self.create_cli_evidence(root=root)
                evidence[field] = value
                self.assert_invalid_evidence(root=root, evidence=evidence)

    def test_sample_indices_must_be_nonempty_unique_integer_frame_indices(self):
        for samples in [None, [], [0, 0], [0, 1.0], [0, True], [-1, 1], [0, 30]]:
            with self.subTest(samples=samples), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                evidence = self.create_cli_evidence(root=root)
                evidence["sampleIndices"] = samples
                self.assert_invalid_evidence(root=root, evidence=evidence)

    def test_same_png_subset_in_all_modes_cannot_hide_missing_requested_samples(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            evidence = self.create_cli_evidence(root=root)
            evidence["sampleIndices"].append(2)
            self.assert_invalid_evidence(root=root, evidence=evidence)

    def test_export_and_preview_png_sets_must_each_match_requested_samples(self):
        for kind in ["export", "preview"]:
            for mode in MODULE.MODE_LABELS:
                for defect in ["missing", "extra"]:
                    with self.subTest(kind=kind, mode=mode, defect=defect), tempfile.TemporaryDirectory() as directory:
                        root = Path(directory)
                        evidence = self.create_cli_evidence(root=root)
                        if defect == "missing":
                            (root / mode / f"{kind}-frame-000001.png").unlink()
                        else:
                            Image.new("RGBA", (2, 2)).save(root / mode / f"{kind}-frame-000002.png")
                        self.assert_invalid_evidence(root=root, evidence=evidence)

    def test_half_frame_duration_rounds_like_the_electron_harness(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            evidence = self.create_cli_evidence(root=root)
            evidence.update(duration=1.5, fps=3, totalFrames=5)
            for row in evidence["completed"]:
                row["exported"]["probe"]["frameCount"] = 5
            (root / "e2e-evidence.json").write_text(json.dumps(evidence))
            self.assertTrue(MODULE.build_report(evidence=root)["preview_export_passed"])

    def test_real_capture_auxiliary_pngs_are_not_canonical_frame_samples(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.create_cli_evidence(root=root)
            for mode in MODULE.MODE_LABELS:
                for name in ["preview-frame-000000-composition.png", "preview-frame-000000-ui.png",
                             "preview-frame-000000-layer-00.png", "preview-frame-000000-layer-01.png"]:
                    Image.new("RGBA", (2, 2)).save(root / mode / name)
            report = MODULE.build_report(evidence=root)
            self.assertTrue(report["preview_export_passed"])
            self.assertEqual(report["sample_count"], 2)

    def test_report_separates_algorithm_and_preview_parity(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.create_cli_evidence(root=root)
            report = MODULE.build_report(evidence=root)
            self.assertTrue(all(report["preview_export_within_one_rgb"].values()))
            self.assertFalse(report["native_independent_within_one_rgb"])
            self.assertTrue((root / "comparison/index.html").is_file())

    def test_cli_native_failure_keeps_complete_report_and_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.create_cli_evidence(root=root)
            Image.new("RGBA", (2, 2), (13, 10, 10, 255)).save(
                root / "native/preview-frame-000001.png"
            )
            result = self.run_cli(root=root)
            self.assertEqual(result.returncode, 1, result.stderr)
            summary = json.loads(result.stdout)
            report = json.loads((root / "comparison/metrics.json").read_text())
            self.assertFalse(summary["preview_export_passed"])
            self.assertEqual(report["sample_count"], 2)
            self.assertEqual(report["preview_export_summary"]["native"], {
                "passed": False, "max_rgb": 3, "max_alpha": 0, "failed_frames": [1],
            })
            self.assertTrue(report["preview_export_summary"]["independent"]["passed"])
            self.assertEqual(len(report["frames"][1]["comparisons"]), 6)
            page = (root / "comparison/index.html").read_text()
            self.assertIn("预览／导出验收：FAIL", page)
            self.assertLess(page.index("预览／导出验收：FAIL"), page.index("<video"))
            self.assertIn('src="native-preview-export-000001.png"', page)
            self.assertIn('data-mode="native"', page)
            self.assertIn("最大 RGB 差", page)

    def test_cli_alpha_only_difference_fails_for_every_mode(self):
        for mode in ["original", "native", "independent"]:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.create_cli_evidence(root=root)
                candidate = root / mode / "preview-frame-000000.png"
                with Image.open(candidate) as image:
                    rgba = image.copy()
                rgba.putalpha(254)
                rgba.save(candidate)
                result = self.run_cli(root=root)
                self.assertEqual(result.returncode, 1, result.stderr)
                summary = json.loads(result.stdout)["preview_export_summary"][mode]
                self.assertEqual(summary["max_rgb"], 0)
                self.assertEqual(summary["max_alpha"], 1)
                self.assertEqual(summary["failed_frames"], [0])
                self.assertIn("最大 Alpha 差", (root / "comparison/index.html").read_text())

    def test_cli_algorithm_difference_is_allowed_with_one_rgb_preview_error(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.create_cli_evidence(root=root)
            Image.new("RGBA", (2, 2), (11, 10, 10, 255)).save(
                root / "native/preview-frame-000001.png"
            )
            result = self.run_cli(root=root)
            self.assertEqual(result.returncode, 0, result.stderr)
            summary = json.loads(result.stdout)
            self.assertTrue(summary["preview_export_passed"])
            self.assertFalse(summary["native_independent_within_one_rgb"])
            self.assertEqual(summary["preview_export_summary"]["native"], {
                "passed": True, "max_rgb": 1, "max_alpha": 0, "failed_frames": [],
            })
            page = (root / "comparison/index.html").read_text()
            self.assertIn("预览／导出验收：PASS", page)
            self.assertIn("算法差异不参与通过／失败门槛", page)


if __name__ == "__main__":
    unittest.main()
