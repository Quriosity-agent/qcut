"""Synthetic sampling controls and mocked native boundaries; no vendor runtime."""

from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

import cv2
import numpy as np

import face_host_sampling_probe as probe


def identity():
    return np.array([[1, 0, 0], [0, 1, 0]], np.float32)


def rgba_frame():
    return np.arange(120 * 120 * 4, dtype=np.uint8).reshape(120, 120, 4)


class RecoveredTests(unittest.TestCase):
    def test_signed_extremes_are_recovered_without_clipping_or_channel_changes(self):
        tensor = np.tile(np.array([-128, 0, 127], np.int16), (1, 120, 120, 1))
        original = tensor.copy()
        actual = probe.recovered(tensor=tensor)
        self.assertEqual(actual.dtype, np.uint8)
        self.assertEqual(actual.shape, (120, 120, 3))
        np.testing.assert_array_equal(actual, np.broadcast_to([0, 128, 255], actual.shape))
        actual[0, 0] = 0
        np.testing.assert_array_equal(tensor, original)

    def test_out_of_range_signed_pixels_are_rejected_not_clipped(self):
        for value in (-32768, -129, 128, 32767):
            tensor = np.zeros((1, 120, 120, 3), np.int16)
            tensor[0, 0, 0, 0] = value
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "clipping prohibited"):
                probe.recovered(tensor=tensor)

    def test_wrong_storage_or_signed120_shape_is_rejected(self):
        for dtype in (np.int8, np.int32, np.uint8, np.uint16, np.float32, np.bool_):
            with self.subTest(dtype=dtype), self.assertRaises(ValueError):
                probe.recovered(tensor=np.zeros((1, 120, 120, 3), dtype))
        for shape in ((120, 120, 3), (2, 120, 120, 3), (1, 160, 160, 3), (1, 120, 120, 4), (1, 0, 120, 3)):
            with self.subTest(shape=shape), self.assertRaises(ValueError):
                probe.recovered(tensor=np.zeros(shape, np.int16))


class OpenCVTests(unittest.TestCase):
    def test_identity_returns_owned_bgr_without_alpha_premultiplication(self):
        frame = rgba_frame()
        original = frame.copy()
        frame[0, 0] = [17, 91, 231, 0]
        original[0, 0] = frame[0, 0]
        for interpolation in ("nearest", "linear"):
            with self.subTest(interpolation=interpolation):
                actual = probe.opencv_sample(frame=frame, inverse=identity(), interpolation=interpolation)
                np.testing.assert_array_equal(actual, frame[:, :, :3][:, :, ::-1])
                self.assertEqual(actual.shape, (120, 120, 3))
                self.assertEqual(actual.dtype, np.uint8)
                self.assertTrue(actual.flags.c_contiguous)
                actual[:] = 0
                np.testing.assert_array_equal(frame, original)

    def test_inverse_integer_translation_uses_source_coordinates_and_zero_borders(self):
        frame = rgba_frame()
        matrix = identity()
        matrix[:, 2] = [2, -1]
        original = matrix.copy()
        for interpolation in ("nearest", "linear"):
            with self.subTest(interpolation=interpolation):
                actual = probe.opencv_sample(frame=frame, inverse=matrix, interpolation=interpolation)
                np.testing.assert_array_equal(actual[1:, :118], frame[:-1, 2:, :3][:, :, ::-1])
                self.assertFalse(actual[0].any())
                self.assertFalse(actual[:, 118:].any())
                np.testing.assert_array_equal(matrix, original)

    def test_fractional_linear_translation_interpolates_bgr_channels(self):
        frame = np.array([[[10, 20, 30, 255], [30, 40, 50, 255]]], np.uint8)
        matrix = identity()
        matrix[0, 2] = 0.5
        actual = probe.opencv_sample(frame=frame, inverse=matrix, interpolation="linear")
        np.testing.assert_array_equal(actual[0, 0], [40, 30, 20])
        self.assertFalse(actual[1:].any())
        self.assertFalse(actual[:, 2:].any())

    def test_small_frames_keep_the_fixed120_output_with_constant_borders(self):
        frame = np.array([[[11, 22, 33, 44]]], np.uint8)
        actual = probe.opencv_sample(frame=frame, inverse=identity(), interpolation="nearest")
        np.testing.assert_array_equal(actual[0, 0], [33, 22, 11])
        self.assertEqual(np.count_nonzero(actual), 3)

    def test_invalid_frame_sizes_shapes_and_storage_are_rejected_before_warp(self):
        frames = [np.zeros(shape, np.uint8) for shape in
                  ((0, 4, 4), (4, 0, 4), (4097, 1, 4), (1, 4097, 4), (4, 4), (4, 4, 3), (4, 4, 5))]
        frames.extend(np.zeros((4, 4, 4), dtype) for dtype in (np.int8, np.uint16, np.float32, np.bool_))
        for frame in frames:
            with self.subTest(shape=frame.shape, dtype=frame.dtype), patch.object(cv2, "warpAffine") as warp:
                with self.assertRaises(ValueError):
                    probe.opencv_sample(frame=frame, inverse=identity(), interpolation="nearest")
                warp.assert_not_called()

    def test_singular_nonfinite_unbounded_or_wrong_shape_matrices_are_rejected(self):
        for matrix in (np.zeros((2, 3)), np.eye(3), [[1, 2, 0], [2, 4, 0]],
                       [[1, 0, np.nan], [0, 1, 0]], [[1, 0, 0], [0, np.inf, 0]],
                       [[1, 0, 32769], [0, 1, 0]]):
            with self.subTest(matrix=matrix), patch.object(cv2, "warpAffine") as warp:
                with self.assertRaises(ValueError):
                    probe.opencv_sample(frame=rgba_frame(), inverse=matrix, interpolation="linear")
                warp.assert_not_called()

    def test_invalid_interpolation_modes_are_rejected_before_warp(self):
        for interpolation in (None, False, "cubic", "NEAREST", "", [], {}):
            with self.subTest(interpolation=interpolation), patch.object(cv2, "warpAffine") as warp:
                with self.assertRaises(ValueError):
                    probe.opencv_sample(frame=rgba_frame(), inverse=identity(), interpolation=interpolation)
                warp.assert_not_called()

    def test_opencv_version_is_pinned_before_warp(self):
        for version in ("4.10.0", "4.11.1", "5.0.0", None):
            with self.subTest(version=version), patch.object(cv2, "__version__", version), \
                    patch.object(cv2, "warpAffine") as warp:
                with self.assertRaisesRegex(ValueError, "OpenCV 4.11.0"):
                    probe.opencv_sample(frame=rgba_frame(), inverse=identity(), interpolation="nearest")
                warp.assert_not_called()


