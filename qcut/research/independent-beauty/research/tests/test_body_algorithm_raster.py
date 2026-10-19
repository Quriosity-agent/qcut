"""Observed video fan interpolation and the existing photo raster profile."""
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import body_mesh_renderer as renderer


class AlgorithmRaster(unittest.TestCase):
    def setUp(self):
        self.source = np.full((777, 555, 4), 255, np.uint8)

    def test_video_expands_native_fan_without_changing_source_or_sampler(self):
        expected_uv = np.asarray([[[0, 0], [1, 0], [1, 1]],
                                  [[0, 0], [1, 1], [0, 1]]], np.float32)
        for size in ((457, 640), (631, 640), (360, 640)):
            with self.subTest(size=size), patch.object(renderer, 'draw_mesh') as draw:
                renderer.algorithm_image(rgba=self.source, runtime=Path('/absent'), output_size=size)
                call = draw.call_args.kwargs
                vertices = call['vertices']
                np.testing.assert_array_equal(vertices[call['triangles'], 3:], expected_uv)
                np.testing.assert_array_equal(vertices[:, :2],
                                              vertices[:, 3:] * [2, -2] + [-1, 1])
                self.assertIs(call['rgba'], self.source)
                self.assertEqual(call['output_size'], size)
                self.assertEqual(call['precision'], 'float')
                self.assertFalse(call['flip_source'])

    def test_photo_retains_its_existing_diagonal_and_size_policy(self):
        with patch.object(renderer, 'draw_mesh') as draw, \
                patch('detection_geometry.algorithm_size', return_value=(457, 640)) as size:
            renderer.algorithm_image(rgba=self.source, runtime=Path('/absent'))
        size.assert_called_once_with(size=(555, 777))
        call = draw.call_args.kwargs
        np.testing.assert_array_equal(call['vertices'][call['triangles'], 3:],
                                      [[[0, 0], [0, 1], [1, 0]],
                                       [[1, 0], [0, 1], [1, 1]]])
        self.assertEqual(call['output_size'], (457, 640))


if __name__ == '__main__':
    unittest.main()
