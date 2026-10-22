"""New-control acceptance rejects fabricated state, images, identity and legacy equality."""
from copy import deepcopy
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

from body import validate_photo_controls as verification
from body.photo_controls import EXTRA_RANGES, SKIN_CONTROLS


def png(*, pixels):
    stream = io.BytesIO()
    Image.fromarray(pixels).save(stream, format="PNG")
    return stream.getvalue()


class PhotoEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.source = np.full((48, 32, 4), [90, 80, 70, 255], np.uint8)
        self.original = png(pixels=self.source)
        changed = self.source.copy()
        changed[12, 20, 0] += 2
        self.result = png(pixels=changed)
        self.values = verification.VALIDATE_CONTROLS(controls={"BodySkinTone": 50})
        self.case = {"id": "vsx-26--BodySkinTone-positive", "sample": "vsx-26", "variant": "BodySkinTone-positive",
                     "values": {"BodySkinTone": 50}, "expectedStatus": "applied",
                     "expectedAppliedControls": ["BodySkinTone"]}
        self.photo = {"photoId": "photo", "width": 32, "height": 48,
                      "pngSha256": verification.digest(data=self.original),
                      "rgbaSha256": verification.digest(data=self.source.tobytes())}
        pin = (self.photo["pngSha256"], self.photo["rgbaSha256"], 32, 48)
        context = patch.dict(verification.SAMPLES, {"vsx-26": pin})
        context.start()
        self.addCleanup(context.stop)
        parts = {name: {"moved": bool(value), "intensity": value / 100} for name, value in self.values.items()}
        parts["BodySkinTone"].update(changedProtectedPixels=0, alphaUnchanged=True,
                                     textureGenerated=False, skinSelection={"available": True})
        self.receipt = {"controls": self.values, "backend": "portable-CPU", "changedPixels": 1,
            "actualEffectStatus": "applied", "sourceAndAssetsUnchanged": True,
            "nativeGeometryUsed": False, "fixedLandmarks": False, "parts": parts,
            "inputPngSha256": self.photo["pngSha256"], "inputRgbaSha256": self.photo["rgbaSha256"],
            "outputPngSha256": verification.digest(data=self.result),
            "outputRgbaSha256": verification.digest(data=changed.tobytes())}
        self.response = {"photoId": "photo", "values": self.values, "status": "applied",
            "controls": {name: {"requested": value, "applied": bool(value)} for name, value in self.values.items()},
            "result": {"url": "/api/renders/result.png", "downloadUrl": "/api/download/result.png",
                       "pngSha256": self.receipt["outputPngSha256"], "rgbaSha256": self.receipt["outputRgbaSha256"]},
            "receiptUrl": "/api/receipts/result.json"}

    def verify(self, *, download=None):
        return verification.verify_photo_case(case=self.case, photo=self.photo, response=self.response,
            receipt=self.receipt, original=self.original, result=self.result,
            download=self.result if download is None else download)

    def test_actual_skin_result_and_half_comparison_use_exact_same_coordinates(self):
        evidence, half = self.verify()
        self.assertEqual(evidence["appliedControls"], ["BodySkinTone"])
        self.assertEqual(evidence["changedPixels"], 1)
        self.assertTrue(evidence["perPart"]["BodySkinTone"]["moved"])
        np.testing.assert_array_equal(half[:, :16], self.source[:, :16])
        np.testing.assert_array_equal(half[:, 16:], verification.png_pixels(data=self.result)[:, 16:])

    def test_falsified_application_and_disagreement_between_feedback_and_parts_fail(self):
        good_response, good_receipt = deepcopy(self.response), deepcopy(self.receipt)
        mutations = [
            lambda: self.response["controls"]["BodySkinTone"].update(applied=False),
            lambda: self.response["controls"]["BodyBlemish"].update(applied=True),
            lambda: self.receipt["parts"]["BodySkinTone"].update(moved=False),
            lambda: self.receipt["parts"]["BodySkinTone"].update(moved=1),
            lambda: self.receipt.update(parts={}),
            lambda: self.receipt.update(actualEffectStatus="unavailable"),
            lambda: self.receipt.update(sourceAndAssetsUnchanged=False),
        ]
        for mutate in mutations:
            self.response, self.receipt = deepcopy(good_response), deepcopy(good_receipt)
            mutate()
            with self.assertRaises(ValueError):
                self.verify()

    def test_partial_or_applied_status_must_match_actual_requested_set(self):
        self.case["expectedStatus"] = "partial"
        self.response["status"] = "partial"
        with self.assertRaisesRegex(ValueError, "actual applied-control set"):
            self.verify()
        self.response["status"] = "unavailable"
        with self.assertRaisesRegex(ValueError, "changed pixels"):
            self.verify()

    def test_export_and_all_png_rgba_hashes_must_match_the_download(self):
        with self.assertRaisesRegex(ValueError, "export"):
            self.verify(download=self.original)
        original_receipt = deepcopy(self.receipt)
        for field in ("inputPngSha256", "inputRgbaSha256", "outputPngSha256", "outputRgbaSha256"):
            self.receipt = {**original_receipt, field: "0" * 64}
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "hash"):
                self.verify()

    def test_known_sample_cannot_be_relabelled_or_replaced_by_another_source(self):
        self.case["sample"] = "vsx-03"
        with self.assertRaisesRegex(ValueError, "sample identity"):
            self.verify()
        self.case["sample"] = "vsx-26"
        self.photo["rgbaSha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "sample identity"):
            self.verify()

    def test_skin_clothing_head_protection_receipt_is_required_when_applied(self):
        good = deepcopy(self.receipt["parts"]["BodySkinTone"])
        for key, value in (("changedProtectedPixels", 1), ("alphaUnchanged", False),
                           ("textureGenerated", True), ("skinSelection", {"available": False}),
                           ("skinSelection", None)):
            self.receipt["parts"]["BodySkinTone"] = {**good, key: value}
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "skin protection"):
                self.verify()

    def test_real_http_zero_extra_controls_need_no_models_and_export_original(self):
        case = verification.photo_cases(sample="vsx-26")[0]
        with tempfile.TemporaryDirectory(prefix="photo-control-zero-") as temporary, \
             verification.cpu_service() as (base, _):
            status, raw, _ = verification.request(base=base, path="/api/photos", data=self.original,
                                                   content_type="image/png")
            self.assertEqual(status, 200)
            photo = json.loads(raw)
            status, original, _ = verification.request(base=base, path=photo["url"])
            self.assertEqual(status, 200)
            output = Path(temporary)
            record = verification.run_case(case=case, base=base, output=output, photo=photo, original=original)
            self.assertEqual(record["status"], "identity")
            self.assertTrue(record["passed"])
            self.assertEqual(record["changedPixels"], 0)
            self.assertEqual((output / record["result"]).read_bytes(), original)
            np.testing.assert_array_equal(verification.png_pixels(data=(output / record["half"]).read_bytes()), self.source)
            self.assertTrue((output / record["receipt"]).is_file())

    def test_unexpected_http_failure_is_not_reported_as_expected_refusal(self):
        with tempfile.TemporaryDirectory(prefix="photo-control-error-") as temporary, \
             patch.object(verification, "request", return_value=(500, b'{"error":{"code":"failed"}}', {})):
            with self.assertRaisesRegex(ValueError, "HTTP request failed"):
                verification.run_case(case=self.case, base="http://127.0.0.1:1", output=Path(temporary),
                                      photo=self.photo, original=self.original)


