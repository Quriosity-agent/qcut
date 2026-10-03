"""Synthetic cache/mapping contracts; no vendor arrays, binaries or portraits."""
import ctypes as ct
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import numpy as np

from face_alignment_tracking_verify import (EXACT_CHECKS, NEAR_CHECKS, anchor_witness, chain_passed,
                                             gate_controls, gate_witness, run, synthetic_seed, target_witness)
from face_alignment_warp_native import NativeAlignmentWarp, PointVector, validate_tracking
from face_alignment_warp_verify import map_witness


def passing_chain():
    return {"optimized": False, "step": 1, "threshold": 0.0, "confidence": 0.7, "repeat_confidence": 0.7,
            **{key: {"exact": True} for key in EXACT_CHECKS},
            **{key: {"within": True} for key in NEAR_CHECKS}}


def fake_warp():
    value = object.__new__(NativeAlignmentWarp)
    value.transform = ct.create_string_buffer(0x938)
    value.closed, value.ready = False, True
    value.native = Mock()
    value.get_anchor, value.check_transform = Mock(), Mock(return_value=False)
    vector = PointVector.from_address(ct.addressof(value.transform) + 0x4F8)
    vector.data, vector.count, vector.capacity = ct.addressof(vector) + 16, 212, 212
    ct.memmove(vector.data, synthetic_seed().ctypes.data, 212 * 4)
    ct.c_bool.from_address(ct.addressof(value.transform) + 0x930).value = True
    return value, vector


class TrackingFormulaTest(unittest.TestCase):
    def test_anchor_pairs_are_midpoints_not_four_point_fit(self):
        points = synthetic_seed()
        points[[55, 58, 84, 90]] = [[1, 2], [3, 6], [10, 8], [14, 12]]
        result = anchor_witness(points=points)
        np.testing.assert_array_equal(result, [[2, 4], [12, 10]])
        self.assertEqual(result.dtype, np.float32)

    def test_first_call_requires_fit_even_at_zero_movement(self):
        self.assertTrue(gate_witness(points=synthetic_seed(), cached=None))

    def test_unchanged_fitted_points_reuse_cache(self):
        points = synthetic_seed()
        self.assertFalse(gate_witness(points=points, cached=points))

    def test_vertical_threshold_neighbors_and_equality(self):
        points = synthetic_seed()
        for dy, expected in ((np.nextafter(np.float32(5), np.float32(0)), False),
                             (np.float32(5), True),
                             (np.nextafter(np.float32(5), np.float32(10)), True)):
            with self.subTest(dy=dy):
                self.assertEqual(gate_witness(points=points + [0, dy], cached=points), expected)

    def test_negative_displacement_has_same_gate(self):
        points = synthetic_seed()
        for dy, expected in ((4, False), (5, True), (6, True)):
            for sign in (-1, 1):
                self.assertEqual(gate_witness(points=points + [0, dy * sign], cached=points), expected)

    def test_anchor_displacements_are_sum_not_maximum(self):
        points = synthetic_seed()
        changed = points.copy()
        changed[[55, 58], 1] = 8
        self.assertFalse(gate_witness(points=changed, cached=points))
        changed[[55, 58], 1] = 10
        self.assertTrue(gate_witness(points=changed, cached=points))

    def test_nonanchor_changes_do_not_refresh(self):
        points = synthetic_seed()
        for index in (0, 20, 54, 105):
            changed = points.copy()
            changed[index] += [200, -100]
            self.assertFalse(gate_witness(points=changed, cached=points))

    def test_opposite_pair_movements_cancel_in_midpoint(self):
        points = synthetic_seed()
        changed = points.copy()
        changed[55, 1], changed[58, 1] = 24, -24
        self.assertFalse(gate_witness(points=changed, cached=points))

    def test_queries_do_not_advance_last_fit_reference(self):
        points = synthetic_seed()
        original = points.copy()
        for dy in (1, 2, 3, 4):
            self.assertFalse(gate_witness(points=points + [0, dy], cached=points))
        self.assertTrue(gate_witness(points=points + [0, 5], cached=points))
        np.testing.assert_array_equal(points, original)
        cached = points + [0, 5]
        self.assertFalse(gate_witness(points=points + [0, 6], cached=cached))

    def test_near_zero_reference_requests_fit(self):
        points = synthetic_seed()
        for span, expected in ((0, True), (1e-6, True), (2e-6, True), (3e-6, False)):
            with self.subTest(span=span):
                tiny = points.copy()
                tiny[[84, 90]] = [span, 0]
                self.assertEqual(gate_witness(points=tiny, cached=tiny), expected)

    def test_threshold_endpoints_are_explicit(self):
        points = synthetic_seed()
        self.assertTrue(gate_witness(points=points, cached=points, threshold=0))
        self.assertFalse(gate_witness(points=points, cached=points, threshold=1))
        self.assertTrue(gate_witness(points=points + [0, 50], cached=points, threshold=1))

    def test_reference_is_scaled_with_face_size(self):
        points = synthetic_seed()
        for scale in (0.5, 1, 2):
            self.assertFalse(gate_witness(points=(points + [0, 4]) * scale, cached=points * scale))
            self.assertTrue(gate_witness(points=(points + [0, 6]) * scale, cached=points * scale))

    def test_bad_count_threshold_and_nonfinite_cached_rejected(self):
        points = synthetic_seed()
        for count in (2, 7, 105):
            with self.assertRaises(ValueError):
                validate_tracking(points=points[:count])
        for threshold in (True, np.bool_(False), "0.1", None, [], float("nan"), float("inf"), -0.01, 1.01):
            with self.subTest(threshold=threshold), self.assertRaises(ValueError):
                validate_tracking(points=points, threshold=threshold)
        with self.assertRaises(ValueError):
            gate_witness(points=points, cached=np.full_like(points, np.nan))

    def test_synthetic_controls_have_unique_names_and_boundary_neighbors(self):
        controls = list(gate_controls(source=synthetic_seed()))
        self.assertEqual(len(controls), 32)
        self.assertEqual(len({name for name, _ in controls}), 32)
        self.assertEqual(sum(name.startswith("rotate-") for name, _ in controls), 6)


