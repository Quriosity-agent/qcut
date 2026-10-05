"""CPU-only bit comparisons and evidence gates; synthetic fixtures are not parity."""
import copy
from dataclasses import replace
import hashlib
import json
import math
import os
from pathlib import Path
import struct
import unittest

import numpy as np

import face_extra_crop_geometry as geometry
from face_extra_crop_trace_test import CropMemoryFixture
import face_live_extra_trace as boundary
from face_temporal_smoothing import FilterState, update as outer_update


def inner_state(*, current=None, scale=4, alpha=0.2):
    return FilterState(current=np.zeros((1, 2), np.float32) if current is None else current,
        previous=np.empty((0, 2), np.float32), delta=np.empty((0, 2), np.float32),
        alpha=alpha, scale=scale, first=True)


def rounded(*, value):
    return struct.unpack("<f", struct.pack("<f", value))[0]


def scalar_inner(*, old, new, scale):
    delta = rounded(value=float(new) - float(old))
    ratio = rounded(value=abs(delta) / float(scale))
    weight = rounded(value=math.exp(-math.pow(ratio, 3.0)))
    return rounded(value=rounded(value=float(old) * weight) +
                   rounded(value=float(new) * rounded(value=1.0 - weight)))


class AuditFixture(CropMemoryFixture):
    def observer(self, *, capture=False):
        events = []
        for prediction in (0, 1):
            self.memory[self.registers["x3"] + 0xa] = bytes([int(prediction == 0)])
            for name, offset in (("before", boundary.CALL), ("after", boundary.RETURN)):
                scope = self.scope()
                row = dict(event=name, offset=offset, prediction=prediction, thread=42, **scope,
                           snapshot=boundary.snapshot(read=self.read, scope=scope))
                if capture:
                    row["crop_geometry"] = self.capture(event=name, prediction=prediction)
                if name == "after":
                    row["return_code"] = 0
                    row["extra_model"] = dict(diagnostic_only=True, native_points_sent_to_worker=False,
                        **{key: [[1.0, -0.0, 3.0], [0.0, 1.0, 4.0]] for key in
                           ("forward", "inverse", "stage2_forward", "stage2_inverse")})
                events.append(row)
        return dict(passed=True, target_memory_written=False, target_functions_evaluated=False,
            software_breakpoints_used=False,
            extra_trace=dict(schema="face-live-extra-boundary-v1", complete=True, events=events,
                target_memory_written=False, native_points_sent_to_worker=False, product_parity_verified=False))


