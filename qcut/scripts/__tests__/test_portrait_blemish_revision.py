import copy
import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location(
    "blemish_revision", Path(__file__).parents[1] / "compare-portrait-blemish-revision.py"
)
REVISION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REVISION)


class BlemishRevisionEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.before = {
            "source": {"sha256": "a" * 64},
            "method": {"frame": 60, "normalizedSize": [600, 900], "sigma": 0.6,
                       "gain": 6, "losslessParity": False},
            "diagnostics": {side: {"consistentColorContract": True, "neutralDriftMeanRGB": 0}
                            for side in ("qcut", "jianying")},
        }
        self.after = copy.deepcopy(self.before)

    def test_accepts_matching_export_evidence(self):
        REVISION.validate_reports(before=self.before, after=self.after)

    def test_rejects_a_different_source(self):
        self.after["source"]["sha256"] = "b" * 64
        with self.assertRaisesRegex(ValueError, "Source"):
            REVISION.validate_reports(before=self.before, after=self.after)

    def test_rejects_changed_comparison_parameters(self):
        for field, value in (("gain", 12), ("sigma", 1), ("frame", 0), ("losslessParity", True)):
            with self.subTest(field=field):
                changed = copy.deepcopy(self.after)
                changed["method"][field] = value
                with self.assertRaisesRegex(ValueError, "methods"):
                    REVISION.validate_reports(before=self.before, after=changed)

    def test_rejects_missing_baseline_diagnostics(self):
        self.after["diagnostics"] = {}
        with self.assertRaisesRegex(ValueError, "Both applications"):
            REVISION.validate_reports(before=self.before, after=self.after)

    def test_rejects_neutral_or_color_drift_on_either_side(self):
        for phase in ("before", "after"):
            for side in ("qcut", "jianying"):
                for field, value in (("consistentColorContract", False), ("neutralDriftMeanRGB", 0.01)):
                    with self.subTest(phase=phase, side=side, field=field):
                        reports = copy.deepcopy({"before": self.before, "after": self.after})
                        reports[phase]["diagnostics"][side][field] = value
                        with self.assertRaisesRegex(ValueError, "Unstable"):
                            REVISION.validate_reports(**reports)


if __name__ == "__main__":
    unittest.main()