class TargetAndEvidenceTest(unittest.TestCase):
    def test_target_uses_120_not_119_and_preserves_double_intermediate(self):
        mean = np.random.default_rng(755).uniform(0, 256, (106, 2)).astype(np.float32)
        actual = target_witness(mean=mean)
        np.testing.assert_array_equal(actual, (mean.astype(np.float64) / 256 * 120).astype(np.float32))
        self.assertFalse(np.array_equal(actual, (mean.astype(np.float64) / 256 * 119).astype(np.float32)))
        mean[:] = 0
        self.assertTrue(actual.any())

    def test_target_rejects_invalid_mean(self):
        for mean in (np.zeros((105, 2)), np.zeros((106, 3)), np.full((106, 2), np.nan),
                     np.full((106, 2), -1), np.full((106, 2), 257)):
            with self.assertRaises(ValueError):
                target_witness(mean=mean)

    def test_backmap_is_after_baseline_addition(self):
        residual = np.zeros((106, 2), np.float32)
        base = target_witness(mean=np.full((106, 2), 128, np.float32))
        matrix = np.array([[2, 0, 10], [0, 2, 20]], np.float32)
        actual = map_witness(points=residual + base, matrix=matrix)
        np.testing.assert_array_equal(actual, np.broadcast_to([130, 140], (106, 2)))
        self.assertFalse(np.array_equal(actual, map_witness(points=residual, matrix=matrix)))

    def test_gate_requires_all_exact_near_metadata_and_repeat_fields(self):
        report = passing_chain()
        self.assertTrue(chain_passed(report=report))
        for key in report:
            with self.subTest(key=key):
                self.assertFalse(chain_passed(report={name: value for name, value in report.items() if name != key}))
        for key in EXACT_CHECKS:
            self.assertFalse(chain_passed(report={**report, key: {"exact": False}}))
        for key in NEAR_CHECKS:
            self.assertFalse(chain_passed(report={**report, key: {"within": False}}))
        for key, value in (("step", True), ("step", 3), ("optimized", 1), ("threshold", 0),
                           ("threshold", 0.5), ("confidence", float("nan")), ("confidence", 1),
                           ("repeat_confidence", 0.8)):
            self.assertFalse(chain_passed(report={**report, key: value}))

    def test_control_run_does_not_overwrite_evidence_or_create_output_for_missing_fixture(self):
        with tempfile.TemporaryDirectory() as directory, patch("face_alignment_tracking_verify.private_path", side_effect=lambda *, path: Path(path)):
            with self.assertRaisesRegex(ValueError, "overwrite"):
                run(output=Path(directory), image="not-needed")
            fresh = Path(directory) / "fresh"
            with self.assertRaisesRegex(ValueError, "fixture"):
                run(output=fresh, image="missing")
            self.assertFalse(fresh.exists())


class OriginalBoundaryTest(unittest.TestCase):
    def test_invalid_request_never_calls_native_gate_or_anchor(self):
        warp, _ = fake_warp()
        with self.assertRaises(ValueError):
            warp.anchors(points=np.zeros((7, 2)))
        with self.assertRaises(ValueError):
            warp.needs_update(points=synthetic_seed(), threshold=float("nan"))
        warp.check_transform.assert_not_called()
        warp.get_anchor.assert_not_called()

    def test_closed_or_released_owner_rejected_even_for_unfitted_gate(self):
        warp, _ = fake_warp()
        warp.closed = True
        with self.assertRaises(ValueError):
            warp.needs_update(points=synthetic_seed())
        warp.closed = False
        warp.native.detector.require_open.side_effect = ValueError("released")
        with self.assertRaisesRegex(ValueError, "released"):
            warp.anchors(points=synthetic_seed())

    def test_gate_accepts_unfitted_object_without_marking_it_fitted(self):
        warp, _ = fake_warp()
        warp.ready = False
        warp.check_transform.return_value = True
        self.assertTrue(warp.needs_update(points=synthetic_seed()))
        self.assertFalse(warp.ready)

    def test_fitted_cache_is_owned_copy_and_supports_native_capacity_change(self):
        for capacity in (212, 264):
            warp, vector = fake_warp()
            vector.capacity = capacity
            copied = warp.cached_points()
            np.testing.assert_array_equal(copied, synthetic_seed())
            vector.storage[0] = 12345
            self.assertNotEqual(copied[0, 0], 12345)

    def test_bad_descriptor_or_fitted_flag_rejected_before_pointer_read(self):
        for field, value in (("count", 210), ("capacity", 211), ("capacity", 265), ("data", 1)):
            warp, vector = fake_warp()
            setattr(vector, field, value)
            with self.subTest(field=field), self.assertRaises(ValueError):
                warp.cached_points()
        warp, _ = fake_warp()
        ct.c_bool.from_address(ct.addressof(warp.transform) + 0x930).value = False
        with self.assertRaises(ValueError):
            warp.cached_points()

    def test_nonfinite_native_cache_rejected(self):
        warp, vector = fake_warp()
        vector.storage[0] = float("nan")
        with self.assertRaises(ValueError):
            warp.cached_points()


if __name__ == "__main__":
    unittest.main()
