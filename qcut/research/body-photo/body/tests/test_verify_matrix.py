"""Matrix evidence and declared-boundary tests using an explicitly synthetic engine."""
import io
from contextlib import redirect_stdout
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from PIL import Image

from body.backend import BodyBackend, image_identity, sha256, write_json
from body.server import BodyHandler, BodyHTTPServer
from body import verify_matrix as matrix
from body import verify_photo
from body.control_contract import CONTROL_RANGES, LEG_CONTROLS, validate_controls
from body.photo_controls import extended_catalog


SOURCE_COMMIT = "7bd5ceacc996b924c25563f430651dd1046d6ce0"
NONZERO_CASES = len(matrix.CASES) - 2


class SyntheticEngine:
    def __init__(self):
        self.missing = set()
        self.fail = False

    def __call__(self, *, source, values, output, report):
        if self.fail:
            raise RuntimeError("explicit synthetic failure")
        with Image.open(source) as original:
            image = original.convert("RGBA")
        before = image_identity(image=image)
        parts = {name: {"moved": bool(value and name not in self.missing)} for name, value in values.items()}
        for index, part in enumerate(parts.values()):
            if part["moved"]:
                image.putpixel((index, 0), (255, 0, 0, 255))
        image.save(output, format="PNG")
        write_json(path=report, value={
            "inputRgbaSha256": before["rgbaSha256"], "outputRgbaSha256": image_identity(image=image)["rgbaSha256"],
            "inputPngSha256": sha256(data=source.read_bytes()), "outputPngSha256": sha256(data=output.read_bytes()),
            "controls": values, "parts": parts, "sourceAndAssetsUnchanged": True,
            "verification": {"verified": True, "sourceFiles": 107, "sourceCommit": SOURCE_COMMIT,
                "assets": 5, "assetBytes": 7431877}, "nativeGeometryUsed": False, "fixedLandmarks": False,
            "execution": {"independence": {"private_native_images": []}},
        })


class MatrixTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="body-matrix-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        app = self.root / "app"
        app.mkdir()
        write_json(path=app / "catalog.json", value={"sourceCommit": SOURCE_COMMIT,
            "controls": [{"name": name, "min": minimum, "max": maximum}
                         for name, (minimum, maximum) in CONTROL_RANGES.items()]})
        self.engine = SyntheticEngine()
        self.backend = BodyBackend(root=app, runner=self.engine, platform="darwin")
        self.server = BodyHTTPServer(address=("127.0.0.1", 0), backend=self.backend)
        self.thread = threading.Thread(target=lambda: self.server.serve_forever(poll_interval=.01), daemon=True)
        self.log_patch = patch.object(BodyHandler, "log_message", return_value=None)
        self.log_patch.start()
        self.addCleanup(self.log_patch.stop)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"
        self.image = self.root / "synthetic.png"
        Image.new("RGB", (32, 48), (90, 110, 120)).save(self.image)
        self.original = self.image.read_bytes()
        self.manifest = self.root / "manifest.json"
        self.output = self.root / "result"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)

    def entry(self, *, expectations=None):
        return {"id": "synthetic", "image": str(self.image), "label": "明确合成的测试fixture",
            "sourceKind": "synthetic-reference", "notes": "不冒充真人照片验收。",
            "provenance": {"generator": "Pillow solid RGB fixture"},
            "expectations": expectations if expectations is not None else {
                name: "applied" for name, values in matrix.CASE_VALUES.items() if any(values.values())}}

    def run_matrix(self, *, entry=None):
        write_json(path=self.manifest, value={"version": 1, "entries": [entry or self.entry()]})
        with redirect_stdout(io.StringIO()):
            return matrix.run_matrix(manifest_path=self.manifest, output=self.output, base=self.base)

    def test_full_declared_matrix_produces_verified_offline_assets(self):
        report = self.run_matrix()
        self.assertTrue(report["allChecksPassed"])
        self.assertEqual(report["exitCode"], 0)
        self.assertEqual(report["summary"]["renderRequestAttempts"], len(matrix.CASES))
        self.assertEqual(report["summary"]["actualStatuses"], {"identity": 2, "applied": NONZERO_CASES})
        self.assertEqual(report["summary"]["sourceKinds"], {"synthetic-reference": 1})
        self.assertTrue(report["entries"][0]["sourceFileUnchanged"])
        self.assertEqual(self.image.read_bytes(), self.original)
        self.assertEqual((self.output / "manifest.json").read_bytes(), self.manifest.read_bytes())
        self.assertEqual(matrix.digest(data=self.manifest.read_bytes()), report["manifestSha256"])
        self.assertFalse(report["nativeParityVerified"])
        for case in report["entries"][0]["cases"]:
            self.assertTrue(case["evidenceChecksPassed"])
            self.assertTrue((self.output / "synthetic" / case["resultFile"]).is_file())
            self.assertTrue((self.output / "synthetic" / case["halfFile"]).is_file())
            self.assertEqual(case["visualReview"], "not-reviewed")
        html = (self.output / "index.html").read_text(encoding="utf-8")
        self.assertEqual(html.count('<article class="case"'), len(matrix.CASES))
        self.assertEqual(html.count('type="range" min='), len(matrix.CASES))
        self.assertIn("合成人像样本", html)
        self.assertNotIn('src="http', html)

    def test_missing_expectations_are_observations_and_exit_two(self):
        report = self.run_matrix(entry=self.entry(expectations={}))
        self.assertFalse(report["allChecksPassed"])
        self.assertEqual(report["exitCode"], 2)
        self.assertEqual(report["summary"]["missingExpectations"], NONZERO_CASES)
        self.assertEqual(report["summary"]["verdicts"], {"passed": 2, "unverified": NONZERO_CASES})
        self.assertEqual(report["summary"]["evidenceChecksPassed"], len(matrix.CASES))
        self.assertIn("待人工确认，不计通过", (self.output / "index.html").read_text(encoding="utf-8"))

    def test_cpu_catalog_extension_keeps_only_legacy_matrix_cases(self):
        with patch.dict("os.environ", {"BODY_RENDER_BACKEND": "cpu"}):
            report = self.run_matrix()
        self.assertTrue(report["allChecksPassed"])
        self.assertEqual(len(report["catalog"]["controls"]), 21)
        self.assertEqual(report["summary"]["renderRequestAttempts"], len(matrix.CASES))
        for case in report["entries"][0]["cases"]:
            self.assertEqual(set(case["values"]), set(CONTROL_RANGES))
            self.assertTrue(case["evidenceChecksPassed"])

    def test_original_three_control_manifests_leave_all_added_cases_unverified(self):
        legacy_expectations = {name: "applied" for name in
            ("long-leg-100", "waist-100", "head-100", "combined-moderate", "combined-extreme")}
        report = self.run_matrix(entry=self.entry(expectations=legacy_expectations))
        self.assertFalse(report["allChecksPassed"])
        self.assertEqual(report["exitCode"], 2)
        self.assertEqual(report["summary"]["missingExpectations"], NONZERO_CASES - len(legacy_expectations))
        self.assertEqual(report["summary"]["verdicts"], {"passed": 7, "unverified": NONZERO_CASES - len(legacy_expectations)})
        unverified = {case["id"] for case in report["entries"][0]["cases"] if case["verdict"] == "unverified"}
        self.assertEqual(unverified, set(matrix.CASE_VALUES) - set(legacy_expectations) - {"zero-before", "zero-after"})
        self.assertEqual(report["summary"]["evidenceChecksPassed"], len(matrix.CASES))

    def test_previous_five_control_manifests_do_not_accept_new_cases_implicitly(self):
        previous = {name: "applied" for name in ("long-leg-100", "waist-100", "head-100", "body-100", "arm-100",
                    "combined-moderate", "combined-extreme", "combined-five-moderate", "combined-five-extreme")}
        report = self.run_matrix(entry=self.entry(expectations=previous))
        self.assertFalse(report["allChecksPassed"])
        self.assertEqual(report["exitCode"], 2)
        self.assertEqual(report["summary"]["verdicts"], {"passed": 11, "unverified": NONZERO_CASES - len(previous)})

    def test_ten_control_manifests_require_new_leg_case_expectations(self):
        added = {"thigh-narrow-50", "thigh-wide-50", "calf-narrow-50", "calf-wide-50",
                 "combined-legs-narrow", "combined-twelve-moderate"}
        previous = {name: "applied" for name, values in matrix.CASE_VALUES.items()
                    if any(values.values()) and name not in added}
        report = self.run_matrix(entry=self.entry(expectations=previous))
        self.assertEqual(report["exitCode"], 2)
        self.assertEqual(report["summary"]["verdicts"], {"passed": 22, "unverified": 6})
        self.assertEqual({case["id"] for case in report["entries"][0]["cases"]
                          if case["verdict"] == "unverified"}, added)

    def test_unavailable_cannot_pass_expected_success(self):
        self.engine.missing = set(matrix.CONTROL_PARTS)
        report = self.run_matrix()
        self.assertFalse(report["allChecksPassed"])
        self.assertEqual(report["exitCode"], 1)
        self.assertEqual(report["summary"]["actualStatuses"], {"identity": 2, "unavailable": NONZERO_CASES})
        self.assertEqual(report["summary"]["verdicts"], {"passed": 2, "failed": NONZERO_CASES})
        for case in report["entries"][0]["cases"][1:-1]:
            self.assertEqual(case["changedPixels"], 0)
            self.assertEqual(case["appliedControls"], [])
            self.assertTrue(case["evidenceChecksPassed"])

    def test_explicit_unavailable_is_recorded_as_boundary_not_beauty_success(self):
        self.engine.missing = set(matrix.CONTROL_PARTS)
        expected = {name: "unavailable" for name, values in matrix.CASE_VALUES.items() if any(values.values())}
        report = self.run_matrix(entry=self.entry(expectations=expected))
        self.assertTrue(report["allChecksPassed"])
        self.assertEqual(report["summary"]["verdicts"], {"passed": 2, "expected-unavailable": NONZERO_CASES})
        self.assertNotIn("applied", report["summary"]["actualStatuses"])
        self.assertIn("未应用，输出为原图", (self.output / "index.html").read_text(encoding="utf-8"))

    def test_partial_requires_the_declared_exact_subset_when_supplied(self):
        self.engine.missing = {"StretchLeg"}
        expected = {name: "applied" for name, values in matrix.CASE_VALUES.items() if any(values.values())}
        expected["long-leg-100"] = "unavailable"
        for name, values in matrix.CASE_VALUES.items():
            active = {key for key, value in values.items() if value}
            if "StretchLeg" in active and len(active) > 1:
                expected[name] = {"status": "partial", "appliedControls": sorted(active - {"StretchLeg"})}
        report = self.run_matrix(entry=self.entry(expectations=expected))
        self.assertTrue(report["allChecksPassed"])
        self.assertEqual(report["summary"]["verdicts"]["expected-partial"], 7)
        verdict, _ = matrix.expected_verdict(expectation=expected["combined-extreme"], status="partial", applied=["SmallHead"])
        self.assertEqual(verdict, "failed")

    def test_engine_errors_fail_and_later_zero_still_runs(self):
        self.engine.fail = True
        report = self.run_matrix()
        self.assertFalse(report["allChecksPassed"])
        self.assertEqual(report["exitCode"], 1)
        self.assertEqual(report["summary"]["actualStatuses"], {"identity": 2, "error": NONZERO_CASES})
        cases = report["entries"][0]["cases"]
        self.assertEqual(cases[-1]["status"], "identity")
        self.assertEqual(cases[1]["error"]["httpStatus"], 500)
        self.assertNotIn("resultFile", cases[1])

    def test_mismatched_download_is_never_presented_as_verified(self):
        original_request = matrix.request

        def corrupted_download(**kwargs):
            data, headers = original_request(**kwargs)
            if kwargs["route"].startswith("/api/download/"):
                return b"not a png", headers
            return data, headers

        with patch.object(matrix, "request", side_effect=corrupted_download):
            report = self.run_matrix()
        self.assertFalse(report["allChecksPassed"])
        self.assertEqual(report["summary"]["evidenceChecksPassed"], 0)
        self.assertNotIn('type="range" min=', (self.output / "index.html").read_text(encoding="utf-8"))

    def test_source_changed_on_server_fails_the_affected_case(self):
        original_request = matrix.request
        accesses = 0

        def changed_source(**kwargs):
            nonlocal accesses
            data, headers = original_request(**kwargs)
            if kwargs["route"].startswith("/api/photos/") and kwargs.get("body") is None:
                accesses += 1
                if accesses > 1:
                    return data + b"changed", headers
            return data, headers

        with patch.object(matrix, "request", side_effect=changed_source):
            report = self.run_matrix()
        self.assertFalse(report["allChecksPassed"])
        self.assertTrue(all("服务中的原图" in case["error"]["message"] for case in report["entries"][0]["cases"]))

    def test_html_escapes_untrusted_labels_notes_and_provenance(self):
        entry = self.entry()
        entry.update(label='<img src=x onerror="alert(1)">', notes='</script><script>alert(2)</script>',
                     provenance={"source": "<svg onload=alert(3)>"})
        report = self.run_matrix(entry=entry)
        self.assertTrue(report["allChecksPassed"])
        html = (self.output / "index.html").read_text(encoding="utf-8")
        self.assertNotIn('<img src=x onerror=', html)
        self.assertNotIn('</script><script>alert(2)', html)
        self.assertIn('&lt;img src=x', html)
        self.assertIn('&lt;svg onload=alert(3)&gt;', html)

    def test_http_routes_and_base_are_strictly_local(self):
        for base in ("https://127.0.0.1:5270", "http://evil.test:5270", "http://127.0.0.1:5270.evil.test",
                     "http://user@127.0.0.1:5270", "http://127.0.0.1:5270/path", "http://127.0.0.1:5270?x=y"):
            with self.subTest(base=base), self.assertRaises(ValueError):
                matrix.validate_base(base=base)
        self.assertEqual(matrix.validate_base(base=self.base + "/"), self.base)
        for route in ("https://evil.test/x.png", "/api/receipts/" + "a" * 32 + ".png", "/api/photos/../../x.png"):
            with self.subTest(route=route), self.assertRaises(ValueError):
                matrix.checked_route(route=route, category="photos")

    def test_manifest_boundary_errors_are_rejected_before_output(self):
        entry = self.entry()
        invalid = [
            {"version": True, "entries": [entry]},
            {"version": 1, "entries": []},
            {"version": 1, "entries": [entry, entry]},
            {"version": 1, "entries": [{**entry, "id": "../escape"}]},
            {"version": 1, "entries": [{**entry, "image": "relative.png"}]},
            {"version": 1, "entries": [{**entry, "expectations": {"typo": "applied"}}]},
            {"version": 1, "entries": [{**entry, "expectations": {"head-100": "identity"}}]},
            {"version": 1, "entries": [{**entry, "expectations": {"long-leg-100": "partial"}}]},
            {"version": 1, "entries": [{**entry, "expectations": {"zero-after": "applied"}}]},
            {"version": 1, "entries": [{**entry, "expectations": {"combined-extreme": {
                "status": "unavailable", "appliedControls": ["SmallHead"]}}}]},
        ]
        for value in invalid:
            write_json(path=self.manifest, value=value)
            with self.subTest(value=value), self.assertRaises(ValueError):
                matrix.run_matrix(manifest_path=self.manifest, output=self.output, base=self.base)
            self.assertFalse(self.output.exists())

    def test_existing_output_is_preserved(self):
        write_json(path=self.manifest, value={"version": 1, "entries": [self.entry()]})
        self.output.mkdir()
        marker = self.output / "keep.txt"
        marker.write_text("preserve", encoding="utf-8")
        with self.assertRaises(ValueError):
            matrix.run_matrix(manifest_path=self.manifest, output=self.output, base=self.base)
        self.assertEqual(marker.read_text(encoding="utf-8"), "preserve")

    def test_provenance_hash_mismatch_prevents_upload_and_render(self):
        entry = self.entry()
        entry["provenance"]["sha256"] = "0" * 64
        report = self.run_matrix(entry=entry)
        self.assertFalse(report["allChecksPassed"])
        self.assertEqual(report["summary"]["renderRequestAttempts"], 0)
        self.assertIn("SHA-256不一致", report["entries"][0]["errors"][0]["message"])


