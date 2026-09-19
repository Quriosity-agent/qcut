"""Synthetic tests for frozen OCR replay; no torch, weights, or native runtime."""
import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest

import numpy as np
import ocr_rec_onnx_replay

from ocr_rec_onnx_replay import (BUNDLE_SHA256, SOURCE_FORMAT, SOURCE_SHA256,
                                 check_source_report, compare_all, private_path)


def synthetic_report():
    return {"format": SOURCE_FORMAT, "source_sha256": SOURCE_SHA256, "artifact_sha256": BUNDLE_SHA256,
            "status": "native-parity-passed", "all_declared_outputs_verified": True,
            "cases": [{"case": f"synthetic-{index}", "passed": True} for index in range(20)]}


class OCRONNXReplayTests(unittest.TestCase):
    def test_exact_full_terminal(self):
        value = np.arange(24, dtype=np.float32).reshape(1, 3, 2, 4)
        result = compare_all(actual=value, expected=value.copy())
        self.assertTrue(result["passed"] and result["bitwise_equal"])
        self.assertEqual(result["elements"], 24)
        self.assertEqual(result["argmax"]["mismatches"], 0)

    def test_argmax_agreement_cannot_hide_one_bad_logit(self):
        native = np.array([0, 10, 20], dtype=np.float32).reshape(1, 3, 1, 1)
        actual = native.copy()
        actual[0, 0, 0, 0] = 0.0002
        result = compare_all(actual=actual, expected=native)
        self.assertFalse(result["passed"])
        self.assertEqual(result["outside_tolerance"], 1)
        self.assertTrue(result["argmax"]["equal"])

    def test_argmax_is_diagnostic_not_a_substitute_threshold(self):
        native = np.array([1, 1.00001], dtype=np.float32).reshape(1, 2, 1, 1)
        actual = native[:, ::-1].copy()
        result = compare_all(actual=actual, expected=native)
        self.assertTrue(result["passed"])
        self.assertEqual(result["argmax"]["mismatches"], 1)
        self.assertEqual(result["argmax"]["first_mismatches"][0]["actual"], 0)

    def test_relative_tolerance_uses_reference_values(self):
        expected = np.full((1, 1, 1, 1), 100.0, dtype=np.float32)
        self.assertTrue(compare_all(actual=expected + np.float32(0.01), expected=expected)["passed"])
        self.assertFalse(compare_all(actual=expected + np.float32(0.02), expected=expected)["passed"])

    def test_invalid_terminal_shape_dtype_and_finite_rejected(self):
        expected = np.zeros((1, 3, 1, 2), dtype=np.float32)
        for actual in (expected.astype(np.float64), expected.reshape(3, 2), expected[:, :, :, :1],
                       np.full_like(expected, np.nan), np.full_like(expected, np.inf)):
            with self.subTest(shape=actual.shape, dtype=actual.dtype), self.assertRaises(ValueError):
                compare_all(actual=actual, expected=expected)

    def test_report_requires_exactly_twenty_distinct_passing_cases(self):
        check_source_report(report=synthetic_report())
        for change in ("missing", "duplicate", "failed", "escape"):
            report = synthetic_report()
            if change == "missing":
                report["cases"].pop()
            elif change == "duplicate":
                report["cases"][1] = copy.deepcopy(report["cases"][0])
            elif change == "failed":
                report["cases"][0]["passed"] = False
            else:
                report["cases"][0]["case"] = "../escape"
            with self.subTest(change=change), self.assertRaises(ValueError):
                check_source_report(report=report)

    def test_failed_candidates_and_different_assets_rejected(self):
        for key, value in (("format", "v3"), ("status", "verification-failed"), ("artifact_sha256", "0" * 64),
                           ("source_sha256", "0" * 64), ("all_declared_outputs_verified", False)):
            report = synthetic_report()
            report[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                check_source_report(report=report)

    def test_private_mount_boundary(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertEqual(private_path(path=root / "outputs", root=root), root.resolve() / "outputs")
            for value in (root, root.parent / "outside"):
                with self.subTest(path=value), self.assertRaises(ValueError):
                    private_path(path=value, root=root)
            with self.assertRaises(ValueError):
                private_path(path=root / "outputs", root=Path(root.anchor))

    def test_standalone_shallow_mount_import_and_explicit_root(self):
        spec = importlib.util.spec_from_file_location("ocr_replay_shallow_import", ocr_rec_onnx_replay.__file__)
        module = importlib.util.module_from_spec(spec)
        module.__file__ = "/runner/ocr_rec_onnx_replay.py"
        spec.loader.exec_module(module)
        self.assertEqual(module.PRIVATE, Path("/.local/jianying-model-pytorch").resolve())
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            self.assertEqual(module.private_path(path=root / "replay", root=root), root / "replay")


if __name__ == "__main__":
    unittest.main()
