"""Tests for float-output decoding and separation of confidence from geometry."""
import unittest
from unittest.mock import patch

import numpy as np

import body_float_refine_decode as module


def points():
    return np.asarray([[100 + i, 200 + i, .8, 1] for i in range(18)], np.float32)


class DecodeTests(unittest.TestCase):
    def test_float_values_are_not_divided_by_integer_scale(self):
        output = np.full((1, 24, 18, 34), .75, np.float32)
        coco = [[10, 20, .75, 1] for _ in range(17)]
        expected = points()
        with patch.object(module, "postprocess", return_value=[[0.] * 51]), \
                patch.object(module, "map_local_to_global", return_value=[coco]), \
                patch.object(module, "refine_pose", return_value=expected.tolist()) as decoder:
            actual = module.decode_output(output=output, previous=points(), roi=[0, 0, 144, 192], body_scale=443)
        self.assertEqual(decoder.call_args.args[0][0][0][0], .75)
        self.assertEqual(decoder.call_args.args[2], points().tolist())
        self.assertEqual(decoder.call_args.args[3], 443)
        self.assertEqual(decoder.call_args.kwargs, {})
        np.testing.assert_array_equal(actual["public"], expected)

    def test_real_decoder_empty_heatmaps_yield_invalid_pose(self):
        result = module.decode_output(output=np.zeros((1, 24, 18, 34), np.float32),
            previous=points(), roi=[0, 0, 144, 192], body_scale=443)
        np.testing.assert_array_equal(result["public"], np.asarray([[-1, -1, -1, 0]] * 18, np.float32))

    def test_output_shape_dtype_and_finiteness_rejected(self):
        for output in (np.zeros((1, 24, 18, 34), np.int16), np.zeros((1, 34, 24, 18), np.float32),
                       np.full((1, 24, 18, 34), np.nan, np.float32)):
            with self.subTest(shape=output.shape, dtype=output.dtype), self.assertRaises(ValueError):
                module.decode_output(output=output, previous=points(), roi=[0, 0, 144, 192], body_scale=443)

    def test_invalid_previous_or_crop_rejected(self):
        wrong = points()
        wrong[0, 3] = 2
        with self.assertRaises(ValueError):
            module.decode_output(output=np.zeros((1, 24, 18, 34), np.float32), previous=wrong, roi=[0, 0, 144, 192], body_scale=443)
        with self.assertRaises(ValueError):
            module.decode_output(output=np.zeros((1, 24, 18, 34), np.float32), previous=points(), roi=[0, 0, 0, 192], body_scale=443)

    def test_confidence_residual_does_not_hide_exact_coordinates(self):
        native, actual = points(), points()
        actual[:, 2] += np.float32(.01)
        result = module.joint_metrics(actual=actual, expected=native, source_scale=[3, 3])
        self.assertEqual(result["jointCoordinatesExact"], 18)
        self.assertTrue(result["validity"]["exact"])
        self.assertEqual(result["confidence"]["different"], 18)
        self.assertFalse(result["public72"]["exact"])

    def test_ankle_displacement_maps_to_original_pixel_units(self):
        native, actual = points(), points()
        actual[10, 0] -= 5
        result = module.joint_metrics(actual=actual, expected=native, source_scale=[3, 3])
        self.assertEqual(result["jointCoordinatesExact"], 17)
        self.assertEqual(result["coordinates"]["different"], 1)
        self.assertEqual(result["maximumJointDistanceAlgorithmPixels"], 5)
        self.assertEqual(result["maximumJointDistanceOriginalPixels"], 15)
        self.assertEqual(result["jointRows"][10]["name"], "right_ankle")
        self.assertEqual(result["jointRows"][10]["coordinateDeltaOriginalPixels"], [-15, 0])

    def test_missing_joints_do_not_inflate_shared_valid_distance(self):
        native, actual = points(), points()
        actual[10] = [-1, -1, -1, 0]
        result = module.joint_metrics(actual=actual, expected=native, source_scale=[3, 3])
        self.assertEqual(result["sharedValidJoints"], 17)
        self.assertEqual(result["maximumJointDistanceOriginalPixels"], 0)
        self.assertEqual(result["validity"]["different"], 1)


if __name__ == "__main__":
    unittest.main()
