"""Public synthetic contracts; no vendor runtime, models or mean-face tables."""
import ctypes as ct
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import numpy as np

from face_alignment_warp_native import (BYTENN_SHA256, NativeAlignmentWarp, PointVector, loaded_bytenn, point_vector,
                                        validate_fit, validate_frame, validate_matrix, validate_points)
from face_alignment_warp_verify import (color_witness, encoded_frame, geometry_cases, geometry_passed,
                                        integer_witness, map_witness, near, raster_cases, raster_passed,
                                        run, similarity_witness)
from face_geometry_native import mat_view


def passing_raster(*, size=120):
    checks = ("staged_color", "repeat_pixels", "network_input", "repeat_input", "repeat_raw_landmarks")
    return {"size": size, "mode": "RGBA", "fused": True, "raw": [2, 6] if size == 120 else [1, 6],
            "integer_control": None, "repeat_raw_equal": True, **{name: {"exact": True} for name in checks}}


def passing_geometry():
    checks = ("matrix_witness", "inverse_witness", "point_mapping", "roundtrip")
    return {"count": 106, **{name: {"within": True} for name in checks},
            "repeat_forward": {"exact": True}, "repeat_inverse": {"exact": True}}


class PointAndMatrixTest(unittest.TestCase):
    def test_inline_vector_abi_and_interleaved_owned_copy(self):
        values = np.arange(212, dtype=np.float32).reshape(106, 2)
        vector = point_vector(points=values)
        self.assertEqual(ct.sizeof(PointVector), 0x438)
        self.assertEqual(PointVector.count.offset, 0x430)
        self.assertEqual((vector.data - ct.addressof(vector), vector.capacity, vector.count), (16, 264, 212))
        values[:] = 0
        np.testing.assert_array_equal(np.ctypeslib.as_array(vector.storage)[:212], np.arange(212))

    def test_noncontiguous_points_are_packed(self):
        values = np.arange(28, dtype=np.float32).reshape(7, 4)[:, ::2]
        result = validate_points(points=values)
        self.assertTrue(result.flags.c_contiguous)
        np.testing.assert_array_equal(result, values)

    def test_invalid_points_rejected_before_native_execution(self):
        for values in (np.zeros((1, 2)), np.zeros((107, 2)), np.zeros((7, 3)), np.zeros((7,)),
                       np.full((7, 2), np.nan), np.full((7, 2), np.inf), np.full((7, 2), 32769)):
            with self.subTest(shape=values.shape), self.assertRaises(ValueError):
                point_vector(points=values)

    def test_fit_rejects_mismatched_degenerate_or_extreme_scale_pairs(self):
        source = np.array([[0, 0], [1, 1]], np.float32)
        for first, second in ((source, np.zeros((3, 2))), (source * 0, source), (source, source * 0),
                              (source, source * 1e-6), (source, source * 101)):
            with self.subTest(first=first, second=second), self.assertRaises(ValueError):
                validate_fit(source=first, mean=second)

    def test_zero_similarity_from_reflected_symmetric_points_rejected(self):
        source = np.array([[-1, -1], [-1, 1], [1, 1], [1, -1]], np.float32)
        with self.assertRaisesRegex(ValueError, "degenerate"):
            validate_fit(source=source, mean=source * [1, -1])

    def test_invalid_affine_matrices_rejected(self):
        for matrix in (np.zeros((2, 3)), np.eye(3), np.full((2, 3), np.nan),
                       [[1, 0, 40000], [0, 1, 0]], [[1, 2, 0], [2, 4, 0]]):
            with self.subTest(matrix=matrix), self.assertRaises(ValueError):
                validate_matrix(matrix=matrix)

    def test_similarity_witness_recovers_known_rotation_translation_and_scale(self):
        matrix = np.array([[0.7, -0.4, 11], [0.4, 0.7, -9]], np.float32)
        for count in (2, 7, 106):
            source = np.random.default_rng(count).uniform(0, 100, (count, 2)).astype(np.float32)
            mean = map_witness(points=source, matrix=matrix)
            np.testing.assert_allclose(similarity_witness(source=source, mean=mean), matrix, atol=2e-5)

    def test_similarity_not_a_general_affine_fit(self):
        source = np.array([[-1, -1], [-1, 1], [1, 1], [1, -1]], np.float32)
        matrix = similarity_witness(source=source, mean=source * [2, 1])
        np.testing.assert_array_equal(matrix, [[1.5, 0, 0], [0, 1.5, 0]])

    def test_geometry_controls_cover_counts_angles_scales_and_noise(self):
        cases = list(geometry_cases())
        self.assertEqual(len(cases), 72)
        self.assertEqual({item[2]["count"] for item in cases}, {2, 7, 106})
        self.assertEqual({item[2]["angle"] for item in cases}, {-35, 0, 25, 90})
        self.assertEqual({item[2]["noise"] for item in cases}, {0, 0.3})


