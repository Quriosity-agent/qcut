import copy
import importlib.util
import tempfile
import unittest
from pathlib import Path

from PIL import Image

SPEC = importlib.util.spec_from_file_location(
    "portrait_skin_reference", Path(__file__).parents[1] / "compare-portrait-skin-reference.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def editor_report():
    return {"errors": [], "samples": [
        {"values": {key: value}, "value": value}
        for _, _, key in MODULE.CONTROLS for value in (50, 100)
    ]}


def reference_manifest():
    return {"sourceSha256": "same-source", "samples": [
        {"key": key, "value": value, "zero": "zero.png", "result": f"{key}-{value}.png"}
        for _, _, key in MODULE.CONTROLS for value in (50, 100)
    ]}


class SkinReferenceTests(unittest.TestCase):
    def test_accepts_complete_isolated_values(self):
        self.assertEqual(len(MODULE.validate_samples(report=editor_report())), 16)

    def test_rejects_missing_duplicate_combined_or_mislabeled_values(self):
        base = editor_report()
        missing = copy.deepcopy(base)
        missing["samples"].pop()
        duplicate = copy.deepcopy(base)
        duplicate["samples"].append(duplicate["samples"][0])
        combined = copy.deepcopy(base)
        combined["samples"][0]["values"]["face_adjust_Pouch"] = 50
        mislabeled = copy.deepcopy(base)
        mislabeled["samples"][0]["value"] = 100
        for report in [missing, duplicate, combined, mislabeled]:
            with self.subTest(report=report), self.assertRaises(ValueError):
                MODULE.validate_samples(report=report)

    def test_rejects_failed_editor_run(self):
        report = editor_report()
        report["errors"] = ["render failed"]
        with self.assertRaises(ValueError):
            MODULE.validate_samples(report=report)

    def test_references_require_identical_source_and_complete_cases(self):
        manifest = reference_manifest()
        self.assertEqual(len(MODULE.validate_references(manifest=manifest, source_hash="same-source")), 16)
        with self.assertRaises(ValueError):
            MODULE.validate_references(manifest=manifest, source_hash="different-source")
        manifest["samples"].pop()
        with self.assertRaises(ValueError):
            MODULE.validate_references(manifest=manifest, source_hash="same-source")

    def test_references_reject_duplicates(self):
        manifest = reference_manifest()
        manifest["samples"].append(manifest["samples"][0])
        with self.assertRaises(ValueError):
            MODULE.validate_references(manifest=manifest, source_hash="same-source")

    def test_crop_checks_dimensions_and_bounds_before_resizing(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "capture.png"
            Image.new("RGB", (40, 60), "white").save(path)
            result = MODULE.load_frame(path=path, expected_size=[40, 60], crop=[10, 15, 30, 45])
            self.assertEqual(result.size, MODULE.DIFF.NORMALIZED_SIZE)
            for options in [
                {"expected_size": [41, 60]},
                {"expected_size": [40, 60], "crop": [-1, 0, 40, 60]},
                {"expected_size": [40, 60], "crop": [0, 0, 41, 60]},
                {"expected_size": [40, 60], "crop": [20, 0, 10, 60]},
            ]:
                with self.subTest(options=options), self.assertRaises(ValueError):
                    MODULE.load_frame(path=path, **options)

    def test_each_side_subtracts_its_own_baseline(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            for prefix, color in [("jianying", 100), ("qcut", 150)]:
                image = Image.new("RGB", MODULE.DIFF.NORMALIZED_SIZE, (color,) * 3)
                display, metrics = MODULE.save_side(
                    baseline=image, adjusted=image, output=output, prefix=prefix
                )
                self.assertEqual(display.getextrema(), (0, 0))
                self.assertEqual(metrics["meanAbsoluteChange"], 0)
                self.assertTrue((output / f"{prefix}-difference-raw.npy").is_file())


if __name__ == "__main__":
    unittest.main()
