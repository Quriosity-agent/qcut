import copy
import importlib.util
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw


SPEC = importlib.util.spec_from_file_location(
    "portrait_face_shape_people", Path(__file__).parents[1] / "compare-portrait-face-shape-people.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class FaceShapePeopleTests(unittest.TestCase):
    def setUp(self):
        self.editor = {"sourceSha256": "source", "errors": [], "reopenedHash": "reopened",
                       "exported": {"decodedFrames": 150}, "samples": []}
        for control in MODULE.COMPARISON.editor_controls():
            for value in control["values"]:
                self.editor["samples"].append({"name": f"{control['slug']}-{value}", "value": value,
                                               "values": {control["key"]: value}})
        self.reference = {"sourceSha256": "source", "evidence": "ui-screenshot",
                          "samples": copy.deepcopy(self.editor["samples"][:-2])}
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.path = self.root / "reference.jpg"
        frame = Image.new("RGB", (32, 24), "black")
        ImageDraw.Draw(frame).rectangle((16, 0, 31, 23), fill="white")
        frame.save(self.path)
        self.record = {"file": self.path.name,
                       "sha256": MODULE.COMPARISON.SKIN.fingerprint(path=self.path)["sha256"]}

    def test_requires_all_26_paired_cases(self):
        samples, refs = MODULE.validate_reference(editor=self.editor, reference=self.reference)
        self.assertEqual(len(samples), 28)
        self.assertEqual(len(refs), 26)

    def test_rejects_missing_or_duplicate_reference(self):
        for samples in [self.reference["samples"][:-1], self.reference["samples"] + self.reference["samples"][:1]]:
            with self.subTest(count=len(samples)), self.assertRaises(ValueError):
                MODULE.validate_reference(editor=self.editor, reference={**self.reference, "samples": samples})

    def test_rejects_wrong_source_or_non_ui_evidence(self):
        for fields in [{"sourceSha256": "another-person"}, {"evidence": "native-runtime"}]:
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                MODULE.validate_reference(editor=self.editor, reference={**self.reference, **fields})

    def test_rejects_value_51_labeled_as_50(self):
        self.reference["samples"][0]["value"] = 51
        with self.assertRaisesRegex(ValueError, "numeric value"):
            MODULE.validate_reference(editor=self.editor, reference=self.reference)

    def test_rejects_mixed_controls(self):
        self.reference["samples"][0]["values"]["face_adjust_TotalFace"] = 50
        with self.assertRaisesRegex(ValueError, "isolated matching"):
            MODULE.validate_reference(editor=self.editor, reference=self.reference)

    def test_rejects_failed_editor_run(self):
        self.editor["errors"] = ["render failed"]
        with self.assertRaisesRegex(ValueError, "completed editor run"):
            MODULE.validate_reference(editor=self.editor, reference=self.reference)

    def test_real_jpeg_dimensions_and_crop_are_validated(self):
        frame = MODULE.load_reference(root=self.root, record=self.record, size=[32, 24], crop=[0, 0, 32, 24])
        self.assertEqual(frame.size, (32, 24))
        for size, crop in [([24, 32], None), ([32, 24], [0, 0, 33, 24])]:
            with self.subTest(size=size, crop=crop), self.assertRaises(ValueError):
                MODULE.load_reference(root=self.root, record=self.record, size=size, crop=crop)

    def test_rejects_modified_reference_bytes(self):
        self.path.write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "fingerprint changed"):
            MODULE.load_reference(root=self.root, record=self.record, size=[32, 24], crop=None)

    def test_rejects_blank_preview(self):
        Image.new("RGB", (32, 24), "black").save(self.path)
        self.record["sha256"] = MODULE.COMPARISON.SKIN.fingerprint(path=self.path)["sha256"]
        with self.assertRaisesRegex(ValueError, "Blank reference"):
            MODULE.load_reference(root=self.root, record=self.record, size=[32, 24], crop=None)

    def test_normalization_preserves_source_aspect(self):
        for source, target in [((1080, 1350), (463, 579)), ((1080, 1080), (579, 579))]:
            with self.subTest(source=source):
                frame = Image.new("RGB", source)
                original, adjusted = MODULE.normalized_pair(baseline=frame, adjusted=frame, size=target)
                self.assertEqual(original.size, target)
                self.assertEqual(adjusted.size, target)
        with self.assertRaisesRegex(ValueError, "aspect ratio"):
            frame = Image.new("RGB", (1080, 1080))
            MODULE.normalized_pair(baseline=frame, adjusted=frame, size=(463, 579))

    def test_difference_uses_fixed_gain_for_both_sides(self):
        original = Image.new("RGB", (32, 24), (100,) * 3)
        result = Image.new("RGB", (32, 24), (110,) * 3)
        gray, raw = MODULE.DIFF.difference_map(baseline=original, adjusted=result)
        self.assertEqual(gray.getextrema(), (60, 60))
        self.assertEqual(float(raw.mean()), 10)

    def test_zero_change_has_zero_delta(self):
        frame = Image.new("RGB", (32, 24), (100,) * 3)
        delta = MODULE.change_pixels(frame=frame, baseline=frame)
        self.assertFalse(delta.any())

    def test_rejects_inactive_face_even_with_matching_numeric_proof(self):
        frame = Image.new("RGB", (32, 24), (100,) * 3)
        delta = MODULE.change_pixels(frame=frame, baseline=frame)
        for side in ["Jianying", "QCut"]:
            with self.subTest(side=side), self.assertRaisesRegex(ValueError, "recheck active face"):
                MODULE.require_changed_pixels(delta=delta, name="small-face-100", side=side)

    def test_does_not_reject_subtle_nonzero_changes(self):
        baseline = Image.new("RGB", (32, 24), (100,) * 3)
        adjusted = baseline.copy()
        adjusted.putpixel((16, 12), (101,) * 3)
        delta = MODULE.change_pixels(frame=adjusted, baseline=baseline)
        MODULE.require_changed_pixels(delta=delta, name="chin-length--50", side="Jianying")


if __name__ == "__main__":
    unittest.main()
