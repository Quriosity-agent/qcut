import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from contacts_geometry import pupil_mesh
from contacts_layers import weights


class ContactsGeometryTests(unittest.TestCase):
    def setUp(self):
        self.extra = np.zeros((240, 2), np.float32)
        for side in range(2):
            eye = self.extra[196+22*side:218+22*side]
            eye[11, 0] = 10
            eye[[5, 6], 1] = 1
            eye[[16, 17], 1] = -1
        self.pupil = np.arange(80, dtype=np.float32).reshape(40, 2)

    def test_two_rings_keep_centers_and_expand_only_the_boundary(self):
        original = self.pupil.copy()
        mesh = pupil_mesh(extra=self.extra, pupil=self.pupil)
        self.assertEqual(mesh.shape, (78, 3))
        for side in range(2):
            part = mesh[39*side:39*(side+1)]
            pupil = self.pupil[20*side:20*(side+1)]
            np.testing.assert_array_equal(part[:20, :2], pupil)
            np.testing.assert_allclose(part[:20, 2], .4, atol=.000001)
            np.testing.assert_array_equal(part[20:, 2], 0)
            np.testing.assert_allclose(part[20:, :2]-pupil[0], (pupil[1:]-pupil[0])*1.1, atol=.00001)
        np.testing.assert_array_equal(self.pupil, original)

    def test_coincident_corners_nonfinite_and_wrong_cardinality_are_rejected(self):
        for extra, pupil in ((self.extra*0, self.pupil), (self.extra, self.pupil[:39]),
                (self.extra.astype(float), self.pupil), (self.extra, self.pupil*np.nan)):
            with self.assertRaises(ValueError):
                pupil_mesh(extra=extra, pupil=pupil)

    def test_weight_interpolation_crosses_tile_boundary_without_a_gap(self):
        positions = np.zeros((78, 3), np.float32)
        positions[:3] = [[510, 0, .5], [515, 0, .5], [510, 5, .5]]
        triangles = np.array([[0, 1, 2]], np.uint16)
        result = weights(positions=positions, triangles=triangles, size=(514, 2))
        np.testing.assert_array_equal(result[0, 510:514, 0], .5)
        np.testing.assert_array_equal(result[0, :510, 0], 0)

    def test_weight_allocation_budget_is_validated_first(self):
        positions = np.zeros((78, 3), np.float32)
        for size in ((1281, 1), (1, False), (-1, 1), [1, 1]):
            with self.assertRaises(ValueError):
                weights(positions=positions, triangles=np.array([[0, 1, 2]], np.uint16), size=size)


if __name__ == '__main__':
    unittest.main()
