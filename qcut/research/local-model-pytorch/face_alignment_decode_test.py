"""Synthetic Stage1 contracts; no vendor models, tables or runtime required."""
import ctypes as ct
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import numpy as np

from face_alignment_decode_native import NativeAlignmentDecode, read_pairs, validate_control
from face_alignment_decode_verify import CHECKS, evidence_passed, stage1_witness, synthetic_controls, run
from face_detector_native import TensorView
from face_geometry_native import Mat, mat_view


def passing_report(*, size=120):
    return {"size": size, "optimized": False, "threshold": 0.0, "confidence": 0.2, "repeat_confidence": 0.2,
            "branch": "base-residual" if size == 120 else "detection-coordinate",
            **{name: {"exact": True} for name in CHECKS}}


class Stage1WitnessTest(unittest.TestCase):
    def fixture(self):
        raw = np.arange(212, dtype=np.float32).reshape(106, 2) / 10
        mean = np.linspace(1, 255, 212, dtype=np.float32).reshape(106, 2)
        order = np.roll(np.arange(106), 9)
        return {"raw_pairs": raw, "mean": mean, "order": order, "size": 120}

    def test_base_residual_scatter_then_mean_uses_destination_order(self):
        fixture = self.fixture()
        decoded, actual = stage1_witness(**fixture)
        for index, destination in enumerate(fixture["order"]):
            np.testing.assert_array_equal(decoded[destination], fixture["raw_pairs"][index])
            expected = (fixture["raw_pairs"][index].astype(np.float64)
                        + fixture["mean"][destination].astype(np.float64) / 256 * 120).astype(np.float32)
            np.testing.assert_array_equal(actual[destination], expected)
        self.assertFalse(np.array_equal(decoded, fixture["raw_pairs"][fixture["order"]]))

    def test_detection_coordinates_are_not_scaled_or_offset(self):
        decoded, actual = stage1_witness(**{**self.fixture(), "size": 160})
        np.testing.assert_array_equal(actual, decoded)
        actual[:] = 0
        self.assertTrue(np.any(decoded))

    def test_dimension_is_size_not_size_minus_one(self):
        fixture = {**self.fixture(), "mean": np.full((106, 2), 256, np.float32)}
        decoded, actual = stage1_witness(**fixture)
        np.testing.assert_array_equal(actual, (decoded.astype(np.float64) + 120).astype(np.float32))
        self.assertFalse(np.array_equal(actual, decoded + 119))

    def test_rounds_only_after_double_precision_baseline_addition(self):
        fixture = self.fixture()
        fixture["raw_pairs"] = np.full((106, 2), -23.737606, np.float32)
        fixture["mean"] = np.full((106, 2), 237.86554, np.float32)
        decoded, actual = stage1_witness(**fixture)
        expected = (decoded.astype(np.float64) + fixture["mean"].astype(np.float64) / 256 * 120).astype(np.float32)
        np.testing.assert_array_equal(actual, expected)
        self.assertFalse(np.array_equal(actual, decoded + fixture["mean"] / np.float32(256) * np.float32(120)))

    def test_invalid_means_profiles_and_tokens_rejected(self):
        fixture = self.fixture()
        for changes in ({"size": True}, {"size": 121}, {"size": 120.0}, {"mean": np.zeros((105, 2))},
                        {"mean": np.full((106, 2), np.nan)}, {"mean": np.full((106, 2), 257)},
                        {"mean": np.full((106, 2), -1)}, {"raw_pairs": np.full((106, 2), np.inf)},
                        {"raw_pairs": np.zeros((105, 2))}, {"order": np.zeros(106, int)},
                        {"order": np.arange(106, dtype=np.float32)}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                stage1_witness(**{**fixture, **changes})

    def test_sources_are_not_mutated(self):
        fixture = self.fixture()
        before = {key: value.copy() for key, value in fixture.items() if isinstance(value, np.ndarray)}
        stage1_witness(**fixture)
        for key, value in before.items():
            np.testing.assert_array_equal(fixture[key], value)


class DecodeEvidenceTest(unittest.TestCase):
    def test_every_stage_and_metadata_field_required(self):
        for size in (120, 160):
            report = passing_report(size=size)
            self.assertTrue(evidence_passed(report=report))
            for key in report:
                self.assertFalse(evidence_passed(report={name: value for name, value in report.items() if name != key}))
            for key in CHECKS:
                self.assertFalse(evidence_passed(report={**report, key: {"exact": False}}))

    def test_wrong_branch_confidence_and_truthy_metadata_rejected(self):
        report = passing_report()
        for key, value in (("branch", "detection-coordinate"), ("size", 120.0), ("optimized", 0),
                           ("threshold", 0), ("threshold", 0.5), ("confidence", np.nan),
                           ("repeat_confidence", 0.3), ("input", {"exact": 1})):
            with self.subTest(key=key, value=value):
                self.assertFalse(evidence_passed(report={**report, key: value}))

    def test_twenty_synthetic_controls_cover_both_profiles_and_modes(self):
        controls = list(synthetic_controls())
        self.assertEqual(len(controls), 20)
        self.assertEqual({item["fixture"] for item in controls}, {"black", "neutral", "white", "ramp", "noise"})
        for fixture in {item["fixture"] for item in controls}:
            self.assertEqual({(item["size"], item["optimized"]) for item in controls if item["fixture"] == fixture},
                             {(120, False), (120, True), (160, False), (160, True)})
        for item in controls:
            self.assertEqual(item["pixels"].shape, (item["size"], item["size"], 3))

    def test_existing_output_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory, patch("face_alignment_decode_verify.private_path", side_effect=lambda *, path: Path(path)):
            with self.assertRaisesRegex(ValueError, "overwrite"):
                run(output=Path(directory), image="unused")

    def test_missing_fixture_creates_no_evidence(self):
        with tempfile.TemporaryDirectory() as directory, patch("face_alignment_decode_verify.private_path", side_effect=lambda *, path: Path(path)):
            output = Path(directory) / "new"
            with self.assertRaisesRegex(ValueError, "fixture"):
                run(output=output, image=Path(directory) / "missing.png")
            self.assertFalse(output.exists())


class NativeDecodeBoundaryTest(unittest.TestCase):
    def oracle(self):
        oracle = object.__new__(NativeAlignmentDecode)
        oracle.native = Mock()
        oracle._owner = ct.create_string_buffer(0x1100)
        oracle.native.alignment = ct.addressof(oracle._owner)
        oracle.native.predictors = {120: 1, 160: 2}
        oracle.geometry, oracle.phase, oracle.read_function = Mock(), Mock(), Mock()
        oracle.get = {False: 3, True: 4}
        return oracle

    def test_noncontiguous_pixels_are_copied(self):
        pixels = np.zeros((240, 240, 3), np.uint8)[::2, ::2]
        result = validate_control(pixels=pixels, size=120, optimized=False)
        self.assertTrue(result.flags.c_contiguous)
        np.testing.assert_array_equal(result, pixels)

    def test_invalid_controls_do_not_invoke_original_function(self):
        oracle = self.oracle()
        for pixels, optimized in ((np.zeros((119, 119, 3), np.uint8), False),
                                  (np.zeros((120, 120, 4), np.uint8), False),
                                  (np.zeros((120, 120, 3), np.float32), False),
                                  (np.zeros((120, 120, 3), np.uint8), 0),
                                  (np.zeros((120, 160, 3), np.uint8), False)):
            with self.assertRaises(ValueError):
                oracle.run_phase(pixels=pixels, optimized=optimized)
        oracle.phase.assert_not_called()

    def test_invalid_thresholds_do_not_invoke_original_function(self):
        oracle = self.oracle()
        for threshold in (True, None, "0", [], 1j, np.nan, np.inf, -0.1, 1.1):
            with self.subTest(threshold=threshold), self.assertRaises(ValueError):
                oracle.run_phase(pixels=np.zeros((120, 120, 3), np.uint8), optimized=False, threshold=threshold)
        oracle.phase.assert_not_called()

    def test_closed_owner_rejected_before_any_execution(self):
        oracle = self.oracle()
        oracle.native.detector.require_open.side_effect = ValueError("closed")
        with self.assertRaisesRegex(ValueError, "closed"):
            oracle.run_phase(pixels=np.zeros((120, 120, 3), np.uint8), optimized=False)
        with self.assertRaisesRegex(ValueError, "closed"):
            oracle.read(size=120, optimized=False)
        oracle.phase.assert_not_called()
        oracle.read_function.assert_not_called()

    def test_invalid_read_profiles_rejected_before_bridge(self):
        oracle = self.oracle()
        for size, optimized in ((True, False), (120.0, False), (240, False), (120, 0)):
            with self.assertRaises(ValueError):
                oracle.read(size=size, optimized=optimized)
        oracle.read_function.assert_not_called()

    def test_native_rejection_does_not_use_previous_output(self):
        oracle = self.oracle()
        oracle.phase.return_value = False
        oracle.read = Mock()
        with self.assertRaisesRegex(ValueError, "rejected"):
            oracle.run_phase(pixels=np.zeros((120, 120, 3), np.uint8), optimized=False)
        oracle.read.assert_not_called()

    def test_phase_is_copied_before_decoder_overwrites_shared_storage(self):
        for size in (120, 160):
            oracle = self.oracle()
            storage = np.arange(212, dtype=np.float32).reshape(2, 106)
            expected = storage.T.copy()
            view = mat_view(array=storage)
            ct.memmove(oracle.native.alignment + 0xAA8, ct.byref(view), ct.sizeof(Mat))
            result = (np.zeros((1, size, size, 3), np.int16), np.zeros((106, 2), np.float32), expected.copy())

            def overwrite(*, size, optimized):
                storage[:] = 999
                return result

            oracle.read = Mock(side_effect=overwrite)
            actual = oracle.run_phase(pixels=np.zeros((size, size, 3), np.uint8), optimized=True)
            np.testing.assert_array_equal(actual[3], expected)
            args = oracle.phase.call_args.args
            self.assertEqual(args[3:5], (size == 160, 2))
            self.assertEqual([args[5].raw[index] for index in (0, 3, 7, 8, 11)], [1, 1, 0, 0, 1])
            self.assertEqual(ct.c_int.from_buffer(args[6], 0x124).value, -1)
            self.assertEqual(ct.c_int.from_buffer(args[6], 0xFC).value, 0)
            self.assertEqual(oracle.geometry.set_anchors.call_count, int(size == 160))

    def test_bridge_failure_is_not_read_as_success(self):
        oracle = self.oracle()
        oracle.read_function.return_value = 6
        with self.assertRaisesRegex(ValueError, "decoding failed: 6"):
            oracle.read(size=120, optimized=False)

    def reader(self, *, size, format_change=None, nonfinite=False):
        oracle = self.oracle()
        inputs = np.arange(size * size * 3, dtype=np.int16 if size == 120 else np.int8).reshape(1, size, size, 3)
        raw = np.arange(212, dtype=np.float32).reshape(106, 2)
        expected = raw.copy()
        raw_format = (4, 0) if format_change is None else format_change

        def fill(function, cleanup, predictor, input_pointer, raw_pointer, decoded_pointer):
            ct.cast(input_pointer, ct.POINTER(TensorView))[0] = TensorView(
                inputs.ctypes.data, (ct.c_int * 4)(1, size, size, 3),
                (ct.c_int * 2)(2 if size == 120 else 1, 6))
            ct.cast(raw_pointer, ct.POINTER(TensorView))[0] = TensorView(
                raw.ctypes.data, (ct.c_int * 4)(1, 1, 1, 212), (ct.c_int * 2)(*raw_format))
            copied = np.full((106, 2), np.nan, np.float32) if nonfinite else expected
            ct.memmove(decoded_pointer, copied.ctypes.data, copied.nbytes)
            return 0

        oracle.read_function.side_effect = fill
        return oracle, inputs, raw, expected

    def test_actual_tensor_copy_has_correct_profile_and_owned_buffers(self):
        for size in (120, 160):
            oracle, inputs, raw, expected = self.reader(size=size)
            actual = oracle.read(size=size, optimized=True)
            for value, wanted in zip(actual, (inputs, raw, expected), strict=True):
                np.testing.assert_array_equal(value, wanted)
            self.assertEqual(oracle.read_function.call_args.args[0], oracle.get[True])
            inputs[:] = 0
            raw[:] = 0
            self.assertTrue(np.any(actual[0]))
            self.assertEqual(actual[1][-1, -1], 211)

    def test_raw_tensor_fraction_and_type_must_match(self):
        for raw_format in ((4, 1), (2, 0)):
            oracle, *_ = self.reader(size=120, format_change=raw_format)
            with self.assertRaises(ValueError):
                oracle.read(size=120, optimized=False)

    def test_nonfinite_decoded_output_rejected(self):
        oracle, *_ = self.reader(size=120, nonfinite=True)
        with self.assertRaisesRegex(ValueError, "descriptor"):
            oracle.read(size=120, optimized=False)

    def test_nonfinite_original_quality_result_rejected(self):
        oracle = self.oracle()
        view = mat_view(array=np.zeros((2, 106), np.float32))
        ct.memmove(oracle.native.alignment + 0xAA8, ct.byref(view), ct.sizeof(Mat))

        def phase(alignment, source, prepared, detection, mode, config, timing):
            ct.c_float.from_buffer(timing, 0x28).value = np.nan
            return True

        oracle.phase.side_effect = phase
        oracle.read = Mock(return_value=(None, None, None))
        with self.assertRaisesRegex(ValueError, "quality result"):
            oracle.run_phase(pixels=np.zeros((120, 120, 3), np.uint8), optimized=False)

    def test_existing_decode_bridge_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory, patch("face_alignment_decode_native.private_path", side_effect=lambda *, path: Path(path)):
            with self.assertRaisesRegex(ValueError, "fresh"):
                NativeAlignmentDecode(native=Mock(), output=Path(directory))

    def test_native_points_must_be_finite_and_have_106_pairs(self):
        for values in (np.zeros((2, 105), np.float32), np.full((2, 106), np.nan, np.float32)):
            with self.assertRaises(ValueError):
                read_pairs(value=mat_view(array=values))

    def test_native_points_are_not_borrowed(self):
        values = np.arange(212, dtype=np.float32).reshape(2, 106)
        actual = read_pairs(value=mat_view(array=values))
        values[:] = 0
        self.assertEqual(actual[-1, -1], 211)


if __name__ == "__main__":
    unittest.main()