class RasterControlTest(unittest.TestCase):
    def test_distinct_channels_and_alpha_not_premultiplied_in_color_witness(self):
        rgb = np.full((3, 4, 3), [17, 91, 231], np.uint8)
        for mode in ("RGB", "BGR", "RGBA", "BGRA"):
            frame = encoded_frame(rgb=rgb, mode=mode)
            np.testing.assert_array_equal(color_witness(pixels=frame, mode=mode), rgb[:, :, ::-1])
            if frame.shape[2] == 4:
                self.assertEqual(frame[0, 0, 3], 0)

    def test_integer_translation_zero_border_and_identity(self):
        frame = np.arange(12 * 12 * 3, dtype=np.uint8).reshape(12, 12, 3)
        identity = np.array([[1, 0, 0], [0, 1, 0]], np.float32)
        np.testing.assert_array_equal(integer_witness(frame=frame, matrix=identity, size=12), frame)
        matrix = identity.copy()
        matrix[:, 2] = [2, -1]
        shifted = integer_witness(frame=frame, matrix=matrix, size=12)
        np.testing.assert_array_equal(shifted[:-1, 2:], frame[1:, :-2])
        self.assertFalse(shifted[:, :2].any())
        self.assertFalse(shifted[-1].any())
        matrix[0, 2] = 0.5
        self.assertIsNone(integer_witness(frame=frame, matrix=matrix, size=12))

    def test_raster_controls_cover_all_supported_modes_and_fused_rgba(self):
        cases = list(raster_cases())
        self.assertEqual(len(cases), 60)
        self.assertEqual({item["size"] for item in cases}, {120, 160})
        self.assertEqual({item["mode"] for item in cases}, {"RGB", "BGR", "RGBA", "BGRA"})
        self.assertEqual(sum(item["fused"] for item in cases), 12)
        self.assertTrue(all(item["mode"] == "RGBA" for item in cases if item["fused"]))

    def test_noncontiguous_pixels_become_packed(self):
        frame = np.zeros((100, 100, 4), np.uint8)[::2, ::2]
        result = validate_frame(frame=frame, mode="RGBA", size=(120, 120), fused=True)
        self.assertTrue(result.flags.c_contiguous)

    def test_invalid_modes_gray_channels_sizes_and_flags_rejected(self):
        base = dict(frame=np.zeros((8, 8, 3), np.uint8), mode="RGB", size=(120, 120), fused=False)
        changes = ({"mode": "UNKNOWN"}, {"mode": []}, {"mode": "GRAY", "frame": np.zeros((8, 8), np.uint8)},
                   {"frame": np.zeros((8, 8, 4), np.uint8)}, {"frame": np.zeros((0, 8, 3), np.uint8)},
                   {"frame": np.zeros((8, 8, 3), np.float32)}, {"size": [120, 120]}, {"size": (True, 120)},
                   {"size": (1, 120)}, {"size": (161, 120)}, {"fused": 1})
        for change in changes:
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_frame(**{**base, **change})


class EvidenceGateTest(unittest.TestCase):
    def test_near_uses_explicit_tolerance_and_rejects_bad_arrays(self):
        base = np.zeros((2, 3), np.float32)
        self.assertTrue(near(actual=base + 0.0001, expected=base, tolerance=0.001)["within"])
        self.assertFalse(near(actual=base + 0.01, expected=base, tolerance=0.001)["within"])
        for value in (np.full_like(base, np.nan), np.zeros((3, 2), np.float32), base.astype(np.float64)):
            self.assertFalse(near(actual=value, expected=base, tolerance=0.001)["within"])

    def test_geometry_gate_requires_every_check_and_repeat(self):
        report = passing_geometry()
        self.assertTrue(geometry_passed(report=report))
        for key in report:
            with self.subTest(key=key):
                self.assertFalse(geometry_passed(report={name: value for name, value in report.items() if name != key}))
                if key != "count":
                    self.assertFalse(geometry_passed(report={**report, key: {"within": False, "exact": False}}))

    def test_raster_gate_requires_exact_stages_and_known_quantization(self):
        for size in (120, 160):
            report = passing_raster(size=size)
            self.assertTrue(raster_passed(report=report))
            for key in report:
                with self.subTest(key=key, size=size):
                    self.assertFalse(raster_passed(report={name: value for name, value in report.items() if name != key}))
            for key in ("staged_color", "repeat_pixels", "network_input", "repeat_input", "repeat_raw_landmarks"):
                self.assertFalse(raster_passed(report={**report, key: {"exact": False}}))
            self.assertFalse(raster_passed(report={**report, "integer_control": {"exact": False}}))
            for key, value in (("raw", [4, 0]), ("size", 240), ("repeat_raw_equal", 1), ("mode", "GRAY"), ("fused", 1)):
                self.assertFalse(raster_passed(report={**report, key: value}))

    def test_fused_difference_not_misrepresented_as_a_parity_gate(self):
        report = {**passing_raster(), "fused_vs_fallback": {"exact": False, "max_abs": 255}}
        self.assertTrue(raster_passed(report=report))

    def test_existing_evidence_and_missing_fixture_rejected_before_writes(self):
        with tempfile.TemporaryDirectory() as directory, patch("face_alignment_warp_verify.private_path", side_effect=lambda *, path: Path(path)):
            with self.assertRaisesRegex(ValueError, "overwrite"):
                run(output=Path(directory), image="not-needed")
            fresh = Path(directory) / "new"
            with self.assertRaisesRegex(ValueError, "fixture"):
                run(output=fresh, image="missing-file")
            self.assertFalse(fresh.exists())


