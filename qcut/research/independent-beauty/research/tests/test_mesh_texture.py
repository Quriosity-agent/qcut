import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mesh_texture import linear_samples


class MeshTextureTests(unittest.TestCase):
    def test_premultiplication_keeps_sub_byte_colors_before_spatial_interpolation(self):
        rgba = np.array([[[100, 0, 0, 1], [0, 100, 0, 255]]], np.uint8)
        coordinates = np.array([[1., .5]])
        actual = linear_samples(rgba=rgba, coordinates=coordinates, premultiply=True)
        np.testing.assert_allclose(actual, [[50/255, 50, 0, 128]], rtol=0, atol=1e-12)
        np.testing.assert_array_equal(linear_samples(rgba=rgba, coordinates=coordinates), [[50, 50, 0, 128]])

    def test_premultiplied_sampling_clamps_edges_and_preserves_input(self):
        rgba = np.array([[[100, 30, 20, 128]]], np.uint8)
        original = rgba.copy()
        actual = linear_samples(rgba=rgba, coordinates=np.array([[-5., 10.]]), premultiply=True)
        np.testing.assert_allclose(actual, [[100*128/255, 30*128/255, 20*128/255, 128]])
        np.testing.assert_array_equal(rgba, original)
        with self.assertRaises(ValueError):
            linear_samples(rgba=rgba, coordinates=np.array([[0., 0.]]), premultiply=1)


if __name__ == '__main__':
    unittest.main()
