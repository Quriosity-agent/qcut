import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from slimface_mesh import generate_mesh, outward
from slimface_mesh_assets import arm64_image, decode_scene_arrays, load_assets
from slimface_mesh_landmarks import deform, prepare


def fixture():
    points = np.random.default_rng(57).uniform([200, 180], [400, 400], (106, 2)).astype(np.float32)
    angles = np.linspace(np.pi, 0, 33)
    points[:33] = np.column_stack((300 + 100 * np.cos(angles), 230 + 180 * np.sin(angles)))
    points[74], points[77] = [255, 260], [345, 260]
    points[46], points[43] = [300, 305], [300, 250]
    assets = {"weights": np.column_stack((np.arange(62), np.zeros((62, 2)))).astype(np.float32),
              "triangles": np.tile(np.array([[0, 1, 2]], np.uint16), (595, 1)),
              "opening_indices": np.arange(43), "small_face_indices": np.arange(3, 61),
              "left_eye_midpoints": np.r_[np.arange(2, 10), 2],
              "right_eye_midpoints": np.r_[np.arange(59, 67), 59],
              "left_eye_spacing": np.r_[np.arange(33), 66],
              "right_eye_spacing": np.r_[np.arange(33, 66), 67]}
    return points, assets


class SlimFaceMeshTests(unittest.TestCase):
    def setUp(self):
        self.points, self.assets = fixture()

    def mesh(self, *, intensity=100, points=None, size=(640, 480), yaw=0, pitch=0):
        return generate_mesh(points=self.points if points is None else points, intensity=intensity,
                             size=size, yaw=yaw, pitch=pitch, assets=self.assets)

    def test_zero_mesh_has_identical_positions_and_uv(self):
        mesh = self.mesh(intensity=0)
        np.testing.assert_array_equal(mesh["positions"], mesh["uv_pixels"])
        np.testing.assert_array_equal(mesh["deformed_landmarks"],
                                      mesh["prepared_source"])

    def test_render_corners_and_texture_y_have_correct_orientation(self):
        mesh = self.mesh()
        self.assertEqual(mesh["positions"].shape, (311, 2))
        self.assertEqual(mesh["clip_positions"].shape, (315, 3))
        self.assertEqual(mesh["triangles"].shape, (597, 3))
        np.testing.assert_array_equal(mesh["clip_positions"][-4:], [[-1, -1, 0], [-1, 1, 0], [1, -1, 0], [1, 1, 0]])
        np.testing.assert_array_equal(mesh["texcoords"][-4:], [[0, 0], [0, 1], [1, 0], [1, 1]])
        np.testing.assert_array_equal(mesh["triangles"][:2], [[311, 312, 313], [314, 313, 312]])
        np.testing.assert_array_equal(mesh["clip_positions"][:, 2], 0)

    def test_inputs_and_reference_data_are_not_mutated(self):
        points = self.points.copy()
        assets = {key: value.copy() for key, value in self.assets.items()}
        self.mesh()
        np.testing.assert_array_equal(points, self.points)
        for key in assets:
            np.testing.assert_array_equal(assets[key], self.assets[key])

    def test_float32_threshold_activates_small_face_at_ten(self):
        source = prepare(points=self.points, assets=self.assets)
        inactive = deform(source=source.copy(), intensity=9.99, yaw=0, assets=self.assets)
        active = deform(source=source.copy(), intensity=10, yaw=0, assets=self.assets)
        np.testing.assert_array_equal(inactive[42], source[42])
        self.assertGreater(float(np.linalg.norm(active[42] - source[42])), .001)

    def test_deformation_is_active_and_outer_ring_uv_tracks_positions(self):
        mesh = self.mesh()
        self.assertGreater(float(np.max(np.abs(mesh["positions"] - mesh["uv_pixels"]))), .01)
        np.testing.assert_array_equal(mesh["positions"][80:120], mesh["uv_pixels"][80:120])
        np.testing.assert_array_equal(mesh["positions"][287:311], mesh["uv_pixels"][287:311])

    def test_translation_and_scaling_preserve_face_geometry(self):
        base = self.mesh()["positions"][:287]
        translated = self.mesh(points=self.points + [40, 20])["positions"][:287]
        np.testing.assert_allclose(translated, base + [40, 20], atol=.001, rtol=0)
        scaled = self.mesh(points=self.points * 2, size=(1280, 960))["positions"][:287]
        np.testing.assert_allclose(scaled, base * 2, atol=.001, rtol=0)

    def test_invalid_landmarks_sizes_and_controls(self):
        for points in (np.zeros((106, 2)), np.zeros((105, 2)), np.full((106, 2), np.nan), np.full((106, 2), 1e7)):
            with self.assertRaises(ValueError):
                self.mesh(points=points)
        for size in ((0, 480), (4097, 480), (640.0, 480), (True, 480), (640,)):
            with self.assertRaises(ValueError):
                self.mesh(size=size)
        for intensity in (-1, 101, True, "50", float("nan")):
            with self.assertRaises(ValueError):
                self.mesh(intensity=intensity)
        for yaw, pitch in ((51, 0), (0, -1), (0, 51), (float("inf"), 0)):
            with self.assertRaises(ValueError):
                self.mesh(yaw=yaw, pitch=pitch)

    def test_zero_length_boundary_ray_is_rejected(self):
        with self.assertRaises(ValueError):
            outward(points=np.array([[0, 0]], np.float32), center=np.array([0, 0], np.float32), step=2)

    def test_asymmetric_face_compensation_remains_finite_and_zero_is_identity(self):
        for landmark in (4, 28):
            points = self.points.copy()
            points[45] = points[landmark] + [2, 2]
            mesh = self.mesh(points=points, intensity=0)
            np.testing.assert_array_equal(mesh["positions"], mesh["uv_pixels"])
            self.assertTrue(np.isfinite(self.mesh(points=points)["positions"]).all())

    def test_opening_compensation_preserves_input_and_returns_finite_supports(self):
        points = self.points.copy()
        points[43] = points[46] + [0, -1]
        original = points.copy()
        mesh = self.mesh(points=points, intensity=0)
        np.testing.assert_array_equal(points, original)
        self.assertTrue(np.isfinite(mesh["positions"]).all())
        self.assertGreater(float(np.max(np.abs(mesh["prepared_source"] - points))), 1)

    def test_unpinned_and_truncated_assets_are_rejected(self):
        with self.assertRaises(ValueError):
            arm64_image(data=b"invalid binary")
        with self.assertRaises(ValueError):
            decode_scene_arrays(data=bytes(256))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "invalid.npz"
            np.savez(path, core_sha256="wrong")
            with self.assertRaises(ValueError):
                load_assets(path=path)


if __name__ == "__main__":
    unittest.main()
