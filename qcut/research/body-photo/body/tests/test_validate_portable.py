"""Acceptance checks reject misleading image, export, status and fixture evidence."""
from copy import deepcopy
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import validate_portable as verification
from control_contract import validate_controls
from local_shape import validate_edits


def png(*, pixels):
    output = io.BytesIO()
    Image.fromarray(pixels).save(output, format="PNG")
    return output.getvalue()


class PortableAcceptanceTests(unittest.TestCase):
    def setUp(self):
        self.source = np.full((48, 32, 4), [90, 80, 70, 255], np.uint8)
        self.original = png(pixels=self.source)
        rendered = self.source.copy()
        rendered[12, 16, 0] = 91
        self.result = png(pixels=rendered)
        self.values = validate_controls(controls={"SlimWaist": 50})
        self.case = {"id": "waist", "sample": "photo", "values": {"SlimWaist": 50},
                     "expectedStatus": "applied", "expectedAppliedControls": ["SlimWaist"]}
        self.photo = {"photoId": "sample-photo"}
        self.receipt = {"controls": self.values, "inputPngSha256": verification.digest(data=self.original),
                        "outputPngSha256": verification.digest(data=self.result),
                        "inputRgbaSha256": verification.digest(data=self.source.tobytes()),
                        "outputRgbaSha256": verification.digest(data=rendered.tobytes()),
                        "backend": "portable-CPU", "changedPixels": 1}
        self.response = {"photoId": self.photo["photoId"], "values": self.values, "status": "applied",
                         "controls": {name: {"requested": value, "applied": bool(value)}
                                      for name, value in self.values.items()},
                         "result": {"pngSha256": self.receipt["outputPngSha256"],
                                    "rgbaSha256": self.receipt["outputRgbaSha256"]}}

    def verify(self, *, download=None):
        return verification.verify_case(case=self.case, photo=self.photo, response=self.response,
                                        receipt=self.receipt, original=self.original, result=self.result,
                                        download=self.result if download is None else download)

    def test_actual_change_and_half_comparison_use_original_and_result_pixels(self):
        evidence, half = self.verify()
        self.assertEqual(evidence["changedPixels"], 1)
        self.assertEqual(evidence["appliedControls"], ["SlimWaist"])
        np.testing.assert_array_equal(half[:, :16], self.source[:, :16])
        np.testing.assert_array_equal(half[:, 16:], verification.png_pixels(data=self.result)[:, 16:])

    def test_png_and_rgba_hashes_all_need_to_match_actual_downloads(self):
        original = deepcopy(self.receipt)
        for name in ("inputPngSha256", "outputPngSha256", "inputRgbaSha256", "outputRgbaSha256"):
            self.receipt = {**original, name: "0" * 64}
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "hash"):
                self.verify()


    def test_malformed_success_evidence_fails_as_a_validation_error(self):
        original_response, original_receipt = deepcopy(self.response), deepcopy(self.receipt)
        for name in ("result", "controls", "photoEdits"):
            self.response, self.receipt = deepcopy(original_response), deepcopy(original_receipt)
            target = self.receipt if name == "photoEdits" else self.response
            target[name] = None
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.verify()

    def test_export_must_be_the_same_png_as_preview(self):
        with self.assertRaisesRegex(ValueError, "export"):
            self.verify(download=self.original)

    def test_backend_and_changed_count_cannot_be_faked(self):
        for field, value in (("backend", "macOS-Metal"), ("changedPixels", 999)):
            original = deepcopy(self.receipt)
            self.receipt[field] = value
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "CPU receipt"):
                self.verify()
            self.receipt = original

    def test_successful_response_must_match_declared_status_and_controls(self):
        self.case["expectedStatus"] = "unavailable"
        with self.assertRaisesRegex(ValueError, "expectation"):
            self.verify()
        self.case["expectedStatus"] = "applied"
        self.case["expectedAppliedControls"] = []
        with self.assertRaisesRegex(ValueError, "applied-control"):
            self.verify()

    def test_changed_pixels_cannot_be_reported_as_unavailable(self):
        self.response["status"] = "unavailable"
        with self.assertRaisesRegex(ValueError, "changed pixels"):
            self.verify()

    def test_success_cannot_satisfy_an_expected_error(self):
        self.case.pop("expectedStatus")
        self.case["expectedError"] = {"code": "background_unavailable", "status": 422}
        with self.assertRaisesRegex(ValueError, "expectation"):
            self.verify()

    def test_background_protection_needs_nonempty_unchanged_protected_area(self):
        edits = validate_edits(edits={"backgroundProtection": True})
        self.case["edits"] = edits
        self.response.update(edits=edits, editFeedback={"manual": {"requested": 0, "applied": 0}})
        self.receipt.update(edits=edits, photoEdits={"backgroundProtection": {"applied": True,
                            "protectedPixels": 100, "changedProtectedPixels": 0}})
        self.assertEqual(self.verify()[0]["protectedPixels"], 100)
        for name, value in (("applied", False), ("protectedPixels", 0), ("changedProtectedPixels", 1)):
            original = deepcopy(self.receipt["photoEdits"]["backgroundProtection"])
            self.receipt["photoEdits"]["backgroundProtection"][name] = value
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "protected-pixel"):
                self.verify()
            self.receipt["photoEdits"]["backgroundProtection"] = original

    def test_manual_feedback_requires_correct_count_and_exact_edits(self):
        edits = validate_edits(edits={"strokes": [{"start": [.5, .5], "end": [.51, .5], "radius": .1}]})
        self.case["edits"] = edits
        self.response.update(edits=edits, editFeedback={"manual": {"requested": 1, "applied": 1}})
        self.receipt["edits"] = edits
        self.assertEqual(self.verify()[0]["manualApplied"], 1)
        self.response["editFeedback"]["manual"]["applied"] = 2
        with self.assertRaisesRegex(ValueError, "manual-stroke"):
            self.verify()
        self.response["edits"] = {}
        with self.assertRaisesRegex(ValueError, "local-edit"):
            self.verify()

    def test_no_person_assertion_requires_unchanged_unavailable_output(self):
        self.case["expectNoPerson"] = True
        with self.assertRaisesRegex(ValueError, "fail closed"):
            self.verify()

    def test_transparent_and_non_png_results_are_rejected(self):
        transparent = self.source.copy()
        transparent[0, 0, 3] = 0
        with self.assertRaisesRegex(ValueError, "opaque"):
            verification.png_pixels(data=png(pixels=transparent))
        output = io.BytesIO()
        Image.fromarray(self.source[..., :3]).save(output, format="JPEG")
        with self.assertRaisesRegex(ValueError, "PNG"):
            verification.png_pixels(data=output.getvalue())

    def test_response_cannot_claim_unrequested_control(self):
        self.response["controls"]["SmallHead"]["applied"] = True
        with self.assertRaisesRegex(ValueError, "zero control"):
            self.verify()

    def test_actual_zero_http_flow_requires_no_models_and_exports_identical_png(self):
        with verification.cpu_service() as (base, _):
            status, raw, _ = verification.request(base=base, path="/api/photos", data=self.original,
                                                   content_type="image/png")
            self.assertEqual(status, 200)
            photo = json.loads(raw)
            status, original, _ = verification.request(base=base, path=photo["url"])
            case = {"id": "zero", "sample": "photo", "values": {}, "expectedStatus": "identity"}
            status, raw, _ = verification.request(base=base, path="/api/render",
                data=json.dumps({"photoId": photo["photoId"], "values": {}}).encode())
            self.assertEqual(status, 200)
            response = json.loads(raw)
            _, result, _ = verification.request(base=base, path=response["result"]["url"])
            _, download, _ = verification.request(base=base, path=response["result"]["downloadUrl"])
            _, receipt, _ = verification.request(base=base, path=response["receiptUrl"])
            evidence, _ = verification.verify_case(case=case, photo=photo, response=response,
                receipt=json.loads(receipt), original=original, result=result, download=download)
            self.assertEqual(evidence["changedPixels"], 0)
            self.assertEqual(result, original)


class FixtureContractTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="body-fixture-contract-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "inputs").mkdir()
        (self.root / "inputs" / "photo.png").write_bytes(b"fixture")
        self.case = {"id": "one", "sample": "photo", "values": {}, "expectedStatus": "identity"}

    def load(self, *, cases):
        (self.root / "cases.json").write_text(json.dumps({"schemaVersion": 1, "cases": cases}))
        return verification.fixture_cases(root=self.root)

    def test_valid_fixture_allows_expected_rejections_without_forcing_applied(self):
        self.assertEqual(self.load(cases=[self.case])["cases"][0], self.case)
        self.case.pop("expectedStatus")
        self.case["expectedError"] = {"code": "background_unavailable", "status": 422}
        self.assertEqual(self.load(cases=[self.case])["cases"][0], self.case)

    def test_duplicate_ids_missing_samples_and_path_traversal_are_rejected(self):
        for cases in ([self.case, self.case], [{**self.case, "sample": "../photo"}],
                      [{**self.case, "sample": "missing"}], [{**self.case, "id": "../out"}],
                      [{**self.case, "id": "sources"}], [{**self.case, "id": "acceptance.json"}]):
            with self.subTest(cases=cases), self.assertRaises(ValueError):
                self.load(cases=cases)

    def test_inconsistent_or_malformed_expectations_are_rejected(self):
        for extras in ({"expectedStatus": "success"}, {"expectedError": {"code": "x", "status": 422}},
                       {"expectedAppliedControls": ["SlimWaist", "SlimWaist"]},
                       {"expectedAppliedControls": [{}]}, {"expectNoPerson": "true"}):
            with self.subTest(extras=extras), self.assertRaises(ValueError):
                self.load(cases=[{**self.case, **extras}])

    def test_missing_expectation_is_retained_as_observation_not_silently_added(self):
        self.case.pop("expectedStatus")
        loaded = self.load(cases=[self.case])["cases"][0]
        self.assertNotIn("expectedStatus", loaded)
        self.assertNotIn("expectedError", loaded)


    def test_shards_cover_each_case_once_and_preserve_original_order(self):
        cases = [{"id": str(index)} for index in range(308)]
        shards = [verification.select_cases(cases=cases, shard_index=index, shard_count=4)
                  for index in range(4)]
        self.assertEqual([len(shard) for shard in shards], [77] * 4)
        self.assertEqual({item["id"] for shard in shards for item in shard}, {item["id"] for item in cases})
        self.assertEqual(sum(len(shard) for shard in shards), len(cases))
        self.assertEqual(shards[2], cases[2::4])
        self.assertEqual(verification.select_cases(cases=cases), cases)

    def test_shards_reject_empty_negative_boolean_or_out_of_range_indices(self):
        for index, count in ((0, 0), (-1, 1), (1, 1), (True, 1), (0, False), (0, 10), (0, 257)):
            with self.subTest(index=index, count=count), self.assertRaises(ValueError):
                verification.select_cases(cases=[self.case], shard_index=index, shard_count=count)

    def test_invalid_manifest_shape_and_nonlocal_urls_are_rejected(self):
        (self.root / "cases.json").write_text("[]")
        with self.assertRaises(ValueError):
            verification.fixture_cases(root=self.root)
        with self.assertRaises(ValueError):
            verification.request(base="http://127.0.0.1:1", path="https://example.com/")


if __name__ == "__main__":
    unittest.main()
