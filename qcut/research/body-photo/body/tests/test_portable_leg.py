"""Foot pixels, visible strength progression, and cumulative control composition."""
import copy
from pathlib import Path
import unittest

import numpy as np

from body.cpu_raster import draw_mesh
from body.portable_leg import adjust_long_leg


def mesh_state(*, width=600, height=960, rows=30, columns=30, legacy=True, other=False):
    base = np.stack(np.meshgrid(np.linspace(0, width, columns + 1, dtype=np.float32),
                                np.linspace(0, height, rows + 1, dtype=np.float32)), axis=-1)
    triangles = []
    for row in range(rows):
        for column in range(columns):
            a = row * (columns + 1) + column
            triangles.extend(((a, a + columns + 1, a + columns + 2),
                              (a, a + columns + 2, a + 1)))
    head = np.zeros_like(base)
    waist = np.zeros_like(base)
    if other:
        head[..., 0] = 2 * np.sin(base[..., 0] * np.pi / width) * np.sin(base[..., 1] * np.pi / height)
        waist[..., 0] = -4 * np.sin(base[..., 0] * np.pi / width) * np.sin(base[..., 1] * np.pi / height)
    old_leg = np.zeros_like(base)
    if legacy:
        old_leg[..., 1] = -.16 * (height - base[..., 1])
    stages = {"SmallHead": head, "LongLeg": head + old_leg, "SlimWaist": head + old_leg + waist}
    return {"base": base, "uv": base / [width, height], "tri": np.asarray(triangles, np.int32),
            "delta": stages["SlimWaist"].copy(), "positions": base + stages["SlimWaist"],
            "stages": stages, "states": {"sentinel": object()}}


def assessment(*, width=600, height=960, shoulders=True, bent=False):
    return {"eligible": True, "points": {
        "hips": [[width * .4, height * .44], [width * .6, height * .44]],
        "knees": [[width * .36, height * (.62 if bent else .68)], [width * .65, height * .68]],
        "ankles": [[width * .3, height * (.84 if bent else .91)], [width * .7, height * .90]],
        "shoulders": [[width * .37, height * .19], [width * .63, height * .20]] if shoulders else [],
    }}


def apply(*, state=None, eligibility=None, target=.35, width=600, height=960):
    return adjust_long_leg(state=mesh_state(width=width, height=height) if state is None else state,
                           eligibility=assessment(width=width, height=height) if eligibility is None else eligibility,
                           target=target, width=width, height=height)


def areas(*, state):
    points = state["positions"].reshape(-1, 2)[state["tri"]].astype(np.float64)
    first, second = points[:, 1] - points[:, 0], points[:, 2] - points[:, 0]
    return first[:, 0] * second[:, 1] - first[:, 1] * second[:, 0]


