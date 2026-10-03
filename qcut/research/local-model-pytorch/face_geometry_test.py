"""Public geometry and native-boundary regressions without proprietary assets."""
import ctypes as ct
import gc
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import weakref

import numpy as np

from face_geometry import CropRegion, crop_pixels, crop_region, map_points, reorder_landmarks, resize_inverse
from face_geometry_native import Mat, NativeGeometry, copy_mat, mat_view
from face_geometry_verify import compare, run


class CropGeometryTest(unittest.TestCase):
    def test_centered_square_expansion(self):
        region = crop_region(rect=(6, 4, 8, 6), frame_size=(67, 43), expansion=1.5)
        self.assertEqual(region.rect, (4, 1, 12, 12))

    def test_legacy_anchor_is_not_centered(self):
        cases = [((6, 4, 8, 6), (4, 0, 12, 12)), ((6, 4, 6, 8), (2, 2, 12, 12))]
        for box, expected in cases:
            with self.subTest(box=box):
                self.assertEqual(crop_region(rect=box, frame_size=(67, 43), expansion=1.5,
                                             legacy_anchor=True).rect, expected)

    def test_legacy_anchor_falls_back_at_bottom_and_right(self):
        for box, expected in [((59, 37, 8, 6), (59, 37, 8, 8)), ((61, 35, 6, 8), (61, 35, 8, 8))]:
            with self.subTest(box=box):
                self.assertEqual(crop_region(rect=box, frame_size=(67, 43), expansion=1,
                                             legacy_anchor=True).rect, expected)

    def test_negative_half_origin_truncates_toward_zero(self):
        self.assertEqual(crop_region(rect=(0, 0, 4, 4), frame_size=(10, 10), expansion=1.5).rect,
                         (0, 0, 6, 6))

    def test_positive_half_side_rounds_up_not_to_even(self):
        self.assertEqual(crop_region(rect=(0, 0, 3, 3), frame_size=(10, 10), expansion=1.5).size, 5)

    def test_fractional_box_origin_rounds_before_side(self):
        self.assertEqual(crop_region(rect=(11.25, 12.75, 7.5, 8.5), frame_size=(67, 43), expansion=1).rect,
                         (11, 13, 9, 9))

    def test_single_pixel_crop(self):
        frame = np.full((1, 1, 3), 149, np.uint8)
        region = crop_region(rect=(0, 0, 1, 1), frame_size=(1, 1), expansion=1)
        np.testing.assert_array_equal(crop_pixels(frame=frame, region=region), frame)

    def test_black_padding_top_left(self):
        frame = np.arange(4 * 5 * 3, dtype=np.uint8).reshape(4, 5, 3)
        output = crop_pixels(frame=frame, region=CropRegion(x=-2, y=-1, size=4))
        expected = np.zeros((4, 4, 3), np.uint8)
        expected[1:, 2:] = frame[:3, :2]
        np.testing.assert_array_equal(output, expected)

    def test_black_padding_bottom_right(self):
        frame = np.full((4, 5, 3), 149, np.uint8)
        output = crop_pixels(frame=frame, region=CropRegion(x=3, y=2, size=4))
        expected = np.zeros((4, 4, 3), np.uint8)
        expected[:2, :2] = 149
        np.testing.assert_array_equal(output, expected)

    def test_noncontiguous_frame_is_supported_by_owned_copy(self):
        frame = np.arange(8 * 10 * 3, dtype=np.uint8).reshape(8, 10, 3)[::2, ::2]
        np.testing.assert_array_equal(crop_pixels(frame=frame, region=CropRegion(x=0, y=0, size=4)), frame[:, :4])

    def test_invalid_box_and_expansion(self):
        for box in [(1, 2, 0, 4), (1, 2, -1, 4), (1, 2, 3), (0, 0, np.nan, 4)]:
            with self.subTest(box=box), self.assertRaises(ValueError):
                crop_region(rect=box, frame_size=(20, 20), expansion=1.5)
        for factor in (0, -1, np.nan, np.inf, 1e6):
            with self.subTest(factor=factor), self.assertRaises(ValueError):
                crop_region(rect=(1, 2, 4, 4), frame_size=(20, 20), expansion=factor)

    def test_invalid_frame_dimensions(self):
        for dimensions in [(0, 20), (20, -1), (20.5, 20), (True, 20), (32769, 20)]:
            with self.subTest(dimensions=dimensions), self.assertRaises(ValueError):
                crop_region(rect=(1, 2, 4, 4), frame_size=dimensions, expansion=1.5)

    def test_fully_outside_crop_rejected(self):
        for x, y in [(-20, 0), (0, -20), (20, 0), (0, 20)]:
            with self.subTest(x=x, y=y), self.assertRaises(ValueError):
                crop_pixels(frame=np.zeros((4, 5, 3), np.uint8), region=CropRegion(x=x, y=y, size=4))
        with self.assertRaises(ValueError):
            crop_region(rect=(100, 100, 4, 4), frame_size=(5, 4), expansion=1)

    def test_invalid_frames_and_region_types(self):
        frames = [np.zeros((4, 4), np.uint8), np.zeros((4, 4, 4), np.uint8), np.zeros((4, 4, 3), np.float32),
                  np.zeros((0, 4, 3), np.uint8)]
        for frame in frames:
            with self.subTest(shape=frame.shape), self.assertRaises(ValueError):
                crop_pixels(frame=frame, region=CropRegion(x=0, y=0, size=2))
        for region in [None, CropRegion(x=0.5, y=0, size=2), CropRegion(x=0, y=0, size=True),
                       CropRegion(x=0, y=0, size=32769)]:
            with self.subTest(region=region), self.assertRaises(ValueError):
                crop_pixels(frame=np.zeros((4, 4, 3), np.uint8), region=region)

    def test_memory_limit_rejects_before_allocation(self):
        with self.assertRaises(ValueError):
            crop_pixels(frame=np.zeros((4, 4, 3), np.uint8), region=CropRegion(x=0, y=0, size=10000))


