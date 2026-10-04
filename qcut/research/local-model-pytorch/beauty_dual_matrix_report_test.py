"""CPU-only fixtures for offline reports; no native bridge/model imports."""
from __future__ import annotations

import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

import beauty_dual_matrix_report as reporter


class ReportHTML(HTMLParser):
    def __init__(self):
        super().__init__()
        self.images, self.links, self.columns = [], [], []

    def handle_starttag(self, tag, attrs):
        value = dict(attrs)
        if tag == "img":
            self.images.append(value)
        if tag == "a":
            self.links.append(value["href"])
        if tag == "th" and value.get("scope") == "col":
            self.columns.append(value)


class MatrixFixture(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="qcut-dual-matrix-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.probe = self.root / "probe"
        self.probe.mkdir()
        (self.probe / "baseline").mkdir()
        (self.probe / "live").mkdir()
        self.audit_path = self.probe / "report.json"
        self.matrix_path = self.root / "matrix.json"
        self.out = self.root / "report"
        self.original = bytes([10, 20, 30, 255, 100, 110, 120, 128])
        self.native = bytes([11, 22, 33, 255, 100, 110, 120, 128])
        self.manifest = self.root / "manifest.json"
        self.manifest.write_bytes(b'{"version":1,"frames":[]}\n')
        self.audit = dict(schema="face-live-bridge-probe-v1", passed=True, completed=True,
            phase="live-audit", failures=[], live_checks_completed=True, native_execution_performed=True,
            dependencies_unchanged=True, scope="bounded-single-face-native-dependent-live-research",
            manifest=str(self.manifest), manifest_sha256=self.sha(data=self.manifest.read_bytes()),
            width=2, height=1, input_frames=[], requests=dict(baseline=[], live=[]), frames=[],
            artifacts={}, dependencies=dict(files={}))
        self.add_frame(frame=0, original=self.original, native=self.native, live=self.native)
        self.case = dict(id="front-eye", portrait="front", category="face-controls", label="Eye 50",
                         audit=str(self.audit_path), frame=0)

    @staticmethod
    def sha(*, data):
        return hashlib.sha256(data).hexdigest()

    def artifact(self, *, relative, data):
        path = self.probe / relative
        path.write_bytes(data)
        metadata = path.stat()
        self.audit["artifacts"][relative] = dict(sha256=self.sha(data=data),
            identity=[str(path), metadata.st_dev, metadata.st_ino, len(data), metadata.st_mtime_ns])
        return str(path)

    def add_frame(self, *, frame, original, native, live):
        input_path = self.artifact(relative=f"input-{frame:02d}.rgba", data=original)
        self.audit["input_frames"].append(dict(input=input_path, input_sha256=self.sha(data=original),
            parameters=dict(eye=50 + frame), timestamp=frame / 30, expect_change=native != original))
        self.audit["dependencies"]["files"][input_path] = self.sha(data=original)
        for phase, data in (("baseline", native), ("live", live)):
            output = self.artifact(relative=f"{phase}/frame-{frame:02d}.rgba", data=data)
            self.audit["requests"][phase].append(dict(id=f"frame-{frame:02d}", frame=frame, warmup=False,
                timestamp=frame / 30, timestamp_us=round(frame / 30 * 1e6), output=output))
        self.audit["frames"].append(dict(frame=frame, native_sha256=self.sha(data=native), sha256=self.sha(data=live)))

    def run_report(self, *, cases=None):
        self.audit_path.write_text(json.dumps(self.audit), encoding="utf-8")
        self.matrix_path.write_text(json.dumps(dict(schema="beauty-dual-matrix-v1", cases=cases or [self.case])),
                                    encoding="utf-8")
        return reporter.generate(matrix=self.matrix_path, out=self.out)

    def test_exact_exports_six_images_with_exact_metrics_and_immutable_snapshots(self):
        result = self.run_report()
        row = result["cases"][0]
        self.assertEqual(row["status"], "EXACT")
        self.assertEqual(len(row["images"]), 6)
        self.assertFalse(result["gpu_launched"])
        self.assertFalse(result["product_parity_verified"])
        self.assertFalse(result["temporal_sequence_acceptance"])
        self.assertEqual(row["metrics"]["native_original"], dict(pixel_count=2, rgb_sample_count=6,
            rgb_abs_sum=6, rgb_mae=1.0, rgb_max=3, alpha_abs_sum=0, alpha_mae=0.0, alpha_max=0,
            rgb_changed_pixels=1, alpha_changed_pixels=0, alpha_only_changed_pixels=0, rgba_changed_pixels=1,
            equal=False))
        for role, expected in (("original", self.original), ("native", self.native), ("live", self.native)):
            image_path = self.out / row["images"][role]["file"]
            with Image.open(image_path) as image:
                self.assertEqual(image.mode, "RGBA")
                self.assertEqual(image.tobytes(), expected)
            self.assertEqual(row["artifacts"][role]["bytes"], 8)
            self.assertEqual(row["artifacts"][role]["sha256"], self.sha(data=expected))
            self.assertTrue(row["artifacts"][role]["audit_hash_verified"])
        for reference, original in ((result["matrix"], self.matrix_path), (row["audit"], self.audit_path),
                                     (row["probe_manifest"], self.manifest)):
            snapshot = (self.out / reference["snapshot"]).read_bytes()
            self.assertEqual(snapshot, original.read_bytes())
            self.assertEqual(self.sha(data=snapshot), reference["sha256"])
        for image in row["images"].values():
            self.assertEqual(self.sha(data=(self.out / image["file"]).read_bytes()), image["sha256"])
        with Image.open(self.out / row["images"]["native_original"]["file"]) as image:
            self.assertEqual(image.mode, "L")
            self.assertEqual(image.tobytes(), bytes([24, 0]))

    def test_failed_warmup_audit_still_exports_later_frame_as_different(self):
        live = bytes([15, 22, 33, 255, 100, 110, 120, 128])
        self.add_frame(frame=1, original=self.original, native=self.native, live=live)
        for phase in ("baseline", "live"):
            self.audit["requests"][phase].insert(0, dict(id="warmup-0", frame=0, warmup=True,
                timestamp=0, timestamp_us=0, output=str(self.probe / phase / "absent-warmup.rgba")))
        self.audit.update(passed=False, completed=False, live_checks_completed=False, frames=[],
                          failures=[dict(error="zero-tolerance render mismatch: warmup-0")])
        result = self.run_report(cases=[self.case, dict(self.case, id="later", frame=1)])
        first, second = result["cases"]
        self.assertEqual(first["status"], "AUDIT_FAILED")
        self.assertEqual(second["status"], "DIFFERENT")
        self.assertEqual(second["audit_status"], "FAILED")
        self.assertEqual(second["comparison"], "DIFFERENT")
        self.assertEqual(second["metrics"]["native_live"]["rgb_mae"], 4 / 6)
        self.assertEqual(second["parameters"], dict(eye=51))
        self.assertEqual(len(second["images"]), 6)
        self.assertEqual(first["audit"], second["audit"])
        self.assertEqual(len(list((self.out / "sources").glob("audit-*"))), 1)

    def test_no_change_and_alpha_only_never_become_positive_effect_pass(self):
        alpha = bytes([10, 20, 30, 254, 100, 110, 120, 0])
        self.add_frame(frame=1, original=self.original, native=self.original, live=self.original)
        self.add_frame(frame=2, original=self.original, native=alpha, live=alpha)
        result = self.run_report(cases=[dict(self.case, id="unchanged", frame=1),
                                        dict(self.case, id="alpha", frame=2)])
        unchanged, alpha_row = result["cases"]
        self.assertEqual(unchanged["status"], "NO_CHANGE")
        self.assertEqual(alpha_row["status"], "ALPHA_ONLY")
        metric = alpha_row["metrics"]["native_original"]
        self.assertEqual(metric["rgb_mae"], 0)
        self.assertEqual(metric["rgb_changed_pixels"], 0)
        self.assertEqual(metric["alpha_mae"], 64.5)
        self.assertEqual(metric["alpha_max"], 128)
        self.assertEqual(metric["alpha_only_changed_pixels"], 2)
        self.assertEqual(metric["rgba_changed_pixels"], 2)
        with Image.open(self.out / alpha_row["images"]["native_original"]["file"]) as image:
            self.assertEqual(image.tobytes(), bytes([0, 0]))

    def test_alpha_only_native_live_difference_is_not_exact(self):
        self.artifact(relative="live/frame-00.rgba", data=bytes([11, 22, 33, 0, 100, 110, 120, 128]))
        self.audit["frames"] = []
        row = self.run_report()["cases"][0]
        self.assertEqual(row["status"], "DIFFERENT")
        self.assertEqual(row["metrics"]["native_live"]["rgb_mae"], 0)
        self.assertEqual(row["metrics"]["native_live"]["alpha_changed_pixels"], 1)

    def test_missing_output_preserves_original_native_and_their_difference(self):
        (self.probe / "live/frame-00.rgba").unlink()
        row = self.run_report()["cases"][0]
        self.assertEqual(row["status"], "MISSING")
        self.assertEqual(row["comparison"], "UNAVAILABLE")
        self.assertEqual(set(row["images"]), {"original", "native", "native_original"})
        self.assertNotIn("native_live", row["metrics"])
        self.assertEqual(row["activity"]["live"], "UNAVAILABLE")

    def test_missing_audit_is_a_case_not_a_success_or_batch_abort(self):
        result = self.run_report(cases=[dict(self.case, id="missing", audit=str(self.root / "missing.json")), self.case])
        self.assertEqual(result["counts"], dict(MISSING=1, EXACT=1))
        self.assertEqual(result["cases"][0]["images"], {})

    def test_unchanged_outputs_with_failed_audit_keep_failure_and_no_change_separate(self):
        self.add_frame(frame=1, original=self.original, native=self.original, live=self.original)
        self.audit.update(passed=False, failures=[dict(error="effect control differs from expected original-pixel change")])
        row = self.run_report(cases=[dict(self.case, frame=1)])["cases"][0]
        self.assertEqual(row["status"], "AUDIT_FAILED")
        self.assertEqual(row["activity"], dict(native="NO_CHANGE", live="NO_CHANGE"))
        self.assertEqual(row["comparison"], "EXACT")

    def test_truncated_and_oversized_rgba_fail_exact_byte_length(self):
        cases = []
        for frame, data in ((1, self.native[:-1]), (2, self.native + b"\0")):
            self.add_frame(frame=frame, original=self.original, native=self.native, live=data)
            cases.append(dict(self.case, id=str(frame), frame=frame))
        result = self.run_report(cases=cases)
        for row in result["cases"]:
            self.assertEqual(row["status"], "INVALID")
            self.assertIn("byte length mismatch", row["issues"][0]["error"])
            self.assertNotIn("live", row["images"])

    def test_hash_mismatch_even_same_size_is_invalid_not_different(self):
        (self.probe / "live/frame-00.rgba").write_bytes(self.original)
        row = self.run_report()["cases"][0]
        self.assertEqual(row["status"], "INVALID")
        self.assertIn("SHA-256 mismatch", row["issues"][0]["error"])
        self.assertNotIn("live", row["artifacts"])

    def test_audit_identity_size_mismatch_rejected_even_hash_matches(self):
        self.audit["artifacts"]["live/frame-00.rgba"]["identity"][3] = 9
        row = self.run_report()["cases"][0]
        self.assertEqual(row["status"], "INVALID")
        self.assertIn("artifact byte length mismatch", row["issues"][0]["error"])

    def test_input_hash_and_render_receipt_hashes_are_independently_checked(self):
        self.audit["input_frames"][0]["input_sha256"] = "0" * 64
        self.audit["frames"][0]["native_sha256"] = "1" * 64
        self.audit["frames"][0]["sha256"] = "2" * 64
        row = self.run_report()["cases"][0]
        self.assertEqual(row["status"], "INVALID")
        self.assertEqual({issue["role"] for issue in row["issues"]}, {"original", "native", "live"})
        self.assertEqual(row["images"], {})

    def test_no_hash_receipt_is_explicitly_unverified(self):
        self.audit["artifacts"] = {}
        self.audit["frames"] = []
        row = self.run_report()["cases"][0]
        self.assertEqual(row["status"], "UNVERIFIED")
        self.assertEqual(row["comparison"], "EXACT")
        self.assertFalse(row["artifacts"]["live"]["audit_hash_verified"])

    def test_request_pair_mismatch_rejected(self):
        self.audit["requests"]["live"][0]["timestamp_us"] = 1
        row = self.run_report()["cases"][0]
        self.assertEqual(row["status"], "INVALID")
        self.assertIn("association mismatch", row["issues"][0]["error"])

    def test_duplicate_or_only_warmup_requests_never_selected(self):
        self.audit["requests"]["baseline"].append(dict(self.audit["requests"]["baseline"][0]))
        self.audit["requests"]["live"][0]["warmup"] = True
        row = self.run_report()["cases"][0]
        self.assertEqual(row["status"], "INVALID")
        self.assertEqual(row["comparison"], "UNAVAILABLE")
        self.assertEqual(len(row["issues"]), 2)
        self.assertEqual(set(row["images"]), {"original"})

    def test_outside_audit_artifact_and_symlink_escape_rejected(self):
        outside = self.root / "outside.rgba"
        outside.write_bytes(self.native)
        (self.probe / "live/frame-00.rgba").unlink()
        (self.probe / "live/frame-00.rgba").symlink_to(outside)
        self.audit["requests"]["baseline"][0]["output"] = str(outside)
        row = self.run_report()["cases"][0]
        self.assertEqual(row["status"], "INVALID")
        self.assertEqual(set(row["images"]), {"original"})
        self.assertTrue(all("outside referenced audit" in issue["error"] for issue in row["issues"]))

    def test_manifest_mismatch_invalidates_case_but_preserves_pixel_evidence(self):
        self.manifest.write_bytes(b'{"modified":true}')
        row = self.run_report()["cases"][0]
        self.assertEqual(row["status"], "INVALID")
        self.assertEqual(len(row["images"]), 6)
        self.assertEqual(row["issues"][0]["role"], "manifest")

    def test_missing_external_manifest_is_explicit_without_losing_audit_hash(self):
        self.manifest.unlink()
        row = self.run_report()["cases"][0]
        self.assertEqual(row["probe_manifest"]["status"], "unavailable")
        self.assertIn("expected_sha256", row["probe_manifest"])
        self.assertIn("sha256", row["audit"])

    def test_parameters_mismatch_is_not_silently_relabelled(self):
        row = self.run_report(cases=[dict(self.case, parameters=dict(eye=2))])["cases"][0]
        self.assertEqual(row["status"], "INVALID")
        self.assertIn("audited controls", row["issues"][0]["error"])

    def test_optional_adjustments_and_runner_error_preserved(self):
        case = dict(self.case, parameters=dict(eye=50), adjustments=dict(lip=0.8), error="runner exit 1")
        row = self.run_report(cases=[case])["cases"][0]
        self.assertEqual(row["status"], "AUDIT_FAILED")
        self.assertEqual(row["input"], case)

    def test_html_six_columns_filters_local_lazy_images_and_escaping(self):
        case = dict(self.case, label='<script>alert("x")</script>', portrait='front" onfocus="bad')
        result = self.run_report(cases=[case])
        html = (self.out / "index.html").read_text()
        parsed = ReportHTML()
        parsed.feed(html)
        self.assertEqual(len(parsed.columns), 6)
        self.assertEqual(len(parsed.images), 6)
        self.assertTrue(all(image["src"].startswith("images/") for image in parsed.images))
        self.assertTrue(all(image["loading"] == "lazy" for image in parsed.images))
        self.assertTrue(all((self.out / image["src"]).is_file() for image in parsed.images))
        self.assertNotIn("base64,", html)
        self.assertIn('id="portrait"', html)
        self.assertIn('id="category"', html)
        self.assertIn('id="case-0"', html)
        self.assertIn('href="#case-0"', html)
        self.assertNotIn(case["label"], html)
        self.assertIn("&lt;script&gt;", html)
        self.assertIn(reporter.WARNING, html)
        self.assertIn(result["cases"][0]["audit"]["snapshot"], parsed.links)
        for link in parsed.links:
            if not link.startswith("#"):
                self.assertTrue((self.out / link).is_file(), link)

    def test_existing_reports_and_audits_remain_untouched(self):
        self.run_report()
        audit_before, index_before = self.audit_path.read_bytes(), (self.out / "index.html").read_bytes()
        with self.assertRaises(FileExistsError):
            reporter.generate(matrix=self.matrix_path, out=self.out)
        self.assertEqual(self.audit_path.read_bytes(), audit_before)
        self.assertEqual((self.out / "index.html").read_bytes(), index_before)

    def test_invalid_matrix_rejected_before_output_created(self):
        for value in (dict(schema="other", cases=[self.case]), dict(schema="beauty-dual-matrix-v1", cases=[]),
                      dict(schema="beauty-dual-matrix-v1", cases=[self.case, self.case]),
                      dict(schema="beauty-dual-matrix-v1", cases=[dict(self.case, frame=True)]),
                      dict(schema="beauty-dual-matrix-v1", cases=[dict(self.case, frame=-1)])):
            self.matrix_path.write_text(json.dumps(value))
            with self.subTest(value=value), self.assertRaises(ValueError):
                reporter.generate(matrix=self.matrix_path, out=self.out)
            self.assertFalse(self.out.exists())

    def test_malformed_audit_fields_are_reported_without_stopping_other_cases(self):
        self.audit["requests"] = []
        row = self.run_report()["cases"][0]
        self.assertEqual(row["status"], "INVALID")

    def test_explicit_runner_failure_without_audit_or_frame_is_exported(self):
        case = dict(id="absent-package", portrait="front", category="makeup", label="Blush",
                    adjustments=dict(blush=80), error="pinned package unavailable")
        result = self.run_report(cases=[case, self.case])
        self.assertEqual(result["counts"], dict(RUNNER_FAILED=1, EXACT=1))
        row = result["cases"][0]
        self.assertEqual(row["input"], case)
        self.assertIsNone(row["frame"])
        self.assertEqual(row["comparison"], "UNAVAILABLE")
        self.assertEqual(row["audit_status"], "UNAVAILABLE")
        self.assertEqual(row["images"], {})
        self.assertEqual(row["metrics"], {})
        self.assertIn("pinned package unavailable", (self.out / "index.html").read_text())

    def test_missing_audit_requires_explicit_nonempty_runner_error(self):
        for error in (None, "", "   ", False, [], {}):
            case = dict(id="no-audit", portrait="front", category="makeup", error=error)
            self.matrix_path.write_text(json.dumps(dict(schema="beauty-dual-matrix-v1", cases=[case])))
            with self.subTest(error=error), self.assertRaisesRegex(ValueError, "explicit nonempty runner error"):
                reporter.generate(matrix=self.matrix_path, out=self.out)
            self.assertFalse(self.out.exists())

    def test_cli_offline_creates_report_and_declares_generation_not_parity(self):
        self.run_report()
        output = self.root / "cli-report"
        process = subprocess.run([sys.executable, "-B", str(Path(reporter.__file__)), "--matrix",
            str(self.matrix_path), "--out", str(output)], capture_output=True, text=True, check=False)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(json.loads(process.stdout)["counts"], dict(EXACT=1))
        self.assertTrue((output / "index.html").is_file())


class MetricTests(unittest.TestCase):
    def test_gain_eight_is_fixed_max_rgb_clipped_with_no_alpha_or_normalization(self):
        left = np.array([[[0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255]]], dtype=np.uint8)
        right = np.array([[[1, 2, 3, 0], [32, 0, 0, 255], [0, 0, 0, 0]]], dtype=np.uint8)
        self.assertEqual(reporter.difference_image(reference=left, actual=right).tolist(), [[24, 255, 0]])
        value = reporter.metrics(reference=left, actual=right)
        self.assertEqual(value["rgb_abs_sum"], 38)
        self.assertEqual(value["rgb_mae"], 38 / 9)
        self.assertEqual(value["rgb_max"], 32)
        self.assertEqual(value["rgb_changed_pixels"], 2)
        self.assertEqual(value["alpha_changed_pixels"], 2)
        self.assertEqual(value["rgba_changed_pixels"], 3)

    def test_rgb_delta_does_not_wrap_at_uint8_bounds(self):
        left = np.array([[[255, 0, 255, 0]]], dtype=np.uint8)
        right = np.array([[[0, 255, 0, 255]]], dtype=np.uint8)
        value = reporter.metrics(reference=left, actual=right)
        self.assertEqual(value["rgb_mae"], 255)
        self.assertEqual(value["alpha_mae"], 255)

    def test_invalid_dimensions_or_pixel_types_rejected(self):
        valid = np.zeros((1, 2, 4), dtype=np.uint8)
        for invalid in (valid[:, :1], valid[:, :, :3], valid.astype(np.float32), np.zeros((0, 2, 4), dtype=np.uint8)):
            with self.subTest(shape=invalid.shape), self.assertRaises(ValueError):
                reporter.metrics(reference=valid, actual=invalid)

    def test_duplicate_and_nonfinite_json_rejected(self):
        for data in (b'{"x":1,"x":2}', b'{"x":NaN}', b'{"x":Infinity}'):
            with self.subTest(data=data), self.assertRaises(ValueError):
                reporter.parse_json(data=data)


if __name__ == "__main__":
    unittest.main()