class EvidenceAuditTests(AuditFixture, unittest.TestCase):
    def test_legacy_capture_reports_missing_inputs_not_owned_parity(self):
        result = geometry.audit_observer(observer=self.observer())
        self.assertTrue(result["audit_completed"])
        self.assertEqual(result["status"], "evidence-only-no-owned-geometry")
        self.assertEqual(len(result["native_dependencies"]), 5)
        for case in result["cases"]:
            self.assertFalse(case["reconstruction_ready"])
            self.assertIsNone(case["float32_geometry_comparison"])
            self.assertTrue(case["native_post_crop_matrices_available"])
            self.assertIn("pre_crop_transform_caches", case["missing"])
        for key in ("owned_geometry_enabled", "geometry_parity_verified", "product_parity_verified"):
            self.assertIs(result[key], False)

    def test_inner_filter_bypass_is_prediction_specific(self):
        cases = geometry.audit_observer(observer=self.observer())["cases"]
        self.assertFalse(cases[0]["inner_filter_expected"])
        self.assertTrue(cases[1]["inner_filter_expected"])
        self.assertNotIn("pre_crop_inner_filter_history", cases[0]["missing"])
        self.assertIn("pre_crop_inner_filter_history", cases[1]["missing"])

    def test_routing_uses_bit_zero_not_truthiness(self):
        observer = self.observer()
        for row in observer["extra_trace"]["events"]:
            row["snapshot"]["config_bytes"]["0x0"] = 2
            row["snapshot"]["config_bytes"]["0xa"] = 2
        result = geometry.audit_observer(observer=observer)
        self.assertFalse(any(case["inner_filter_expected"] for case in result["cases"]))

    def test_complete_snapshots_still_do_not_certify_arithmetic_or_parity(self):
        observer = self.observer(capture=True)
        before = copy.deepcopy(observer)
        result = geometry.audit_observer(observer=observer)
        self.assertEqual(observer, before)
        self.assertEqual(json.loads(json.dumps(result, allow_nan=False)), result)
        self.assertFalse(result["geometry_parity_verified"])
        self.assertEqual(len(result["unresolved"]), 4)
        for case in result["cases"]:
            self.assertTrue(case["boundary_copies_available"])
            self.assertEqual(case["missing"], [])
            self.assertFalse(case["reconstruction_ready"])

    def test_only_after_capture_never_substitutes_for_before(self):
        observer = self.observer(capture=True)
        for row in observer["extra_trace"]["events"][::2]:
            row["crop_geometry"] = None
        cases = geometry.audit_observer(observer=observer)["cases"]
        self.assertTrue(all("pre_crop_transform_caches" in case["missing"] for case in cases))

    def test_after_point_changes_are_not_geometry_reconstruction(self):
        observer = self.observer()
        for row in observer["extra_trace"]["events"][1::2]:
            row["snapshot"]["tracked"][0][0] += 100
            row["snapshot"]["published_xy"][0] -= 100
        result = geometry.audit_observer(observer=observer)
        self.assertFalse(result["geometry_parity_verified"])
        self.assertTrue(all(case["float32_geometry_comparison"] is None for case in result["cases"]))

    def test_native_model_reference_is_optional_but_never_geometry_input(self):
        observer = self.observer()
        for row in observer["extra_trace"]["events"][1::2]:
            row["extra_model"] = None
        cases = geometry.audit_observer(observer=observer)["cases"]
        self.assertTrue(all(not case["native_post_crop_matrices_available"] for case in cases))

    def test_trace_mutation_and_nonboolean_claims_fail(self):
        for key in ("target_memory_written", "native_points_sent_to_worker", "product_parity_verified"):
            for bad in (True, 0, None):
                observer = self.observer()
                observer["extra_trace"][key] = bad
                with self.subTest(key=key, bad=bad), self.assertRaises(ValueError):
                    geometry.audit_observer(observer=observer)

    def test_unfinished_unordered_or_extra_events_fail(self):
        original = self.observer()
        for bad in (None, {}, [], original["extra_trace"]["events"][:3],
                    list(reversed(original["extra_trace"]["events"])), original["extra_trace"]["events"] * 2):
            observer = copy.deepcopy(original)
            observer["extra_trace"]["events"] = bad
            with self.subTest(kind=type(bad)), self.assertRaises(ValueError):
                geometry.audit_observer(observer=observer)
        original["extra_trace"]["complete"] = False
        with self.assertRaises(ValueError):
            geometry.audit_observer(observer=original)

    def test_observer_must_be_completed_and_read_only(self):
        for key in ("passed", "target_memory_written", "target_functions_evaluated", "software_breakpoints_used"):
            observer = self.observer()
            observer[key] = not observer[key]
            with self.subTest(key=key), self.assertRaises(ValueError):
                geometry.audit_observer(observer=observer)

    def test_owner_face_thread_prediction_offset_and_return_code_are_bound(self):
        original = self.observer()
        for key, bad in (("owner", 0x40000), ("alignment", 0x50000), ("runtime", 0x60000),
                          ("face_id", 8), ("thread", 43), ("prediction", True),
                          ("offset", boundary.CALL), ("return_code", -1), ("return_code", True)):
            observer = copy.deepcopy(original)
            observer["extra_trace"]["events"][1][key] = bad
            with self.subTest(key=key), self.assertRaises(ValueError):
                geometry.audit_observer(observer=observer)

    def test_borrowed_after_capture_cannot_be_relabelled_as_before(self):
        observer = self.observer(capture=True)
        events = observer["extra_trace"]["events"]
        events[0]["crop_geometry"] = events[1]["crop_geometry"]
        with self.assertRaisesRegex(ValueError, "association"):
            geometry.audit_observer(observer=observer)

    def test_all_crop_identity_fields_are_bound_and_typed(self):
        original = self.observer(capture=True)
        for key in (*geometry.IDENTITY, "prediction", "offset"):
            observer = copy.deepcopy(original)
            observer["extra_trace"]["events"][0]["crop_geometry"][key] += 1
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "association"):
                geometry.audit_observer(observer=observer)

    def test_crop_policy_flags_and_hash_must_be_exact(self):
        original = self.observer(capture=True)
        for key, value in (("lens_sha256", "0" * 64), ("schema", "other"), ("diagnostic_only", 1),
                            ("target_memory_written", True), ("target_functions_evaluated", True),
                            ("native_points_sent_to_worker", True), ("product_parity_verified", True)):
            observer = copy.deepcopy(original)
            observer["extra_trace"]["events"][0]["crop_geometry"][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                geometry.audit_observer(observer=observer)

    def test_crop_point_copy_must_match_original_boundary_bits(self):
        observer = self.observer(capture=True)
        row = observer["extra_trace"]["events"][0]
        self.assertEqual(row["snapshot"]["tracked"][0][0], 0.0)
        row["crop_geometry"]["tracked"][0][0] = -0.0
        with self.assertRaisesRegex(ValueError, "point copy"):
            geometry.audit_observer(observer=observer)

    def test_missing_capture_fields_do_not_count_as_complete(self):
        original = self.observer(capture=True)
        for key in ("source", "input_parameter", "read_budget", "inner_filter", "mean", "transforms",
                    "face_modes", "face_bytes", "config_bytes", "reset_byte", "tracked", "published_xy"):
            observer = copy.deepcopy(original)
            observer["extra_trace"]["events"][0]["crop_geometry"].pop(key)
            with self.subTest(key=key), self.assertRaises(ValueError):
                geometry.audit_observer(observer=observer)

    def test_constant_mean_change_across_boundary_is_rejected(self):
        observer = self.observer(capture=True)
        observer["extra_trace"]["events"][1]["crop_geometry"]["mean"][0] = 1.0
        with self.assertRaisesRegex(ValueError, "constant crop mean"):
            geometry.audit_observer(observer=observer)

    def test_source_or_input_parameter_change_across_call_is_rejected(self):
        original = self.observer(capture=True)
        for key, field in (("source", "data"), ("input_parameter", "address"), ("input_parameter", "orientation")):
            observer = copy.deepcopy(original)
            observer["extra_trace"]["events"][1]["crop_geometry"][key][field] += 1
            with self.subTest(key=key, field=field), self.assertRaisesRegex(ValueError, "input context"):
                geometry.audit_observer(observer=observer)

    def test_malformed_native_transform_reference_is_rejected(self):
        for value in ([[1, 0], [0, 1]], [[1, 0, float("nan")], [0, 1, 0]],
                      [[True, 0, 1], [0, 1, 0]], "matrix"):
            observer = self.observer()
            observer["extra_trace"]["events"][1]["extra_model"]["forward"] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                geometry.audit_observer(observer=observer)


class BitComparisonTests(unittest.TestCase):
    def test_bit_equality_preserves_signed_zero_mismatch(self):
        result = geometry.compare_bits(actual=np.array([0.0], np.float32),
                                       expected=np.array([-0.0], np.float32))
        self.assertFalse(result["equal"])
        self.assertEqual(result["mismatched_values"], 1)
        self.assertEqual(result["max_abs_error"], 0)

    def test_one_ulp_is_a_mismatch_without_tolerance(self):
        actual = np.array([1, 0], np.float32)
        expected = np.array([np.nextafter(np.float32(1), np.float32(2)), 0], np.float32)
        result = geometry.compare_bits(actual=actual, expected=expected)
        self.assertEqual(result["compared_values"], 2)
        self.assertEqual(result["mismatched_values"], 1)
        self.assertEqual(result["first_mismatch"], [0])

    def test_shape_difference_cannot_broadcast_to_equality(self):
        result = geometry.compare_bits(actual=np.zeros((2, 3), np.float32), expected=np.zeros(6, np.float32))
        self.assertFalse(result["shape_equal"])
        self.assertFalse(result["equal"])
        self.assertEqual(result["compared_values"], 0)

    def test_subnormal_and_negative_zero_bits_compare_exactly(self):
        value = np.array([0, 0x80000000, 1, 0x80000001], np.uint32).view(np.float32)
        self.assertTrue(geometry.compare_bits(actual=value, expected=value.copy())["equal"])

    def test_invalid_dtype_shape_size_and_nonfinite_are_rejected(self):
        for value in ([1.0], np.ones(1, np.float64), np.ones(1, np.int32), np.ones(561, np.float32),
                      np.ones((1, 1, 1), np.float32), np.array(1, np.float32),
                      np.array([float("nan")], np.float32), np.array([float("inf")], np.float32)):
            with self.subTest(kind=type(value)), self.assertRaises(ValueError):
                geometry.compare_bits(actual=value, expected=np.ones(1, np.float32))

    def test_mean_preparation_uses_only_pre_crop_mean_and_explicit_size(self):
        mean = np.arange(480, dtype=np.float32).tolist()
        result = geometry.mean106(mean=mean, size=160)
        expected = np.arange(212, dtype=np.float32).reshape(106, 2) * np.float32(0.625)
        self.assertTrue(geometry.compare_bits(actual=result, expected=expected)["equal"])
        self.assertEqual(mean, np.arange(480, dtype=np.float32).tolist())

    def test_mean_rounding_uses_double_intermediate(self):
        mean = [1.2345670461654663] * 480
        result = geometry.mean106(mean=mean, size=159)
        expected = np.float32(float(np.float32(mean[0])) / 256 * 159)
        self.assertEqual(result[0, 0].view(np.uint32), expected.view(np.uint32))

    def test_mean_shape_types_range_and_network_size_are_checked(self):
        for mean, size in (([0.0] * 479, 160), ([0.0] * 481, 160), ([True] * 480, 160),
                           ([float("nan")] * 480, 160), ([32769] * 480, 160),
                           ([0.0] * 480, True), ([0.0] * 480, 0), ([0.0] * 480, 4097)):
            with self.subTest(size=size), self.assertRaises(ValueError):
                geometry.mean106(mean=mean, size=size)


class InnerFilterTests(unittest.TestCase):
    def test_analytic_cubic_weight_not_outer_square_root(self):
        points = np.array([[8, 0]], np.float32)
        state = inner_state()
        output, updated = geometry.update_inner_filter(state=state, points=points)
        weight = np.array([0x39afe108], np.uint32).view(np.float32)[0]
        self.assertEqual(output[0, 0], np.float32(8) * (np.float32(1) - weight))
        self.assertEqual(output[0, 1], 0)
        self.assertFalse(updated.first)
        self.assertFalse(np.array_equal(output, outer_update(state=state, points=points, optimized=False)[0]))

    def test_first_and_nonfirst_replace_delta_without_alpha_blending(self):
        points = np.array([[1, -2]], np.float32)
        results = []
        for alpha in (0, 0.2, 1):
            for first in (True, False):
                state = replace(inner_state(alpha=alpha), first=first, delta=np.array([[999, -999]], np.float32))
                output, updated = geometry.update_inner_filter(state=state, points=points)
                results.append(output)
                self.assertTrue(geometry.compare_bits(actual=updated.delta, expected=points)["equal"])
                self.assertEqual(updated.alpha, np.float32(alpha))
                self.assertFalse(updated.first)
        self.assertTrue(all(geometry.compare_bits(actual=item, expected=results[0])["equal"] for item in results))

    def test_weighted_sum_cannot_be_reassociated_to_subtraction(self):
        old = np.array([[-194.113525390625, 0]], np.float32)
        points = np.array([[-194.29429626464844, 0]], np.float32)
        output, _ = geometry.update_inner_filter(state=inner_state(current=old, scale=2.6666667461395264), points=points)
        self.assertEqual(int(output[0, 0].view(np.uint32)), 3275889939)
        wrong = points[0, 0] - (points[0, 0] - old[0, 0]) * np.float32(0.9996885061264038)
        self.assertEqual(int(wrong.view(np.uint32)), 3275889940)

    def test_multistep_106_points_match_scalar_float32_instruction_order(self):
        rng = np.random.default_rng(20261005)
        current = rng.uniform(-1000, 1000, (106, 2)).astype(np.float32)
        state = inner_state(current=current, scale=2.6666667461395264)
        for _ in range(5):
            points = (current + rng.uniform(-8, 8, current.shape)).astype(np.float32)
            expected = np.array([scalar_inner(old=old, new=new, scale=state.scale)
                                 for old, new in zip(current.flat, points.flat, strict=True)], np.float32).reshape(106, 2)
            output, updated = geometry.update_inner_filter(state=state, points=points)
            self.assertTrue(geometry.compare_bits(actual=output, expected=expected)["equal"])
            self.assertTrue(geometry.compare_bits(actual=updated.previous, expected=current)["equal"])
            self.assertTrue(geometry.compare_bits(actual=updated.delta, expected=points-current)["equal"])
            current, state = expected, updated

    def test_scale_bypass_preserves_delta_and_first_but_advances_current_previous(self):
        for first in (True, False):
            state = replace(inner_state(scale=0), first=first, delta=np.array([[9, 10]], np.float32))
            points = np.array([[-0.0, 4]], np.float32)
            output, updated = geometry.update_inner_filter(state=state, points=points)
            self.assertTrue(geometry.compare_bits(actual=output, expected=points)["equal"])
            self.assertTrue(geometry.compare_bits(actual=updated.previous, expected=state.current)["equal"])
            self.assertTrue(geometry.compare_bits(actual=updated.delta, expected=state.delta)["equal"])
            self.assertIs(updated.first, first)

    def test_scale_threshold_compares_promoted_float_to_double_constant(self):
        lower = np.float32(1e-5)
        upper = np.nextafter(lower, np.float32(1))
        self.assertLess(float(lower), 1e-5)
        self.assertGreater(float(upper), 1e-5)
        for scale, expected_first in ((lower, True), (upper, False)):
            _, state = geometry.update_inner_filter(state=inner_state(scale=scale), points=np.ones((1, 2), np.float32))
            self.assertIs(state.first, expected_first)

    def test_empty_input_or_state_does_not_advance_history(self):
        empty = np.empty((0, 2), np.float32)
        for state, points in ((inner_state(), empty), (inner_state(current=empty), np.ones((1, 2), np.float32))):
            output, updated = geometry.update_inner_filter(state=state, points=points)
            self.assertIs(updated, state)
            self.assertTrue(geometry.compare_bits(actual=output, expected=points)["equal"])
            self.assertFalse(np.shares_memory(output, points))

    def test_zero_displacement_and_weight_underflow_remain_finite(self):
        for old, points in ((np.array([[7, -8]], np.float32), np.array([[7, -8]], np.float32)),
                            (np.array([[-32768, 32768]], np.float32), np.array([[32768, -32768]], np.float32))):
            output, _ = geometry.update_inner_filter(state=inner_state(current=old), points=points)
            self.assertTrue(geometry.compare_bits(actual=output, expected=points)["equal"])

    def test_invalid_input_or_size_change_is_rejected_without_cast(self):
        for points in ([[1, 2]], np.ones((1, 2), np.float64), np.ones((2, 2), np.float32),
                       np.ones((107, 2), np.float32), np.ones((1, 3), np.float32),
                       np.full((1, 2), np.nan, np.float32), np.full((1, 2), 32769, np.float32)):
            with self.subTest(shape=np.shape(points)), self.assertRaises(ValueError):
                geometry.update_inner_filter(state=inner_state(), points=points)
        with self.assertRaises(ValueError):
            geometry.update_inner_filter(state={}, points=np.ones((1, 2), np.float32))

    def test_inputs_remain_unchanged_and_result_buffers_are_detached(self):
        state = inner_state()
        points = np.ones((1, 2), np.float32)
        output, updated = geometry.update_inner_filter(state=state, points=points)
        output[:] = 99
        points[:] = 200
        self.assertTrue(np.array_equal(state.current, np.zeros((1, 2), np.float32)))
        self.assertFalse(np.array_equal(updated.current, output))
        self.assertFalse(updated.current.flags.writeable)
        self.assertFalse(np.shares_memory(updated.previous, state.current))


R4_PATH = os.environ.get("QCUT_FACE_EXTRA_CROP_OBSERVER")


@unittest.skipUnless(R4_PATH, "set QCUT_FACE_EXTRA_CROP_OBSERVER to the private r4 observer")
class CapturedInnerFilterTests(unittest.TestCase):
    def setUp(self):
        payload = Path(R4_PATH).read_bytes()
        self.assertEqual(hashlib.sha256(payload).hexdigest(),
                         "c83f4f42802a164a547bb0bd6fb19e9da4c35a6877d35d7a06a35368ce14f017")
        self.observer = json.loads(payload)

    def test_actual_r4_bypass_and_636_coordinate_state_bits_match(self):
        result = geometry.audit_inner_filter(observer=self.observer)
        self.assertTrue(result["boundary_state_bits_equal"])
        self.assertEqual([case["mode"] for case in result["cases"]], ["config-bypass", "cubic-inner-update"])
        checks = result["cases"][1]["checks"]
        self.assertEqual(sum(checks[key]["compared_values"] for key in
                             ("current_xy", "previous_xy", "delta_x", "delta_y")), 636)
        self.assertFalse(result["owned_geometry_enabled"])
        self.assertFalse(result["geometry_parity_verified"])
        self.assertFalse(result["cases"][1]["actual_inner_call_arguments_captured"])

    def test_actual_r4_mapping_roundtrip_is_not_an_identity(self):
        result = geometry.audit_inner_filter(observer=self.observer)["cases"][1]
        self.assertEqual(result["roundtrip_vs_pre_published"]["mismatched_values"], 5)
        self.assertEqual(result["input_sha256"], "7dc2bfb159b5ca1c0a1e714228e75145c263b5941dbb8951e86a71fefa036e49")
        self.assertEqual(result["output_sha256"], "51b4ae4b9eebaacd1210c3719dd9bc3ff52a170675aebc41505511c515a79cef")

    def test_corrupt_post_filter_state_is_only_a_failed_reference_not_an_input(self):
        expected = geometry.audit_inner_filter(observer=self.observer)["cases"][1]
        self.observer["extra_trace"]["events"][3]["crop_geometry"]["inner_filter"]["current_xy"][0] += 1
        result = geometry.audit_inner_filter(observer=self.observer)["cases"][1]
        self.assertFalse(result["boundary_state_bits_equal"])
        self.assertEqual(result["checks"]["current_xy"]["mismatched_values"], 1)
        self.assertEqual(result["output_sha256"], expected["output_sha256"])
        self.assertEqual(result["input_sha256"], expected["input_sha256"])

    def test_final_published_points_and_extra_transform_do_not_feed_filter_math(self):
        expected = geometry.audit_inner_filter(observer=self.observer)["cases"][1]
        row = self.observer["extra_trace"]["events"][3]
        row["snapshot"]["published_xy"][0] += 10
        row["crop_geometry"]["published_xy"][0] += 10
        row["crop_geometry"]["transforms"]["extra"]["forward"][0][2] += 10
        result = geometry.audit_inner_filter(observer=self.observer)["cases"][1]
        self.assertTrue(result["boundary_state_bits_equal"])
        self.assertEqual(result["output_sha256"], expected["output_sha256"])

    def test_changed_pre_crop_point_changes_computation_and_fails_comparison(self):
        row = self.observer["extra_trace"]["events"][2]
        row["snapshot"]["published_xy"][0] += 10
        row["crop_geometry"]["published_xy"][0] += 10
        result = geometry.audit_inner_filter(observer=self.observer)["cases"][1]
        self.assertFalse(result["boundary_state_bits_equal"])
        self.assertFalse(result["checks"]["delta_x"]["equal"])

    def test_inconsistent_native_matrix_observations_are_rejected(self):
        row = self.observer["extra_trace"]["events"][3]
        row["crop_geometry"]["transforms"]["stage2"]["forward"][0][2] += 1
        with self.assertRaisesRegex(ValueError, "diagnostics disagree"):
            geometry.audit_inner_filter(observer=self.observer)

    def test_optimized_secondary_warp_and_other_face_modes_are_rejected(self):
        original = copy.deepcopy(self.observer)
        for key, field, value in (("config_bytes", "0xb", 1), ("config_bytes", "0x21", 1),
                                  ("face_modes", "0x3c", 5), ("face_modes", "0x68", 1)):
            self.observer = copy.deepcopy(original)
            for row in self.observer["extra_trace"]["events"]:
                row["snapshot"][key][field] = value
                row["crop_geometry"][key][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "ordinary primary106"):
                geometry.audit_inner_filter(observer=self.observer)

    def test_post_state_first_and_parameter_mismatch_are_reported(self):
        state = self.observer["extra_trace"]["events"][3]["crop_geometry"]["inner_filter"]
        state["first"], state["alpha"] = True, 0.5
        result = geometry.audit_inner_filter(observer=self.observer)["cases"][1]
        self.assertFalse(result["boundary_state_bits_equal"])
        self.assertFalse(result["checks"]["first"]["equal"])
        self.assertFalse(result["checks"]["alpha"]["equal"])


if __name__ == "__main__":
    unittest.main()