class NativeBoundaryTest(unittest.TestCase):
    def oracle(self):
        value = object.__new__(NativeAlignmentWarp)
        value.ready, value.closed = True, False
        value.native, value.geometry = Mock(), Mock()
        value.transform = ct.create_string_buffer(0x938)
        value.preprocess, value.compute, value.set_mean = Mock(), Mock(), Mock()
        return value

    def test_closed_unfitted_or_released_owner_rejected(self):
        oracle = self.oracle()
        for field in ("closed", "ready"):
            setattr(oracle, field, field == "closed")
            with self.assertRaises(ValueError):
                oracle.require_open()
            setattr(oracle, field, field == "ready")
        oracle.native.detector.require_open.side_effect = ValueError("released")
        with self.assertRaisesRegex(ValueError, "released"):
            oracle.require_open()

    def test_invalid_fit_does_not_call_original_methods(self):
        oracle = self.oracle()
        with self.assertRaises(ValueError):
            oracle.fit(source=np.zeros((106, 2)), mean=np.ones((106, 2)))
        oracle.set_mean.assert_not_called()
        oracle.compute.assert_not_called()

    def test_unsupported_pixels_do_not_call_preprocessor(self):
        oracle = self.oracle()
        with self.assertRaises(ValueError):
            oracle.prepare(frame=np.zeros((8, 8), np.uint8), mode="GRAY", size=(120, 120))
        oracle.preprocess.assert_not_called()

    def test_prepared_pixels_are_copied_and_pointer_ownership_checked(self):
        oracle = self.oracle()
        pixels = np.full((120, 120, 3), 231, np.uint8)
        descriptor = mat_view(array=pixels)
        oracle.native.alignment = ct.addressof(descriptor) - 0x7880
        oracle.preprocess.return_value = ct.addressof(descriptor)
        result = oracle.prepare(frame=pixels, mode="RGB", size=(120, 120))
        pixels[:] = 0
        self.assertEqual(result[0, 0, 0], 231)
        oracle.preprocess.return_value = 1
        with self.assertRaisesRegex(ValueError, "ownership"):
            oracle.prepare(frame=pixels, mode="RGB", size=(120, 120))

    def test_close_releases_both_mats_and_vectors_once(self):
        oracle = self.oracle()
        oracle.deallocate = Mock()
        oracle.close()
        oracle.close()
        self.assertEqual(oracle.geometry.destroy_mat.call_count, 2)
        self.assertEqual(oracle.deallocate.call_count, 2)
        self.assertTrue(oracle.closed)
        self.assertFalse(oracle.ready)

    def test_loaded_runtime_requires_unique_hash_matching_actual_image(self):
        images = Mock()
        images._dyld_image_count.return_value = 2
        images._dyld_get_image_name.side_effect = [b"/tmp/libsystem.dylib", b"/tmp/libbytenn.dylib"]
        with patch("face_alignment_warp_native.ct.CDLL", return_value=images), \
                patch("face_alignment_warp_native.sha256", return_value=BYTENN_SHA256) as digest:
            self.assertEqual(loaded_bytenn()["sha256"], BYTENN_SHA256)
            digest.assert_called_once_with(path=Path("/tmp/libbytenn.dylib").resolve())

    def test_wrong_missing_duplicate_or_unbounded_loaded_runtime_rejected(self):
        for paths, count, digest in (([b"/tmp/libbytenn.dylib"], 1, "wrong"), ([b"/tmp/libsystem.dylib"], 1, BYTENN_SHA256),
                                     ([b"/tmp/a/libbytenn.dylib", b"/tmp/b/libbytenn.dylib"], 2, BYTENN_SHA256),
                                     ([], 8193, BYTENN_SHA256), ([], 0, BYTENN_SHA256)):
            with self.subTest(paths=paths, count=count):
                images = Mock()
                images._dyld_image_count.return_value = count
                images._dyld_get_image_name.side_effect = paths
                with patch("face_alignment_warp_native.ct.CDLL", return_value=images), \
                        patch("face_alignment_warp_native.sha256", return_value=digest), self.assertRaises(ValueError):
                    loaded_bytenn()


if __name__ == "__main__":
    unittest.main()
