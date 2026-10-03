"""Pure actual-coordinate decode controls; no native inference or fixture models."""
import unittest

import numpy as np

import face_host_geometry_replay as replay


class ActualGeometryMathTests(unittest.TestCase):
    def test_double_accumulation_then_single_float_rounding(self):
        points = np.tile(np.array([81.23456, 72.34567], np.float32), (106, 1))
        matrix = np.array([[2.234567, .024321, 188.12345], [-.024321, 2.234567, 111.98765]], np.float32)
        expected = np.array([[sum(float(point[axis]) * float(row[axis]) for axis in range(2)) + float(row[2])
                              for row in matrix] for point in points], np.float32)
        actual = replay.map_double(points=points, inverse=matrix)
        np.testing.assert_array_equal(actual, expected)
        self.assertFalse(np.array_equal(points @ matrix[:, :2].T + matrix[:, 2], expected))

    def test_affine_identity_and_translation(self):
        points = np.arange(212, dtype=np.float32).reshape(106, 2)
        actual = replay.map_double(points=points, inverse=np.array([[1, 0, 20], [0, 1, -10]], np.float32))
        np.testing.assert_array_equal(actual, points + [20, -10])

    def test_rejects_wrong_point_shape(self):
        with self.assertRaises(ValueError):
            replay.map_double(points=np.zeros((105, 2), np.float32), inverse=np.eye(2, 3, dtype=np.float32))

    def test_rejects_wrong_point_dtype(self):
        with self.assertRaises(ValueError):
            replay.map_double(points=np.zeros((106, 2)), inverse=np.eye(2, 3, dtype=np.float32))

    def test_rejects_wrong_matrix_dtype(self):
        with self.assertRaises(ValueError):
            replay.map_double(points=np.zeros((106, 2), np.float32), inverse=np.eye(2, 3))

    def test_rejects_singular_inverse(self):
        with self.assertRaises(ValueError):
            replay.map_double(points=np.zeros((106, 2), np.float32), inverse=np.zeros((2, 3), np.float32))

    def test_rejects_nonfinite_points_and_matrix(self):
        for target in ("points", "inverse"):
            values = dict(points=np.zeros((106, 2), np.float32), inverse=np.eye(2, 3, dtype=np.float32))
            values[target].flat[0] = np.nan
            with self.subTest(target=target), self.assertRaises(ValueError):
                replay.map_double(**values)

    def test_rejects_unbounded_input_and_output(self):
        for points, matrix in ((np.full((106, 2), 32769, np.float32), np.eye(2, 3, dtype=np.float32)),
                               (np.full((106, 2), 32768, np.float32), np.eye(2, 3, dtype=np.float32) * 2)):
            with self.assertRaises(ValueError):
                replay.map_double(points=points, inverse=matrix)

    def test_point_capacity_only_reads_first_106_columns(self):
        values = np.arange(560, dtype=np.float32).reshape(2, 280)
        result = replay.first_points(value=values.tolist())
        np.testing.assert_array_equal(result, values[:, :106].T)
        self.assertFalse(np.shares_memory(result, values))

    def test_rejects_unsupported_point_capacity(self):
        with self.assertRaises(ValueError):
            replay.first_points(value=np.zeros((2, 107)))

    def test_rejects_nonfinite_capacity_tail(self):
        values = np.zeros((2, 280), np.float32)
        values[0, 279] = np.inf
        with self.assertRaises(ValueError):
            replay.first_points(value=values)

    def test_decode_uses_actual_order_mean_and_inverse(self):
        snapshot = dict(tables=dict(base=np.tile([128, 64], (106, 1)).reshape(-1).tolist(),
                                    order=list(reversed(range(106)))))
        raw = np.arange(212, dtype=np.float32).reshape(106, 2) / 10
        face = dict(inverse=[[2, 0, 10], [0, 3, 20]])
        stage, mapped = replay.decode_actual(raw=raw, snapshot=snapshot, face=face)
        expected = (raw[::-1].astype(np.float64) + [60, 30]).astype(np.float32)
        np.testing.assert_array_equal(stage, expected)
        np.testing.assert_array_equal(mapped, (expected.astype(np.float64) * [2, 3] + [10, 20]).astype(np.float32))

    def test_decode_rejects_nonfinite_raw(self):
        with self.assertRaises(ValueError):
            replay.decode_actual(raw=np.full((106, 2), np.nan, np.float32), snapshot={}, face={})

    def test_decode_rejects_float64_raw(self):
        with self.assertRaises(ValueError):
            replay.decode_actual(raw=np.zeros((106, 2)), snapshot={}, face={})

    def test_normalization_uses_actual_algorithm_frame_not_output_frame(self):
        points = np.tile(np.array([320, 120], np.float32), (106, 1))
        actual = replay.normalized(points=points, request=[0, 640, 480, 2560, 0])
        expected_y = np.float32(360) * (np.float32(1) / np.float32(480))
        np.testing.assert_array_equal(actual, np.tile(np.array([.5, expected_y], np.float32), (106, 1)))

    def test_normalization_uses_full_dimensions_not_minus_one(self):
        points = np.tile(np.array([639, 479], np.float32), (106, 1))
        result = replay.normalized(points=points, request=[0, 640, 480, 2560, 0])
        self.assertLess(result[0, 0], 1)
        self.assertGreater(result[0, 1], 0)

    def test_normalization_preserves_subtract_then_reciprocal_multiply_rounding(self):
        points = np.tile(np.array([320, 120], np.float32), (106, 1))
        result = replay.normalized(points=points, request=[0, 640, 480, 2560, 0])
        expected = (np.float32(480) - points[:, 1]) * (np.float32(1) / np.float32(480))
        np.testing.assert_array_equal(result[:, 1], expected)
        self.assertFalse(np.array_equal(result[:, 1], 1 - points[:, 1] / np.float32(480)))

    def test_normalization_rejects_outside_instead_of_clipping(self):
        points = np.tile(np.array([641, 120], np.float32), (106, 1))
        with self.assertRaises(ValueError):
            replay.normalized(points=points, request=[0, 640, 480, 2560, 0])

    def test_normalization_rejects_bool_dimensions(self):
        with self.assertRaises(ValueError):
            replay.normalized(points=np.zeros((106, 2), np.float32), request=[0, True, 480, 4, 0])

    def test_normalization_rejects_short_request(self):
        with self.assertRaises(ValueError):
            replay.normalized(points=np.zeros((106, 2), np.float32), request=[0, 640])

    def test_active_face_is_not_allocated_inactive_capacity(self):
        active = dict(stage1=[[0] * 106, [0] * 106], frame_size=[480, 640], active=True)
        inactive = dict(stage1=[[0] * 280, [0] * 280], frame_size=[0, 0], active=False)
        self.assertIs(replay.active_face(snapshot=dict(request=[0, 640, 480, 2560, 0], faces=[inactive, active])), active)

    def test_active_face_rejects_ambiguous_faces(self):
        active = dict(stage1=[[0] * 106, [0] * 106], frame_size=[480, 640], active=True)
        with self.assertRaises(ValueError):
            replay.active_face(snapshot=dict(request=[0, 640, 480, 2560, 0], faces=[active, active]))

    def test_active_face_rejects_wrong_frame_dimensions(self):
        face = dict(stage1=[[0] * 106, [0] * 106], frame_size=[640, 480], active=True)
        with self.assertRaises(ValueError):
            replay.active_face(snapshot=dict(request=[0, 640, 480, 2560, 0], faces=[face]))


if __name__ == "__main__":
    unittest.main()
