import copy
import importlib.util
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

SPEC = importlib.util.spec_from_file_location(
    "portrait_face_shape_reference",
    Path(__file__).parents[1] / "compare-portrait-face-shape-reference.py",
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def reports():
    editor = {
        "sourceSha256": "same-source",
        "errors": [],
        "reopenedHash": "same-render",
        "exported": {"decodedFrames": 30},
        "samples": [
            {"name": f"{item['slug']}-{value}", "value": value,
             "values": {item["key"]: value}}
            for item in MODULE.editor_controls() for value in item["values"]
        ],
    }
    reference = {
        "sourceSha256": "same-source",
        "evidence": "ui-screenshot",
        "samples": [[item["slug"], value]
                    for item in MODULE.reference_controls() for value in item["values"]],
    }
    return editor, reference


class FaceShapeReferenceTests(unittest.TestCase):
    def test_accepts_complete_matrix_with_bidirectional_controls(self):
        editor, reference = reports()
        samples = MODULE.validate_reports(editor=editor, reference=reference)
        self.assertEqual(len(samples), 28)
        self.assertEqual(len(reference["samples"]), 36)
        self.assertEqual(samples["narrow-face--50"]["values"], {"face_adjust_CutFace": -50})
        self.assertEqual(samples["smooth-contour-50"]["values"], {"face_adjust_lunkuopinghua": 50})

    def test_small_face_and_jawline_are_independent_and_skin_swatches_remain_missing(self):
        controls = {item["slug"]: item for item in MODULE.reference_controls()}
        self.assertEqual(controls["small-face"]["key"], "face_adjust_YouTaiFace")
        self.assertEqual(controls["jawline"]["key"], "face_adjust_XiaHeXian")
        self.assertEqual(controls["short-face"]["key"], "face_adjust_SmallFace")
        self.assertEqual(sum(item["key"] is None for item in controls.values()), 5)
        self.assertIn("small-face", [item["slug"] for item in MODULE.editor_controls()])

    def test_rejects_short_face_and_legacy_jaw_as_new_operator_evidence(self):
        editor, reference = reports()
        for name, key in [("small-face-50", "face_adjust_SmallFace"), ("jawline-50", "face_adjust_jaw")]:
            invalid = copy.deepcopy(editor)
            sample = next(item for item in invalid["samples"] if item["name"] == name)
            sample["values"] = {key: 50}
            with self.subTest(name=name), self.assertRaises(ValueError):
                MODULE.validate_reports(editor=invalid, reference=reference)

    def test_rejects_wrong_source_or_claimed_export_parity(self):
        editor, reference = reports()
        for field, value in [("sourceSha256", "wrong-source"), ("evidence", "export")]:
            invalid = {**reference, field: value}
            with self.subTest(field=field), self.assertRaises(ValueError):
                MODULE.validate_reports(editor=editor, reference=invalid)

    def test_rejects_incomplete_editor_runs(self):
        editor, reference = reports()
        for field, value in [("errors", ["render failed"]), ("reopenedHash", None), ("exported", None)]:
            invalid = {**editor, field: value}
            with self.subTest(field=field), self.assertRaises(ValueError):
                MODULE.validate_reports(editor=invalid, reference=reference)

    def test_rejects_missing_duplicate_and_unexpected_editor_cases(self):
        editor, reference = reports()
        invalid_cases = [
            editor["samples"][:-1],
            editor["samples"] + [editor["samples"][0]],
            editor["samples"] + [{"name": "invented-control-50"}],
        ]
        for samples in invalid_cases:
            with self.subTest(count=len(samples)), self.assertRaises(ValueError):
                MODULE.validate_reports(editor={**editor, "samples": samples}, reference=reference)

    def test_rejects_combined_mislabeled_and_wrong_runtime_keys(self):
        editor, reference = reports()
        overrides = [
            {"values": {"face_adjust_temple": 50}},
            {"values": {"face_adjust_temple": 50, "face_adjust_Chin": 25}},
            {"value": 100},
            {"values": {"face_adjust_jaw": 50}},
        ]
        for override in overrides:
            invalid = copy.deepcopy(editor)
            invalid["samples"][0].update(override)
            with self.subTest(override=override), self.assertRaises(ValueError):
                MODULE.validate_reports(editor=invalid, reference=reference)

    def test_rejects_missing_duplicate_and_unexpected_references(self):
        editor, reference = reports()
        invalid_cases = [
            reference["samples"][:-1],
            reference["samples"] + [reference["samples"][0]],
            reference["samples"][:-1] + [["skin-tone-6", 100]],
        ]
        for samples in invalid_cases:
            with self.subTest(count=len(samples)), self.assertRaises(ValueError):
                MODULE.validate_reports(editor=editor, reference={**reference, "samples": samples})

    def test_signed_delta_preserves_direction_and_own_baseline(self):
        baseline = Image.new("RGB", MODULE.SKIN.DIFF.NORMALIZED_SIZE, (100,) * 3)
        lighter = Image.new("RGB", baseline.size, (125,) * 3)
        np.testing.assert_array_equal(MODULE.delta(result=baseline, baseline=baseline), 0)
        np.testing.assert_array_equal(MODULE.delta(result=lighter, baseline=baseline), 25)
        np.testing.assert_array_equal(MODULE.delta(result=baseline, baseline=lighter), -25)

    def test_gallery_escapes_labels_and_preserves_local_links(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            MODULE.write_gallery(output=output, pages=[{"label": "<Face & tone>", "file": "face.png"}])
            document = (output / "index.html").read_text()
            self.assertIn("&lt;Face &amp; tone&gt;", document)
            self.assertIn('href="face.png"', document)
            self.assertNotIn("<Face & tone>", document)


if __name__ == "__main__":
    unittest.main()
