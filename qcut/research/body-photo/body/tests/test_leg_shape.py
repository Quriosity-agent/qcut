"""Pose-localized leg widths preserve endpoints and safe mesh orientation."""
import unittest

import numpy as np

from body.leg_shape import build_leg_delta, resample_grid_delta, safe_leg_delta


WIDTH = 1000
HEIGHT = 1600
NAMES = ("ThighWidth", "CalfWidth")


def grid(*, width=WIDTH, height=HEIGHT, rows=80, columns=80):
    x = np.linspace(0, width, columns + 1, dtype=np.float32)
    y = np.linspace(0, height, rows + 1, dtype=np.float32)
    return np.stack(np.meshgrid(x, y), axis=-1).astype(np.float32)


def upright_pose():
    pose = np.zeros((18, 4), dtype=np.float32)
    pose[:, :2] = [500, 300]
    pose[:, 2:] = [.95, 1]
    for index, point in {2: (300, 350), 5: (700, 350), 8: (350, 600), 9: (350, 1000),
                         10: (350, 1450), 11: (650, 600), 12: (650, 1000),
                         13: (650, 1450)}.items():
        pose[index, :2] = point
    return pose


def triangles(*, rows, columns):
    result = []
    for row in range(rows):
        for column in range(columns):
            a = row * (columns + 1) + column
            b = a + 1
            c = a + columns + 1
            d = c + 1
            result.extend(((a, c, d), (a, d, b)))
    return np.asarray(result, dtype=np.uint32)


def signed_areas(*, positions, indices):
    points = positions.reshape(-1, 2)[indices]
    first = points[:, 1] - points[:, 0]
    second = points[:, 2] - points[:, 0]
    return first[:, 0] * second[:, 1] - first[:, 1] * second[:, 0]


