"""Synthetic backbone boundaries and provenance gates; no recovered weights or crops."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

import espresso_oracle
from face_alignment_backbone_verify import (backbone_spec, case_passed, feature_tiles, float_check,
                                            reference_case, run, visual)
from face_alignment_warp_native import BYTENN_SHA256
from face_geometry_native import LIBRARY_SHA256, MODEL_SHA256


def synthetic_graph(*, size=120, batch=1, width=None, channels=3, storage=None, fraction=6,
                    features=128, mode="AVE", global_pool=True):
    storage = storage if storage is not None else (2 if size == 120 else 1)
    return (f"1 2\ndata {batch} {size} {size if width is None else width} {channels} {storage} {fraction}\n"
            f"Convolution conv {features} 1 1 1 1 0 0 0 0 1 6 4 0 {storage} 7 data features\n"
            f"PoolingDown pool 1 1 1 1 0 0 4 0 {mode} features pooled{' GLOBAL' if global_pool else ''}\n")


def passing_report():
    check = {"passed": True, "elements": 128, "max_abs": 0, "mismatches": 0}
    return {"passed": True, "blobs": {
        "first": {key: dict(check) for key in ("pytorch", "onnx")},
        "features": {key: dict(check) for key in ("pytorch", "onnx", "pytorch_reloaded", "onnx_terminal")}}}


def synthetic_reference(*, root, size):
    directory = root / ("case-000" if size == 120 else "seed-000")
    directory.mkdir(parents=True)
    pixels = np.resize(np.arange(256, dtype=np.uint8), (size, size, 3))
    arrays = {"prepared-bgr": pixels, "network-input": (pixels.astype(np.int16) - 128).astype(
        np.int16 if size == 120 else np.int8)[None], "raw": np.zeros((106, 2), np.float32)}
    report = {"passed": True, "expansion": 1.5, "optimized": False, "step": 1, "threshold": 0.0}
    for name, value in arrays.items():
        path = directory / f"{name}.npy"
        np.save(path, value)
        report[name + "_sha256"] = espresso_oracle.sha256(path=path)
    summary = {"passed": True, "runtime_sha256": LIBRARY_SHA256, "model_sha256": MODEL_SHA256,
               "loaded_bytenn": {"sha256": BYTENN_SHA256}, "cases" if size == 120 else "seeds": [report]}
    (root / "summary.json").write_text(json.dumps(summary))
    return directory, summary


class BackboneBoundaryTest(unittest.TestCase):
    def test_two_profiles_stop_before_global_float_pool(self):
        for size in (120, 160):
            actual = backbone_spec(text=synthetic_graph(size=size))
            self.assertEqual((actual["size"], actual["prefix"], actual["layers"], actual["blobs"]),
                             (size, "features", 1, 1))
            self.assertEqual(actual["excluded_first_operator"], "PoolingDown")
            self.assertEqual(actual["graph"]["descriptors"]["pooled"]["type"], 4)

    def test_wrong_batch_size_channels_storage_and_fraction_rejected(self):
        for changes in ({"batch": 2}, {"size": 119}, {"width": 119}, {"channels": 4},
                        {"storage": 1}, {"size": 160, "storage": 2}, {"fraction": 7}):
            with self.subTest(changes=changes), self.assertRaisesRegex(ValueError, "profile"):
                backbone_spec(text=synthetic_graph(**changes))

    def test_multiple_inputs_rejected(self):
        text = synthetic_graph().replace("1 2\n", "2 2\n").replace("Convolution", "other 1 120 120 3 2 6\nConvolution", 1)
        with self.assertRaisesRegex(ValueError, "one alignment input"):
            backbone_spec(text=text)

    def test_no_float_boundary_rejected(self):
        text = synthetic_graph().replace("0 0 4 0 AVE", "0 0 2 7 AVE")
        with self.assertRaisesRegex(ValueError, "integer-to-float"):
            backbone_spec(text=text)

    def test_nonaverage_nonglobal_or_wrong_feature_channels_rejected(self):
        for changes in ({"mode": "MAX"}, {"global_pool": False}, {"features": 64}):
            with self.subTest(changes=changes), self.assertRaisesRegex(ValueError, "boundary"):
                backbone_spec(text=synthetic_graph(**changes))

    def test_different_first_float_operator_rejected(self):
        text = synthetic_graph().split("PoolingDown")[0] + "Softmax head features pooled 4 0\n"
        with self.assertRaisesRegex(ValueError, "boundary"):
            backbone_spec(text=text)


class EvidenceGateTest(unittest.TestCase):
    def passed(self, *, report, names=("first", "features"), prefix="features"):
        return case_passed(report=report, names=names, prefix=prefix)

    def test_all_intermediates_and_both_serialized_terminals_required(self):
        self.assertTrue(self.passed(report=passing_report()))
        for name, checks in passing_report()["blobs"].items():
            for key in checks:
                report = passing_report()
                report["blobs"][name].pop(key)
                self.assertFalse(self.passed(report=report))

    def test_empty_duplicate_missing_and_extra_blob_names_rejected(self):
        for names in ((), ("first", "first"), ("features",), ("first", "features", "unexecuted-head")):
            self.assertFalse(self.passed(report=passing_report(), names=names))
        self.assertFalse(self.passed(report=passing_report(), prefix="unexecuted-head"))

    def test_malformed_outer_records_rejected(self):
        for report in (None, [], {}, {"passed": True, "blobs": []}, {"passed": True, "blobs": None}):
            self.assertFalse(self.passed(report=report))
        for value in ([], None, True):
            report = passing_report()
            report["blobs"]["first"] = value
            self.assertFalse(self.passed(report=report))

    def test_missing_or_wrong_counter_fields_rejected(self):
        check = passing_report()["blobs"]["first"]["pytorch"]
        for key in check:
            report = passing_report()
            report["blobs"]["first"]["pytorch"].pop(key)
            self.assertFalse(self.passed(report=report))
        for key, value in (("passed", 1), ("max_abs", False), ("max_abs", 0.0), ("max_abs", 1),
                           ("mismatches", False), ("mismatches", 1), ("elements", True), ("elements", 0)):
            report = passing_report()
            report["blobs"]["first"]["pytorch"][key] = value
            self.assertFalse(self.passed(report=report))

    def test_extra_check_and_truthy_top_level_pass_rejected(self):
        report = passing_report()
        report["blobs"]["first"]["unconverted_head"] = {"passed": True}
        self.assertFalse(self.passed(report=report))
        self.assertFalse(self.passed(report={**passing_report(), "passed": 1}))

    def test_original_head_crosscheck_is_explicitly_not_converted_head(self):
        actual = np.zeros((1, 1, 1, 212), np.float32)
        expected = actual.reshape(106, 2)
        result = float_check(actual=actual, expected=expected, raw=(4, 0))
        self.assertTrue(result["passed"])
        self.assertTrue(result["exact"])
        self.assertIn("not converted head", result["scope"])
        actual = actual.copy()
        actual.flat[0] = 0.0002
        self.assertFalse(float_check(actual=actual, expected=expected, raw=(4, 0))["passed"])

    def test_original_head_shape_dtype_nonfinite_and_descriptor_rejected(self):
        actual = np.zeros((1, 1, 1, 212), np.float32)
        expected = np.zeros((106, 2), np.float32)
        for value in (actual.reshape(106, 2), actual.astype(np.float64), np.full_like(actual, np.nan)):
            self.assertFalse(float_check(actual=value, expected=expected, raw=(4, 0))["passed"])
        for value in (expected.reshape(212), expected.astype(np.float64), np.full_like(expected, np.inf)):
            self.assertFalse(float_check(actual=actual, expected=value, raw=(4, 0))["passed"])
        self.assertFalse(float_check(actual=actual, expected=expected, raw=(4, 1))["passed"])


class RecordedReferenceTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.guard = patch("espresso_oracle.private_path", side_effect=lambda *, path: Path(path))
        self.guard.start()
        self.addCleanup(self.guard.stop)

    def write_summary(self, *, summary):
        (self.root / "summary.json").write_text(json.dumps(summary))

    def test_signed_input_and_pixel_preprocessing_for_both_profiles(self):
        for size in (120, 160):
            synthetic_reference(root=self.root, size=size)
            result = reference_case(root=self.root, size=size)
            self.assertEqual(result["input"].dtype, np.int16 if size == 120 else np.int8)
            self.assertEqual(int(result["input"].min()), -128)
            self.assertEqual(int(result["input"].max()), 127)
            self.assertEqual(set(result["files"]), {"network-input", "prepared-bgr", "raw"})
            self.assertEqual(len(result["summary_sha256"]), 64)

    def test_runtime_model_loaded_library_and_pass_provenance_rejected(self):
        _, original = synthetic_reference(root=self.root, size=120)
        for key, value in (("passed", 1), ("runtime_sha256", "bad"), ("model_sha256", "bad"),
                           ("loaded_bytenn", []), ("loaded_bytenn", {"sha256": "bad"})):
            self.write_summary(summary={**original, key: value})
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "provenance"):
                reference_case(root=self.root, size=120)
        self.write_summary(summary=[])
        with self.assertRaisesRegex(ValueError, "provenance"):
            reference_case(root=self.root, size=120)

    def test_missing_unbounded_or_ambiguous_reference_rejected(self):
        _, original = synthetic_reference(root=self.root, size=120)
        for records in (None, [], original["cases"] * 2, original["cases"] * 65):
            self.write_summary(summary={**original, "cases": records})
            with self.assertRaises(ValueError):
                reference_case(root=self.root, size=120)

    def test_optimized_other_expansion_and_second_step_are_not_selected(self):
        _, original = synthetic_reference(root=self.root, size=120)
        for key, value in (("optimized", True), ("expansion", 1.8), ("step", 2)):
            summary = copy.deepcopy(original)
            summary["cases"][0][key] = value
            self.write_summary(summary=summary)
            with self.assertRaisesRegex(ValueError, "ordinary"):
                reference_case(root=self.root, size=120)

    def test_failed_or_nonzero_or_integer_threshold_rejected(self):
        _, original = synthetic_reference(root=self.root, size=120)
        for key, value in (("passed", False), ("threshold", 0.1), ("threshold", 0), ("threshold", False)):
            summary = copy.deepcopy(original)
            summary["cases"][0][key] = value
            self.write_summary(summary=summary)
            with self.assertRaisesRegex(ValueError, "threshold"):
                reference_case(root=self.root, size=120)

    def test_modified_array_hash_rejected(self):
        directory, _ = synthetic_reference(root=self.root, size=120)
        np.save(directory / "network-input.npy", np.zeros((1, 120, 120, 3), np.int16))
        with self.assertRaisesRegex(ValueError, "hash"):
            reference_case(root=self.root, size=120)

    def test_matching_hash_still_rejects_bad_array_contract(self):
        directory, original = synthetic_reference(root=self.root, size=120)
        for name, value in (("network-input", np.zeros((1, 120, 120, 3), np.uint8)),
                            ("prepared-bgr", np.zeros((120, 120, 3), np.int16)),
                            ("raw", np.zeros((105, 2), np.float32)), ("raw", np.full((106, 2), np.nan, np.float32))):
            snapshot = (directory / f"{name}.npy").read_bytes()
            np.save(directory / f"{name}.npy", value)
            summary = copy.deepcopy(original)
            summary["cases"][0][name + "_sha256"] = espresso_oracle.sha256(path=directory / f"{name}.npy")
            self.write_summary(summary=summary)
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "shape, dtype or preprocessing"):
                reference_case(root=self.root, size=120)
            (directory / f"{name}.npy").write_bytes(snapshot)

    def test_preprocessing_mismatch_rejected_even_with_new_hash(self):
        directory, summary = synthetic_reference(root=self.root, size=160)
        path = directory / "network-input.npy"
        value = np.load(path)
        value.flat[0] += 1
        np.save(path, value)
        summary["seeds"][0]["network-input_sha256"] = espresso_oracle.sha256(path=path)
        self.write_summary(summary=summary)
        with self.assertRaisesRegex(ValueError, "preprocessing"):
            reference_case(root=self.root, size=160)

    def test_run_refuses_existing_output_or_missing_reference_before_writes(self):
        with self.assertRaisesRegex(ValueError, "overwrite"):
            run(networks="unused", reference="unused", output=self.root)
        fresh = self.root / "fresh"
        with self.assertRaises(FileNotFoundError):
            run(networks="unused", reference=self.root / "missing", output=fresh)
        self.assertFalse(fresh.exists())


class FeatureEvidenceTest(unittest.TestCase):
    def test_feature_chart_has_stable_layout_and_black_exact_difference(self):
        value = np.zeros((1, 4, 4, 128), np.int64)
        self.assertEqual(feature_tiles(values=value, difference=True).getextrema(), (0, 0))
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "chart.png"
            visual(pixels=np.zeros((120, 120, 3), np.uint8), native=value,
                   pytorch=value, portable=value, output=output)
            with Image.open(output) as result:
                self.assertEqual(result.size, (1250, 300))
                self.assertEqual(result.crop((1005, 30, 1225, 140)).convert("L").getextrema(), (0, 0))

    def test_wrong_feature_count_or_batch_rejected(self):
        for shape in ((1, 4, 4, 127), (2, 4, 4, 128), (4, 4, 128)):
            with self.assertRaises(ValueError):
                feature_tiles(values=np.zeros(shape), difference=False)


if __name__ == "__main__":
    unittest.main()