class DifferenceTests(unittest.TestCase):
    def test_exact_blocks_report_zero_errors(self):
        value = rgba_frame()[:, :, :3].copy()
        self.assertEqual(probe.difference(actual=value, expected=value.copy()),
                         dict(exact=True, elements=43200, changed_elements=0, changed_pixels=0, max_abs=0, mean_abs=0.0))

    def test_changed_channels_and_pixels_use_signed_absolute_differences(self):
        expected = np.zeros((120, 120, 3), np.uint8)
        expected[0, 0, 0] = 255
        actual = expected.copy()
        actual[0, 0] = [0, 7, 0]
        actual[1, 1, 2] = 1
        original = actual.copy()
        result = probe.difference(actual=actual, expected=expected)
        self.assertEqual({key: value for key, value in result.items() if key != "mean_abs"},
                         dict(exact=False, elements=43200, changed_elements=3, changed_pixels=2, max_abs=255))
        self.assertAlmostEqual(result["mean_abs"], 263 / 43200)
        np.testing.assert_array_equal(actual, original)

    def test_wrong_uint8_shapes_or_types_are_rejected_on_either_side(self):
        good = np.zeros((120, 120, 3), np.uint8)
        invalid = [np.zeros(shape, np.uint8) for shape in ((120, 120, 4), (120, 119, 3), (0, 120, 3), (1, 120, 120, 3))]
        invalid.extend(good.astype(dtype) for dtype in (np.int16, np.float32, np.bool_))
        for value in invalid:
            for actual, expected in ((value, good), (good, value)):
                with self.subTest(actual=actual.shape, expected=expected.shape, dtype=value.dtype), self.assertRaises(ValueError):
                    probe.difference(actual=actual, expected=expected)