class CaseContractTests(unittest.TestCase):
    def test_catalog_accepts_exact_legacy_or_known_photo_extension(self):
        legacy = {"platform": {"supported": True}, "controls": [
            {"name": name, "min": minimum, "max": maximum}
            for name, (minimum, maximum) in CONTROL_RANGES.items()]}
        matrix.require_legacy_catalog(catalog=legacy)
        matrix.require_legacy_catalog(catalog=extended_catalog(catalog=legacy))

    def test_catalog_rejects_missing_duplicate_unknown_or_changed_controls(self):
        legacy = {"platform": {"supported": True}, "controls": [
            {"name": name, "min": minimum, "max": maximum}
            for name, (minimum, maximum) in CONTROL_RANGES.items()]}
        expanded = extended_catalog(catalog=legacy)
        invalid_controls = [
            legacy["controls"][1:],
            [*legacy["controls"], legacy["controls"][0]],
            [*legacy["controls"], {"name": "unknown", "min": 0, "max": 100}],
            expanded["controls"][:-1],
            [{**legacy["controls"][0], "min": -99}, *legacy["controls"][1:]],
            [{**legacy["controls"][0], "min": False}, *legacy["controls"][1:]],
            [{**expanded["controls"][0], "max": 99}, *expanded["controls"][1:]],
        ]
        for controls in invalid_controls:
            with self.subTest(controls=controls), self.assertRaises(ValueError):
                matrix.require_legacy_catalog(catalog={**legacy, "controls": controls})
        with self.assertRaises(ValueError):
            matrix.require_legacy_catalog(catalog={**legacy, "platform": {"supported": False}})

    def test_legacy_case_ids_keep_original_values_with_new_controls_zero(self):
        legacy = {
            "zero-before": {}, "long-leg-100": {"StretchLeg": 100}, "waist-100": {"SlimWaist": 100},
            "head-100": {"SmallHead": 100}, "combined-moderate": {"StretchLeg": 40, "SlimWaist": 40, "SmallHead": 30},
            "combined-extreme": {"StretchLeg": 100, "SlimWaist": 100, "SmallHead": 100}, "zero-after": {},
            "body-100": {"SlimBody": 100}, "arm-100": {"SlimArm": 100},
            "combined-five-moderate": {"StretchLeg": 40, "SlimWaist": 40, "SmallHead": 30, "SlimBody": 45, "SlimArm": 50},
            "combined-five-extreme": {"StretchLeg": 100, "SlimWaist": 100, "SmallHead": 100, "SlimBody": 100, "SlimArm": 100},
        }
        for name, active in legacy.items():
            with self.subTest(case=name):
                self.assertEqual(matrix.CASE_VALUES[name], {key: active.get(key, 0) for key in CONTROL_RANGES})
        self.assertEqual(matrix.CASES[0][0], "zero-before")
        self.assertEqual(matrix.CASES[-1][0], "zero-after")

    def test_signed_singles_and_ten_control_combinations_are_range_safe(self):
        expected = {
            "shoulder-narrow-50": {"ShoulderWidth": -50}, "shoulder-wide-50": {"ShoulderWidth": 50},
            "ortho-100": {"OrthoShoulder": 100}, "neck-100": {"SwanNeck": 100},
            "hip-narrow-50": {"HipWidth": -50}, "hip-wide-50": {"HipWidth": 50},
            "bust-small-50": {"BustSize": -50}, "bust-full-50": {"BustSize": 50},
            "combined-ten-moderate": {"StretchLeg": 40, "SlimWaist": 40, "SmallHead": 30, "SlimBody": 45, "SlimArm": 50,
                "ShoulderWidth": 10, "OrthoShoulder": 35, "SwanNeck": 40, "HipWidth": 10, "BustSize": 10},
            "combined-ten-negative": {"SlimBody": 30, "ShoulderWidth": -25, "OrthoShoulder": 50,
                "SwanNeck": 50, "HipWidth": -25, "BustSize": -25},
            "combined-ten-extreme": {name: bounds[1] for name, bounds in CONTROL_RANGES.items()
                                     if name not in LEG_CONTROLS},
            "thigh-narrow-50": {"ThighWidth": -50}, "thigh-wide-50": {"ThighWidth": 50},
            "calf-narrow-50": {"CalfWidth": -50}, "calf-wide-50": {"CalfWidth": 50},
            "combined-legs-narrow": {"ThighWidth": -50, "CalfWidth": -50},
            "combined-twelve-moderate": {"StretchLeg": 40, "SlimWaist": 40, "SmallHead": 30,
                "SlimBody": 45, "SlimArm": 50, "ShoulderWidth": 10, "OrthoShoulder": 35,
                "SwanNeck": 40, "HipWidth": 10, "BustSize": 10, "ThighWidth": -25, "CalfWidth": -25},
        }
        self.assertEqual(len(matrix.CASES), 28)
        self.assertEqual(len(set(name for name, _, _ in matrix.CASES)), len(matrix.CASES))
        for name, values in expected.items():
            with self.subTest(case=name):
                self.assertEqual(matrix.CASE_VALUES[name], matrix.canonical_values(values=values))
        for name, values in matrix.CASE_VALUES.items():
            if name not in {"thigh-narrow-50", "thigh-wide-50", "calf-narrow-50", "calf-wide-50",
                            "combined-legs-narrow", "combined-twelve-moderate"}:
                self.assertEqual({control: values[control] for control in LEG_CONTROLS}, dict.fromkeys(LEG_CONTROLS, 0))
        for name, _, values in matrix.CASES:
            with self.subTest(valid_case=name):
                self.assertEqual(validate_controls(controls=values), matrix.CASE_VALUES[name])

    def test_signed_requests_are_active_and_expectations_must_use_public_names(self):
        for case, control in (("shoulder-narrow-50", "ShoulderWidth"), ("hip-narrow-50", "HipWidth"),
                              ("bust-small-50", "BustSize"), ("thigh-narrow-50", "ThighWidth"), ("calf-narrow-50", "CalfWidth")):
            expectation = {"status": "applied", "appliedControls": [control]}
            self.assertEqual(matrix.validate_expectation(name=case, value=expectation), expectation)
            for invalid in ("identity", "partial", {"status": "applied", "appliedControls": []},
                            {"status": "applied", "appliedControls": ["SlimHip"]}):
                with self.subTest(case=case, invalid=invalid), self.assertRaises(ValueError):
                    matrix.validate_expectation(name=case, value=invalid)

    def test_one_photo_runner_covers_twelve_singles_without_changing_old_combos(self):
        cases = {name: values for name, values, _ in verify_photo.PHOTO_CASES}
        self.assertEqual(len(cases), 23)
        for name, values in cases.items():
            with self.subTest(case=name):
                validate_controls(controls=values)
        for name, identifier in verify_photo.SINGLE_CASE_IDS.items():
            self.assertEqual(cases[identifier], {name: CONTROL_RANGES[name][1]})
        self.assertEqual(cases["combined"], {"StretchLeg": 100, "SlimWaist": 80, "SmallHead": 60})
        self.assertEqual(cases["combined-five"], {"StretchLeg": 60, "SlimWaist": 60, "SmallHead": 60, "SlimBody": 60, "SlimArm": 60})
        self.assertEqual(cases["shoulder-narrow-50"], {"ShoulderWidth": -50})
        self.assertEqual(cases["hip-narrow-50"], {"HipWidth": -50})
        self.assertEqual(cases["bust-small-50"], {"BustSize": -50})
        self.assertEqual(cases["thigh-narrow-50"], {"ThighWidth": -50})
        self.assertEqual(cases["calf-narrow-50"], {"CalfWidth": -50})
        self.assertEqual(cases["combined-ten-moderate"], {"StretchLeg": 40, "SlimWaist": 40, "SmallHead": 30,
            "SlimBody": 45, "SlimArm": 50, "ShoulderWidth": 10, "OrthoShoulder": 35,
            "SwanNeck": 40, "HipWidth": 10, "BustSize": 10})
        self.assertEqual(cases["combined-twelve-moderate"], {
            **cases["combined-ten-moderate"], "ThighWidth": -25, "CalfWidth": -25})
        self.assertEqual(verify_photo.PHOTO_CASES[0], ("zero-before", {}, "identity"))
        self.assertEqual(verify_photo.PHOTO_CASES[-1], ("zero-after", {}, "identity"))