class PortableLegTests(unittest.TestCase):
    def test_zero_is_exact_identity_and_does_not_need_pose(self):
        state = mesh_state(legacy=False, other=True)
        result, details = apply(state=state, target=0, eligibility={})
        self.assertIs(result, state)
        self.assertFalse(details["moved"])
        self.assertEqual(details["reasonCode"], "zero")

    def test_hips_rise_but_both_shoes_and_head_remain_fixed(self):
        state = mesh_state()
        result, details = apply(state=state)
        displacement = result["positions"] - state["base"]
        top_y = 960 - state["base"][..., 1]
        self.assertTrue(details["moved"])
        self.assertGreater(details["maximumShiftPixels"], 40)
        np.testing.assert_array_equal(displacement[..., 0], 0)
        np.testing.assert_allclose(displacement[top_y >= details["fixedFootFromY"]], 0, atol=1e-4)
        np.testing.assert_allclose(displacement[top_y <= details["upperAnchorY"]], 0, atol=1e-4)
        self.assertTrue(np.all(displacement[..., 1] >= -1e-4))
        self.assertTrue(np.all(result["positions"] >= -1e-4))
        self.assertTrue(np.all(result["positions"] <= np.array([600, 960]) + 1e-4))
        self.assertGreater(details["minimumTriangleAreaRatio"], .4)

    def test_strength_35_50_100_is_visible_linear_and_monotonic(self):
        states = [apply(target=.35 * strength / 100) for strength in (35, 50, 100)]
        high = states[-1][0]["delta"]
        for strength, (state, details) in zip((35, 50, 100), states):
            with self.subTest(strength=strength):
                self.assertTrue(details["moved"])
                self.assertGreater(details["maximumShiftPixels"], 15)
                np.testing.assert_allclose(state["delta"], high * strength / 100, atol=3e-5)
                self.assertEqual(details["strength"], strength)
        self.assertLess(states[0][1]["maximumShiftPixels"], states[1][1]["maximumShiftPixels"])
        self.assertLess(states[1][1]["maximumShiftPixels"], states[2][1]["maximumShiftPixels"])

    def test_preserves_every_other_stage_increment_and_does_not_mutate_input(self):
        state = mesh_state(other=True)
        snapshot = copy.deepcopy(state)
        result, details = apply(state=state)
        np.testing.assert_array_equal(result["stages"]["SmallHead"], state["stages"]["SmallHead"])
        np.testing.assert_allclose(result["stages"]["SlimWaist"] - result["stages"]["LongLeg"],
                                   state["stages"]["SlimWaist"] - state["stages"]["LongLeg"], atol=3e-5)
        for name in ("base", "delta", "positions", "tri", "uv"):
            np.testing.assert_array_equal(state[name], snapshot[name])
        for name, value in state["stages"].items():
            np.testing.assert_array_equal(value, snapshot["stages"][name])
        self.assertIs(result["states"], state["states"])
        self.assertTrue(details["moved"])
        np.testing.assert_array_equal(result["positions"][..., 0], state["positions"][..., 0])
        np.testing.assert_allclose(result["delta"], result["stages"]["SlimWaist"], atol=3e-5)

    def test_bent_leg_uses_higher_ankle_to_lock_both_shoes(self):
        state = mesh_state()
        eligibility = assessment(bent=True)
        result, details = apply(state=state, eligibility=eligibility)
        self.assertLess(details["fixedFootFromY"], eligibility["points"]["ankles"][0][1] - 32)
        top_y = 960 - state["base"][..., 1]
        np.testing.assert_allclose((result["positions"] - state["base"])[top_y >= details["fixedFootFromY"]],
                                   0, atol=1e-4)
        self.assertTrue(details["moved"])

    def test_missing_shoulders_uses_conservative_torso_anchor(self):
        result, details = apply(eligibility=assessment(shoulders=False))
        self.assertTrue(details["moved"])
        self.assertFalse(details["shoulderAnchorAvailable"])
        self.assertGreater(details["minimumTriangleAreaRatio"], .05)
        self.assertTrue(np.all(areas(state=result) < 0))

    def test_non_square_landscape_and_portrait_grids_preserve_orientation(self):
        for width, height, rows, columns in ((1600, 900, 30, 40), (640, 1536, 80, 80), (200, 300, 10, 20)):
            with self.subTest(dimensions=(width, height)):
                state = mesh_state(width=width, height=height, rows=rows, columns=columns)
                result, details = apply(state=state, width=width, height=height)
                self.assertTrue(details["moved"])
                self.assertTrue(np.all(areas(state=result) < 0))
                self.assertGreater(details["minimumTriangleAreaRatio"], .05)

    def test_rejection_removes_legacy_long_leg_but_keeps_other_controls(self):
        state = mesh_state(other=True)
        rejected = {"eligible": False, "reason": "both ankles required", "reasonCode": "missing-leg-joints"}
        result, details = apply(state=state, eligibility=rejected)
        expected = state["delta"] - (state["stages"]["LongLeg"] - state["stages"]["SmallHead"])
        np.testing.assert_array_equal(result["delta"], expected)
        self.assertFalse(details["moved"])
        self.assertEqual(details["reasonCode"], "missing-leg-joints")
        np.testing.assert_allclose(result["stages"]["LongLeg"], state["stages"]["SmallHead"], atol=1e-5)

    def test_existing_fold_is_reported_without_adding_a_new_leg_warp(self):
        state = mesh_state(legacy=False)
        state["positions"][15, 15, 1] += 80
        result, details = apply(state=state)
        self.assertFalse(details["moved"])
        self.assertEqual(details["reasonCode"], "unsafe-existing-mesh")
        np.testing.assert_allclose(result["positions"], state["positions"], atol=1e-5)

    def test_area_limit_is_computed_at_full_strength_before_slider_scaling(self):
        state = mesh_state(legacy=False)
        state["positions"][20, 15, 1] -= 25
        high, hd = apply(state=state, target=.35)
        half, ld = apply(state=state, target=.175)
        self.assertTrue(hd["moved"])
        self.assertLess(hd["safetyScale"], 1)
        self.assertGreater(hd["minimumTriangleAreaRatio"], .05)
        self.assertEqual(hd["safetyScale"], ld["safetyScale"])
        np.testing.assert_allclose(half["delta"], high["delta"] * .5, atol=1e-6)

    def test_pixel_render_keeps_full_foot_band_identical_and_changes_leg_proportions(self):
        width, height = 192, 320
        source = np.zeros((height, width, 4), np.uint8)
        yy, xx = np.mgrid[:height, :width]
        source[..., :3] = np.stack((xx % 256, yy % 256, (yy // 8 % 2) * 255), axis=-1)
        source[..., 3] = 255
        rendered = []
        for strength in (.175, .35):
            result, details = apply(width=width, height=height, target=strength)
            uv = result["uv"].reshape(-1, 2)
            ndc = result["positions"].reshape(-1, 2) / [width, height] * 2 - 1
            vertices = np.column_stack((ndc, np.zeros(len(ndc)), uv)).astype(np.float32)
            image, receipt = draw_mesh(rgba=source, vertices=vertices, triangles=result["tri"], runtime=Path("."))
            fixed_from = int(np.ceil(details["fixedFootFromY"])) + 1
            np.testing.assert_array_equal(image[fixed_from:], source[fixed_from:])
            self.assertEqual(receipt["geometry"]["uncoveredPixels"], 0)
            self.assertGreater(np.count_nonzero(np.any(image != source, axis=-1)), 1000)
            self.assertTrue(np.all(image[..., 3] == 255))
            rendered.append(image)
        self.assertFalse(np.array_equal(*rendered))

    def test_invalid_target_dimensions_grid_stage_and_triangles_fail_closed(self):
        for value in (-.1, .36, np.nan, np.inf, True, "0.35"):
            with self.subTest(target=value), self.assertRaises(ValueError):
                apply(target=value)
        for width, height in ((0, 960), (600, np.inf), (40000, 960)):
            with self.subTest(dimensions=(width, height)), self.assertRaises(ValueError):
                apply(state=mesh_state(), width=width, height=height)
        mutations = [
            ("base", np.zeros((2, 2), np.float32)),
            ("positions", np.full((31, 31, 2), np.nan)),
            ("delta", np.zeros((2, 2))),
            ("tri", np.array([[0, 1, 99999]])),
            ("tri", np.array([[0., 1., 2.]])),
            ("tri", np.array([[0, 0, 0]], np.int32)),
            ("stages", {"LongLeg": np.zeros((31, 31, 2))}),
        ]
        for name, value in mutations:
            state = mesh_state()
            state[name] = value
            with self.subTest(name=name), self.assertRaises(ValueError):
                apply(state=state)

    def test_malformed_eligible_anchors_fail_closed(self):
        for name in ("hips", "knees", "ankles", "shoulders"):
            for points in ([[1, 2]], [[np.nan, 2], [1, 2]], [[-1, 2], [3, 4]], [[10000, 2], [3, 4]]):
                eligibility = assessment()
                eligibility["points"][name] = points
                with self.subTest(name=name, points=points), self.assertRaises(ValueError):
                    apply(eligibility=eligibility)
        eligibility = assessment()
        eligibility["points"]["ankles"][0][1] = 400
        with self.assertRaises(ValueError):
            apply(eligibility=eligibility)


if __name__ == "__main__":
    unittest.main()
