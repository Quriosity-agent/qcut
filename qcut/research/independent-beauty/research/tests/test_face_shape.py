import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from face_shape_assets import TABLES, load_assets
from face_shape_contour import reshape_contour
from face_shape_controls import CONTROLS, mesh_active, mesh_degrees, validate_controls
from slimface_mesh import generate_mesh
from slimface_mesh_landmarks import apply_coefficients, jaw_strengths
from slimface_mesh_render import run
from test_slimface_mesh import fixture


class FaceShapeTests(unittest.TestCase):
    def test_signed_controls_and_catalog_limits(self):
        for name, (minimum, maximum) in CONTROLS.items():
            for value in (minimum, 0, maximum):
                with self.subTest(name=name, value=value):
                    self.assertEqual(validate_controls(values={name: value}), {name: float(value)})
            for value in (minimum - .01, maximum + .01, True, "50", None, np.nan, np.inf):
                with self.subTest(name=name, value=value), self.assertRaises(ValueError):
                    validate_controls(values={name: value})

    def test_unknown_and_non_object_parameters_fail(self):
        for values in (None, [], 1, {"YouTaiFace": 50}, {"makeup": 50}, {1: 50}):
            with self.subTest(values=values), self.assertRaises(ValueError):
                validate_controls(values=values)

    def test_event_multipliers_and_float32_degree_storage(self):
        degrees = mesh_degrees(values={"CutFace": -50, "ZoomJawbone": 100,
                                       "ZoomCheekbone": 100, "Chin": -50, "Forehead": 50})
        self.assertEqual(degrees.dtype, np.float32)
        for index, expected in ((11, .2), (13, -.135), (14, -.3), (8, .14), (9, -.4), (20, 2)):
            self.assertEqual(degrees[index], np.float32(expected))

    def test_short_face_combines_before_float32_rounding(self):
        values = {"TotalFace": 99.5, "SmallFace": 12.125}
        degrees = mesh_degrees(values=values)
        self.assertEqual(degrees[12], np.float32(-.01 * .995 - .07 * .12125))
        self.assertEqual(degrees[0], np.float32(.08 * .995))
        np.testing.assert_array_equal(degrees, mesh_degrees(values=dict(reversed(list(values.items())))))

    def test_visibility_threshold_and_parameter_specific_multiplier(self):
        self.assertFalse(mesh_active(values={"TotalFace": .1, "ChinSharp": .1}))
        self.assertTrue(mesh_active(values={"TotalFace": .10001}))
        self.assertTrue(mesh_active(values={"Forehead": -.03}))
        self.assertFalse(mesh_active(values={"ZoomJawbone": .14}))

    def test_jaw_fades_only_the_far_side_and_saturates_at_fourteen_degrees(self):
        for yaw, expected in ((0, (1, 1)), (-7, (1, .5)), (7, (.5, 1)), (-50, (1, 0)), (50, (0, 1))):
            np.testing.assert_array_equal(jaw_strengths(yaw=yaw), np.asarray(expected, np.float32))

    def test_coefficient_update_respects_both_sides_and_does_not_modify_inputs(self):
        target = np.zeros((106, 2), np.float32)
        eye = np.array([4, 2], np.float32)
        coefficients = np.array([[3, .5, .25], [29, -.5, .25]], np.float32)
        original = coefficients.copy()
        apply_coefficients(target=target, eye=eye, coefficients=coefficients,
                           strength=np.float32(-.675), side_strengths=(np.float32(1), np.float32(.5)))
        np.testing.assert_allclose(target[3], [-1.6875, 0], atol=1e-6, rtol=0)
        np.testing.assert_allclose(target[29], [.50625, .675], atol=1e-6, rtol=0)
        np.testing.assert_array_equal(coefficients, original)

    def test_legacy_total_face_and_explicit_control_have_identical_geometry(self):
        points, assets = fixture()
        before = points.copy()
        legacy = generate_mesh(points=points, assets=assets, intensity=50, size=(640, 480))
        explicit = generate_mesh(points=points, assets=assets, intensity=0, size=(640, 480), controls={"TotalFace": 50})
        for key in legacy:
            np.testing.assert_array_equal(legacy[key], explicit[key])
        np.testing.assert_array_equal(points, before)

    def test_positive_chin_contour_and_state_are_distinct(self):
        points, _ = fixture()
        target = points.copy()
        position = reshape_contour(target=target, axis=np.array([20, 0], np.float32),
                                   chin=np.float32(.14), sharp=np.float32(0), assets={})
        np.testing.assert_array_equal(position[:12], points[:12])
        self.assertGreater(float(np.max(np.abs(position[12:21] - target[12:21]))), .01)
        delta = target[12:21] - points[12:21]
        np.testing.assert_allclose(delta[:, 0], delta[:, 1], atol=.0001, rtol=0)

    def test_degenerate_chin_radius_is_rejected(self):
        points, _ = fixture()
        points[77] = points[74]
        with self.assertRaises(ValueError):
            reshape_contour(target=points, axis=np.array([20, 0], np.float32),
                            chin=np.float32(.14), sharp=np.float32(0), assets={})

    def test_missing_shape_asset_is_explicit_error(self):
        points, assets = fixture()
        for values in ({"CutFace": 50}, {"Chin": 50}, {"ChinSharp": 100}):
            with self.subTest(values=values), self.assertRaises(ValueError):
                generate_mesh(points=points, assets=assets, intensity=0, size=(640, 480), controls=values)

    def test_asset_loader_rejects_tampering_and_bad_indices(self):
        values = {name: np.zeros((count, 3), np.float32) for name, (_, count) in TABLES.items()}
        with tempfile.TemporaryDirectory() as temporary:
            asset = Path(temporary) / "assets.npz"
            for bad in (values, {**values, "foreign": np.zeros(1)},
                        {**values, "cut": np.full((33, 3), np.nan, np.float32)},
                        {**values, "cut": np.full((33, 3), 106, np.float32)},
                        {**values, "cut": np.zeros((33, 3), np.float64)}):
                np.savez(asset, **bad)
                with self.assertRaises(ValueError):
                    load_assets(path=asset)

    def test_zero_controls_bypass_detection_and_all_assets(self):
        rgba = np.random.default_rng(901).integers(0, 256, (20, 31, 4), np.uint8)
        with tempfile.TemporaryDirectory() as temporary, patch("slimface_mesh_render.single_face_prediction") as detection:
            root = Path(temporary)
            receipt = run(rgba=rgba, intensity=0, controls={name: 0 for name in CONTROLS},
                          output=root / "zero.png", report=root / "zero.json", assets_path=root / "missing.npz")
            detection.assert_not_called()
            self.assertTrue(receipt["diagnostics"]["zero_bypass"])
            self.assertFalse(receipt["private_asset_dependency"])
            self.assertEqual(receipt["input_rgba_sha256"], receipt["output_rgba_sha256"])
            self.assertEqual(json.loads((root / "zero.json").read_text())["controls"], {name: 0 for name in CONTROLS})

    def test_subthreshold_signed_controls_return_rgba_without_models(self):
        rgba = np.random.default_rng(902).integers(0, 256, (17, 29, 4), np.uint8)
        with tempfile.TemporaryDirectory() as temporary, patch("slimface_mesh_render.single_face_prediction") as detection:
            root = Path(temporary)
            receipt = run(rgba=rgba, intensity=0,
                          controls={"TotalFace": .1, "CutFace": -.05, "ZoomJawbone": .14, "Forehead": .025},
                          output=root / "tiny.png", report=root / "tiny.json", assets_path=root / "missing.npz")
            detection.assert_not_called()
            self.assertTrue(receipt["diagnostics"]["zero_bypass"])
            self.assertEqual(receipt["input_rgba_sha256"], receipt["output_rgba_sha256"])

    def test_mixed_control_contract_fails_before_creating_outputs(self):
        rgba = np.full((17, 29, 4), 255, np.uint8)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaises(ValueError):
                run(rgba=rgba, intensity=50, controls={"Chin": -25},
                    output=root / "mixed.png", report=root / "mixed.json", assets_path=root / "missing.npz")
            self.assertEqual(list(root.iterdir()), [])

    def test_oversized_coefficient_archive_is_rejected_before_decoding(self):
        with tempfile.TemporaryDirectory() as temporary:
            asset = Path(temporary) / "oversized.npz"
            asset.write_bytes(bytes(64 * 1024 + 1))
            with self.assertRaises(ValueError):
                load_assets(path=asset)


if __name__ == "__main__":
    unittest.main()
