"""Public synthetic regressions; no vendor model or native runtime required."""
import unittest
import ctypes as ct
from pathlib import Path
import tempfile
from unittest.mock import patch

import numpy as np

from face_detector import (decode, distribution_distance, frame_rectangles,
                           proposals, suppress_ordered, validate_heads, validate_nms)
from face_detector_native import NativeDetector, TensorView, vector
from face_detector_verify import compare, run


def synthetic_heads(*, size=(64, 64), bins=1, fraction=4):
    width, height = size
    regression, scores = [], []
    for stride in (8, 16, 32):
        shape = ((height + stride - 1) // stride, (width + stride - 1) // stride)
        regression.append((np.full((*shape, 4 * bins), 16, dtype=np.int8), fraction))
        scores.append((np.full((*shape, 1), -128, dtype=np.int8), fraction))
    return regression + scores


def configuration():
    return dict(strides=[8, 16, 32], minimum_sizes=[4, 8, 16],
                confidence=.225, before=1500, after=200, iou=.3)


class DetectorTest(unittest.TestCase):
    def test_direct_distance_bypasses_softmax(self):
        values = np.array([[1.25], [-2]], dtype=np.float32)
        np.testing.assert_array_equal(distribution_distance(logits=values), [1.25, -2])

    def test_uniform_distribution_and_sequential_sum(self):
        np.testing.assert_array_equal(distribution_distance(logits=np.zeros((7, 4, 8), dtype=np.float32)),
                                      np.full((7, 4), 3.5))

    def test_one_hot_distribution(self):
        values = np.full((1, 8), -40, dtype=np.float32)
        values[0, 5] = 40
        np.testing.assert_array_equal(distribution_distance(logits=values), [5])

    def test_blank_scores_produce_empty_array(self):
        result = decode(heads=synthetic_heads(), image_size=(64, 64), **configuration())
        self.assertEqual(result.shape, (0, 5))
        self.assertEqual(result.dtype, np.float32)

    def test_center_and_inclusive_endpoints(self):
        heads = synthetic_heads()
        heads[3][0][3, 4, 0] = 0
        result = decode(heads=heads, image_size=(64, 64), **configuration())
        np.testing.assert_array_equal(result, [[28, 20, 44, 36, .5]])

    def test_fractional_distances_truncate_toward_zero(self):
        heads = synthetic_heads()
        heads[0][0][3, 4] = [17, 17, 17, 17]
        heads[3][0][3, 4, 0] = 0
        result = decode(heads=heads, image_size=(64, 64), **configuration())
        np.testing.assert_array_equal(result, [[27, 19, 44, 36, .5]])

    def test_border_clip(self):
        heads = synthetic_heads()
        heads[3][0][0, 0, 0] = 0
        result = decode(heads=heads, image_size=(64, 64), **configuration())
        np.testing.assert_array_equal(result, [[0, 0, 12, 12, .5]])

    def test_negative_distances_clamp_and_minimum_is_inclusive(self):
        heads = synthetic_heads()
        heads[0][0][3, 4] = [-16, -16, 6, 6]
        heads[3][0][3, 4, 0] = 0
        result = decode(heads=heads, image_size=(64, 64), **configuration())
        np.testing.assert_array_equal(result, [[36, 28, 39, 31, .5]])
        heads[0][0][3, 4] = [-16, -16, 5, 5]
        self.assertEqual(len(decode(heads=heads, image_size=(64, 64), **configuration())), 0)

    def test_confidence_equality_keeps_proposal(self):
        heads = synthetic_heads()
        heads[3][0][3, 4, 0] = 0
        params = configuration() | {"confidence": .5}
        self.assertEqual(len(decode(heads=heads, image_size=(64, 64), **params)), 1)
        params["confidence"] = np.nextafter(np.float32(.5), np.float32(1))
        self.assertEqual(len(decode(heads=heads, image_size=(64, 64), **params)), 0)

    def test_rectangular_grid_and_three_scales(self):
        heads = synthetic_heads(size=(73, 49))
        heads[5][0][1, 2, 0] = 0
        result = decode(heads=heads, image_size=(73, 49), **configuration())
        np.testing.assert_array_equal(result, [[48, 16, 72, 48, .5]])

    def test_distribution_branch_decodes_expected_box(self):
        heads = synthetic_heads(bins=8)
        heads[3][0][3, 4, 0] = 0
        result = decode(heads=heads, image_size=(64, 64), **configuration())
        np.testing.assert_array_equal(result, [[8, 0, 63, 56, .5]])

    def test_nms_uses_inclusive_single_pixel_intersection(self):
        boxes = np.array([[0, 0, 1, 1, .9], [1, 1, 2, 2, .8]], dtype=np.float32)
        result = suppress_ordered(boxes=boxes, before=2, after=2, threshold=.1)
        np.testing.assert_array_equal(result, boxes[:1])

    def test_nms_equality_does_not_suppress(self):
        boxes = np.array([[0, 0, 0, 0, .9], [0, 0, 0, 0, .8]], dtype=np.float32)
        self.assertEqual(len(suppress_ordered(boxes=boxes, before=2, after=2, threshold=1)), 2)
        self.assertEqual(len(suppress_ordered(boxes=boxes, before=2, after=2, threshold=.99)), 1)

    def test_nms_limits_and_order(self):
        boxes = np.array([[0, 0, 1, 1, .7], [10, 10, 11, 11, .8], [20, 20, 21, 21, .9]], dtype=np.float32)
        for before, after, expected in ((1, 3, 1), (3, 1, 1), (2, 3, 2), (3, 2, 2)):
            with self.subTest(before=before, after=after):
                np.testing.assert_array_equal(suppress_ordered(boxes=boxes, before=before, after=after, threshold=.3), boxes[:expected])

    def test_empty_nms(self):
        self.assertEqual(suppress_ordered(boxes=np.empty((0, 5)), before=1, after=1, threshold=0).shape, (0, 5))

    def test_stable_score_ties(self):
        heads = synthetic_heads(size=(128, 64))
        heads[3][0][2, 2, 0] = heads[3][0][2, 10, 0] = 0
        values = decode(heads=heads, image_size=(128, 64), **configuration())
        np.testing.assert_array_equal(values[:, 0], [12, 76])

    def test_frame_mapping_inclusive_width_and_native_float_reciprocal(self):
        values = np.array([[146, 54, 276, 240, .6]], dtype=np.float32)
        np.testing.assert_array_equal(frame_rectangles(boxes=values, scales=(.28729280829429626, .294659286737442)),
                                      [[508, 183, 453, 632]])

    def test_inputs_are_not_mutated(self):
        heads = synthetic_heads()
        heads[3][0][3, 4, 0] = 0
        original = [value.copy() for value, _ in heads]
        decode(heads=heads, image_size=(64, 64), **configuration())
        for (value, _), expected in zip(heads, original):
            np.testing.assert_array_equal(value, expected)

    def test_noncontiguous_heads(self):
        heads = [(v[:, ::-1], f) for v, f in synthetic_heads()]
        validate_heads(heads=heads, image_size=(64, 64), strides=[8, 16, 32])

    def test_invalid_head_contract(self):
        cases = [([], (64, 64), [8, 16, 32]), (synthetic_heads(), (True, 64), [8, 16, 32]),
                 (synthetic_heads(), (64, 64), [0, 16, 32]), (synthetic_heads(), (65, 64), [8, 16, 32])]
        for heads, size, strides in cases:
            with self.subTest(size=size, strides=strides), self.assertRaises(ValueError):
                validate_heads(heads=heads, image_size=size, strides=strides)

    def test_invalid_tensors(self):
        for replacement in (np.zeros((8, 8, 3), dtype=np.int8), np.zeros((8, 8, 4)),
                            np.full((8, 8, 4), np.nan, dtype=np.float32)):
            heads = synthetic_heads()
            heads[0] = (replacement, 4)
            with self.assertRaises(ValueError):
                validate_heads(heads=heads, image_size=(64, 64), strides=[8, 16, 32])
        for fraction in (True, 25, -17, 4.0):
            heads = synthetic_heads()
            heads[0] = (heads[0][0], fraction)
            with self.assertRaises(ValueError):
                validate_heads(heads=heads, image_size=(64, 64), strides=[8, 16, 32])

    def test_invalid_distribution_scope(self):
        heads = synthetic_heads(fraction=-16)
        with self.assertRaises(ValueError):
            proposals(heads=heads, image_size=(64, 64), **{k: v for k, v in configuration().items()
                                                        if k in ("strides", "minimum_sizes", "confidence")})

    def test_invalid_nms_contract(self):
        invalid = [[[0, 0, -1, 1, .5]], [[0, 0, 1, 1, 2]], [[0, 0, 1, 1, np.nan]], [[0, 0, 1, 1]]]
        for boxes in invalid:
            with self.assertRaises(ValueError):
                validate_nms(boxes=boxes, before=10, after=10, threshold=.3)
        for before, after, threshold in ((0, 10, .3), (10, True, .3), (10, 10, np.nan), (10, 10, 1.1)):
            with self.assertRaises(ValueError):
                validate_nms(boxes=np.empty((0, 5)), before=before, after=after, threshold=threshold)

    def test_invalid_mapping(self):
        for scales in ((0, 1), (np.inf, 1), (1,), (1e-30, 1)):
            with self.assertRaises(ValueError):
                frame_rectangles(boxes=np.empty((0, 5)), scales=scales)
        with self.assertRaises(ValueError):
            frame_rectangles(boxes=[[1, 1, 100, 100, .5]], scales=(.0001, .0001))


class EvidenceBoundaryTest(unittest.TestCase):
    def test_tensor_abi(self):
        self.assertEqual(ct.sizeof(TensorView), 32)
        self.assertEqual(TensorView.dims.offset, 8)
        self.assertEqual(TensorView.raw.offset, 24)

    def test_bounded_vector_descriptor(self):
        buffer = (ct.c_int * 3)(8, 16, 32)
        start = ct.addressof(buffer)
        descriptor = (ct.c_void_p * 3)(start, start + 12, start + 12)
        self.assertEqual(vector(address=ct.addressof(descriptor), width=4, maximum=3), (start, 3))
        for end, capacity in ((start + 13, start + 13), (start + 12, start + 8), (start + 16, start + 16)):
            descriptor[1], descriptor[2] = end, capacity
            with self.assertRaises(ValueError):
                vector(address=ct.addressof(descriptor), width=4, maximum=3)

    def test_closed_oracle_rejects_before_native_calls(self):
        native = NativeDetector.__new__(NativeDetector)
        native.handle = ct.c_void_p()
        with self.assertRaises(ValueError):
            native.detect(frame=np.zeros((32, 32, 3), dtype=np.uint8))
        with self.assertRaises(ValueError):
            native.decode(heads=synthetic_heads(), image_size=(64, 64))
        with self.assertRaises(ValueError):
            native.nms(boxes=np.empty((0, 5)), before=10, after=10, threshold=.3)

    def test_shape_nonfinite_and_coordinate_failure_gates(self):
        expected = np.array([[1, 2, 3, 4, .5]], dtype=np.float32)
        for actual in (np.empty((0, 5)), np.array([[1, 2, 3, 4, np.nan]]),
                       expected + [0, 0, 1, 0, 0], expected[:, :4]):
            self.assertFalse(compare(actual=actual, expected=expected)["passed"])
        actual = expected.copy()
        actual[0, 4] += 2e-7
        self.assertTrue(compare(actual=actual, expected=expected)["passed"])
        actual[0, 4] += 1e-4
        self.assertFalse(compare(actual=actual, expected=expected)["passed"])

    def test_existing_evidence_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as root, patch("espresso_oracle.PRIVATE", Path(root)):
            evidence = Path(root) / "prior"
            evidence.mkdir()
            sentinel = evidence / "summary.json"
            sentinel.write_text("existing evidence")
            with patch("face_detector_verify.NativeDetector") as native, self.assertRaises(ValueError):
                run(out=evidence, portrait=Path(root) / "missing.png")
            native.assert_not_called()
            self.assertEqual(sentinel.read_text(), "existing evidence")

    def test_evidence_outside_private_root_is_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            with patch("face_detector_verify.NativeDetector") as native, self.assertRaises(ValueError):
                run(out=Path(root) / "new", portrait=Path(root) / "missing.png")
            native.assert_not_called()

    def test_partial_converted_evidence_is_rejected(self):
        with tempfile.TemporaryDirectory() as root, patch("espresso_oracle.PRIVATE", Path(root)):
            with self.assertRaises(ValueError):
                run(out=Path(root) / "new", portrait=Path(root) / "missing.png", network=Path(root))


if __name__ == "__main__":
    unittest.main()
