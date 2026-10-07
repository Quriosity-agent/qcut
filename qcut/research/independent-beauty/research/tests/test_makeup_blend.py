import sys
from pathlib import Path
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from makeup_blend import MODES, compose


class MakeupBlendTests(unittest.TestCase):
    def test_transparent_pigment_and_zero_controls_preserve_source(self):
        base = np.array([[.1, .2, .3, .5]], np.float32)
        pigment = np.zeros_like(base)
        for mode in MODES:
            np.testing.assert_array_equal(compose(base=base, pigment=pigment, strength=1, mode=mode), base)
            np.testing.assert_array_equal(compose(base=base, pigment=base, strength=0, mode=mode), base)
            np.testing.assert_array_equal(compose(base=base, pigment=base, strength=1, opacity=0, mode=mode), base)

    def test_normal_half_opaque_pigment(self):
        base = np.array([[0, 0, 1, 1]], np.float32)
        pigment = np.array([[1, 0, 0, 1]], np.float32)
        np.testing.assert_array_equal(compose(base=base, pigment=pigment, strength=.5, mode="normal"), [[.5, 0, .5, 1]])

    def test_screen_and_multiply_endpoints(self):
        base = np.array([[.2, .4, .6, 1]], np.float32)
        white, black = np.ones_like(base), np.array([[0, 0, 0, 1]], np.float32)
        np.testing.assert_array_equal(compose(base=base, pigment=white, strength=1, mode="multiply"), base)
        np.testing.assert_array_equal(compose(base=base, pigment=black, strength=1, mode="multiply"), black)
        np.testing.assert_array_equal(compose(base=base, pigment=white, strength=1, mode="screen"), white)
        np.testing.assert_allclose(compose(base=base, pigment=black, strength=1, mode="screen"), base, atol=1e-7)

    def test_color_preserves_base_lightness(self):
        base = np.array([[.2, .4, .6, 1], [.1, .8, .2, 1], [0, 0, 0, 1]], np.float32)
        pigment = np.tile(np.array([[.8, .1, .3, 1]], np.float32), (3, 1))
        result = compose(base=base, pigment=pigment, strength=1, mode="color")
        lightness = lambda values: (values[:, :3].max(axis=1) + values[:, :3].min(axis=1)) / 2
        np.testing.assert_allclose(lightness(result), lightness(base), atol=1e-7)
        self.assertGreater(result[0, 0], result[0, 1])

    def test_translucent_composite_and_all_transparent_are_finite(self):
        base = np.array([[0, 0, .5, .5], [0, 0, 0, 0]], np.float32)
        pigment = np.array([[.5, 0, 0, .5], [0, 0, 0, 0]], np.float32)
        for mode in MODES:
            result = compose(base=base, pigment=pigment, strength=1, mode=mode)
            self.assertTrue(np.isfinite(result).all())
            self.assertEqual(result[0, 3], .75)
            np.testing.assert_array_equal(result[1], [0, 0, 0, 0])
            self.assertTrue(np.all(result[:, :3] <= result[:, 3:4] + 1e-7))

    def test_invalid_parameters_fail(self):
        base = np.array([[.2, .3, .4, 1]], np.float32)
        for strength in (True, float("nan"), float("inf"), -1, 2, "1"):
            with self.subTest(strength=strength), self.assertRaises(ValueError):
                compose(base=base, pigment=base, strength=strength, mode="normal")
        for pigment in (base.astype(np.float64), np.array([[1, 0, 0, 0]], np.float32), np.ones((2, 4), np.float32)):
            with self.assertRaises(ValueError):
                compose(base=base, pigment=pigment, strength=1, mode="normal")
        with self.assertRaises(ValueError):
            compose(base=base, pigment=base, strength=1, mode="unknown")


if __name__ == "__main__":
    unittest.main()