class EvidenceTests(unittest.TestCase):
    def evidence(self, *, control="StretchLeg", strength=None):
        original = Image.new("RGBA", (32, 48), (90, 110, 120, 255))
        output = original.copy()
        output.putpixel((0, 0), (255, 0, 0, 255))
        before, after = io.BytesIO(), io.BytesIO()
        original.save(before, format="PNG")
        output.save(after, format="PNG")
        source_png, result_png = before.getvalue(), after.getvalue()
        source_id, result_id = image_identity(image=original), image_identity(image=output)
        photo = {"photoId": "a" * 32, "url": "/api/photos/" + "a" * 32 + ".png", **source_id,
                 "pngSha256": sha256(data=source_png)}
        values = matrix.canonical_values(values={control: CONTROL_RANGES[control][1] if strength is None else strength})
        parts = {name: {"moved": bool(value), "intensity": None if name == "SlimArm" else value / 100}
                 for name, value in values.items()}
        response = {"photoId": photo["photoId"], "values": values, "status": "applied",
            "source": {"url": photo["url"], "width": 32, "height": 48},
            "result": {**result_id, "pngSha256": sha256(data=result_png)},
            "controls": {name: {"requested": value, "applied": bool(value)} for name, value in values.items()}}
        receipt = {"inputRgbaSha256": source_id["rgbaSha256"], "outputRgbaSha256": result_id["rgbaSha256"],
            "inputPngSha256": sha256(data=source_png), "outputPngSha256": sha256(data=result_png),
            "controls": values, "parts": parts, "sourceAndAssetsUnchanged": True,
            "verification": {"verified": True, "sourceCommit": SOURCE_COMMIT, "assets": 5,
                             "assetBytes": 7431877, "sourceFiles": 107},
            "nativeGeometryUsed": False, "fixedLandmarks": False, "independence": {"private_native_images": []}}
        return {"response": response, "receipt": receipt, "source_png": source_png, "result_png": result_png,
            "displayed_png": result_png, "headers": {"Content-Disposition": "attachment; filename=result.png"},
            "photo": photo, "values": values, "source_commit": SOURCE_COMMIT}

    def test_valid_changed_result_has_one_pixel_and_one_verified_part(self):
        output, evidence = matrix.verify_evidence(**self.evidence())
        self.assertEqual(evidence["changedPixels"], 1)
        self.assertEqual(evidence["appliedControls"], ["StretchLeg"])
        self.assertEqual(output.shape, (48, 32, 4))

    def cpu_evidence(self):
        value = self.evidence(control="SlimWaist")
        value["receipt"].update(backend="portable-CPU", verification={
            "verified": True, "backend": "portable-CPU", "sourceFiles": 107, "sourceCommit": SOURCE_COMMIT,
            "sourceManifestSha256": "e3441a1525a4091023437fedf06e8b15302edd6d8787f6ac4b096a06716008aa",
            "faceFiles": 4, "skeletonNpzRequired": False, "publicControls": list(CONTROL_RANGES),
            "skeleton": {"files": 26, "bytes": 56461752,
                "manifestSha256": "52270f5a2dd931b6c28bf5f0b77f0757d7c198cfee06ae21e7848dec0aaac2bb",
                "onnxruntime": "1.22.1", "nativeRuntimeLoaded": False, "inferencePerformed": False},
            "personMask": {"bytes": 6163938,
                "sha256": "552d8a984054e59b5d773d24b9b12022b22046ceb2bbc4c9aaeaceb36a9ddf24"}})
        return value

    def test_actual_cpu_receipt_shape_accepts_legacy_and_expanded_catalog_without_inference(self):
        for names in (list(CONTROL_RANGES), list(CONTROL_RANGES) + list(matrix.EXTRA_RANGES)):
            value = self.cpu_evidence()
            value["receipt"]["verification"]["publicControls"] = names
            with self.subTest(control_count=len(names)), patch.dict("sys.modules", {"onnxruntime": None}):
                _, evidence = matrix.verify_evidence(**value)
                self.assertEqual(evidence["changedPixels"], 1)
                self.assertEqual(evidence["appliedControls"], ["SlimWaist"])

    def test_cpu_rejects_missing_tampered_or_mistyped_model_and_source_evidence(self):
        mutations = [("sourceFiles", 108), ("sourceFiles", 107.0), ("sourceCommit", "0" * 40),
            ("sourceManifestSha256", "0" * 64), ("faceFiles", 3), ("faceFiles", 4.0),
            ("skeletonNpzRequired", True), ("backend", "macOS-Metal"),
            ("skeleton", None), ("personMask", []), ("publicControls", [*CONTROL_RANGES, "unknown"]),
            ("publicControls", [*CONTROL_RANGES, "SlimWaist"]),
            ("skeleton.files", 25), ("skeleton.bytes", 1), ("skeleton.manifestSha256", "0" * 64),
            ("skeleton.onnxruntime", "unknown"), ("skeleton.nativeRuntimeLoaded", True),
            ("personMask.bytes", 1), ("personMask.sha256", "0" * 64)]
        for path, replacement in mutations:
            for remove in (False, True):
                value = self.cpu_evidence()
                fields = path.split(".")
                target = value["receipt"]["verification"]
                for field in fields[:-1]:
                    target = target[field]
                if remove:
                    target.pop(fields[-1])
                else:
                    target[fields[-1]] = replacement
                with self.subTest(field=path, missing=remove), self.assertRaises(ValueError):
                    matrix.verify_evidence(**value)

    def test_cpu_source_cannot_be_replaced_by_a_matching_unpinned_catalog(self):
        value = self.cpu_evidence()
        value["source_commit"] = value["receipt"]["verification"]["sourceCommit"] = "0" * 40
        with self.assertRaisesRegex(ValueError, "固定引擎"):
            matrix.verify_evidence(**value)

    def test_cpu_cannot_fall_back_to_forged_legacy_model_counts(self):
        value = self.cpu_evidence()
        value["receipt"].pop("backend")
        value["receipt"]["verification"].update(assets=5, assetBytes=7431877)
        with self.assertRaisesRegex(ValueError, "Metal"):
            matrix.verify_evidence(**value)

    def test_new_controls_verify_actual_movement_with_nullable_arm_intensity(self):
        for name in ("SlimBody", "SlimArm", "ShoulderWidth", "OrthoShoulder", "SwanNeck", "HipWidth", "BustSize", *LEG_CONTROLS):
            value = self.evidence(control=name)
            with self.subTest(control=name):
                _, evidence = matrix.verify_evidence(**value)
                self.assertEqual(evidence["appliedControls"], [name])
                self.assertEqual(evidence["changedPixels"], 1)
                if name == "SlimArm":
                    self.assertIsNone(value["receipt"]["parts"][name]["intensity"])

    def test_new_controls_cannot_claim_application_without_true_movement_evidence(self):
        for name in ("SlimBody", "SlimArm", "ShoulderWidth", "OrthoShoulder", "SwanNeck", "HipWidth", "BustSize", *LEG_CONTROLS):
            for claimed_movement in (False, None, "true", 1):
                value = self.evidence(control=name)
                value["receipt"]["parts"][name]["moved"] = claimed_movement
                with self.subTest(control=name, moved=claimed_movement), self.assertRaisesRegex(ValueError, name):
                    matrix.verify_evidence(**value)

    def test_negative_strength_requires_the_same_signed_request_and_true_part_evidence(self):
        for control in ("ShoulderWidth", "HipWidth", "BustSize", *LEG_CONTROLS):
            value = self.evidence(control=control, strength=-50)
            _, evidence = matrix.verify_evidence(**value)
            self.assertEqual(evidence["appliedControls"], [control])
            value["receipt"]["controls"] = {**value["receipt"]["controls"], control: 50}
            with self.subTest(control=control), self.assertRaisesRegex(ValueError, "收据"):
                matrix.verify_evidence(**value)

    def test_hash_and_receipt_failures_are_rejected(self):
        for target, field in (("response", "rgbaSha256"), ("response", "pngSha256"),
                              ("receipt", "inputRgbaSha256"), ("receipt", "outputPngSha256")):
            value = self.evidence()
            item = value["response"]["result"] if target == "response" else value["receipt"]
            item[field] = "0" * 64
            with self.subTest(target=target, field=field), self.assertRaises(ValueError):
                matrix.verify_evidence(**value)

    def test_alpha_dimensions_and_attachment_are_checked(self):
        for mode in ("alpha", "dimensions", "attachment"):
            value = self.evidence()
            if mode == "attachment":
                value["headers"] = {}
            else:
                output = Image.new("RGBA", (32, 49 if mode == "dimensions" else 48), (90, 110, 120, 0 if mode == "alpha" else 255))
                buffer = io.BytesIO()
                output.save(buffer, format="PNG")
                value["result_png"] = value["displayed_png"] = buffer.getvalue()
            with self.subTest(mode=mode), self.assertRaises(ValueError):
                matrix.verify_evidence(**value)

    def test_false_part_claims_missing_models_or_foreign_libraries_fail(self):
        for mode in ("part", "models", "library", "status", "photo", "values"):
            value = self.evidence()
            if mode == "part":
                value["receipt"]["parts"]["StretchLeg"]["moved"] = False
            if mode == "models":
                value["receipt"]["verification"] = {}
            if mode == "library":
                value["receipt"]["independence"]["private_native_images"] = ["liblens.dylib"]
            if mode == "status":
                value["response"]["status"] = "unavailable"
            if mode == "photo":
                value["response"]["photoId"] = "b" * 32
            if mode == "values":
                value["response"]["values"] = matrix.canonical_values(values={"StretchLeg": 50})
            with self.subTest(mode=mode), self.assertRaises(ValueError):
                matrix.verify_evidence(**value)


if __name__ == "__main__":
    unittest.main()
