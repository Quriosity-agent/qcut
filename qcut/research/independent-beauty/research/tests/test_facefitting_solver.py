from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from facefitting_geometry import MorphableModel, reconstruct
from facefitting_pose import camera_parameters, project, rodrigues
from facefitting_solver import _rotation_vector, solve


def synthetic_model():
    rng = np.random.default_rng(73)
    basis = np.zeros((82, 1834, 3), np.float32)
    xy = rng.uniform(-3, 3, (221, 2))
    basis[0, -221:] = np.column_stack((xy, 0.15 * np.sum(xy ** 2, axis=1) + rng.uniform(-0.2, 0.2, 221)))
    basis[1:, -221:] = rng.normal(0, 0.001, (81, 221, 3))
    return MorphableModel(basis=basis, landmark_basis=basis[:, -221:].copy(),
                         point_weights=np.full(221, 0.1, np.float32), coefficient_weights=np.r_[np.float32(0), np.ones(81, np.float32)],
                         triangles=np.zeros((3056, 3), np.uint16), uv=np.zeros((1613, 2), np.float32),
                         expression_names=tuple(f'expr{index}' for index in range(52)),
                         auxiliary_vertices=np.zeros((790, 3), np.float32), auxiliary_triangles=np.zeros((1472, 3), np.uint16),
                         auxiliary_uv=np.zeros((770, 2), np.float32))


class PoseTests(unittest.TestCase):
    def test_rodrigues_zero_small_and_pi_are_proper_rotations(self):
        for vector in ([0, 0, 0], [1e-10, -2e-10, 0], [0, 0, np.pi], [0.3, -0.5, 2.9]):
            rotation = rodrigues(vector=vector)
            np.testing.assert_allclose(rotation.T @ rotation, np.eye(3), atol=1e-12)
            self.assertAlmostEqual(np.linalg.det(rotation), 1)
            np.testing.assert_allclose(rodrigues(vector=_rotation_vector(matrix=rotation)), rotation, atol=1e-7)

    def test_projection_uses_negative_depth_and_flips_vertical_coordinate_once(self):
        result = project(vertices=np.array([[1, 2, 0], [-1, -2, 0]], np.float32),
                         pose=np.array([0, 0, 0, 0, 0, -10]), camera=np.array([100, 200, 150]), height=300)
        np.testing.assert_array_equal(result['image_points'], [[190, 170], [210, 130]])
        np.testing.assert_array_equal(result['camera_vertices'][:, 2], [-10, -10])

    def test_camera_and_projection_reject_invalid_or_singular_inputs(self):
        for size in ((100, 640), (640, 0), (10000, 640), (640.0, 640), (True, 640)):
            with self.assertRaises(ValueError):
                camera_parameters(size=size)
        for field_of_view in (0, 91, np.nan):
            with self.assertRaises(ValueError):
                camera_parameters(size=(640, 640), fov_degrees=field_of_view)
        with self.assertRaises(ValueError):
            project(vertices=np.zeros((1, 3)), pose=np.zeros(6), camera=np.array([100, 200, 150]), height=300)
        with self.assertRaises(ValueError):
            rodrigues(vector=[np.inf, 0, 0])


class SolverTests(unittest.TestCase):
    def setUp(self):
        self.model = synthetic_model()
        self.size = (640, 640)
        self.pose = np.array([0.1, -0.2, 3.05, 0.5, -0.3, -30.0])
        self.points = project(vertices=self.model.landmark_basis[0], pose=self.pose,
                              camera=camera_parameters(size=self.size), height=self.size[1])['image_points']

    def test_recovers_neutral_geometry_from_exact_synthetic_projection(self):
        result = solve(model=self.model, points=self.points, size=self.size)
        np.testing.assert_allclose(result['image_points'], self.points, atol=1e-4, rtol=0)
        np.testing.assert_allclose(result['vertices'], reconstruct(model=self.model, coefficients=np.r_[np.float32(1), np.zeros(81, np.float32)])['vertices'], atol=1e-6)
        np.testing.assert_allclose(result['pose'], self.pose, atol=2e-5, rtol=0)

    def test_fortran_layout_and_noncontiguous_input_are_supported_without_mutation(self):
        original = self.points.copy()
        result = solve(model=self.model, points=np.asfortranarray(self.points), size=self.size)
        reversed_points = self.points[::-1].copy()[::-1]
        other = solve(model=self.model, points=reversed_points, size=self.size)
        np.testing.assert_array_equal(result['coefficients'], other['coefficients'])
        np.testing.assert_array_equal(self.points, original)

    def test_rejects_bad_points_degenerate_geometry_and_iteration_budget(self):
        for points in (self.points.astype(np.float64), self.points[:-1], self.points.reshape(1, 442),
                       np.zeros((221, 2), np.float32), np.ones((221, 2), np.float32),
                       np.full((221, 2), np.inf, np.float32), np.full((221, 2), 1e7, np.float32)):
            with self.assertRaises(ValueError):
                solve(model=self.model, points=points, size=self.size)
        for iterations in (0, 101, 1.0, True):
            with self.assertRaises(ValueError):
                solve(model=self.model, points=self.points, size=self.size, iterations=iterations)


if __name__ == '__main__':
    unittest.main()
