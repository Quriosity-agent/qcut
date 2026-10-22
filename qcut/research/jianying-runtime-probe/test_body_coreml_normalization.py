import unittest

import numpy as np

from body_coreml_normalization import normalize_body_coreml_input


class BodyCoremlNormalization(unittest.TestCase):
    def test_half_point_is_not_zero_and_endpoints_use_fused_rounding(self):
        pixels = np.array([[[0, 128, 255]]], np.uint8)
        actual = normalize_body_coreml_input(bgr=pixels)
        np.testing.assert_array_equal(actual.view(np.uint32), np.array([[[0xc0000000, 0x3c008100, 0x40000001]]], np.uint32))

    def test_every_byte_round_trips_with_channels_and_strides_preserved(self):
        pixels = np.repeat(np.arange(256, dtype=np.uint8)[:, None, None], 3, axis=2)
        source = pixels[::-1]
        original = pixels.copy()
        output = normalize_body_coreml_input(bgr=source)
        decoded = np.rint((output.astype(np.float64) + 2) * 63.75).astype(np.uint8)
        np.testing.assert_array_equal(decoded, source)
        np.testing.assert_array_equal(pixels, original)
        self.assertFalse(np.shares_memory(output, source))
        self.assertEqual(output.dtype, np.float32)

    def test_rejects_ambiguous_layout_and_nonbyte_input(self):
        for image in (np.zeros((2, 2, 4), np.uint8), np.zeros((2, 2, 3), np.float32),
                      np.zeros((2, 2), np.uint8), np.zeros((0, 1, 3), np.uint8)):
            with self.assertRaises(ValueError):
                normalize_body_coreml_input(bgr=image)


if __name__ == "__main__":
    unittest.main()
