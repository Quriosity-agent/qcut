import copy
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from align160_prepare import prepare_bgr, run


def call_fixture(*, rect=None, flags=None, expansion=1.):
    return {"format": 0, "orientation": 0, "target": [160, 160],
            "rect": {"values": rect or [0., 0., 160., 160.]},
            "flags": flags or [1, 0, 0], "expansion": expansion}


class Align160PrepareTests(unittest.TestCase):
    def test_bgr_and_signed_tensor_identity_keep_channel_order(self):
        source = np.zeros((160, 160, 3), np.uint8)
        source[:, :, :] = [0, 128, 255]
        result = prepare_bgr(source=source, call=call_fixture())
        np.testing.assert_array_equal(result["resized"], source)
        np.testing.assert_array_equal(result["tensor"][0, 0, 0], [-128, 0, 127])
        self.assertEqual(result["tensor"].shape, (1, 160, 160, 3))
        self.assertEqual(result["tensor"].dtype, np.int8)

    def test_crop_zero_padding_becomes_minus_128_tensor(self):
        source = np.full((8, 8, 3), 200, np.uint8)
        result = prepare_bgr(source=source, call=call_fixture(rect=[-2., -2., 8., 8.], flags=[0, 0, 0]))
        self.assertEqual(result["post_crop_rect"], [-1, -1, 8, 8])
        np.testing.assert_array_equal(result["crop"][0, 0], [0, 0, 0])
        np.testing.assert_array_equal(result["tensor"][0, 0, 0], [-128] * 3)

    def test_reciprocal_nearest_floor_selects_actual_source_pixels(self):
        source = np.random.default_rng(22).integers(0, 256, (320, 320, 3), np.uint8)
        result = prepare_bgr(source=source, call=call_fixture(rect=[0., 0., 320., 320.]))
        self.assertEqual(result["resize"], "nearest")
        np.testing.assert_array_equal(result["resized"], source[::2, ::2])
        np.testing.assert_array_equal(result["inverse"], np.array([[319 / 159, 0, 0], [0, 319 / 159, 0]], np.float32))

    def test_linear_upscale_and_endpoint_coordinate_mapping(self):
        source = np.arange(80 * 80 * 3, dtype=np.uint8).reshape(80, 80, 3)
        result = prepare_bgr(source=source, call=call_fixture(rect=[0., 0., 80., 80.]))
        self.assertEqual(result["resize"], "linear")
        self.assertEqual(result["inverse"].dtype, np.float32)
        self.assertAlmostEqual(float(result["inverse"][0, 0] * 159), 79., delta=1e-5)

    def test_call_cannot_include_captured_oracle_buffers_or_matrix(self):
        source = np.zeros((160, 160, 3), np.uint8)
        for key in ("crop", "tensor", "inverse", "post_crop_rect"):
            call = call_fixture()
            call[key] = []
            with self.subTest(key=key), self.assertRaises(ValueError):
                prepare_bgr(source=source, call=call)

    def test_invalid_inputs_formats_rotations_and_flags_fail(self):
        valid = np.zeros((160, 160, 3), np.uint8)
        for source in (valid.astype(np.float32), valid[:, :, :2], np.zeros((0, 160, 3), np.uint8),
                       np.zeros((4097, 1, 3), np.uint8)):
            with self.assertRaises(ValueError):
                prepare_bgr(source=source, call=call_fixture())
        for key, value in (("format", True), ("orientation", 1), ("flags", [1, 0, 1]),
                           ("flags", [True, 0, 0]), ("expansion", float("nan")), ("target", [120, 120])):
            call = call_fixture()
            call[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                prepare_bgr(source=valid, call=call)

    def test_owned_buffers_and_input_parameters_are_not_mutated(self):
        source = np.arange(160 * 160 * 3, dtype=np.uint8).reshape(160, 160, 3)[:, ::-1]
        before, call = source.copy(), call_fixture()
        before_call = copy.deepcopy(call)
        result = prepare_bgr(source=source, call=call)
        np.testing.assert_array_equal(source, before)
        self.assertEqual(call, before_call)
        for name in ("source", "crop", "resized", "tensor", "inverse"):
            self.assertFalse(np.shares_memory(source, result[name]))

    def test_private_library_or_existing_output_is_rejected_before_saving(self):
        source = np.zeros((160, 160, 3), np.uint8)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "output"
            with patch("align160_prepare.native_images", return_value={"private_native_images": ["private"]}), self.assertRaises(ValueError):
                run(source=source, call=call_fixture(), output=path)
            self.assertFalse(path.exists())
            with self.assertRaises(ValueError):
                run(source=source, call=call_fixture(), output=Path(directory))


if __name__ == "__main__":
    unittest.main()
