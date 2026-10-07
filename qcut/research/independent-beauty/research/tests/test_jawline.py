from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from face_metal import render
from jawline_assets import load_assets
from jawline_mapping import affine, map_points, triangle_ids
from jawline_render import run
from jawline_smooth import smooth
from jawline_support import prepare, shadow_opacity
from jawline_warp import adaptive_axis, build_mesh, sparse_warp


class JawlineTests(unittest.TestCase):
    def test_zero_bypasses_models_assets_and_both_gpu_stages(self):
        rgba = np.arange(64, dtype=np.uint8).reshape(4, 4, 4)
        rgba[..., 3] = 255
        with tempfile.TemporaryDirectory() as temporary, patch('jawline_render.predict_extra_photo') as infer, patch(
                'jawline_render.render_shadow') as shadow, patch('jawline_render.render_warp') as warp:
            root = Path(temporary)
            receipt = run(rgba=rgba, intensity=0, runtime=root/'missing', output=root/'zero.png', report=root/'zero.json')
            np.testing.assert_array_equal(np.asarray(Image.open(root/'zero.png')), rgba)
            self.assertEqual(receipt['changedPixels'], 0)
            self.assertIsNone(receipt['gpu'])
            infer.assert_not_called()
            shadow.assert_not_called()
            warp.assert_not_called()

    def test_invalid_strength_alpha_and_size_fail_before_inference(self):
        rgba = np.full((2, 2, 4), 255, np.uint8)
        with patch('jawline_render.predict_extra_photo') as infer:
            for value in (-1, 101, True, np.nan, np.inf, '80'):
                with self.assertRaises(ValueError):
                    run(rgba=rgba, intensity=value, runtime=Path('missing'), output=Path('unused'), report=Path('unused-report'))
            for invalid in (np.zeros((2, 2, 4), np.uint8), np.full((1281, 1, 4), 255, np.uint8)):
                with self.assertRaises(ValueError):
                    run(rgba=invalid, intensity=80, runtime=Path('missing'), output=Path('unused'), report=Path('unused-report'))
            infer.assert_not_called()

    def test_unverified_negative_pitch_and_edge_grid_fail_explicitly(self):
        with self.assertRaisesRegex(ValueError, 'negative-pitch'):
            prepare(points=np.zeros((106, 2), np.float32), size=(640, 640), yaw=0, pitch=-.01, assets={})
        with self.assertRaisesRegex(ValueError, 'interior face'):
            adaptive_axis(lower=np.float32(0), upper=np.float32(640), extent=640)
        with self.assertRaises(ValueError):
            adaptive_axis(lower=np.float32(20), upper=np.float32(20), extent=640)

    def test_forward_grid_expansion_does_not_use_pixel_rounding(self):
        source = np.array([[0, 0], [10, 0], [0, 10]], np.float32)
        triangles = np.array([[0, 1, 2]], np.int32)
        points = np.array([[5.1, 5], [5.3, 5]], np.float32)
        np.testing.assert_array_equal(triangle_ids(points=points, source=source, triangles=triangles, pixel_lookup=False), [0, -1])
        result, _ = map_points(points=points[:1], source=source, target=source*2+1, triangles=triangles, pixel_lookup=False)
        np.testing.assert_array_equal(result, points[:1]*2+1)
        np.testing.assert_array_equal(affine(source=source, target=source*2+1), [[2, 0, 1], [0, 2, 1]])

    def test_triangle_overwrite_order_is_retained_at_shared_edges(self):
        source = np.array([[0, 0], [10, 0], [0, 10], [10, 10]], np.float32)
        triangles = np.array([[0, 1, 2], [1, 2, 3]], np.int32)
        point = np.array([[5, 5]], np.float32)
        self.assertEqual(triangle_ids(points=point, source=source, triangles=triangles, pixel_lookup=True)[0], 1)

    def test_unmapped_points_keep_image_coordinates(self):
        source = np.array([[0, 0], [10, 0], [0, 10]], np.float32)
        points = np.array([[2, 2], [20, 20]], np.float32)
        original = points.copy()
        mapped, ids = map_points(points=points, source=source, target=source*2+1,
            triangles=np.array([[0, 1, 2]], np.int32), pixel_lookup=False)
        np.testing.assert_array_equal(ids, [0, -1])
        np.testing.assert_array_equal(mapped, [[5, 5], [20, 20]])
        np.testing.assert_array_equal(points, original)

    def test_unmapped_image_point_inside_active_canonical_cell_is_not_warped(self):
        assets = {'x_axis': np.array([-10, 0, 10, 20], np.float32),
            'y_axis': np.array([-10, 0, 10, 20], np.float32),
            'positions': np.array([5], np.int32), 'offsets': np.array([[4, 8]], np.float32)}
        points = np.array([[2, 2], [2, 2], [40, 40]], np.float32)
        original = points.copy()
        result, active = sparse_warp(points=points, covered=np.array([False, True, True]),
            strength=.5, assets=assets)
        np.testing.assert_array_equal(active, [False, True, False])
        np.testing.assert_array_equal(result[[0, 2]], points[[0, 2]])
        np.testing.assert_allclose(result[1], [3.28, 4.56], atol=1e-6)
        np.testing.assert_array_equal(points, original)

    def test_invalid_coverage_masks_fail_before_reading_assets(self):
        points = np.zeros((3, 2), np.float32)
        for covered in (None, [True]*3, np.ones(3), np.ones((3, 1), bool), np.ones(2, bool)):
            with self.assertRaisesRegex(ValueError, 'coverage flag'):
                sparse_warp(points=points, covered=covered, strength=1, assets={})

    def test_mesh_accepts_identity_margins_but_rejects_active_inverse_misses(self):
        support = np.tile(np.array([[100, 100], [300, 300]], np.float32), (119, 1))
        assets = {'base': np.zeros((106, 2), np.float32), 'triangles': np.zeros((0, 3), np.int32),
            'x_axis': np.array([-100, 0, 1000, 2000], np.float32),
            'y_axis': np.array([-100, 0, 1000, 2000], np.float32),
            'positions': np.array([5], np.int32), 'offsets': np.array([[2, 2]], np.float32)}

        for inverse_miss in (False, True):
            def mapping(*, points, pixel_lookup, **kwargs):
                ids = np.zeros(len(points), np.int32)
                if not pixel_lookup:
                    ids[0] = -1
                    return points+np.float32(100), ids
                if inverse_miss:
                    ids[100] = -1
                return points-np.float32(98), ids

            with patch('jawline_warp.prepare', return_value=support), patch(
                    'jawline_warp.push_contour', return_value=support), patch(
                    'jawline_warp.map_points', side_effect=mapping):
                arguments = dict(points=assets['base'], size=(640, 640), yaw=0, pitch=0,
                    strength=1, assets=assets)
                if inverse_miss:
                    with self.assertRaisesRegex(ValueError, 'complete inverse coverage'):
                        build_mesh(**arguments)
                    continue
                mesh, coverage = build_mesh(**arguments)
                self.assertEqual(coverage, {'gridPoints': 5329, 'mappedPoints': 5328,
                    'identityMarginPoints': 1, 'activePoints': 5328, 'activeInverseMisses': 0})
                np.testing.assert_array_equal(mesh['vertices'][0, :2], [-1, 1])
                self.assertEqual(set(mesh), {'name', 'vertices', 'triangles'})

    def test_smoothing_preserves_corners_and_uses_center_weight(self):
        grid = np.zeros((5, 5, 2), np.float32)
        grid[2, 2] = [12, 24]
        original = grid.copy()
        result = smooth(a=grid)
        np.testing.assert_array_equal(result[2, 2], [4, 8])
        np.testing.assert_array_equal(result[1, 2], [1, 2])
        np.testing.assert_array_equal(result[[0, 0, -1, -1], [0, -1, 0, -1]], 0)
        np.testing.assert_array_equal(grid, original)

    def test_mesh_projection_preserves_rounding_before_vertical_clip_scale(self):
        support = np.tile(np.array([[100, 100], [300, 300]], np.float32), (119, 1))
        positions = np.full((73, 73, 2), 500, np.float32)
        positions[40, 40:43, 1] = [621.9315795898438, 633.7267456054688, 633.6942749023438]
        assets = {'base': np.zeros((106, 2), np.float32), 'triangles': np.zeros((0, 3), np.int32)}

        def mapping(*, points, **kwargs):
            return points.copy(), np.zeros(len(points), np.int32)

        def unchanged_warp(*, points, **kwargs):
            return points.copy(), np.zeros(len(points), bool)

        with patch('jawline_warp.prepare', return_value=support), patch(
                'jawline_warp.push_contour', return_value=support), patch(
                'jawline_warp.map_points', side_effect=mapping), patch(
                'jawline_warp.sparse_warp', side_effect=unchanged_warp), patch(
                'jawline_warp.smooth', side_effect=[positions, positions]):
            mesh, _ = build_mesh(points=assets['base'], size=(1083, 1280), yaw=0,
                pitch=0, strength=.8, assets=assets)
        indices = 41*75+np.arange(41, 44)
        np.testing.assert_array_equal(mesh['vertices'][indices, 1], np.array(
            [.02823185920715332, .009801983833312988, .00985264778137207], np.float32))
        np.testing.assert_array_equal(mesh['vertices'][indices, 4], np.array(
            [.5141159296035767, .5049009919166565, .504926323890686], np.float32))

    def test_shadow_roll_uses_extra_geometry_and_clamps_pose_fade(self):
        points = np.zeros((240, 2), np.float32)
        points[[55, 58]] = [100, 100]
        points[[84, 90]] = [100, 150]
        self.assertEqual(shadow_opacity(extra=points, yaw=0, pitch=0, strength=.8), .8)
        self.assertEqual(shadow_opacity(extra=points, yaw=2, pitch=0, strength=.8), 0)
        with self.assertRaises(ValueError):
            shadow_opacity(extra=np.zeros((240, 2), np.float32), yaw=0, pitch=0, strength=1)

    def test_asset_tampering_and_unknown_gpu_profile_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)/'bad.npz'
            np.savez(path, base=np.zeros((106, 2), np.float32))
            with self.assertRaises(ValueError):
                load_assets(path=path)
        with patch('face_metal.build_host') as compiler:
            with self.assertRaises(ValueError):
                render(rgba=np.full((2, 2, 4), 255, np.uint8), passes=[], runtime=Path('missing'), profile='other')
            compiler.assert_not_called()

    def test_real_jawline_gpu_pass_preserves_orientation(self):
        rgba = np.array([[[10, 20, 30, 255], [80, 100, 120, 255]],
                         [[160, 180, 200, 255], [220, 230, 240, 255]]], np.uint8)
        vertices = np.zeros((5625, 5), np.float32)
        vertices[:4, :2] = [[-1, 1], [1, 1], [-1, -1], [1, -1]]
        vertices[:4, 3:] = [[0, 1], [1, 1], [0, 0], [1, 0]]
        triangles = np.zeros((11248, 3), np.uint16)
        triangles[:2] = [[0, 1, 2], [2, 1, 3]]
        with tempfile.TemporaryDirectory() as temporary:
            result, receipt = render(rgba=rgba, passes=[{'name': 'Jawline', 'vertices': vertices, 'triangles': triangles}],
                runtime=Path(temporary), profile='jawline')
        np.testing.assert_array_equal(result, rgba)
        self.assertEqual(receipt['passes'], ['Jawline'])
        self.assertEqual(receipt['private_native_images'], [])


if __name__ == '__main__':
    unittest.main()
