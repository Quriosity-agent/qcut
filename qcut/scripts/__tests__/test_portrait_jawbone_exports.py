import copy
import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location(
    "portrait_jawbone_exports", Path(__file__).parents[1] / "compare-portrait-jawbone-exports.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def manifest():
    return {"sourceSha256": "same-source", "errors": [],
            "samples": [{"name": name, "values": values, "exportPath": name + ".mp4"}
                        for name, values in MODULE.EXPECTED.items()]}


def improved():
    return [{"value": value, "before": {"deltaMae": 1.0, "deltaCosine": 0.7},
             "after": {"deltaMae": 0.5, "deltaCosine": 0.9}} for value in (50, 100)]


class JawboneExportTests(unittest.TestCase):
    def test_accepts_complete_isolated_matrix(self):
        self.assertEqual(len(MODULE.validate_manifest(manifest=manifest(), source_hash="same-source")), 4)

    def test_rejects_source_errors_missing_duplicates_and_combined_parameters(self):
        valid = manifest()
        combined = copy.deepcopy(valid)
        combined["samples"][1]["values"]["face_adjust_Chin"] = 50
        for invalid in [
            {**valid, "sourceSha256": "different"}, {**valid, "errors": ["failure"]},
            {**valid, "samples": valid["samples"][:-1]},
            {**valid, "samples": valid["samples"] + [valid["samples"][0]]}, combined,
        ]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                MODULE.validate_manifest(manifest=invalid, source_hash="same-source")

    def test_requires_all_three_stable_export_sets(self):
        stable = {side: {"neutralDriftMeanRGB": 0, "consistentColorContract": True}
                  for side in ("before", "after", "jianying")}
        MODULE.validate_diagnostics(diagnostics=stable)
        for invalid in [{"before": stable["before"]},
                        {**stable, "after": {"neutralDriftMeanRGB": 0.1, "consistentColorContract": True}},
                        {**stable, "jianying": {"neutralDriftMeanRGB": 0, "consistentColorContract": False}}]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                MODULE.validate_diagnostics(diagnostics=invalid)

    def test_requires_improvement_in_both_strengths(self):
        MODULE.validate_improvement(records=improved())
        for field, value in [("deltaMae", 1.0), ("deltaMae", 1.1), ("deltaCosine", 0.7),
                             ("deltaCosine", None), ("deltaMae", float("nan"))]:
            records = improved()
            records[1]["after"][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                MODULE.validate_improvement(records=records)
        with self.assertRaises(ValueError):
            MODULE.validate_improvement(records=improved()[:1])


if __name__ == "__main__":
    unittest.main()
