import importlib.util
import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

SPEC = importlib.util.spec_from_file_location("portrait_difference_sheets", Path(__file__).parents[1] / "create-portrait-difference-sheets.py")
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class DifferenceMapTests(unittest.TestCase):
    def test_identical_input_is_black(self):
        image = Image.new("RGB", (4, 4), (130, 100, 70))
        display, raw = MODULE.difference_map(baseline=image, adjusted=image)
        self.assertEqual(display.mode, "L")
        self.assertEqual(np.asarray(display).max(), 0)
        self.assertEqual(raw.max(), 0)

    def test_signed_channels_do_not_cancel(self):
        base = Image.new("RGB", (1, 1), (100, 100, 100))
        result = Image.new("RGB", (1, 1), (115, 85, 100))
        display, raw = MODULE.difference_map(baseline=base, adjusted=result, sigma=0)
        self.assertEqual(float(raw[0, 0]), 10)
        self.assertEqual(display.getpixel((0, 0)), 60)

    def test_local_change_stays_local_without_blur(self):
        base = Image.new("RGB", (5, 5), "black")
        result = base.copy()
        result.putpixel((2, 2), (10, 10, 10))
        display, _ = MODULE.difference_map(baseline=base, adjusted=result, sigma=0)
        self.assertEqual(np.count_nonzero(np.asarray(display)), 1)
        self.assertEqual(display.getpixel((2, 2)), 60)

    def test_gain_is_shared_not_renormalized_per_image(self):
        base = Image.new("RGB", (1, 1), "black")
        for value, expected in [(5, 30), (10, 60), (50, 255)]:
            with self.subTest(value=value):
                display, raw = MODULE.difference_map(baseline=base, adjusted=Image.new("RGB", (1, 1), (value,) * 3), sigma=0)
                self.assertEqual(display.getpixel((0, 0)), expected)
                self.assertEqual(float(raw[0, 0]), value)

    def test_rejects_mismatched_sizes(self):
        with self.assertRaises(ValueError):
            MODULE.difference_map(baseline=Image.new("RGB", (2, 2)), adjusted=Image.new("RGB", (3, 3)))

    def test_rejects_invalid_display_parameters(self):
        image = Image.new("RGB", (2, 2))
        for options in [{"gain": 0}, {"gain": np.inf}, {"sigma": -1}, {"sigma": np.nan}]:
            with self.subTest(options=options), self.assertRaises(ValueError):
                MODULE.difference_map(baseline=image, adjusted=image, **options)


if __name__ == "__main__":
    unittest.main()