class NativeSampleTests(unittest.TestCase):
    def test_synthetic_controls_use_seven_fixed_transforms_and_both_native_routes(self):
        state = {}
        warp = Mock()
        warp.set_matrix.side_effect = lambda *, matrix: state.update(forward=matrix.copy())
        warp.prepare.side_effect = lambda **kwargs: probe.sample_bgr(frame=kwargs["frame"], forward=state["forward"])
        with patch("ctypes.CDLL", side_effect=AssertionError("vendor runtime forbidden")):
            controls = probe.synthetic_controls(warp=warp)
        self.assertEqual((len(controls), warp.set_matrix.call_count, warp.prepare.call_count), (7, 7, 14))
        self.assertEqual([call.kwargs["fused"] for call in warp.prepare.call_args_list], [False, True] * 7)
        self.assertTrue(all(check["exact"] for case in controls for check in case["comparisons"].values()))

    def test_forward_and_recorded_inverse_are_preserved_without_recomputing(self):
        face = dict(forward=[[1.25, 0.2, 4], [0, 0.75, -3]], inverse=[[0.7, -0.1, -2], [0.03, 1.3, 5]])
        original = deepcopy(face)
        state = {}
        warp = Mock(transform=object())
        warp.set_matrix.side_effect = lambda *, matrix: state.update(forward=matrix.copy())

        def set_inverse(transform, borrowed):
            self.assertIs(transform, warp.transform)
            state["inverse"] = borrowed._obj._buffer_reference.copy()

        warp.set_inverse.side_effect = set_inverse
        warp.matrices.side_effect = lambda: (state["forward"], state["inverse"])
        fallback, fused = (np.full((120, 120, 3), value, np.uint8) for value in (11, 22))
        warp.prepare.side_effect = [fallback, fused]
        frame = rgba_frame()
        with patch("ctypes.CDLL", side_effect=AssertionError("vendor runtime forbidden")):
            result = probe.native_samples(warp=warp, frame=frame, face=face)
        self.assertIs(result["native-fallback"], fallback)
        self.assertIs(result["native-fused"], fused)
        np.testing.assert_array_equal(state["forward"], np.asarray(face["forward"], np.float32))
        np.testing.assert_array_equal(state["inverse"], np.asarray(face["inverse"], np.float32))
        self.assertEqual(face, original)
        self.assertEqual([item.kwargs["fused"] for item in warp.prepare.call_args_list], [False, True])
        for item in warp.prepare.call_args_list:
            self.assertIs(item.kwargs["frame"], frame)
            self.assertEqual((item.kwargs["mode"], item.kwargs["size"]), ("RGBA", (120, 120)))

    def test_changed_forward_or_inverse_is_rejected_before_prepare(self):
        face = dict(forward=identity(), inverse=identity())
        for index in (0, 1):
            matrices = [identity(), identity()]
            matrices[index][0, 2] = 1
            warp = Mock(transform=object(), matrices=Mock(return_value=matrices))
            with self.subTest(index=index), self.assertRaisesRegex(ValueError, "matrix changed"):
                probe.native_samples(warp=warp, frame=rgba_frame(), face=face)
            warp.prepare.assert_not_called()

    def test_invalid_recorded_matrix_is_rejected_before_native_setters(self):
        for key in ("forward", "inverse"):
            face = dict(forward=identity(), inverse=identity())
            face[key] = np.zeros((2, 3), np.float32)
            warp = Mock()
            with self.subTest(key=key), self.assertRaises(ValueError):
                probe.native_samples(warp=warp, frame=rgba_frame(), face=face)
            warp.set_matrix.assert_not_called()
            warp.set_inverse.assert_not_called()
            warp.prepare.assert_not_called()


class CleanupTests(unittest.TestCase):
    def test_both_objects_close_and_report_is_written_even_if_first_close_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            report = dict(completed=True, failures=[])
            error = RuntimeError("warp close")
            warp = Mock(close=Mock(side_effect=error))
            native = Mock()
            with self.assertRaises(RuntimeError) as caught:
                probe.finish_report(out=out, report=report, resources=(warp, native), original_error=None)
            self.assertIs(caught.exception, error)
            warp.close.assert_called_once_with()
            native.close.assert_called_once_with()
            saved = json.loads((out / "report.json").read_text())
            self.assertFalse(saved["completed"])
            self.assertEqual(saved["failures"], ["cleanup RuntimeError: warp close"])

    def test_original_error_survives_both_cleanup_failures(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            error = ValueError("original probe failure")
            report = dict(completed=False, failures=[str(error)])
            resources = [Mock(close=Mock(side_effect=RuntimeError(name))) for name in ("warp", "native")]
            with self.assertRaises(ValueError) as caught:
                try:
                    raise error
                finally:
                    probe.finish_report(out=out, report=report, resources=resources, original_error=sys.exc_info()[1])
            self.assertIs(caught.exception, error)
            self.assertEqual(len(json.loads((out / "report.json").read_text())["failures"]), 3)
            for resource in resources:
                resource.close.assert_called_once_with()

    def test_missing_resources_and_successful_cleanup_preserve_completion(self):
        with tempfile.TemporaryDirectory() as directory:
            report = dict(completed=True, failures=[])
            resource = Mock()
            probe.finish_report(out=Path(directory), report=report, resources=(None, resource), original_error=None)
            resource.close.assert_called_once_with()
            self.assertTrue(report["completed"])
            self.assertEqual(report["failures"], [])

    def test_report_write_error_propagates_only_without_original_failure(self):
        out = Mock(spec=Path)
        out.__truediv__ = Mock(return_value=Mock(write_text=Mock(side_effect=OSError("disk failure"))))
        for original_error in (None, ValueError("original")):
            report = dict(completed=True, failures=[])
            if original_error is None:
                with self.assertRaisesRegex(OSError, "disk failure"):
                    probe.finish_report(out=out, report=report, resources=(), original_error=None)
            else:
                probe.finish_report(out=out, report=report, resources=(), original_error=original_error)
            self.assertFalse(report["completed"])


if __name__ == "__main__":
    unittest.main()
