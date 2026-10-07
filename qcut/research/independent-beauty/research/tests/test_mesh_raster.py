import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mesh_raster import rasterize
from mesh_texture import sample_texture
from slimface_mesh_render import run


def image_fixture(*, width=8, height=6):
    return np.random.default_rng(31).integers(0, 256, (height, width, 4), np.uint8)


def quad(*, width=8, height=6):
    return np.array([[0, 0], [width, 0], [width, height], [0, height]], float)


class MeshRasterTests(unittest.TestCase):
    def test_texture_and_destination_can_have_distinct_dimensions(self):
        texture = np.array([[[255, 20, 40, 255]]], np.uint8)
        positions = quad(width=4, height=3)
        output, diagnostics = rasterize(rgba=texture, positions=positions, uv=np.full((4, 2), .5),
            triangles=[[0, 1, 2], [0, 2, 3]], size=(4, 3), floating=True)
        np.testing.assert_array_equal(output, np.tile(texture, (3, 4, 1)))
        self.assertEqual(diagnostics['uncovered_pixel_count'], 0)
        self.assertIsNone(diagnostics['changed_pixel_count'])
        for size in ((0, 1), (1, 5000), (True, 1), (2.5, 1), [1]):
            with self.assertRaises(ValueError):
                rasterize(rgba=texture, positions=positions, uv=positions,
                    triangles=[[0, 1, 2]], size=size)

    def test_identity_pixel_centers_and_both_triangle_windings(self):
        rgba, vertices = image_fixture(), quad()
        for triangles in ([[0, 1, 2], [0, 2, 3]], [[2, 1, 0], [3, 2, 0]]):
            result, diagnostics = rasterize(rgba=rgba, positions=vertices, uv=vertices, triangles=triangles)
            np.testing.assert_array_equal(result, rgba)
            self.assertEqual(diagnostics["uncovered_pixel_count"], 0)
            self.assertEqual(diagnostics["changed_pixel_count"], 0)

    def test_straight_rgba_clamp_and_half_texel(self):
        rgba = np.array([[[255, 0, 0, 255], [0, 255, 0, 0]]], np.uint8)
        colors = sample_texture(rgba=rgba, coordinates=np.array([[.5, .5], [1, .5], [-3, 4], [8, 0]]))
        np.testing.assert_array_equal(colors, [[255, 0, 0, 255], [128, 128, 0, 128], [255, 0, 0, 255], [0, 255, 0, 0]])

    def test_floating_reference_preserves_values_before_unorm_rounding(self):
        rgba = np.array([[[0, 0, 0, 0], [255, 255, 255, 255]]], np.uint8)
        p = quad(width=2, height=1)
        result, _ = rasterize(rgba=rgba, positions=p, uv=p + [.5, 0],
                              triangles=[[0, 1, 2], [0, 2, 3]], floating=True)
        np.testing.assert_array_equal(result, [[[127.5] * 4, [255.] * 4]])

    def test_shared_diagonal_is_owned_by_one_triangle(self):
        rgba = np.array([[[255, 0, 0, 255], [0, 0, 255, 255]]], np.uint8)
        vertices = np.vstack((quad(width=3, height=3)[[0, 1, 2]], quad(width=3, height=3)[[0, 2, 3]]))
        uv = np.array([[.5, .5]] * 3 + [[1.5, .5]] * 3)
        result, diagnostics = rasterize(rgba=np.tile(rgba, (3, 2, 1))[:, :3], positions=vertices, uv=uv,
                                       triangles=[[0, 1, 2], [3, 4, 5]])
        np.testing.assert_array_equal(result[np.arange(3), np.arange(3)], [[255, 0, 0, 255]] * 3)
        self.assertEqual(diagnostics["uncovered_pixel_count"], 0)

    def test_later_triangle_overwrites_without_blending(self):
        rgba = np.array([[[255, 0, 0, 255], [0, 0, 255, 0]]], np.uint8)
        vertices = np.array([[0, 0], [4, 0], [0, 4]] * 2)
        uv = np.array([[.5, .5]] * 3 + [[1.5, .5]] * 3)
        result, _ = rasterize(rgba=rgba, positions=vertices, uv=uv, triangles=[[0, 1, 2], [3, 4, 5]])
        np.testing.assert_array_equal(result, [[[0, 0, 255, 0], [0, 0, 255, 0]]])

    def test_offscreen_clip_degenerate_triangles_and_uncovered_pixels(self):
        rgba = image_fixture()
        p = np.array([[-10, -10], [30, -10], [-10, 30], [1, 1]])
        result, diagnostics = rasterize(rgba=rgba, positions=p, uv=p, triangles=[[0, 1, 2], [3, 3, 3]])
        np.testing.assert_array_equal(result, rgba)
        self.assertEqual(diagnostics["degenerate_triangle_count"], 1)
        empty, diagnostics = rasterize(rgba=rgba, positions=p, uv=p, triangles=np.empty((0, 3), int))
        self.assertFalse(empty.any())
        self.assertEqual(diagnostics["uncovered_pixel_count"], 48)

    def test_vertex_and_source_arrays_are_not_modified(self):
        rgba, p = image_fixture(), quad()
        original_rgba, original_p = rgba.copy(), p.copy()
        rasterize(rgba=rgba, positions=p, uv=p + [.25, .5], triangles=[[0, 1, 2], [0, 2, 3]])
        np.testing.assert_array_equal(rgba, original_rgba)
        np.testing.assert_array_equal(p, original_p)

    def test_invalid_mesh_is_rejected_before_sampling(self):
        rgba, p = image_fixture(), quad()
        for points, uv, triangles in ((p, p, [[-1, 0, 1]]), (p, p, [[0, 1, 4]]),
                                     (p, p, [[0., 1, 2]]), (p[:, :1], p, [[0, 1, 2]]),
                                     (p * np.nan, p, [[0, 1, 2]]), (p, p[:2], [[0, 1, 2]]),
                                     (p * 1e8, p, [[0, 1, 2]])):
            with self.assertRaises(ValueError):
                rasterize(rgba=rgba, positions=points, uv=uv, triangles=triangles)

    def test_zero_bypasses_detection_assets_and_preserves_hidden_rgb(self):
        rgba = image_fixture()
        with tempfile.TemporaryDirectory() as directory, patch("slimface_mesh_render.single_face_prediction") as detector:
            output, report = Path(directory) / "zero.png", Path(directory) / "zero.json"
            receipt = run(rgba=rgba, intensity=0, output=output, report=report, assets_path=Path("missing.npz"))
            detector.assert_not_called()
            np.testing.assert_array_equal(np.asarray(Image.open(output)), rgba)
            self.assertTrue(receipt["diagnostics"]["zero_bypass"])
            self.assertEqual(json.loads(report.read_text())["input_rgba_sha256"], receipt["output_rgba_sha256"])

    def test_positive_invalid_frame_and_mismatched_fixed_points_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            for rgba, request in ((np.zeros((3, 3, 3), np.uint8), None),
                                  (image_fixture(), {"size": [9, 6], "points": []})):
                with self.assertRaises(ValueError):
                    run(rgba=rgba, intensity=100, output=Path(directory) / "bad.png",
                        report=Path(directory) / "bad.json", assets_path=Path("missing.npz"), fixed_request=request)
            self.assertFalse((Path(directory) / "bad.png").exists())




