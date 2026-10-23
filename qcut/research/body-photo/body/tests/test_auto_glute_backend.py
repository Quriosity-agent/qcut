"""Automatic photo analysis is CPU-only, source-bound, and explicit on failure."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from PIL import Image

from body.backend import AppError, BodyBackend, EngineRunner, image_identity, sha256, write_json
from body.glute_analysis import PROVIDER, validate_detection
from body.glute_import import analyze_import
from body.local_shape import validate_edits
from body.tests.test_backend import picture


def detection(*, source_hash, available=True):
    return {"provider": PROVIDER, "available": available, "confidence": .82 if available else 0.,
            "inputRgbaSha256": source_hash, "anatomicalLandmarksDetected": False,
            **({"selection": {"view": "side-right", "anchors": [
                {"peak": [.65, .55], "fold": [.62, .67]}]}} if available else {"reason": "轮廓被遮挡"})}


class AnalysisRunner:
    def __init__(self):
        self.analysis_calls, self.calls = [], []
        self.analysis_patch, self.render_patch = {}, {}
        self.analysis_error = None

    def analyze_photo(self, *, source, photo):
        self.analysis_calls.append({"source": source.read_bytes(), "photo": deepcopy(photo)})
        if self.analysis_error:
            raise self.analysis_error
        return {**detection(source_hash=photo["rgbaSha256"]), **self.analysis_patch}

    def __call__(self, *, source, values, output, report, edits):
        self.calls.append({"source": source.read_bytes(), "values": deepcopy(values), "edits": deepcopy(edits)})
        with Image.open(source) as original:
            image = original.convert("RGBA")
            before = image_identity(image=image)
        image.putpixel((0, 0), (255, 0, 0, 255))
        image.save(output)
        receipt = {"inputRgbaSha256": before["rgbaSha256"],
                   "outputRgbaSha256": image_identity(image=image)["rgbaSha256"],
                   "inputPngSha256": sha256(data=source.read_bytes()),
                   "outputPngSha256": sha256(data=output.read_bytes()), "controls": values,
                   "parts": {"ButtLift": {"moved": True}}, "edits": deepcopy(edits),
                   "independence": {"private_native_images": []}}
        receipt.update(self.render_patch)
        write_json(path=report, value=receipt)


class AutoGluteBackendTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix="auto-glute-backend-")
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        write_json(path=self.root / "catalog.json", value={"controls": []})
        context = patch.dict("os.environ", {"BODY_RENDER_BACKEND": "cpu"})
        context.start()
        self.addCleanup(context.stop)
        self.runner = AnalysisRunner()
        self.backend = BodyBackend(root=self.root, runner=self.runner, platform="linux")
        self.addCleanup(self.backend.close)

    def test_cpu_import_stores_source_bound_estimate_and_preserves_owned_pixels(self):
        photo = self.backend.import_photo(data=picture())
        source, saved = self.backend.photo(identifier=photo["photoId"])
        self.assertEqual(saved, photo)
        self.assertEqual(photo["buttocksDetection"]["inputRgbaSha256"], photo["rgbaSha256"])
        self.assertFalse(photo["buttocksDetection"]["anatomicalLandmarksDetected"])
        self.assertEqual(self.runner.analysis_calls[0]["source"], source.read_bytes())
        self.assertEqual(self.runner.calls, [])
        with Image.open(source) as image:
            self.assertEqual(image_identity(image=image)["rgbaSha256"], photo["rgbaSha256"])

    def test_bad_analysis_never_discards_original_or_publishes_forged_coordinates(self):
        for fault in ({"inputRgbaSha256": "0" * 64}, {"provider": "foreign"},
                      {"anatomicalLandmarksDetected": True}, {"available": 1},
                      {"confidence": float("nan")}, {"confidence": 1.1}, {"confidence": 0},
                      {"confidence": 10 ** 1000},
                      {"selection": {"view": "rear", "anchors": []}}):
            with self.subTest(fault=fault):
                self.runner.analysis_patch = fault
                photo = self.backend.import_photo(data=picture())
                source, stored = self.backend.photo(identifier=photo["photoId"])
                estimate = stored["buttocksDetection"]
                self.assertFalse(estimate["available"])
                self.assertNotIn("selection", estimate)
                self.assertEqual(estimate["inputRgbaSha256"], photo["rgbaSha256"])
                self.assertEqual(sha256(data=source.read_bytes()), photo["pngSha256"])

    def test_analyzer_failure_and_missing_capability_keep_import_available_for_manual_correction(self):
        self.runner.analysis_error = RuntimeError("inference unavailable")
        failed = self.backend.import_photo(data=picture())
        self.assertFalse(failed["buttocksDetection"]["available"])
        self.assertIn("手动", failed["buttocksDetection"]["reason"])
        self.backend.runner = Mock(spec=["__call__"])
        missing = self.backend.import_photo(data=picture())
        self.assertFalse(missing["buttocksDetection"]["available"])
        self.assertTrue(self.backend.photo(identifier=missing["photoId"])[0].is_file())
        self.backend.runner = self.runner

    def test_malformed_analyzer_type_and_overflow_failures_preserve_the_owned_original(self):
        for error in (TypeError("malformed inference result"), OverflowError("unbounded confidence")):
            with self.subTest(error=type(error).__name__):
                self.runner.analysis_error = error
                photo = self.backend.import_photo(data=picture())
                source, saved = self.backend.photo(identifier=photo["photoId"])
                self.assertFalse(saved["buttocksDetection"]["available"])
                self.assertEqual(sha256(data=source.read_bytes()), photo["pngSha256"])

    def test_zero_auto_echo_is_byte_identity_and_reuses_import_estimate_without_engine(self):
        photo = self.backend.import_photo(data=picture())
        edits = {"backgroundProtection": False, "strokes": [], "autoButtocks": True}
        result = self.backend.render(request={"photoId": photo["photoId"], "values": {}, "edits": edits})
        self.assertEqual(result["status"], "identity")
        self.assertEqual(result["edits"], edits)
        receipt = json.loads(self.backend.stored_file(category="receipts", identifier=result["renderId"]).read_text())
        self.assertTrue(receipt["photoEdits"]["automaticDetectionFromImport"])
        self.assertEqual(receipt["photoEdits"]["buttocksDetection"], photo["buttocksDetection"])
        self.assertEqual(self.backend.stored_file(category="renders", identifier=result["renderId"]).read_bytes(),
                         self.backend.photo(identifier=photo["photoId"])[0].read_bytes())
        self.assertEqual(len(self.runner.analysis_calls), 1)
        self.assertEqual(self.runner.calls, [])

    def test_manual_override_with_auto_flag_is_echoed_without_modifying_import_suggestion(self):
        photo = self.backend.import_photo(data=picture())
        manual = {"view": "side-left", "anchors": [{"peak": [.35, .55], "fold": [.38, .68]}]}
        edits = {"backgroundProtection": False, "strokes": [], "autoButtocks": True, "buttocks": manual}
        result = self.backend.render(request={"photoId": photo["photoId"], "values": {"ButtLift": 70}, "edits": edits})
        self.assertEqual(result["status"], "applied")
        self.assertEqual(result["edits"], edits)
        self.assertEqual(self.runner.calls[0]["edits"], edits)
        self.assertEqual(self.backend.photo(identifier=photo["photoId"])[1]["buttocksDetection"], photo["buttocksDetection"])

    def test_auto_mode_requires_exact_boolean_and_rejects_client_detection_or_anatomical_claims(self):
        photo = self.backend.import_photo(data=picture())
        for edits in ([{"autoButtocks": value} for value in (None, 0, 1, "true", [], {})]
                      + [{"autoButtocks": True, "buttocksDetection": photo["buttocksDetection"]},
                         {"autoButtocks": True, "anatomicalLandmarksDetected": True}]):
            with self.subTest(edits=edits), self.assertRaises(AppError):
                self.backend.render(request={"photoId": photo["photoId"], "values": {"ButtLift": 80}, "edits": edits})
        self.assertEqual(self.runner.calls, [])
        self.assertNotIn("autoButtocks", validate_edits())
        self.assertFalse(validate_edits(edits={"autoButtocks": False})["autoButtocks"])

    def test_missing_or_mismatched_auto_echo_never_delivers_a_download(self):
        photo = self.backend.import_photo(data=picture())
        for returned in ({"backgroundProtection": False, "strokes": []},
                         {"backgroundProtection": False, "strokes": [], "autoButtocks": False}):
            self.runner.render_patch = {"edits": returned}
            with self.subTest(returned=returned), self.assertRaises(AppError) as caught:
                self.backend.render(request={"photoId": photo["photoId"], "values": {"ButtLift": 70},
                    "edits": {"autoButtocks": True}})
            self.assertEqual(caught.exception.code, "invalid_render")
            self.assertEqual(list((self.backend.state / "renders").iterdir()), [])
            self.assertEqual(list((self.backend.state / "receipts").iterdir()), [])

    def test_native_import_never_analyzes_and_rejects_auto_field_including_false_at_zero(self):
        with patch.dict("os.environ", {"BODY_RENDER_BACKEND": "metal"}):
            self.backend.platform_name = "darwin"
            photo = self.backend.import_photo(data=picture())
            self.assertNotIn("buttocksDetection", photo)
            for flag in (True, False):
                with self.subTest(flag=flag), self.assertRaisesRegex(AppError, "CPU"):
                    self.backend.render(request={"photoId": photo["photoId"], "values": {}, "edits": {"autoButtocks": flag}})
        self.assertEqual(self.runner.analysis_calls, [])
        self.assertEqual(self.runner.calls, [])

    def test_missing_installed_analysis_module_does_not_spawn_a_render_process(self):
        runner = EngineRunner(root=self.root)
        self.addCleanup(runner.close)
        with patch("body.backend.process_group.spawn") as spawn, self.assertRaisesRegex(ValueError, "does not provide"):
            runner.analyze_photo(source=self.root / "photo.png", photo={})
        spawn.assert_not_called()


class AutoGluteImportEvidenceTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix="auto-glute-import-")
        self.addCleanup(directory.cleanup)
        self.source = Path(directory.name) / "photo.png"
        self.source.write_bytes(picture())
        with Image.open(self.source) as image:
            self.photo = {**image_identity(image=image), "pngSha256": sha256(data=self.source.read_bytes())}

    def analyze(self, *, update=None):
        def runner(*, source, values, edits, output, report):
            output.write_bytes(source.read_bytes())
            receipt = {"inputRgbaSha256": self.photo["rgbaSha256"], "outputRgbaSha256": self.photo["rgbaSha256"],
                       "inputPngSha256": self.photo["pngSha256"], "changedPixels": 0,
                       "sourceAndAssetsUnchanged": True, "edits": edits,
                       "photoEdits": {"buttocksDetection": detection(source_hash=self.photo["rgbaSha256"])},
                       "independence": {"private_native_images": []}}
            if update:
                replacement = update(receipt)
                if replacement is not None:
                    receipt = replacement
            write_json(path=report, value=receipt)
        return analyze_import(runner=runner, source=self.source, photo=self.photo)

    def test_import_estimate_requires_normalized_photo_identity_unchanged_assets_and_clean_inventory(self):
        original = self.source.read_bytes()
        self.assertTrue(self.analyze()["available"])
        for field, value in (("inputRgbaSha256", "0" * 64), ("outputRgbaSha256", "0" * 64),
                             ("inputPngSha256", "0" * 64), ("changedPixels", 1),
                             ("sourceAndAssetsUnchanged", False), ("edits", {}),
                             ("independence", {"private_native_images": ["liblens.dylib"]})):
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.analyze(update=lambda receipt, field=field, value=value: receipt.update({field: value}))
        self.assertEqual(self.source.read_bytes(), original)

    def test_detected_selection_is_validated_and_available_false_requires_a_reason(self):
        valid = detection(source_hash=self.photo["rgbaSha256"])
        self.assertEqual(validate_detection(detection=valid, source_hash=self.photo["rgbaSha256"]), valid)
        for update in ({"selection": {"view": "side-right", "anchors": []}},
                       {"confidence": True}, {"confidence": 10 ** 1000},
                       {"available": False, "reason": ""}):
            with self.subTest(update=update), self.assertRaises(ValueError):
                validate_detection(detection={**valid, **update}, source_hash=self.photo["rgbaSha256"])

    def test_analysis_receipt_must_be_an_object_before_reading_identity_fields(self):
        with self.assertRaises(ValueError):
            self.analyze(update=lambda _: [])


if __name__ == "__main__":
    unittest.main()