class LegShapeTests(unittest.TestCase):
    def setUp(self):
        self.base = grid()
        self.pose = upright_pose()

    def build(self, *, controls, pose=None, base=None, algorithm_size=None, width=WIDTH, height=HEIGHT):
        return build_leg_delta(base=self.base if base is None else base,
                               pose=self.pose if pose is None else pose,
                               algorithm_size=[WIDTH, HEIGHT] if algorithm_size is None else algorithm_size,
                               width=width, height=height, controls=controls)

    def test_zero_controls_do_not_need_pose_or_change_the_grid(self):
        delta, parts = build_leg_delta(base=self.base, pose=None, algorithm_size=[640, 400],
                                      width=WIDTH, height=HEIGHT, controls=dict.fromkeys(NAMES, 0))
        self.assertEqual(delta.dtype, np.float32)
        np.testing.assert_array_equal(delta, np.zeros_like(self.base))
        self.assertEqual(set(parts), set(NAMES))
        self.assertFalse(any(part["moved"] for part in parts.values()))

    def test_each_signed_control_moves_both_leg_sides_in_the_correct_direction(self):
        # Y-up 800 is the thigh midpoint; 400 lies inside the calf segment.
        for name, row in (("ThighWidth", 40), ("CalfWidth", 20)):
            for strength in (-50, 50):
                with self.subTest(name=name, strength=strength):
                    delta, parts = self.build(controls={name: strength})
                    self.assertTrue(parts[name]["moved"])
                    self.assertEqual(len(parts[name]["sides"]), 2)
                    self.assertTrue(all(side["moved"] for side in parts[name]["sides"]))
                    for center_column in (28, 52):
                        left = delta[row, center_column - 2, 0]
                        right = delta[row, center_column + 2, 0]
                        self.assertLess(left * strength, 0)
                        self.assertGreater(right * strength, 0)
                        np.testing.assert_array_equal(delta[row, center_column], [0, 0])
                    np.testing.assert_array_equal(delta[..., 1], 0)

    def test_segment_endpoints_far_pixels_and_entire_canvas_boundary_stay_fixed(self):
        for name in NAMES:
            with self.subTest(name=name):
                delta, _ = self.build(controls={name: 50})
                for row in (0, -1):
                    np.testing.assert_array_equal(delta[row], 0)
                for column in (0, -1):
                    np.testing.assert_array_equal(delta[:, column], 0)
                for index in (8, 9, 11, 12):
                    x, top_y = self.pose[index, :2]
                    row, column = round((HEIGHT - top_y) / 20), round(x / 12.5)
                    np.testing.assert_array_equal(delta[row, column], 0)
                np.testing.assert_array_equal(delta[60:], 0)
                np.testing.assert_array_equal(delta[:, :10], 0)
                np.testing.assert_array_equal(delta[:, -10:], 0)
                if name == "ThighWidth":
                    np.testing.assert_array_equal(delta[:30], 0)
                else:
                    np.testing.assert_array_equal(delta[31:], 0)

    def test_algorithm_pixels_scale_to_source_with_independent_axis_factors(self):
        expected, _ = self.build(controls={"ThighWidth": -50, "CalfWidth": 50})
        scaled_pose = self.pose.copy()
        scaled_pose[:, 0] *= .64
        scaled_pose[:, 1] *= .25
        actual, parts = self.build(controls={"ThighWidth": -50, "CalfWidth": 50},
                                   pose=scaled_pose, algorithm_size=[640, 400])
        np.testing.assert_allclose(actual, expected, atol=1e-4, rtol=1e-5)
        self.assertTrue(all(part["moved"] for part in parts.values()))

    def test_anisotropic_photo_dimensions_keep_the_detected_segment_local(self):
        pose = self.pose.copy()
        pose[:, 0] *= 1.5
        base = grid(width=1500)
        delta, parts = self.build(controls={"ThighWidth": 50}, pose=pose, base=base,
                                  algorithm_size=[1500, HEIGHT], width=1500)
        self.assertTrue(parts["ThighWidth"]["moved"])
        self.assertGreater(np.count_nonzero(delta), 0)
        np.testing.assert_array_equal(delta[:30], 0)
        np.testing.assert_array_equal(delta[51:], 0)
        np.testing.assert_array_equal(delta[:, :10], 0)
        np.testing.assert_array_equal(delta[:, -10:], 0)

    def test_mirroring_subject_and_photo_mirrors_the_displacement(self):
        pose = self.pose.copy()
        pose[8:11, 0] -= 30
        pose[11:14, 0] += 50
        original, _ = self.build(controls={"ThighWidth": -50, "CalfWidth": 50}, pose=pose)
        mirrored_pose = pose.copy()
        mirrored_pose[:, 0] = WIDTH - mirrored_pose[:, 0]
        mirrored_pose[8:11] = mirrored_pose[[11, 12, 13]].copy()
        mirrored_pose[11:14] = np.column_stack((WIDTH - pose[8:11, 0], pose[8:11, 1:]))
        mirrored, _ = self.build(controls={"ThighWidth": -50, "CalfWidth": 50}, pose=mirrored_pose)
        expected = original[:, ::-1].copy()
        expected[..., 0] *= -1
        np.testing.assert_allclose(mirrored, expected, atol=1e-4, rtol=1e-5)

    def test_one_missing_leg_disables_that_control_instead_of_silently_shaping_one_side(self):
        for name, index in (("ThighWidth", 8), ("ThighWidth", 12),
                            ("CalfWidth", 9), ("CalfWidth", 13)):
            pose = self.pose.copy()
            pose[index, 3] = 0
            with self.subTest(name=name, index=index):
                delta, parts = self.build(controls={name: 50}, pose=pose)
                self.assertFalse(parts[name]["moved"])
                self.assertTrue(parts[name]["reason"])
                np.testing.assert_array_equal(delta, 0)

    def test_invalid_low_confidence_and_off_image_endpoints_are_unavailable(self):
        mutations = ((0, np.nan), (1, np.inf), (2, np.nan), (2, .19), (0, -1),
                     (0, WIDTH + 1), (1, HEIGHT + 1))
        for name, index in (("ThighWidth", 8), ("CalfWidth", 13)):
            for column, value in mutations:
                pose = self.pose.copy()
                pose[index, column] = value
                with self.subTest(name=name, column=column, value=value):
                    delta, parts = self.build(controls={name: 50}, pose=pose)
                    self.assertFalse(parts[name]["moved"])
                    self.assertTrue(parts[name]["reason"])
                    self.assertTrue(np.isfinite(delta).all())
                    np.testing.assert_array_equal(delta, 0)

    def test_scores_above_one_are_accepted_and_no_face_or_head_is_required(self):
        pose = self.pose.copy()
        pose[:8] = [-1, -1, 0, 0]
        pose[8:14, 2] = 1.05
        delta, parts = self.build(controls={"ThighWidth": 50, "CalfWidth": 50}, pose=pose)
        self.assertTrue(all(part["moved"] for part in parts.values()))
        self.assertGreater(np.count_nonzero(delta), 0)

    def test_short_bones_and_crossed_legs_fail_closed(self):
        short = self.pose.copy()
        short[9, :2] = short[8, :2] + [0, 20]
        crossed = self.pose.copy()
        crossed[9, 0], crossed[12, 0] = 700, 300
        for pose in (short, crossed):
            with self.subTest(pose=pose[8:14].tolist()):
                delta, parts = self.build(controls={"ThighWidth": 50}, pose=pose)
                self.assertFalse(parts["ThighWidth"]["moved"])
                self.assertTrue(parts["ThighWidth"]["reason"])
                np.testing.assert_array_equal(delta, 0)

    def test_zero_and_malformed_pose_are_reported_without_nonfinite_geometry(self):
        for pose in (None, np.empty((0, 4), np.float32), np.zeros((17, 4), np.float32),
                     np.zeros((18, 4), np.float32)):
            with self.subTest(shape=None if pose is None else pose.shape):
                delta, parts = build_leg_delta(base=self.base, pose=pose, algorithm_size=[WIDTH, HEIGHT],
                                              width=WIDTH, height=HEIGHT,
                                              controls={"ThighWidth": 50, "CalfWidth": -50})
                self.assertTrue(np.isfinite(delta).all())
                np.testing.assert_array_equal(delta, 0)
                for part in parts.values():
                    self.assertFalse(part["moved"])
                    self.assertTrue(part["reason"])

    def test_build_does_not_mutate_caller_arrays_or_control_dictionary(self):
        base, pose = self.base.copy(), self.pose.copy()
        controls = {"ThighWidth": -50, "CalfWidth": 50}
        delta, _ = self.build(controls=controls)
        np.testing.assert_array_equal(self.base, base)
        np.testing.assert_array_equal(self.pose, pose)
        self.assertEqual(controls, {"ThighWidth": -50, "CalfWidth": 50})
        self.assertFalse(np.shares_memory(delta, self.base))
        self.assertFalse(np.shares_memory(delta, self.pose))


