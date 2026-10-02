import copy
import importlib.util
import unittest
from pathlib import Path

from PIL import Image

SPEC = importlib.util.spec_from_file_location(
    "feature_makeup", Path(__file__).parents[1] / "compare-portrait-feature-makeup.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class FeatureMakeupTests(unittest.TestCase):
    def setUp(self):
        self.feature = {"name": "nose-50", "value": 50, "values": {"nose": 50}}
        self.makeup = {"name": "lip", "value": 60, "values": {},
                       "makeup": {"lip": {"cardId": "coral", "intensity": 60}}}
        self.editor = {"sourceSha256": "source", "errors": [], "combined": {"hash": "combined"},
                       "exported": {"decodedFrames": 30, "videoStream": {
                           "codec_name": "h264", "width": 1080, "height": 1080}},
                       "samples": [self.feature], "makeupSamples": [self.makeup]}
        self.reference = {"sourceSha256": "source", "evidence": "ui-screenshot",
                          "samples": copy.deepcopy([self.feature, self.makeup])}

    def test_pairs_actual_subset_without_claiming_whole_catalog(self):
        self.reference["samples"] = self.reference["samples"][:1]
        samples, refs = MODULE.validate_reference(editor=self.editor, reference=self.reference)
        self.assertEqual(len(samples), 2)
        self.assertEqual(len(refs), 1)

    def test_pairs_feature_and_makeup(self):
        _, refs = MODULE.validate_reference(editor=self.editor, reference=self.reference)
        self.assertEqual(len(refs), 2)

    def test_pairs_non_square_exports_at_the_reported_canvas_size(self):
        for width, height in [(1080, 810), (1080, 1350), (1440, 1080)]:
            editor = copy.deepcopy(self.editor)
            editor["canvasSize"] = {"width": width, "height": height}
            editor["exported"]["videoStream"]["width"] = width
            editor["exported"]["videoStream"]["height"] = height
            with self.subTest(width=width, height=height):
                _, refs = MODULE.validate_reference(editor=editor, reference=self.reference)
                self.assertEqual(len(refs), 2)

    def test_rejects_canvas_export_mismatch(self):
        editor = {**self.editor, "canvasSize": {"width": 1080, "height": 810}}
        with self.assertRaisesRegex(ValueError, "reference canvas dimensions"):
            MODULE.validate_reference(editor=editor, reference=self.reference)

    def test_rejects_invalid_canvas_dimensions(self):
        for dimension in ["width", "height"]:
            for value in [True, None, 810.0, 0, 63, 811, 4098]:
                canvas = {"width": 1080, "height": 810, dimension: value}
                editor = {**self.editor, "canvasSize": canvas}
                with self.subTest(dimension=dimension, value=value), self.assertRaisesRegex(ValueError, "valid even"):
                    MODULE.validate_reference(editor=editor, reference=self.reference)

    def test_rejects_malformed_canvas_metadata(self):
        for canvas in [None, [], "1080x810", {}, {"width": 1080}]:
            editor = {**self.editor, "canvasSize": canvas}
            with self.subTest(canvas=canvas), self.assertRaisesRegex(ValueError, "valid even"):
                MODULE.validate_reference(editor=editor, reference=self.reference)

    def test_rejects_incomplete_export_and_runtime_error(self):
        for fields in [{"errors": ["render failed"]}, {"combined": {}},
                       {"exported": {"decodedFrames": 0}}]:
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                MODULE.validate_reference(editor={**self.editor, **fields}, reference=self.reference)

    def test_rejects_source_or_evidence_mismatch(self):
        for fields in [{"sourceSha256": "other"}, {"evidence": "generated"}]:
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                MODULE.validate_reference(editor=self.editor, reference={**self.reference, **fields})

    def test_rejects_empty_or_duplicate_references(self):
        for samples in [[], [self.feature, self.feature]]:
            with self.subTest(samples=samples), self.assertRaises(ValueError):
                MODULE.validate_reference(editor=self.editor, reference={**self.reference, "samples": samples})

    def test_rejects_different_value_or_card(self):
        for changes in [{"value": 51}, {"values": {"nose": 100}},
                        {"values": {"nose": 50, "eyes": 50}}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                MODULE.validate_reference(editor=self.editor, reference={**self.reference, "samples": [
                    {**self.feature, **changes}]})
        other_lip = {**self.makeup, "makeup": {"lip": {"cardId": "other", "intensity": 60}}}
        with self.assertRaises(ValueError):
            MODULE.validate_reference(editor=self.editor, reference={**self.reference, "samples": [other_lip]})

    def test_rejects_combined_or_zero_makeup(self):
        for fields in [{"value": 0}, {"values": {"nose": 60}},
                       {"makeup": {"lip": {"cardId": "coral", "intensity": 61}}}]:
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                MODULE.isolated_parameters(sample={**self.makeup, **fields})

    def test_rejects_duplicate_editor_samples(self):
        with self.assertRaisesRegex(ValueError, "Duplicate editor"):
            MODULE.validate_reference(editor={**self.editor, "samples": [self.feature, self.feature]},
                                      reference=self.reference)

    def test_rejects_nonfinite_values_and_unsafe_names(self):
        for value in [float("nan"), float("inf"), -float("inf")]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                MODULE.isolated_parameters(sample={**self.feature, "value": value})
        with self.assertRaisesRegex(ValueError, "safe evidence"):
                MODULE.validate_reference(editor={**self.editor, "samples": [
                {**self.feature, "name": "../../other-file"}]}, reference=self.reference)


class PairedDeltaMetricTests(unittest.TestCase):
    def metrics(self, *, zero_j=80, result_j=100, zero_q=120, result_q=140,
                crop=(1, 1, 7, 7)):
        return MODULE.paired_delta_metrics(
            baseline_j=Image.new("RGB", (8, 8), (zero_j,) * 3),
            result_j=Image.new("RGB", (8, 8), (result_j,) * 3),
            baseline_q=Image.new("RGB", (8, 8), (zero_q,) * 3),
            result_q=Image.new("RGB", (8, 8), (result_q,) * 3), crop=crop)

    def test_removes_independent_baseline_bias(self):
        metric = self.metrics()["faceCrop"]
        self.assertAlmostEqual(metric["deltaCosine"], 1)
        self.assertEqual(metric["deltaMae"], 0)
        self.assertEqual(metric["referenceMagnitude"], 20)

    def test_opposite_changes_are_not_equal_magnitudes(self):
        metric = self.metrics(result_q=100)["faceCrop"]
        self.assertEqual(metric["referenceMagnitude"], metric["candidateMagnitude"])
        self.assertAlmostEqual(metric["deltaCosine"], -1)
        self.assertEqual(metric["deltaMae"], 40)

    def test_zero_change_has_no_direction_score(self):
        metric = self.metrics(result_j=80, result_q=120)["faceCrop"]
        self.assertIsNone(metric["deltaCosine"])
        self.assertEqual(metric["deltaMae"], 0)

    def test_crop_does_not_dilute_a_local_error_with_background(self):
        zero = Image.new("RGB", (32, 32), (80,) * 3)
        adjusted = zero.copy()
        adjusted.paste((120,) * 3, (12, 12, 20, 20))
        metrics = MODULE.paired_delta_metrics(
            baseline_j=zero, result_j=adjusted, baseline_q=zero, result_q=zero,
            crop=[12, 12, 20, 20])
        self.assertGreater(metrics["faceCrop"]["deltaMae"], metrics["fullFrame"]["deltaMae"] * 10)

    def test_rejects_invalid_metric_crops(self):
        for crop in [None, [], [0, 1, 2], [0, 0, 8.0, 8], [False, 0, 8, 8],
                     [-1, 0, 8, 8], [0, 0, 9, 8], [0, 0, 0, 8], [0, 3, 8, 2]]:
            with self.subTest(crop=crop), self.assertRaises(ValueError):
                self.metrics(crop=crop)

    def test_rejects_mismatched_metric_frames(self):
        zero = Image.new("RGB", (8, 8))
        with self.assertRaisesRegex(ValueError, "dimensions must match"):
            MODULE.paired_delta_metrics(baseline_j=zero, result_j=Image.new("RGB", (10, 8)),
                                        baseline_q=zero, result_q=zero, crop=[0, 0, 8, 8])


if __name__ == "__main__":
    unittest.main()
