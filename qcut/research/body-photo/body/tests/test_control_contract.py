"""The product catalog and strict public control transport stay in agreement."""
import json
from pathlib import Path
import unittest

from body.control_contract import (
    CONTROL_PARTS, CONTROL_RANGES, LEG_CONTROLS, PUBLIC_CONTROLS, to_engine_controls, validate_controls,
)


class ControlContractTests(unittest.TestCase):
    def test_catalog_describes_exactly_the_supported_transport(self):
        path = Path(__file__).resolve().parents[1] / "catalog.json"
        controls = json.loads(path.read_text(encoding="utf-8"))["controls"]
        self.assertEqual([control["name"] for control in controls], list(PUBLIC_CONTROLS))
        self.assertEqual(CONTROL_PARTS["StretchLeg"], "LongLeg")
        for control in controls:
            minimum, maximum = CONTROL_RANGES[control["name"]]
            self.assertEqual((control["min"], control["max"], control["default"], control["step"]),
                             (minimum, maximum, 0, 1))
            self.assertTrue(control["title"].strip())

    def test_legacy_requests_leave_all_new_controls_disabled(self):
        legacy = {"StretchLeg": 60, "SlimWaist": 40, "SmallHead": 20, "SlimBody": 30, "SlimArm": 70}
        values = validate_controls(controls=legacy)
        self.assertEqual(values, {name: legacy.get(name, 0) for name in PUBLIC_CONTROLS})
        self.assertEqual({name: value for name, value in values.items() if value}, legacy)

    def test_new_controls_transport_separately_and_together(self):
        for controls in ({"SlimBody": 100}, {"SlimArm": 100}, {"SlimBody": 35, "SlimArm": 80}):
            with self.subTest(controls=controls):
                values = validate_controls(controls=controls)
                self.assertEqual(set(values), set(PUBLIC_CONTROLS))
                self.assertEqual({name: value for name, value in values.items() if value}, controls)
        self.assertEqual(validate_controls(controls={}), dict.fromkeys(PUBLIC_CONTROLS, 0))

    def test_invalid_new_control_values_do_not_coerce_into_valid_requests(self):
        for name in PUBLIC_CONTROLS:
            minimum, maximum = CONTROL_RANGES[name]
            for value in (minimum - 1, maximum + 1, True, False, 1.0, float("nan"), float("inf"), "50", None, [], {}):
                with self.subTest(name=name, value=value), self.assertRaises(ValueError):
                    validate_controls(controls={name: value})

    def test_signed_aliases_have_explicit_ranges_and_engine_names(self):
        expected = {"ShoulderWidth": ("WidenShoulderTest", "WidenShoulder"),
                    "HipWidth": ("SlimHip", "SlimHip"), "BustSize": ("SlimBreast", "SlimBreast")}
        for name, (engine_name, part) in expected.items():
            self.assertEqual(CONTROL_RANGES[name], (-50, 50))
            self.assertEqual(CONTROL_PARTS[name], part)
            for value in (-50, 0, 50):
                with self.subTest(name=name, value=value):
                    controls = validate_controls(controls={name: value})
                    translated = to_engine_controls(controls=controls)
                    self.assertEqual(translated[engine_name], value)
                    self.assertNotIn(name, translated)
                    self.assertEqual({key: amount for key, amount in translated.items() if amount},
                                     {engine_name: value} if value else {})

    def test_raise_shoulder_and_swan_neck_keep_unipolar_ranges(self):
        for name in ("OrthoShoulder", "SwanNeck"):
            self.assertEqual(CONTROL_RANGES[name], (0, 100))
            for value in (0, 100):
                self.assertEqual(validate_controls(controls={name: value})[name], value)

    def test_owned_leg_controls_keep_signed_values_out_of_the_pinned_engine(self):
        self.assertEqual(LEG_CONTROLS, ("ThighWidth", "CalfWidth"))
        engine_names = set(to_engine_controls(controls={}))
        self.assertEqual(len(engine_names), 10)
        for name in LEG_CONTROLS:
            self.assertEqual(CONTROL_RANGES[name], (-50, 50))
            self.assertEqual(CONTROL_PARTS[name], name)
            for value in (-50, 0, 50):
                with self.subTest(name=name, value=value):
                    values = validate_controls(controls={name: value, "SlimWaist": 40})
                    self.assertEqual(values[name], value)
                    translated = to_engine_controls(controls=values)
                    self.assertEqual(set(translated), engine_names)
                    self.assertFalse(set(translated) & set(LEG_CONTROLS))
                    self.assertEqual({key: amount for key, amount in translated.items() if amount},
                                     {"SlimWaist": 40})

    def test_leg_controls_are_independent_and_rejected_before_engine_translation(self):
        values = validate_controls(controls={"ThighWidth": -50, "CalfWidth": 50})
        self.assertEqual(values, {name: {"ThighWidth": -50, "CalfWidth": 50}.get(name, 0)
                                  for name in PUBLIC_CONTROLS})
        for value in (-51, 51, True, "-50", 0.0):
            with self.subTest(value=value), self.assertRaises(ValueError):
                to_engine_controls(controls={"ThighWidth": value})

    def test_unknown_or_non_object_requests_are_rejected(self):
        for value in ({"WidenShoulderTest": 25}, {"WidenShoulder": 25}, {"SlimHip": 25}, {"SlimBreast": 25},
                      {"SlimArm": 25, "arbitrary": 0}, [], None, 100):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_controls(controls=value)


if __name__ == "__main__":
    unittest.main()
