import unittest
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from m4_texture import linear_samples, resize_rgba


class M4TextureTests(unittest.TestCase):
    def test_exact_texels_and_clamped_footprints(self):
        rgba = np.array([[[0, 17, 85, 255], [255, 128, 34, 0]]], np.uint8)
        points = np.array([[.5, .5], [1.5, .5], [-3, .5], [5, .5]], np.float32)
        sampled = linear_samples(rgba=rgba, coordinates=points)
        expected = rgba[0, [0, 1, 0, 1]].astype(np.float32) / np.float32(255)
        np.testing.assert_array_equal(sampled, expected)

    def test_half_footprint_is_quantized_before_byte_conversion(self):
        rgba = np.array([[[0, 1, 254, 255], [1, 2, 255, 0]]], np.uint8)
        sampled = linear_samples(rgba=rgba, coordinates=np.array([[1., .5]], np.float64))
        np.testing.assert_array_equal(sampled * np.float32(4080), [[8, 24, 4072, 2040]])
        pixels = np.floor(sampled.astype(np.float64) * 255 + .5).astype(np.uint8)
        np.testing.assert_array_equal(pixels, [[1, 2, 254, 128]])

    def test_identity_resize_keeps_every_byte_and_input(self):
        frame = np.arange(256, dtype=np.uint8).reshape(8, 8, 4)
        original = frame.copy()
        np.testing.assert_array_equal(resize_rgba(frame=frame, size=(8, 8)), frame)
        np.testing.assert_array_equal(frame, original)

    def test_refuses_unverified_coordinates_and_frames(self):
        frame = np.zeros((1, 1, 4), np.uint8)
        for value in (np.array([[np.nan, 0.]]), np.array([[1e-9, 0.]]),
                      np.array([[9., 0.]]), np.zeros((3, 3)), np.zeros((1, 2), np.int64)):
            with self.assertRaises(ValueError):
                linear_samples(rgba=frame, coordinates=value)
        with self.assertRaises(ValueError):
            resize_rgba(frame=frame, size=(True, 4))


if __name__ == '__main__':
    unittest.main()
