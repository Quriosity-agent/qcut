"""The native two-half neck warp shares its left-half degenerate-radius gate."""
import copy
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from body_composition.neck.geometry import deform


class NeckDegenerateRadius(unittest.TestCase):
    def setUp(self):
        self.source = np.stack(np.meshgrid(np.linspace(0, 100, 11, dtype=np.float32),
                                          np.linspace(0, 100, 11, dtype=np.float32)), axis=-1)
        self.halves = [{'center': [50, 50], 'axis': [1, 0], 'perpendicular': [0, 1],
                       'radii': [40, 40, 40, 40], 'bounds': [0, 100, 0, 100]} for _ in range(2)]

    def test_left_degeneracy_suppresses_the_valid_right_half_and_preserves_destination(self):
        destination = self.source + np.float32(.5)
        for index in (0, 2, 3):
            for value in (0, np.float32(2 ** -24), np.float32(-2 ** -24)):
                halves = copy.deepcopy(self.halves)
                halves[0]['radii'][index] = value
                with self.subTest(index=index, value=value):
                    result = deform(self.source, .5, halves, destination=destination)
                    np.testing.assert_array_equal(result, destination)
                    self.assertFalse(np.shares_memory(result, destination))

    def test_epsilon_boundary_is_strict_and_allows_the_valid_right_half(self):
        self.halves[0]['radii'][0] = np.finfo(np.float32).eps
        result = deform(self.source, .5, self.halves)
        self.assertGreater(float(np.abs(result[:, 6:] - self.source[:, 6:]).max()), 0)

    def test_first_half_unused_right_radius_is_not_part_of_the_shared_gate(self):
        expected = deform(self.source, .5, self.halves)
        self.halves[0]['radii'][1] = 0
        np.testing.assert_array_equal(deform(self.source, .5, self.halves), expected)

    def test_uninitialized_halves_leave_the_destination_unchanged(self):
        destination = self.source + np.float32(.5)
        np.testing.assert_array_equal(deform(self.source, 0, [], destination=destination), destination)


if __name__ == '__main__':
    unittest.main()
