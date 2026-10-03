"""Uniform grayscale uses RGB max at a fixed gain, never per-frame scaling."""
import unittest

import face_live_validation_report as report


class DifferenceTests(unittest.TestCase):
    def test_black_exact_difference(self):
        values, image = report.difference(actual=b"\1\2\3\xff", reference=b"\1\2\3\xff", width=1, height=1)
        self.assertEqual(values, dict(rgb_mae=0, rgb_max=0, alpha_max=0, changed_pixels=0))
        self.assertEqual(image.tobytes(), b"\0")

    def test_small_rgb_difference_is_not_normalized(self):
        values, image = report.difference(actual=b"\3\7\2\xff", reference=b"\1\2\3\xff", width=1, height=1)
        self.assertEqual(values, dict(rgb_mae=8 / 3, rgb_max=5, alpha_max=0, changed_pixels=1))
        self.assertEqual(image.tobytes(), bytes([40]))

    def test_alpha_only_difference_remains_separate(self):
        values, image = report.difference(actual=b"\1\2\3\x80", reference=b"\1\2\3\xff", width=1, height=1)
        self.assertEqual(values, dict(rgb_mae=0, rgb_max=0, alpha_max=127, changed_pixels=1))
        self.assertEqual(image.tobytes(), b"\0")

    def test_gain_saturates_without_wrapping(self):
        values, image = report.difference(actual=bytes([255, 0, 0, 255]), reference=bytes([0, 0, 0, 255]), width=1, height=1)
        self.assertEqual(image.tobytes(), b"\xff")
        self.assertEqual(values["rgb_max"], 255)

    def test_wrong_size_rejected(self):
        with self.assertRaisesRegex(ValueError, "dimensions"):
            report.difference(actual=b"abc", reference=b"abc", width=1, height=1)


if __name__ == "__main__":
    unittest.main()
