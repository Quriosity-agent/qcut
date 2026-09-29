import copy
import importlib.util
from pathlib import Path
import unittest
import tempfile
from PIL import Image

SPEC = importlib.util.spec_from_file_location(
    "blemish_revision", Path(__file__).parents[1] / "compare-portrait-blemish-revision.py"
)
REVISION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REVISION)


class BlemishRevisionEvidenceTests(unittest.TestCase):
    def test_frames_are_bound_to_the_producer_report(self):
        producer_spec = importlib.util.spec_from_file_location(
            "blemish_export_producer", Path(__file__).parents[1] / "compare-portrait-skin-exports.py"
        )
        producer = importlib.util.module_from_spec(producer_spec)
        producer_spec.loader.exec_module(producer)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            case = root / "blemish-50"
            case.mkdir()
            for kind in ("zero", "result"):
                Image.new("RGB", (600, 900), "red").save(case / f"qcut-{kind}.png")
            frames = producer.comparison_fingerprints(directory=case, prefix="qcut")
            report = {"samples": [{"key": "face_adjust_SpotAcne", "value": 50, "qcut": {"frames": frames}}]}
            options = {"report": report, "directory": root, "value": 50, "side": "qcut", "kind": "result"}
            image, record = REVISION.validated_frame(**options)
            self.assertEqual(image.size, (600, 900))
            self.assertEqual(record, frames["result"])
            for invalid in ({}, {"samples": []}, {"samples": report["samples"] * 2},
                            {"samples": [{"key": "face_adjust_SpotAcne", "value": 50}]}):
                with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                    REVISION.validated_frame(**{**options, "report": invalid})
            Image.new("RGB", (600, 900), "blue").save(case / "qcut-result.png")
            with self.assertRaisesRegex(ValueError, "fingerprint"):
                REVISION.validated_frame(**options)
            (case / "qcut-result.png").unlink()
            with self.assertRaises(FileNotFoundError):
                REVISION.validated_frame(**options)

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