class CoordinateTest(unittest.TestCase):
    def test_endpoint_mapping_uses_size_minus_one(self):
        matrix = resize_inverse(region=CropRegion(x=-4, y=7, size=121), network_size=(120, 160))
        values = map_points(points=[[0, 0], [119, 159], [59.5, 79.5]], inverse=matrix)
        np.testing.assert_allclose(values, [[-4, 7], [116, 127], [56, 67]], atol=1e-5, rtol=0)

    def test_identity_mapping(self):
        matrix = resize_inverse(region=CropRegion(x=0, y=0, size=120), network_size=(120, 120))
        values = np.array([[17.37, 52.28], [-2.5, 124.5]], np.float32)
        np.testing.assert_array_equal(map_points(points=values, inverse=matrix), values)

    def test_invalid_mapping_dimensions(self):
        for size in [(1, 120), (120, 0), (120, 32769), (120.0, 120)]:
            with self.subTest(size=size), self.assertRaises(ValueError):
                resize_inverse(region=CropRegion(x=0, y=0, size=3), network_size=size)
        with self.assertRaises(ValueError):
            resize_inverse(region=CropRegion(x=0, y=0, size=1), network_size=(120, 120))

    def test_invalid_points_and_affine_matrix(self):
        for points in [[], [[1, 2, 3]], [[np.nan, 1]], [[np.inf, 1]]]:
            with self.subTest(points=points), self.assertRaises(ValueError):
                map_points(points=points, inverse=np.zeros((2, 3)))
        for matrix in [np.zeros((3, 3)), np.full((2, 3), np.nan)]:
            with self.assertRaises(ValueError):
                map_points(points=[[1, 2]], inverse=matrix)

    def test_reorder_direction_is_scatter(self):
        pairs = np.arange(212, dtype=np.float32).reshape(106, 2)
        order = np.roll(np.arange(106), 7)
        values = reorder_landmarks(raw_pairs=pairs, destinations=order)
        for source in range(106):
            np.testing.assert_array_equal(values[order[source]], pairs[source])
        self.assertFalse(np.array_equal(values, pairs[order]))

    def test_reorder_rejects_missing_duplicate_or_out_of_range_indices(self):
        pairs = np.zeros((106, 2))
        for order in [np.arange(105), np.zeros(106, int), np.arange(1, 107), np.arange(106, dtype=float)]:
            with self.subTest(order_shape=order.shape), self.assertRaises(ValueError):
                reorder_landmarks(raw_pairs=pairs, destinations=order)

    def test_reorder_rejects_bad_pair_shape_and_nonfinite_values(self):
        for pairs in [np.zeros((212,)), np.zeros((105, 2)), np.full((106, 2), np.nan)]:
            with self.assertRaises(ValueError):
                reorder_landmarks(raw_pairs=pairs, destinations=np.arange(106))


