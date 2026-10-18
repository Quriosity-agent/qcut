"""Version-locked native geometry goldens and bounded manual zoom dispatch."""
import hashlib
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import body_mesh_renderer
import manual_body_render
from manual_body_zoom_geometry import base_grid, make_zoom_mesh, radial_weight


class Geometry(unittest.TestCase):
    def test_native_radial_samples_cover_center_transition_edge_and_outside(self):
        radius = np.asarray([0, .125, .25, .5, .75, .875, 1, 1.125], np.float32)
        samples = {
            False: [1065353216, 1065353024, 1065341056, 1064632320, 1058914688, 1048741412, 0, 0],
            True: [1065353216, 1065325431, 1065029722, 1061997074, 1052201190, 1039172280, 0, 0],
        }
        for positive, expected in samples.items():
            with self.subTest(positive=positive):
                result = radial_weight(radius=radius, positive=positive)
                np.testing.assert_array_equal(result.view(np.uint32), np.asarray(expected, np.uint32))

    def test_native_canvas_rounding_and_pinned_uv_boundaries(self):
        for width, height, expected_low in ((720, 1280, [72.5, 128]),
                                            (1080, 1920, [108, 192]), (999, 1333, [100, 133.5])):
            with self.subTest(size=(width, height)):
                source, uv, triangles, low, high = base_grid(width=width, height=height)
                np.testing.assert_array_equal(low, [21, 21])
                np.testing.assert_array_equal(high, [229, 229])
                np.testing.assert_array_equal(source[21, 21, :2], expected_low)
                np.testing.assert_array_equal(source[229, 229, :2], np.asarray(expected_low) + [width, height])
                np.testing.assert_array_equal(uv[21, 21], [0, 0])
                np.testing.assert_array_equal(uv[229, 229], [1, 1])
                np.testing.assert_array_equal(triangles[:2], [[0, 251, 252], [0, 252, 1]])

    def test_forward_mesh_matches_native_cpu_capture_digests(self):
        # Native 0c39324e: original grid, UV, ellipse and deformed vertices matched bitwise.
        samples = [
            (1080, 1920, .5, .5, .24, -50, '1f087712da8059e416de161c33dab802b3a1a0dc6af4ef1633d02a47c4faba53'),
            (1080, 1920, .5, .5, .24, 50, '3c199ed444e2544610026ce8fdaf752df423560b9c6ab4b02f4c6aff7065e20f'),
            (1080, 1920, .03, .02, .4, 50, '03d5924fd214ee52a1152f101b9317393f293c7ecf79e6ac0f1924e489f952e6'),
            (1920, 1080, .5, .5, .24, 50, '79899ed8efd8b7c6315efb0ff298a8e7c41e419d6b49a0e658810da45faeaa62'),
        ]
        for width, height, x, y, radius, intensity, digest in samples:
            with self.subTest(size=(width, height), intensity=intensity, x=x):
                vertices, triangles = make_zoom_mesh(width=width, height=height, intensity=intensity,
                                                      x=x, y=y, radius=radius)
                self.assertEqual(vertices.shape, (63001, 5))
                self.assertEqual(triangles.shape, (125000, 3))
                self.assertEqual(hashlib.sha256(vertices.tobytes()).hexdigest(), digest)

    def test_collapsed_small_circle_produces_finite_unchanged_geometry(self):
        zero, _ = make_zoom_mesh(width=8, height=8, intensity=0, x=.5, y=.5, radius=.01)
        for intensity in (-50, 50):
            vertices, _ = make_zoom_mesh(width=8, height=8, intensity=intensity, x=.5, y=.5, radius=.01)
            self.assertTrue(np.isfinite(vertices).all())
            np.testing.assert_array_equal(vertices, zero)


class Dispatch(unittest.TestCase):
    def setUp(self):
        self.rgba = np.full((32, 32, 4), 255, np.uint8)
        self.vertices, self.triangles = make_zoom_mesh(width=32, height=32, intensity=25,
                                                      x=.5, y=.5, radius=.25)

    def test_large_mesh_needs_explicit_float_manual_profile(self):
        kwargs = {'rgba': self.rgba, 'vertices': self.vertices, 'triangles': self.triangles,
                  'runtime': Path('/absent')}
        with patch.object(body_mesh_renderer, 'build_host', side_effect=RuntimeError('accepted')) as build:
            for settings in ({}, {'mesh_profile': 'manual-zoom'}, {'mesh_profile': 'unknown'},
                             {'mesh_profile': 'manual-zoom', 'precision': 'float',
                              'triangles': np.zeros((125001, 3), np.uint32)}):
                with self.subTest(settings=list(settings)), self.assertRaises(ValueError):
                    body_mesh_renderer.draw_mesh(**(kwargs | settings))
            build.assert_not_called()
            with self.assertRaisesRegex(RuntimeError, 'accepted'):
                body_mesh_renderer.draw_mesh(**kwargs, precision='float', mesh_profile='manual-zoom')
            build.assert_called_once()

    def test_zero_zoom_never_launches_gpu(self):
        with patch.object(manual_body_render, 'draw_mesh') as draw:
            result = manual_body_render.apply_zoom(rgba=self.rgba, intensity=0, x=.5, y=.5, radius=.2)
        draw.assert_not_called()
        np.testing.assert_array_equal(result, self.rgba)
        self.assertIsNot(result, self.rgba)

    def test_zoom_raster_is_explicit_and_uncovered_pixels_use_original(self):
        warped = self.rgba.copy()
        warped[0, 0] = 0
        warped[1, 1, :3] = 42
        with patch.object(manual_body_render, 'draw_mesh', return_value=(warped, {})) as draw:
            result = manual_body_render.apply_zoom(rgba=self.rgba, intensity=25, x=.5, y=.5,
                                                    radius=.2, runtime=Path('/empty'))
        self.assertEqual(draw.call_args.kwargs['mesh_profile'], 'manual-zoom')
        self.assertEqual(draw.call_args.kwargs['precision'], 'float')
        self.assertEqual(draw.call_args.kwargs['runtime'], Path('/empty'))
        np.testing.assert_array_equal(result[0, 0], self.rgba[0, 0])
        np.testing.assert_array_equal(result[1, 1, :3], [42, 42, 42])


if __name__ == '__main__':
    unittest.main()
