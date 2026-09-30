import copy
import importlib.util
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