class LegacyEqualityTests(unittest.TestCase):
    def setUp(self):
        self.png = png(pixels=np.full((48, 32, 4), 255, np.uint8))
        values = {"SlimWaist": 60}
        self.legacy = {"id": "vsx-26--legacy-waist", "sample": "vsx-26", "variant": "legacy-waist",
                       "passed": True, "request": {"values": values}, "status": "applied",
                       "appliedControls": ["SlimWaist"], "outputPngSha256": verification.digest(data=self.png)}
        self.extended = {**self.legacy, "id": "vsx-26--legacy-extra-zero", "variant": "legacy-extra-zero",
                         "request": {"values": {**values, **{name: 0 for name in EXTRA_RANGES}}}}

    def verify(self, *, extended_png=None):
        return verification.verify_legacy_pair(legacy=self.legacy, extended=self.extended,
            legacy_png=self.png, extended_png=self.png if extended_png is None else extended_png)

    def test_equal_verified_requests_produce_a_byte_identity_record(self):
        record = self.verify()
        self.assertTrue(record["passed"])
        self.assertTrue(record["pngBytesIdentical"])
        self.assertEqual(record["pngSha256"], verification.digest(data=self.png))

    def test_changed_bytes_cannot_pass_extra_zero_regression(self):
        changed = np.full((48, 32, 4), 255, np.uint8)
        changed[0, 0, 0] = 0
        with self.assertRaisesRegex(ValueError, "legacy output"):
            self.verify(extended_png=png(pixels=changed))

    def test_pair_must_have_same_verified_sample_and_only_zero_new_controls(self):
        original = deepcopy(self.extended)
        mutations = [{"sample": "vsx-03"}, {"passed": False}, {"status": "partial"},
                     {"variant": "combined"}, {"appliedControls": []},
                     {"outputPngSha256": "0" * 64},
                     {"request": {"values": {"SlimWaist": 60}}},
                     {"request": {"values": {**self.extended["request"]["values"], "BodySkinTone": 1}}}]
        for change in mutations:
            self.extended = {**deepcopy(original), **change}
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.verify()


class PhotoFixtureAndRunnerTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="photo-control-fixture-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.fixture = self.root / "fixture"
        (self.fixture / "inputs").mkdir(parents=True)
        cases, pins = [], {}
        for index, sample in enumerate(verification.SAMPLES):
            pixels = np.full((48, 32, 4), [90 + index, 80, 70, 255], np.uint8)
            data = png(pixels=pixels)
            (self.fixture / "inputs" / (sample + ".png")).write_bytes(data)
            pins[sample] = (verification.digest(data=data), verification.digest(data=pixels.tobytes()), 32, 48)
            cases.append({"id": sample + "--old-zero", "sample": sample, "values": {}, "expectedStatus": "identity"})
        manifest = json.dumps({"schemaVersion": 1, "cases": cases}).encode()
        (self.fixture / "cases.json").write_bytes(manifest)
        for context in (patch.dict(verification.SAMPLES, pins, clear=True),
                        patch.object(verification, "FIXTURE_SHA256", verification.digest(data=manifest))):
            context.start()
            self.addCleanup(context.stop)

    def test_old_fixture_loads_without_new_assets_or_modified_cases(self):
        before = (self.fixture / "cases.json").read_bytes()
        sources = verification.fixture_inputs(root=self.fixture)
        self.assertEqual(set(sources), set(verification.SAMPLES))
        self.assertEqual((self.fixture / "cases.json").read_bytes(), before)

    def test_sample_file_hash_and_manifest_identity_are_pinned(self):
        path = self.fixture / "inputs/vsx-26.png"
        path.write_bytes((self.fixture / "inputs/vsx-04.png").read_bytes())
        with self.assertRaisesRegex(ValueError, "sample identity"):
            verification.fixture_inputs(root=self.fixture)
        manifest = self.fixture / "cases.json"
        manifest.write_bytes(manifest.read_bytes() + b"\n")
        with self.assertRaisesRegex(ValueError, "manifest identity"):
            verification.fixture_inputs(root=self.fixture)

    def test_missing_oversized_or_symlink_sample_is_refused(self):
        path = self.fixture / "inputs/vsx-26.png"
        path.unlink()
        with self.assertRaisesRegex(ValueError, "bounded"):
            verification.fixture_inputs(root=self.fixture)
        with path.open("wb") as stream:
            stream.truncate(20 * 1024**2 + 1)
        with self.assertRaisesRegex(ValueError, "bounded"):
            verification.fixture_inputs(root=self.fixture)
        path.unlink()
        try:
            path.symlink_to(self.fixture / "inputs/vsx-04.png")
        except OSError:
            return
        with self.assertRaisesRegex(ValueError, "bounded"):
            verification.fixture_inputs(root=self.fixture)

    def test_output_must_be_fresh_and_outside_inputs_application_and_runtime(self):
        for output in (self.fixture, self.fixture / "new", verification.BODY_ROOT / "unsafe-new",
                       verification.BODY_ROOT.parent / "runtime/unsafe-new"):
            with self.subTest(output=output), self.assertRaisesRegex(ValueError, "fresh output"):
                verification.fresh_output(output=output, fixture_root=self.fixture)
        self.assertEqual(verification.fresh_output(output=self.root / "actual", fixture_root=self.fixture), self.root / "actual")

    def test_108_cases_have_bounded_ids_and_expected_gates_including_refusal(self):
        cases = verification.selected_cases()
        self.assertEqual(len(cases), 108)
        self.assertEqual(len({case["id"] for case in cases}), 108)
        for sample in verification.SAMPLES:
            selected = verification.photo_cases(sample=sample)
            self.assertEqual(len(selected), 18)
            positives = [case for case in selected if case["variant"].endswith("-positive")]
            self.assertEqual(len(positives), 9)
            self.assertEqual({name for case in positives for name in case["expectedAppliedControls"]}, verification.EXPECTED[sample])
            self.assertEqual(sum(case["variant"].endswith("-negative") for case in selected), 4)
            for case in selected:
                verification.VALIDATE_CONTROLS(controls=case["values"])
        rear = verification.photo_cases(sample="vsx-03")
        self.assertTrue(all(case["expectedStatus"] == "unavailable" for case in rear[1:16]))
        partial = next(case for case in verification.photo_cases(sample="vsx-18") if case["variant"] == "combined")
        self.assertEqual(partial["expectedStatus"], "partial")
        self.assertEqual(partial["expectedAppliedControls"], ["Abdomen"])

    def test_two_shards_keep_legacy_pairs_local_and_cover_every_case_once(self):
        shards = [verification.selected_cases(shard_index=index, shard_count=2) for index in range(2)]
        self.assertEqual([len(shard) for shard in shards], [54, 54])
        self.assertEqual(len({case["id"] for shard in shards for case in shard}), 108)
        for shard in shards:
            for sample in {case["sample"] for case in shard}:
                variants = {case["variant"] for case in shard if case["sample"] == sample}
                self.assertIn("legacy-waist", variants)
                self.assertIn("legacy-extra-zero", variants)
        for index, count in ((True, 2), (0, False), (-1, 2), (2, 2), (0, 7), (0, 0)):
            with self.subTest(index=index, count=count), self.assertRaises(ValueError):
                verification.selected_cases(shard_index=index, shard_count=count)

    def test_cli_arguments_forward_to_bounded_validation_and_exit_code(self):
        argv = ["--fixture-root", str(self.fixture), "--output", str(self.root / "actual"),
                "--shard-index", "1", "--shard-count", "2"]
        with patch.object(verification, "validate", return_value={"passed": False, "completed": 54}) as validate, \
             patch("builtins.print"):
            self.assertEqual(verification.main(argv=argv), 1)
        self.assertEqual(validate.call_args.kwargs["shard_index"], 1)
        self.assertEqual(validate.call_args.kwargs["shard_count"], 2)



if __name__ == "__main__":
    unittest.main()
