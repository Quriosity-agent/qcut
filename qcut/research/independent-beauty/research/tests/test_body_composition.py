"""Ten-part composition on synthetic perception; no models or person fixtures."""

import hashlib
import math
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from body_composition.controls import BODY_ORDER, internal_targets
from body_composition.inputs import resolve_targets, validate_inputs


def synthetic_inputs():
    coords = np.array(
        [
            [0.5, 0.83],
            [0.5, 0.75],
            [0.4, 0.74],
            [0.34, 0.6],
            [0.32, 0.45],
            [0.6, 0.74],
            [0.66, 0.6],
            [0.68, 0.45],
            [0.44, 0.48],
            [0.43, 0.27],
            [0.42, 0.07],
            [0.56, 0.48],
            [0.57, 0.27],
            [0.58, 0.07],
            [0.48, 0.85],
            [0.52, 0.85],
            [0.45, 0.83],
            [0.55, 0.83],
        ],
        np.float32,
    )
    face = np.array(
        [[0.47 + (i % 11) * 0.006, 0.80 + (i // 11) * 0.007] for i in range(106)],
        np.float32,
    )
    return {
        "coords": coords,
        "visibility": np.ones(18, np.uint8),
        "width": 720,
        "height": 1280,
        "faces": face[None],
        "rectangles": np.array([[0.45, 0.79, 0.11, 0.1]], np.float32),
        "rolls": np.array([0.1], np.float32),
    }


class Controls(unittest.TestCase):
    def test_percentages_are_divided_once_before_lua_multiplier(self):
        actual = internal_targets(
            values={
                "body_adjust_StretchLeg": 35,
                "body_adjust_SlimWaist": 80,
                "body_adjust_SlimBody": 50,
            }
        )
        self.assertEqual(actual["LongLeg"], np.float32(0.35 * 0.35))
        self.assertEqual(actual["SlimWaist"], np.float32(0.8 * 0.25))
        self.assertEqual(actual["SlimBody"], np.float32(0.5 * 0.3))
        self.assertEqual(tuple(actual), BODY_ORDER)
        self.assertEqual(actual["SlimArm"], 0)

    def test_signed_controls_use_distinct_positive_and_negative_multipliers(self):
        for key, part, positive, negative in (
            ("body_adjust_WidenShoulderTest", "WidenShoulder", 1.0, -1.0),
            ("body_adjust_SlimHip", "SlimHip", 0.7, -0.42),
            ("body_adjust_SlimBreast", "SlimBreast", 0.55, -0.3),
        ):
            with self.subTest(key=key):
                self.assertEqual(
                    internal_targets(values={key: 50})[part], np.float32(positive)
                )
                self.assertEqual(
                    internal_targets(values={key: -50})[part], np.float32(negative)
                )

    def test_control_bounds_reject_nonfinite_boolean_unknown_and_out_of_range(self):
        for value in (True, np.bool_(False), math.nan, math.inf, "35", -1, 101):
            with self.subTest(value=value), self.assertRaises(ValueError):
                internal_targets(values={"body_adjust_SlimArm": value})
        for values in (
            {"StretchLeg": 35},
            {1: 35},
            [],
            {"body_adjust_SlimHip": 51},
            {"body_adjust_OrthoShoulder": -1},
        ):
            with self.subTest(values=values), self.assertRaises(ValueError):
                internal_targets(values=values)

    def test_internal_partial_targets_do_not_enable_other_parts(self):
        targets = resolve_targets({"SlimArm": 0.4})
        self.assertEqual(targets["SlimArm"], 0.4)
        self.assertTrue(
            all(value == 0 for part, value in targets.items() if part != "SlimArm")
        )
        for bad in ({"Other": 1}, {1: 1}, {"SlimArm": True}, {"SlimArm": math.inf}, 3):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                resolve_targets(bad)

    def test_synthetic_input_validation_rejects_mismatched_faces_and_visibility(self):
        valid = synthetic_inputs()
        validate_inputs(**valid)
        invalids = [
            {"coords": np.zeros((17, 2))},
            {"coords": np.full((18, 2), np.nan)},
            {"visibility": np.full(18, 2)},
            {"width": 0},
            {"height": True},
            {"faces": None},
            {"rolls": np.zeros(2)},
            {"rectangles": np.zeros((2, 4))},
        ]
        for invalid in invalids:
            with self.subTest(invalid=invalid.keys()), self.assertRaises(ValueError):
                validate_inputs(**{**valid, **invalid})


# Frozen outputs of the pre-port owned desktop Combined implementation on the
# synthetic points above. No photo-derived coordinates or native binaries are used.
SYNTHETIC_DELTA_SHA256 = {
    "SmallHead": "36e89152d9d19438df7c2abeb3d6eb9b078d4e31027fe0da85e4b7869b88986e",
    "LongLeg": "ae337826da3250f1755a02db1b08922e6d8b9d52a3ce22be005a3d8caf44d723",
    "SlimWaist": "cdc72fa50e681b70262088434427c2ac633e6d0fbb3a9eaa491a23ee66a6a2ad",
    "SlimBody": "1933be145ca90d5872bb7d171f6d6226b5d5a6758a45a873bf47d705aff82d76",
    "OrthoShoulder": "f7c277b665b83cce137cb784d490787a79aca2ceb22a77d13a133ed2a5576256",
    "WidenShoulder": "122b9836f88727a0bf6b352ad0173ce0b6deb1b8d24e3406f30e7cdf77accf75",
    "SwanNeck": "244d536f55d121601a9386caa20a6a715592eb12293d5f322ca50623e31fd70b",
    "SlimHip": "31eaba5fc880ee4b99d4ade64c741fc7e902dd7c041ff44b8d32b072029b180c",
    "SlimArm": "9b211a585dbaa72d036ae17e24b15d615a9a0493cbdbec85a0c3b594df382d09",
    "SlimBreast": "39694f96791d518a94082e50efc10d42f8d08517217f9c9e32e83b0bc3bdb6f9",
    "all": "0f7851e7d1840cfe6e26f42f85af03a9098bd005bb39a2aaf1dd780e5428e619",
}


@unittest.skipUnless(
    sys.platform == "darwin", "accepted geometry uses macOS float32 libm"
)
class Composition(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from body_composition import CombinedBody

        cls.engine = CombinedBody

    def test_all_ten_parts_and_combination_preserve_pre_port_float32_bytes(self):
        for part, expected in SYNTHETIC_DELTA_SHA256.items():
            with self.subTest(part=part):
                result = self.engine().update(
                    **synthetic_inputs(),
                    targets=0.35 if part == "all" else {part: 0.35},
                )
                self.assertEqual(
                    hashlib.sha256(result["delta"].tobytes()).hexdigest(), expected
                )
                self.assertTrue(np.isfinite(result["positions"]).all())
                self.assertGreater(np.count_nonzero(result["delta"]), 0)

    def test_zero_and_missing_pose_are_identity(self):
        for change in (
            {"targets": 0},
            {
                "targets": 0.35,
                "visibility": np.zeros(18, np.uint8),
                "faces": None,
                "rectangles": None,
                "rolls": None,
            },
        ):
            with self.subTest(change=change.keys()):
                result = self.engine().update(**{**synthetic_inputs(), **change})
                np.testing.assert_array_equal(result["positions"], result["base"])
                self.assertEqual(np.count_nonzero(result["delta"]), 0)

    def test_skeleton_only_neck_is_identity_and_other_parts_still_apply(self):
        inputs = {
            **synthetic_inputs(),
            "faces": None,
            "rectangles": None,
            "rolls": None,
        }
        neck = self.engine().update(**inputs, targets={"SwanNeck": 0.35})
        arm = self.engine().update(**inputs, targets={"SlimArm": 0.35})
        self.assertEqual(np.count_nonzero(neck["delta"]), 0)
        self.assertGreater(np.count_nonzero(arm["delta"]), 0)

    def test_body_associates_the_nearest_face_instead_of_first_candidate(self):
        single = synthetic_inputs()
        result = self.engine().update(**single, targets=0.35)
        shifted = single["faces"] - np.array([0.35, 0.25], np.float32)
        inputs = {
            **single,
            "faces": np.concatenate((shifted, single["faces"])),
            "rectangles": np.concatenate((single["rectangles"], single["rectangles"])),
            "rolls": np.array([-0.5, 0.1], np.float32),
        }
        multiple = self.engine().update(**inputs, targets=0.35)
        np.testing.assert_array_equal(multiple["delta"], result["delta"])

    def test_composition_keeps_base_and_source_inputs_immutable(self):
        inputs = synthetic_inputs()
        copies = {
            key: value.copy()
            for key, value in inputs.items()
            if isinstance(value, np.ndarray)
        }
        result = self.engine().update(**inputs, targets=0.35)
        self.assertEqual(tuple(result["stages"]), BODY_ORDER)
        np.testing.assert_array_equal(result["stages"][BODY_ORDER[-1]], result["delta"])
        base = self.engine().update(**inputs, targets=0)["base"]
        np.testing.assert_array_equal(result["base"], base)
        for key, value in copies.items():
            np.testing.assert_array_equal(inputs[key], value)

    def test_all_hidden_then_recovered_has_finite_geometry_and_new_cold_state(self):
        engine = self.engine()
        missing = {
            **synthetic_inputs(),
            "visibility": np.zeros(18, np.uint8),
            "faces": None,
            "rectangles": None,
            "rolls": None,
        }
        engine.update(**missing, targets=0.35)
        recovered = engine.update(**synthetic_inputs(), targets=0.35)
        self.assertTrue(np.isfinite(recovered["positions"]).all())
        self.assertGreater(np.count_nonzero(recovered["delta"]), 0)
        # Two fresh image instances must not share descriptors or shoulder caches.
        fresh = self.engine().update(**synthetic_inputs(), targets=0.35)
        again = self.engine().update(**synthetic_inputs(), targets=0.35)
        np.testing.assert_array_equal(fresh["delta"], again["delta"])


if __name__ == "__main__":
    unittest.main()