class SafeLegMeshTests(unittest.TestCase):
    def setUp(self):
        self.base = grid(width=100, height=160, rows=8, columns=5)
        self.indices = triangles(rows=8, columns=5)
        self.zero = np.zeros_like(self.base)

    def apply(self, *, existing=None, delta):
        return safe_leg_delta(base=self.base, existing_delta=self.zero if existing is None else existing,
                              leg_delta=delta, triangles=self.indices)

    def assert_orientation(self, *, positions):
        reference = signed_areas(positions=self.base, indices=self.indices)
        actual = signed_areas(positions=positions, indices=self.indices)
        self.assertTrue(np.all(actual * reference > 0))

    def test_zero_displacement_has_zero_scale_and_exact_zero_result(self):
        delta, scale = self.apply(delta=self.zero)
        self.assertEqual(scale, 0)
        np.testing.assert_array_equal(delta, self.zero)

    def test_safe_displacement_keeps_full_strength_and_array_ownership(self):
        requested = np.zeros_like(self.base)
        requested[2:6, 2:4, 0] = 2
        before = requested.copy()
        delta, scale = self.apply(delta=requested)
        self.assertEqual(scale, 1)
        np.testing.assert_array_equal(delta, requested)
        np.testing.assert_array_equal(requested, before)
        self.assertFalse(np.shares_memory(delta, requested))
        self.assert_orientation(positions=self.base + delta)

    def test_folding_request_is_backed_off_before_it_can_invert_triangles(self):
        requested = np.zeros_like(self.base)
        requested[:, 2, 0] = 200
        delta, scale = self.apply(delta=requested)
        self.assertGreater(scale, 0)
        self.assertLess(scale, 1)
        np.testing.assert_allclose(delta, requested * scale)
        self.assert_orientation(positions=self.base + delta)

    def test_existing_fold_is_not_claimed_as_repaired_by_new_leg_strength(self):
        existing = np.zeros_like(self.base)
        existing[..., 0] = -2 * self.base[..., 0]
        requested = np.zeros_like(self.base)
        requested[3, 2, 0] = 1
        delta, scale = self.apply(existing=existing, delta=requested)
        self.assertEqual(scale, 0)
        np.testing.assert_array_equal(delta, 0)

    def test_nonfinite_request_is_rejected_without_poisoning_positions(self):
        for value in (np.nan, np.inf, -np.inf):
            requested = np.zeros_like(self.base)
            requested[3, 2, 0] = value
            with self.subTest(value=value):
                delta, scale = self.apply(delta=requested)
                self.assertEqual(scale, 0)
                self.assertTrue(np.isfinite(delta).all())
                np.testing.assert_array_equal(delta, 0)

    def test_safety_check_preserves_every_caller_input(self):
        existing = np.zeros_like(self.base)
        existing[3, 2, 1] = 1
        requested = np.zeros_like(self.base)
        requested[3, 3, 0] = 100
        snapshots = [item.copy() for item in (self.base, existing, requested, self.indices)]
        self.apply(existing=existing, delta=requested)
        for actual, snapshot in zip((self.base, existing, requested, self.indices), snapshots):
            np.testing.assert_array_equal(actual, snapshot)


