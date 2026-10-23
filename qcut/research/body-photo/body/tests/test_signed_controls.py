"""Signed public body controls retain direction and require actual part evidence."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

from body.backend import AppError, BodyBackend
from body.control_contract import CONTROL_RANGES, PUBLIC_CONTROLS
from body.tests.test_backend import FakeEngine, picture

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import render


SIGNED_ALIASES = {"ShoulderWidth": ("WidenShoulderTest", "WidenShoulder"),
                  "HipWidth": ("SlimHip", "SlimHip"), "BustSize": ("SlimBreast", "SlimBreast")}
NEW_CONTROLS = (*SIGNED_ALIASES, "OrthoShoulder", "SwanNeck")


class SignedBackendTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="body-signed-contract-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.engine = FakeEngine()
        self.backend = BodyBackend(root=self.root, runner=self.engine, platform="darwin")
        self.addCleanup(self.backend.close)
        self.photo = self.backend.import_photo(data=picture())

    def request(self, *, values):
        return self.backend.render(request={"photoId": self.photo["photoId"], "values": values})

    def assert_no_output(self):
        for category in ("renders", "receipts"):
            self.assertEqual(list((self.backend.state / category).iterdir()), [])
        self.assertFalse(self.backend.render_lock.locked())

    def test_each_signed_limit_reaches_the_runner_with_its_original_sign(self):
        for name in SIGNED_ALIASES:
            for value in (-50, 50):
                with self.subTest(name=name, value=value):
                    response = self.request(values={name: value})
                    expected = {control: value if control == name else 0 for control in PUBLIC_CONTROLS}
                    self.assertEqual(self.engine.calls[-1]["values"], expected)
                    self.assertEqual(response["values"], expected)
                    self.assertEqual(response["status"], "applied")
                    self.assertEqual(response["controls"][name]["requested"], value)
                    self.assertTrue(response["controls"][name]["applied"])
                    self.assertEqual(sum(item["applied"] for item in response["controls"].values()), 1)
        self.assertEqual(len({call["source"] for call in self.engine.calls}), 1)

    def test_mixed_signed_and_unipolar_combo_reports_each_missing_part(self):
        values = {"StretchLeg": 60, "ShoulderWidth": -50, "HipWidth": 50,
                  "BustSize": -50, "OrthoShoulder": 100, "SwanNeck": 100}
        self.backend.runner = FakeEngine(missing=("HipWidth", "SwanNeck"))
        result = self.request(values=values)
        self.assertEqual(result["status"], "partial")
        actual = {name for name, state in result["controls"].items() if state["applied"]}
        self.assertEqual(actual, {"StretchLeg", "ShoulderWidth", "BustSize", "OrthoShoulder"})
        for name in values:
            self.assertEqual(result["controls"][name]["requested"], values[name])

    def test_new_part_claims_are_rejected_when_changed_pixels_lack_requested_movement(self):
        source, _ = self.backend.photo(identifier=self.photo["photoId"])
        original = source.read_bytes()
        for name in NEW_CONTROLS:
            self.backend.runner = FakeEngine(missing=(name,))
            with self.subTest(name=name), self.assertRaises(AppError) as error:
                self.request(values={name: -50 if name in SIGNED_ALIASES else 100})
            self.assertEqual((error.exception.code, error.exception.status), ("invalid_render", 502))
            self.assert_no_output()
            self.assertEqual(source.read_bytes(), original)

    def test_claimed_movement_with_identity_pixels_is_still_unavailable(self):
        engine = FakeEngine(fault="no-person")

        def claim_movement(**arguments):
            engine(**arguments)
            path = arguments["report"]
            receipt = json.loads(path.read_text(encoding="utf-8"))
            receipt["parts"] = {name: {"moved": True} for name in NEW_CONTROLS}
            path.write_text(json.dumps(receipt), encoding="utf-8")

        self.backend.runner = claim_movement
        result = self.request(values={"ShoulderWidth": -50, "OrthoShoulder": 100,
                                      "SwanNeck": 100, "HipWidth": 50, "BustSize": -50})
        self.assertEqual(result["status"], "unavailable")
        self.assertFalse(any(state["applied"] for state in result["controls"].values()))
        self.assertEqual(result["result"]["rgbaSha256"], self.photo["rgbaSha256"])

    def test_all_new_zeroes_keep_the_legacy_output_and_original_exact(self):
        legacy = {"StretchLeg": 50, "SlimWaist": 40, "SmallHead": 30, "SlimBody": 20, "SlimArm": 10}
        first = self.request(values=legacy)
        second = self.request(values={**legacy, **dict.fromkeys(NEW_CONTROLS, 0)})
        outputs = [self.backend.stored_file(category="renders", identifier=value["renderId"]).read_bytes()
                   for value in (first, second)]
        self.assertEqual(outputs[0], outputs[1])
        self.assertEqual(self.engine.calls[0], self.engine.calls[1])
        zero = self.request(values=dict.fromkeys(PUBLIC_CONTROLS, 0))
        self.assertEqual(zero["status"], "identity")
        self.assertEqual(len(self.engine.calls), 2)
        source, _ = self.backend.photo(identifier=self.photo["photoId"])
        self.assertEqual(self.backend.stored_file(category="renders", identifier=zero["renderId"]).read_bytes(),
                         source.read_bytes())

    def test_internal_engine_names_never_enter_the_public_runner(self):
        for name in ("WidenShoulderTest", "WidenShoulder", "SlimHip", "SlimBreast"):
            with self.subTest(name=name), self.assertRaises(AppError) as error:
                self.request(values={name: 20})
            self.assertEqual((error.exception.code, error.exception.status), ("invalid_request", 400))
        self.assertEqual(self.engine.calls, [])
        self.assert_no_output()

    def test_new_ranges_and_types_fail_before_the_engine_runs(self):
        for name in NEW_CONTROLS:
            minimum, maximum = CONTROL_RANGES[name]
            invalid = (minimum - 1, maximum + 1, True, False, 1.0, "0", None, float("nan"), float("inf"), [], {})
            for value in invalid:
                with self.subTest(name=name, value=value), self.assertRaises(AppError) as error:
                    self.request(values={name: value})
                self.assertEqual((error.exception.code, error.exception.status), ("invalid_request", 400))
        self.assertEqual(self.engine.calls, [])
        self.assert_no_output()


class ModelFreeAliasRendererTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="body-render-alias-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.body_root = self.root / "app"
        self.source = self.root / "source.png"
        Image.new("RGBA", (32, 48), (120, 80, 40, 255)).save(self.source)
        self.observed = []
        self.engine_parts = {}
        self.change = True

        def run(*, rgba, controls, runtime, output, report):
            self.observed.append(dict(controls))
            result = rgba.copy()
            if self.change:
                result[2, 3, 0] ^= 1
            Image.fromarray(result).save(output)
            receipt = {"inputRgbaSha256": hashlib.sha256(rgba.tobytes()).hexdigest(),
                       "outputRgbaSha256": hashlib.sha256(result.tobytes()).hexdigest(),
                       "changedPixels": int(self.change), "controls": controls, "parts": self.engine_parts,
                       "nativeGeometryUsed": False, "fixedLandmarks": False,
                       "independence": {"private_native_images": []}}
            report.write_text(json.dumps(receipt), encoding="utf-8")
            return receipt

        engine = SimpleNamespace(__file__=str(self.body_root / "engine/research/body_smart_render.py"), run=run)
        self.addCleanup(patch.stopall)
        patch.dict(sys.modules, {"body_smart_render": engine}).start()
        patch.object(render, "verify_installation", return_value={"platformSupported": True}).start()
        patch.object(render, "select_backend", return_value="metal").start()

    def render(self, *, controls, name):
        return render.render_image(image=self.source, controls=controls, output=self.root / f"{name}.png",
                                   report=self.root / f"{name}.json", body_root=self.body_root)

    def test_signed_alias_values_and_internal_parts_translate_without_leaking_public_names(self):
        for public, (engine_name, part) in SIGNED_ALIASES.items():
            for value in (-50, 50):
                self.engine_parts = {part: {"moved": True, "intensity": value / 100}}
                with self.subTest(public=public, value=value):
                    receipt = self.render(controls={public: value}, name=f"{public}-{value}")
                    self.assertEqual(self.observed[-1][engine_name], value)
                    self.assertNotIn(public, self.observed[-1])
                    self.assertEqual({key: amount for key, amount in self.observed[-1].items() if amount},
                                     {engine_name: value})
                    self.assertEqual(set(receipt["controls"]), set(PUBLIC_CONTROLS))
                    self.assertEqual(receipt["controls"][public], value)
                    self.assertEqual(set(receipt["parts"]), set(PUBLIC_CONTROLS))
                    self.assertEqual(receipt["parts"][public], self.engine_parts[part])
                    self.assertEqual(receipt["execution"]["controls"][engine_name], value)
                    self.assertEqual(receipt["execution"]["parts"], self.engine_parts)

    def test_ten_control_combo_preserves_mixed_signs_and_all_part_identities(self):
        values = {"StretchLeg": 20, "SlimWaist": 30, "SmallHead": 40, "SlimBody": 50, "SlimArm": 60,
                  "ShoulderWidth": -50, "OrthoShoulder": 70, "SwanNeck": 80, "HipWidth": 50, "BustSize": -50}
        part_names = {"StretchLeg": "LongLeg", **{name: name for name in PUBLIC_CONTROLS[1:]},
                      **{name: part for name, (_, part) in SIGNED_ALIASES.items()}}
        self.engine_parts = {part_names[name]: {"moved": True, "intensity": value / 100}
                             for name, value in values.items()}
        receipt = self.render(controls=values, name="all-ten")
        expected = {SIGNED_ALIASES.get(name, (name,))[0]: value for name, value in values.items()}
        self.assertEqual(self.observed, [expected])
        self.assertEqual(receipt["controls"], {name: values.get(name, 0) for name in PUBLIC_CONTROLS})
        for name in PUBLIC_CONTROLS:
            self.assertEqual(receipt["parts"][name], self.engine_parts.get(part_names[name],
                             {"intensity": 0.0, "moved": False}))

    def test_unavailable_new_parts_do_not_inherit_another_parts_movement(self):
        self.engine_parts = {"LongLeg": {"moved": True, "intensity": .5}}
        receipt = self.render(controls={"StretchLeg": 50, "ShoulderWidth": -50, "HipWidth": 50,
                                        "BustSize": -50, "OrthoShoulder": 100, "SwanNeck": 100}, name="missing")
        self.assertTrue(receipt["parts"]["StretchLeg"]["moved"])
        for name in NEW_CONTROLS:
            self.assertIs(receipt["parts"][name]["moved"], False)

    def test_all_zero_aliases_are_pixel_identity_with_all_engine_keys_present(self):
        self.change = False
        receipt = self.render(controls={}, name="zero")
        expected_keys = {"StretchLeg", "SlimWaist", "SmallHead", "SlimBody", "SlimArm",
                         "WidenShoulderTest", "OrthoShoulder", "SwanNeck", "SlimHip", "SlimBreast"}
        self.assertEqual(self.observed, [dict.fromkeys(expected_keys, 0)])
        self.assertEqual(receipt["actualEffectStatus"], "identity")
        self.assertEqual(receipt["changedPixels"], 0)
        self.assertEqual(receipt["inputRgbaSha256"], receipt["outputRgbaSha256"])
        with Image.open(self.root / "zero.png") as result, Image.open(self.source) as source:
            np.testing.assert_array_equal(np.asarray(result), np.asarray(source))


if __name__ == "__main__":
    unittest.main()
