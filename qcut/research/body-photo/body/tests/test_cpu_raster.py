"""No-model pixel and safety contracts for portable body drawing."""
from pathlib import Path
import unittest
from unittest.mock import patch

import numpy as np

from body import cpu_raster


def photograph(*, width=43, height=57):
    yy, xx = np.mgrid[:height, :width]
    return np.stack((xx * 7 % 256, yy * 13 % 256, (xx + yy) * 17 % 256,
                     np.full_like(xx, 255)), axis=-1).astype(np.uint8)


def grid(*, rows=1, columns=1):
    uv = np.stack(np.meshgrid(np.linspace(0, 1, columns + 1, dtype=np.float32),
                             np.linspace(0, 1, rows + 1, dtype=np.float32)), axis=-1).reshape(-1, 2)
    points = np.column_stack((uv * 2 - 1, np.zeros(len(uv), np.float32), uv))
    triangles = []
    for row in range(rows):
        for column in range(columns):
            first = row * (columns + 1) + column
            triangles.extend(((first, first + columns + 1, first + columns + 2),
                              (first, first + columns + 2, first + 1)))
    return points, np.array(triangles, np.int32)


class CpuRasterTests(unittest.TestCase):
    def setUp(self):
        self.photo = photograph()
        self.vertices, self.triangles = grid()

    def render(self, *, photo=None, vertices=None, triangles=None):
        return cpu_raster.draw_mesh(rgba=self.photo if photo is None else photo,
            vertices=self.vertices if vertices is None else vertices,
            triangles=self.triangles if triangles is None else triangles,
            runtime=Path("/unused-and-does-not-exist"))

    def test_identity_non_square_has_correct_orientation_and_exact_pixels(self):
        result, receipt = self.render()
        np.testing.assert_array_equal(result, self.photo)
        self.assertEqual(receipt["renderer"], "numpy-cpu")
        self.assertEqual(receipt["sourceFrameSize"], [43, 57])
        self.assertEqual(receipt["privateNativeImages"], [])
        self.assertEqual(receipt["geometry"]["uncoveredPixels"], 0)
        self.assertEqual(receipt["geometry"]["overdrawFragments"], 0)

    def test_dense_shared_edges_and_high_contrast_checkerboard_have_no_holes(self):
        photo = photograph(width=137, height=179)
        photo[..., :3] = (np.indices(photo.shape[:2]).sum(axis=0) % 2 * 255)[..., None]
        vertices, triangles = grid(rows=80, columns=80)
        result, receipt = self.render(photo=photo, vertices=vertices, triangles=triangles)
        np.testing.assert_array_equal(result, photo)
        self.assertEqual(receipt["geometry"]["fragmentsWritten"], photo.shape[0] * photo.shape[1])

    def test_reverse_winding_does_not_cull(self):
        result, _ = self.render(triangles=self.triangles[:, ::-1])
        np.testing.assert_array_equal(result, self.photo)

    def test_single_pixel_and_one_axis_images(self):
        for width, height in ((1, 1), (1, 83), (71, 1)):
            with self.subTest(width=width, height=height):
                photo = photograph(width=width, height=height)
                result, _ = self.render(photo=photo)
                np.testing.assert_array_equal(result, photo)

    def test_uv_pixel_translation_and_clamp(self):
        self.vertices[:, 3] -= 3 / self.photo.shape[1]
        result, _ = self.render()
        expected = self.photo[:, np.maximum(0, np.arange(self.photo.shape[1]) - 3)]
        np.testing.assert_array_equal(result, expected)

    def test_uv_vertical_translation_preserves_top_left_image_convention(self):
        self.vertices[:, 4] += 4 / self.photo.shape[0]
        result, _ = self.render()
        expected = self.photo[np.maximum(0, np.arange(self.photo.shape[0]) - 4)]
        np.testing.assert_array_equal(result, expected)

    def test_half_pixel_translation_uses_bilinear_sampling(self):
        photo = np.zeros((19, 29, 4), np.uint8)
        photo[..., :3] = (np.arange(29) * 6)[None, :, None]
        photo[..., 3] = 255
        self.vertices[:, 3] += .5 / 29
        result, _ = self.render(photo=photo)
        expected = photo.copy()
        expected[:, :-1, :3] += 3
        np.testing.assert_array_equal(result, expected)

    def test_extreme_uvs_clamp_to_corner(self):
        self.vertices[:, 3:] = [-32768, 32768]
        result, _ = self.render()
        np.testing.assert_array_equal(result, np.broadcast_to(self.photo[0, 0], self.photo.shape))

    def test_clipped_large_mesh_keeps_affine_pixel_mapping(self):
        self.vertices[:, :2] *= 3
        self.vertices[:, 3:] = (self.vertices[:, :2] + 1) / 2
        result, receipt = self.render()
        np.testing.assert_array_equal(result, self.photo)
        self.assertEqual(receipt["geometry"]["outOfBoundsTriangles"], 2)
        self.assertEqual(receipt["geometry"]["fullyOutsideTriangles"], 0)

    def test_later_overlapping_triangles_replace_earlier_without_blending(self):
        first = self.vertices.copy()
        first[:, 3:] = [.1, .1]
        second = self.vertices.copy()
        second[:, 3:] = [.9, .9]
        vertices = np.concatenate((first, second))
        triangles = np.concatenate((self.triangles, self.triangles + 4))
        result, receipt = self.render(vertices=vertices, triangles=triangles)
        last, _ = self.render(vertices=second)
        np.testing.assert_array_equal(result, last)
        self.assertEqual(receipt["geometry"]["overdrawFragments"], self.photo.shape[0] * self.photo.shape[1])

    def test_folded_triangles_render_and_are_reported(self):
        self.vertices[:, 3] = 1 - self.vertices[:, 3]
        result, receipt = self.render()
        np.testing.assert_array_equal(result, self.photo[:, ::-1])
        self.assertEqual(receipt["geometry"]["foldedTriangles"], 2)

    def test_degenerate_and_outside_triangles_are_skipped_and_reported(self):
        points = np.concatenate((self.vertices, [[2, 2, 0, 0, 0], [3, 2, 0, 0, 0], [2, 3, 0, 0, 0]]))
        indices = np.concatenate((self.triangles, [[0, 0, 1], [4, 5, 6]]))
        result, receipt = self.render(vertices=points, triangles=indices)
        np.testing.assert_array_equal(result, self.photo)
        self.assertEqual(receipt["geometry"]["degenerateTriangles"], 1)
        self.assertGreaterEqual(receipt["geometry"]["fullyOutsideTriangles"], 1)

    def test_incomplete_mesh_is_rejected_instead_of_filling_alpha_or_background(self):
        with self.assertRaisesRegex(ValueError, "uncovered"):
            self.render(triangles=self.triangles[:1])

    def test_all_outside_or_degenerate_mesh_is_rejected(self):
        for vertices, triangles in ((self.vertices + [4, 0, 0, 0, 0], self.triangles),
                                    (self.vertices, np.array([[0, 0, 0]]))):
            with self.subTest(vertices=vertices), self.assertRaisesRegex(ValueError, "uncovered"):
                self.render(vertices=vertices, triangles=triangles)

    def test_source_and_geometry_are_not_mutated(self):
        original = [value.copy() for value in (self.photo, self.vertices, self.triangles)]
        self.render()
        for actual, before in zip((self.photo, self.vertices, self.triangles), original):
            np.testing.assert_array_equal(actual, before)

    def test_noncontiguous_source_and_arrays_work(self):
        result, _ = self.render(photo=self.photo[:, ::-1], vertices=self.vertices[::-1],
            triangles=3 - self.triangles)
        np.testing.assert_array_equal(result, self.photo[:, ::-1])

    def test_invalid_photos_are_rejected(self):
        transparent = self.photo.copy()
        transparent[0, 0, 3] = 0
        for photo in (transparent, self.photo.astype(float), self.photo[..., :3],
                      np.empty((0, 2, 4), np.uint8), np.zeros((4097, 1, 4), np.uint8)):
            with self.subTest(shape=photo.shape), self.assertRaises(ValueError):
                self.render(photo=photo)

    def test_invalid_vertex_shape_type_and_nonfinite_or_unbounded_values(self):
        for vertices in (self.vertices[:2], self.vertices[:, :4], np.empty((8193, 5)),
                         self.vertices.astype(str), self.vertices.astype(object)):
            with self.subTest(shape=vertices.shape), self.assertRaises(ValueError):
                self.render(vertices=vertices)
        for value in (np.nan, np.inf, -np.inf, 32769, 1e308):
            vertices = self.vertices.astype(np.float64)
            vertices[0, 0] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.render(vertices=vertices)

    def test_invalid_triangle_indices_and_counts_are_rejected_before_cast(self):
        for indices in (np.empty((0, 3), np.int32), np.zeros((16385, 3), np.int32),
                        self.triangles.astype(float), [[0, 1, -1]], [[0, 1, 4]],
                        np.array([[0, 1, 2**63]], np.uint64), [[0, 1]], [[True, False, True]]):
            with self.subTest(indices=str(indices)[:60]), self.assertRaises(ValueError):
                self.render(triangles=indices)

    def test_unbounded_overdraw_rejected_before_drawing(self):
        triangles = np.tile(self.triangles, (8192, 1))
        with patch.object(cpu_raster, "_draw_triangle") as draw:
            with self.assertRaisesRegex(ValueError, "work budget"):
                self.render(triangles=triangles)
            draw.assert_not_called()

    def test_unsigned_coordinate_overflow_is_rejected(self):
        points = self.vertices.astype(np.int64).astype(np.uint64)
        with self.assertRaises(ValueError):
            self.render(vertices=points)


if __name__ == "__main__":
    unittest.main()