class ResampleLegMeshTests(unittest.TestCase):
    def test_affine_displacement_is_exact_on_a_different_rectangular_grid(self):
        source_grid = grid(width=150, height=200, rows=3, columns=5)
        source = np.empty_like(source_grid)
        source[..., 0] = source_grid[..., 0] * .1 + source_grid[..., 1] * .2 + 3
        source[..., 1] = source_grid[..., 0] * -.2 + source_grid[..., 1] * .3 - 4
        actual = resample_grid_delta(delta=source, rows=8, cols=7)
        target_grid = grid(width=150, height=200, rows=8, columns=7)
        expected = np.empty_like(target_grid)
        expected[..., 0] = target_grid[..., 0] * .1 + target_grid[..., 1] * .2 + 3
        expected[..., 1] = target_grid[..., 0] * -.2 + target_grid[..., 1] * .3 - 4
        self.assertEqual(actual.dtype, np.float32)
        np.testing.assert_allclose(actual, expected, atol=1e-5, rtol=1e-6)

    def test_cell_midpoints_are_bilinear_and_old_mesh_corners_are_preserved(self):
        source = np.array([[[0, 1], [4, 2], [9, 3]],
                           [[6, 5], [8, 9], [3, 7]]], dtype=np.float32)
        before = source.copy()
        actual = resample_grid_delta(delta=source, rows=2, cols=4)
        np.testing.assert_array_equal(actual[::2, ::2], source)
        np.testing.assert_array_equal(actual[1, 1], source[:, :2].mean(axis=(0, 1)))
        np.testing.assert_array_equal(actual[1, 3], source[:, 1:].mean(axis=(0, 1)))
        np.testing.assert_array_equal(source, before)
        self.assertFalse(np.shares_memory(actual, source))

    def test_zero_displacement_stays_exact_zero_and_same_size_is_identity(self):
        zero = np.zeros((31, 31, 2), dtype=np.float32)
        expanded = resample_grid_delta(delta=zero, rows=80, cols=80)
        self.assertEqual(expanded.shape, (81, 81, 2))
        np.testing.assert_array_equal(expanded, 0)
        source = np.arange(30, dtype=np.float32).reshape(3, 5, 2)
        actual = resample_grid_delta(delta=source, rows=2, cols=4)
        np.testing.assert_array_equal(actual, source)
        self.assertFalse(np.shares_memory(actual, source))


if __name__ == "__main__":
    unittest.main()
