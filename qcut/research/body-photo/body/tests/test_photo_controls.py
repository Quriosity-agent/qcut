"""Extra photo controls cannot change or bypass the original Metal contract."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from body.backend import BodyBackend, AppError
from body.control_contract import PUBLIC_CONTROLS, validate_controls
from body.photo_controls import (
    EXTRA_RANGES, control_parts, extended_catalog, legacy_controls, validate_photo_controls,
)


class PhotoControlContractTests(unittest.TestCase):
    def test_legacy_transport_retains_exact_key_set_and_values(self):
        for values in ({}, {"SlimWaist": 60}, {"CalfWidth": -50}):
            self.assertEqual(validate_photo_controls(controls=values, extended=True),
                             validate_controls(controls=values))

    def test_extra_request_retains_both_contracts_and_exact_part_identity(self):
        values = validate_photo_controls(controls={"Abdomen": 70, "BodySkinTone": -25}, extended=True)
        self.assertEqual(set(values), set(PUBLIC_CONTROLS) | EXTRA_RANGES.keys())
        self.assertEqual(values["Abdomen"], 70)
        self.assertEqual(values["BodySkinTone"], -25)
        self.assertEqual(legacy_controls(values=values), dict.fromkeys(PUBLIC_CONTROLS, 0))
        self.assertEqual(control_parts(values=values)["Abdomen"], "Abdomen")
        self.assertEqual(control_parts(values=values)["StretchLeg"], "LongLeg")

    def test_extra_names_are_rejected_by_the_original_contract_even_at_zero(self):
        for name in EXTRA_RANGES:
            with self.subTest(name=name), self.assertRaises(ValueError):
                validate_photo_controls(controls={name: 0}, extended=False)

    def test_extended_values_are_strict_and_unknown_controls_still_fail(self):
        for name, (minimum, maximum) in EXTRA_RANGES.items():
            for value in (minimum - 1, maximum + 1, True, False, 1.0, "20", None, float("nan")):
                with self.subTest(name=name, value=value), self.assertRaises(ValueError):
                    validate_photo_controls(controls={name: value}, extended=True)
        for controls in ({"Abdomen": 20, "BodySkinUnknown": 0}, [], None):
            with self.subTest(controls=controls), self.assertRaises(ValueError):
                validate_photo_controls(controls=controls, extended=True)

    def test_cpu_catalog_is_expanded_without_mutating_the_legacy_catalog(self):
        path = Path(__file__).resolve().parents[1] / "catalog.json"
        catalog = json.loads(path.read_text(encoding="utf-8"))
        before = json.dumps(catalog, sort_keys=True)
        expanded = extended_catalog(catalog=catalog)
        self.assertEqual(len(expanded["controls"]), 21)
        self.assertEqual(json.dumps(catalog, sort_keys=True), before)
        groups = {group["id"] for group in expanded["groups"]}
        self.assertTrue(all(item["group"] in groups for item in expanded["controls"]))
        for item in expanded["controls"]:
            self.assertEqual((item["default"], item["step"]), (0, 1))
            self.assertLess(item["min"], item["max"])

    def test_backend_exposes_extra_controls_only_for_explicit_cpu_or_cpu_platform(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as temporary:
            backend = BodyBackend(root=root, platform="darwin", state=Path(temporary))
            with patch.dict("os.environ", {"BODY_RENDER_BACKEND": "metal"}):
                self.assertEqual(len(backend.catalog()["controls"]), 12)
                with self.assertRaises(AppError):
                    backend.render(request={"photoId": "0" * 32, "values": {"Abdomen": 40}})
            with patch.dict("os.environ", {"BODY_RENDER_BACKEND": "cpu"}):
                self.assertEqual(len(backend.catalog()["controls"]), 21)
            backend.close()


if __name__ == "__main__":
    unittest.main()
