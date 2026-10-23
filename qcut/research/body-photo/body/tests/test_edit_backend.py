"""Local edits share the existing owned-photo, status and export contracts."""
import json
from pathlib import Path
import tempfile
import unittest

from body.backend import AppError, BodyBackend, write_json
from body.tests.test_backend import FakeEngine, picture


STROKE = {"start": [.5, .5], "end": [.52, .5], "radius": .15}


class EditingEngine(FakeEngine):
    def __call__(self, *, source, values, output, report, edits=None):
        super().__call__(source=source, values=values, output=output, report=report)
        receipt = json.loads(report.read_bytes())
        receipt["edits"] = edits
        receipt["photoEdits"] = {
            "manual": {"appliedCount": len(edits["strokes"]), "strokes": []},
            "backgroundProtection": {"applied": edits["backgroundProtection"], "changedProtectedPixels": 0}}
        if self.fault == "wrong-edits":
            receipt["edits"] = {}
        if self.fault == "too-many-strokes":
            receipt["photoEdits"]["manual"]["appliedCount"] = 99
        if self.fault == "unprotected":
            receipt["photoEdits"]["backgroundProtection"]["applied"] = False
        if self.fault == "changed-background":
            receipt["photoEdits"]["backgroundProtection"]["changedProtectedPixels"] = 1
        write_json(path=report, value=receipt)


class EditBackendTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        write_json(path=self.root / "catalog.json", value={"controls": []})
        self.engine = EditingEngine()
        self.backend = BodyBackend(root=self.root, runner=self.engine, platform="darwin")
        self.photo = self.backend.import_photo(data=picture())

    def render(self, *, edits, values=None):
        return self.backend.render(request={"photoId": self.photo["photoId"],
            "values": values or {}, "edits": edits})

    def test_manual_only_is_applied_and_exports_verified_png(self):
        result = self.render(edits={"strokes": [STROKE]})
        self.assertEqual(result["status"], "applied")
        self.assertEqual(result["edits"]["strokes"], [STROKE])
        self.assertEqual(result["editFeedback"]["manual"]["applied"], 1)
        self.assertTrue(self.backend.stored_file(category="download", identifier=result["renderId"]).is_file())
        self.assertFalse(any(item["applied"] for item in result["controls"].values()))

    def test_zero_protection_preserves_exact_source_without_running_engine(self):
        result = self.render(edits={"backgroundProtection": True})
        self.assertEqual(result["status"], "identity")
        self.assertEqual(self.engine.calls, [])
        self.assertFalse(result["editFeedback"]["backgroundProtection"]["applied"])
        png = self.backend.stored_file(category="download", identifier=result["renderId"]).read_bytes()
        original, _ = self.backend.photo(identifier=self.photo["photoId"])
        self.assertEqual(png, original.read_bytes())

    def test_manual_and_unavailable_automatic_part_report_partial(self):
        self.engine.missing = ("SlimWaist",)
        result = self.render(edits={"strokes": [STROKE]}, values={"SlimWaist": 80})
        self.assertEqual(result["status"], "partial")
        self.assertFalse(result["controls"]["SlimWaist"]["applied"])
        self.assertEqual(result["editFeedback"]["manual"]["applied"], 1)

    def test_protection_evidence_is_required_for_changed_output(self):
        for fault in ("wrong-edits", "too-many-strokes", "unprotected", "changed-background"):
            with self.subTest(fault=fault):
                self.engine.fault = fault
                with self.assertRaises(AppError) as caught:
                    self.render(edits={"backgroundProtection": True, "strokes": [STROKE]})
                self.assertEqual(caught.exception.code, "invalid_render")
                self.assertEqual(list((self.backend.state / "renders").iterdir()), [])
                self.assertEqual(list((self.backend.state / "receipts").iterdir()), [])

    def test_invalid_edit_requests_do_not_run_or_publish(self):
        for edits in ([], {"backgroundProtection": 1}, {"strokes": [STROKE] * 33},
                      {"strokes": [{"start": [float("nan"), .5], "end": [.5, .5], "radius": .1}]},
                      {"strokes": [{"start": [0, 0], "end": [1, 1], "radius": .1}]},
                      {"unknown": True}):
            with self.subTest(edits=edits), self.assertRaises(AppError):
                self.render(edits=edits)
        self.assertEqual(self.engine.calls, [])
        self.assertEqual(list((self.backend.state / "renders").iterdir()), [])

    def test_unsupported_manual_request_is_explicitly_unavailable(self):
        self.backend.platform_name = "freebsd"
        result = self.render(edits={"strokes": [STROKE], "backgroundProtection": True})
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["editFeedback"]["manual"]["applied"], 0)
        self.assertEqual(self.engine.calls, [])
        self.assertIn("不受支持", result["message"])


if __name__ == "__main__":
    unittest.main()