class NativeBoundaryTest(unittest.TestCase):
    def test_mat_abi_has_expected_size_and_offsets(self):
        self.assertEqual(ct.sizeof(Mat), 96)
        self.assertEqual(Mat.data.offset, 16)
        self.assertEqual(Mat.steps.offset, 80)

    def test_mat_borrowed_buffer_is_retained(self):
        array = np.arange(212, dtype=np.float32).reshape(2, 106)
        reference = weakref.ref(array)
        view = mat_view(array=array)
        array = None
        gc.collect()
        self.assertIsNotNone(reference())
        self.assertEqual(view.data, reference().ctypes.data)
        self.assertEqual(view.steps[:], [424, 4])

    def test_mat_copy_roundtrip_and_descriptor_validation(self):
        array = np.arange(24, dtype=np.uint8).reshape(2, 4, 3)
        view = mat_view(array=array)
        np.testing.assert_array_equal(copy_mat(value=view, dtype=np.uint8, channels=3), array)
        view.steps[0] = 1
        with self.assertRaises(ValueError):
            copy_mat(value=view, dtype=np.uint8, channels=3)
        with self.assertRaises(ValueError):
            copy_mat(value=mat_view(), dtype=np.float32, channels=1)

    def test_mat_view_rejects_unsupported_storage(self):
        for array in [np.zeros(10), np.zeros((2, 3), np.int64), np.zeros((4, 4), np.float32)[::2, ::2]]:
            with self.assertRaises(ValueError):
                mat_view(array=array)

    def test_unrecognized_library_is_rejected_before_loading(self):
        with tempfile.TemporaryDirectory() as root:
            library = Path(root) / "synthetic.dylib"
            library.write_bytes(b"public synthetic fixture, not native code")
            with patch("face_geometry_native.sys.platform", "darwin"), \
                    patch("face_geometry_native.platform.machine", return_value="arm64"), \
                    patch("face_geometry_native.ct.CDLL") as load, self.assertRaises(ValueError):
                NativeGeometry(library=library)
            load.assert_not_called()

    def test_platform_rejected_before_file_read(self):
        with patch("face_geometry_native.sys.platform", "linux"), self.assertRaises(ValueError):
            NativeGeometry(library="missing-library")

    def test_reorder_cannot_run_before_initialization(self):
        oracle = object.__new__(NativeGeometry)
        with self.assertRaises(ValueError):
            oracle.reorder(raw_pairs=np.zeros((106, 2)))

    def test_native_crop_rejects_invalid_and_outside_inputs_before_call(self):
        oracle = object.__new__(NativeGeometry)
        for box in [(1, 2, 0, 4), (100, 100, 4, 4), (-20, 0, 4, 4)]:
            with self.subTest(box=box), self.assertRaises(ValueError):
                oracle.crop(frame=np.zeros((10, 10, 3), np.uint8), rect=box, expansion=1)
        with self.assertRaises(ValueError):
            oracle.crop(frame=np.zeros((10, 10, 3), np.uint8), rect=(-100, 0, 101, 10), expansion=0.25)

    def test_native_mapping_rejects_empty_and_nonfinite_points(self):
        oracle = object.__new__(NativeGeometry)
        for points in [[], [[np.nan, 1]], np.zeros((513, 2))]:
            with self.assertRaises(ValueError):
                oracle.resize_mapping(rect=(1, 2, 10, 10), network_size=(120, 120), points=points)


class EvidenceTest(unittest.TestCase):
    def test_byte_comparison_does_not_wrap_unsigned_differences(self):
        result = compare(actual=np.array([0], np.uint8), expected=np.array([255], np.uint8))
        self.assertFalse(result["passed"])
        self.assertEqual(result["max_abs"], 255)

    def test_comparison_rejects_empty_nonfinite_shape_and_dtype_mismatches(self):
        for actual, expected in [(np.array([]), np.array([])), (np.array([np.nan]), np.array([1.])),
                                 (np.zeros(1), np.zeros(2)), (np.zeros(1, np.int32), np.zeros(1, np.int64))]:
            with self.subTest(actual=actual, expected=expected):
                self.assertFalse(compare(actual=actual, expected=expected)["passed"])

    def test_float_tolerance_is_explicit(self):
        actual, expected = np.array([1.0001], np.float32), np.array([1.], np.float32)
        self.assertFalse(compare(actual=actual, expected=expected)["passed"])
        self.assertTrue(compare(actual=actual, expected=expected, tolerance=0.001)["passed"])

    def test_private_output_guard_rejects_public_path_before_native_call(self):
        with patch("face_geometry_verify.NativeGeometry") as native, self.assertRaises(ValueError):
            run(out=Path(__file__).parent / "public-output")
        native.assert_not_called()

    def test_previous_evidence_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as root, patch("espresso_oracle.PRIVATE", Path(root)):
            out = Path(root) / "old-evidence"
            out.mkdir()
            evidence = out / "sentinel.txt"
            evidence.write_bytes(b"preserve")
            with self.assertRaises(ValueError):
                run(out=out)
            self.assertEqual(evidence.read_bytes(), b"preserve")


if __name__ == "__main__":
    unittest.main()
