import sys
from pathlib import Path
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from liquefy_geometry import build_steps, warp_coordinates


class LiquefyGeometryTests(unittest.TestCase):
    def setUp(self):
        self.steps = {"start": np.array([[0, 0]], np.float32), "end": np.array([[2, 0]], np.float32),
                      "action": np.array([0], np.float32), "strength": np.array([.5], np.float32),
                      "radius": np.array([4], np.float32)}

    def test_stretch_center_boundary_and_exterior(self):
        values = np.array([[0, 0], [0, 2], [4, 0], [8, 0]], np.float32)
        output = warp_coordinates(coordinates=values, steps=self.steps)
        np.testing.assert_array_equal(output, [[-1, 0], [-.5, 2], [4, 0], [8, 0]])
        np.testing.assert_array_equal(values, [[0, 0], [0, 2], [4, 0], [8, 0]])

    def test_ordered_warps_use_previous_coordinates(self):
        steps = {name: np.concatenate((value, value)) for name, value in self.steps.items()}
        output = warp_coordinates(coordinates=np.array([[0, 0]], np.float32), steps=steps)
        np.testing.assert_array_equal(output, [[-1.75, 0]])

    def test_zero_strength_is_identity_for_every_action(self):
        for action in (0, 1, 2):
            self.steps["action"][0] = action
            self.steps["strength"][0] = 0
            values = np.array([[0, 0], [2, 0], [4, 4]], np.float32)
            np.testing.assert_array_equal(warp_coordinates(coordinates=values, steps=self.steps), values)

    def test_radial_modes_preserve_center_and_exterior(self):
        values = np.array([[2, 0], [10, 0]], np.float32)
        for action in (1, 2):
            self.steps["action"][0] = action
            np.testing.assert_array_equal(warp_coordinates(coordinates=values, steps=self.steps), values)

    def test_narrow_cannot_divide_by_zero(self):
        self.steps["action"][0] = 2
        self.steps["strength"][0] = 1
        values = np.array([[2.00001, 0]], np.float32)
        self.assertTrue(np.isfinite(warp_coordinates(coordinates=values, steps=self.steps)).all())

    def test_builder_does_not_mutate_inputs(self):
        points = np.full((106, 2), .5, np.float32)
        points[74, 0], points[77, 0] = .25, .75
        records = np.array([[0, 1, 0, 0, 1, 0, 16, 1, .5]], np.float32)
        original = points.copy()
        output = build_steps(points=points, records=records, size=(200, 100), yaw_radians=0)
        np.testing.assert_array_equal(output["start"], [[100, 50]])
        self.assertGreater(output["end"][0, 0], output["start"][0, 0])
        np.testing.assert_array_equal(points, original)
        self.assertEqual(output["radius"].dtype, np.float32)

    def test_malformed_inputs_fail_before_render(self):
        for field, value in (("radius", np.array([0], np.float32)), ("action", np.array([3], np.float32)),
                             ("strength", np.array([np.nan], np.float32)), ("start", np.array([[0, 0]], np.float64))):
            with self.subTest(field=field), self.assertRaises(ValueError):
                warp_coordinates(coordinates=np.zeros((1, 2), np.float32), steps={**self.steps, field: value})
        with self.assertRaises(ValueError):
            warp_coordinates(coordinates=np.zeros((1, 2), np.float64), steps=self.steps)
        with self.assertRaises(ValueError):
            build_steps(points=np.zeros((106, 2), np.float32), records=np.zeros((1, 9), np.float32), size=(100, 100), yaw_radians=True)


if __name__ == "__main__":
    unittest.main()