class SubpixelCoverageTests(unittest.TestCase):
    def test_coverage_snaps_vertices_without_quantizing_texture_gradients(self):
        texture = np.array([[[10, 20, 30, 255]]], np.uint8)
        positions = np.array([[.50001, 0], [2, 0], [.50001, 2]], np.float32)
        uv = np.full((3, 2), .5, np.float32)
        triangles = np.array([[0, 1, 2]], np.uint16)
        default, _ = rasterize(rgba=texture, positions=positions, uv=uv, triangles=triangles,
            floating=True, size=(2, 2))
        measured, diagnostics = rasterize(rgba=texture, positions=positions, uv=uv, triangles=triangles,
            floating=True, size=(2, 2), coverage_bits=8)
        np.testing.assert_array_equal(default[0, 0], 0)
        np.testing.assert_allclose(measured[0, 0], texture[0, 0], atol=1e-10)
        self.assertEqual(diagnostics['coverage_fraction_bits'], 8)

    def test_unmeasured_coverage_and_byte_premultiplication_are_rejected(self):
        texture = np.array([[[10, 20, 30, 255]]], np.uint8)
        positions = np.array([[0, 0], [2, 0], [0, 2]], np.float32)
        for profile in (True, 4, 8., -1, '8'):
            with self.assertRaises(ValueError):
                rasterize(rgba=texture, positions=positions, uv=positions, triangles=[[0, 1, 2]], coverage_bits=profile)
        with self.assertRaises(ValueError):
            rasterize(rgba=texture, positions=positions, uv=positions, triangles=[[0, 1, 2]], premultiply=True)


if __name__ == "__main__":
    unittest.main()
