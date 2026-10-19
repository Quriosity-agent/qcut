from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from detection_resize import resize_bgr


class DetectorResizeTests(unittest.TestCase):
    def test_float32_reciprocal_controls_exact_half_weight_boundaries(self):
        pixels = np.zeros((1001, 359, 3), np.uint8)
        pixels[1::2, :, 0] = 255
        pixels[:, 1::2, 1] = 255
        pixels[:, :, 2] = 127
        output = resize_bgr(pixels=pixels, size=(320, 896))
        # Native table weights at these rows are 23, 53, 83, 113 of 128.
        np.testing.assert_array_equal(output[[1, 3, 5, 7], 0, 0], [209, 149, 89, 29])
        np.testing.assert_array_equal(output[:, :, 2], 127)

    def test_edges_replicate_when_upscaling(self):
        pixels = np.array([[[0, 10, 20], [100, 110, 120]],
                           [[200, 210, 220], [240, 250, 255]]], np.uint8)
        output = resize_bgr(pixels=pixels, size=(8, 8))
        np.testing.assert_array_equal(output[0, 0], pixels[0, 0])
        np.testing.assert_array_equal(output[0, -1], pixels[0, -1])
        np.testing.assert_array_equal(output[-1, 0], pixels[-1, 0])
        np.testing.assert_array_equal(output[-1, -1], pixels[-1, -1])

    def test_horizontal_truncation_precedes_vertical_interpolation(self):
        channel = np.array([[0, 1, 0], [1, 2, 1], [0, 1, 0]], np.uint8)
        output = resize_bgr(pixels=np.repeat(channel[:, :, None], 3, axis=2), size=(2, 2))
        np.testing.assert_array_equal(output, np.zeros((2, 2, 3), np.uint8))

    def test_identity_preserves_bytes_without_aliasing_even_for_strided_input(self):
        pixels = np.arange(9 * 11 * 3, dtype=np.uint8).reshape(9, 11, 3)[::-1, ::-1]
        before = pixels.copy()
        output = resize_bgr(pixels=pixels, size=(11, 9))
        np.testing.assert_array_equal(output, before)
        np.testing.assert_array_equal(pixels, before)
        self.assertFalse(np.shares_memory(output, pixels))

    def test_invalid_input_and_target_are_rejected(self):
        for pixels in ([], np.zeros((2, 2, 4), np.uint8), np.zeros((2, 2, 3), float),
                       np.zeros((1, 2, 3), np.uint8)):
            with self.subTest(pixels=type(pixels)), self.assertRaises(ValueError):
                resize_bgr(pixels=pixels, size=(320, 320))
        pixels = np.zeros((2, 2, 3), np.uint8)
        for size in ((0, 320), (2049, 320), (True, 320), (320., 320), [320, 320]):
            with self.subTest(size=size), self.assertRaises(ValueError):
                resize_bgr(pixels=pixels, size=size)


if __name__ == '__main__':
    unittest.main()
