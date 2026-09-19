"""Synthetic-only contracts; no vendor graphs or weights are test fixtures."""

from copy import deepcopy
import importlib.util
from pathlib import Path
import tempfile
import unittest

import numpy as np
import torch
from torch.nn import functional as F

from tflite_schema import read_model
from tflite_torch import (
    TFLiteTorch,
    activate,
    execute,
    load_model,
    resize,
    same_padding,
)
from tflite_verify import compare


def add_bundle():
    return {
        "format": "qcut-bounded-tflite-pytorch",
        "version": 1,
        "tensors": [{"shape": [1, 2, 2, 1], "dtype": "float32"}] * 3,
        "inputs": [0],
        "outputs": [2],
        "constants": {"1": torch.ones(1, 2, 2, 1)},
        "operators": [
            {
                "type": "ADD",
                "version": 1,
                "inputs": [0, 1],
                "outputs": [2],
                "options": {"FusedActivationFunction": 0, "PotScaleInt16": True},
            }
        ],
    }


def conv_options(*, stride=1, padding=0, depthwise=False):
    result = {
        "Padding": padding,
        "StrideH": stride,
        "StrideW": stride,
        "DilationHFactor": 1,
        "DilationWFactor": 1,
        "FusedActivationFunction": 0,
    }
    result["DepthMultiplier" if depthwise else "QuantizedBiasType"] = (
        1 if depthwise else 0
    )
    return result


class TFLiteContracts(unittest.TestCase):
    def test_roundtrip_weights_only(self):
        model = TFLiteTorch(bundle=add_bundle())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.pt"
            torch.save(model.export_bundle(), path)
            restored = load_model(path=path)
            value = torch.arange(4, dtype=torch.float32).reshape(1, 2, 2, 1)
            self.assertTrue(torch.equal(model(value), restored(value)))

    def test_bundle_is_not_mutated(self):
        bundle = add_bundle()
        model = TFLiteTorch(bundle=bundle)
        bundle["constants"]["1"].fill_(9)
        self.assertTrue(
            torch.equal(model(torch.zeros(1, 2, 2, 1)), torch.ones(1, 2, 2, 1))
        )

    def test_reject_unknown_format(self):
        bundle = add_bundle()
        bundle["format"] = "unknown"
        with self.assertRaises(ValueError):
            TFLiteTorch(bundle=bundle)

    def test_reject_unknown_operator(self):
        bundle = add_bundle()
        bundle["operators"][0]["type"] = "UNVERIFIED"
        with self.assertRaises(ValueError):
            TFLiteTorch(bundle=bundle)

    def test_reject_unknown_options(self):
        bundle = add_bundle()
        bundle["operators"][0]["options"]["Unverified"] = True
        with self.assertRaises(ValueError):
            TFLiteTorch(bundle=bundle)

    def test_reject_unknown_version(self):
        bundle = add_bundle()
        bundle["operators"][0]["version"] = 99
        with self.assertRaises(ValueError):
            TFLiteTorch(bundle=bundle)

    def test_reject_missing_dependency(self):
        bundle = add_bundle()
        bundle["operators"][0]["inputs"][1] = 3
        with self.assertRaises(ValueError):
            TFLiteTorch(bundle=bundle)

    def test_reject_duplicate_producer(self):
        bundle = add_bundle()
        bundle["operators"].append(deepcopy(bundle["operators"][0]))
        with self.assertRaises(ValueError):
            TFLiteTorch(bundle=bundle)

    def test_reject_nonfinite(self):
        with self.assertRaises(ValueError):
            TFLiteTorch(bundle=add_bundle())(torch.full((1, 2, 2, 1), float("nan")))

    def test_reject_wrong_input_shape_dtype(self):
        model = TFLiteTorch(bundle=add_bundle())
        for value in (torch.zeros(2, 2), torch.zeros(1, 2, 2, 1, dtype=torch.float64)):
            with self.assertRaises(ValueError):
                model(value)

    def test_asymmetric_same_padding(self):
        self.assertEqual(same_padding(size=4, kernel=3, stride=2), (0, 1))
        self.assertEqual(same_padding(size=5, kernel=3, stride=2), (1, 1))
        self.assertEqual(same_padding(size=5, kernel=3, stride=1, dilation=2), (2, 2))

    def test_conv_stride_same(self):
        value = torch.arange(16, dtype=torch.float32).reshape(1, 4, 4, 1)
        result = execute(
            operator={"type": "CONV_2D", "options": conv_options(stride=2)},
            values=[value, torch.ones(1, 3, 3, 1), torch.zeros(1)],
        )
        expected = F.conv2d(
            F.pad(value.permute(0, 3, 1, 2), (0, 1, 0, 1)),
            torch.ones(1, 1, 3, 3),
            stride=2,
        ).permute(0, 2, 3, 1)
        self.assertTrue(torch.equal(result, expected))

    def test_depthwise_multiplier(self):
        options = conv_options(depthwise=True)
        options["DepthMultiplier"] = 2
        value = torch.tensor([1.0, 10.0]).reshape(1, 1, 1, 2)
        result = execute(
            operator={"type": "DEPTHWISE_CONV_2D", "options": options},
            values=[
                value,
                torch.tensor([1.0, 2.0, 3.0, 4.0]).reshape(1, 1, 1, 4),
                torch.zeros(4),
            ],
        )
        self.assertEqual(result.flatten().tolist(), [1, 2, 30, 40])

    def test_transpose_conv_asymmetric_crop(self):
        value = torch.ones(1, 2, 2, 1)
        options = {
            "Padding": 0,
            "StrideH": 2,
            "StrideW": 2,
            "FusedActivationFunction": 0,
        }
        result = execute(
            operator={"type": "TRANSPOSE_CONV", "options": options},
            values=[
                torch.tensor([1, 4, 4, 1]),
                torch.ones(1, 3, 3, 1),
                value,
                torch.zeros(1),
            ],
        )
        expected = F.conv_transpose2d(
            value.permute(0, 3, 1, 2), torch.ones(1, 1, 3, 3), stride=2
        )[:, :, :4, :4].permute(0, 2, 3, 1)
        self.assertTrue(torch.equal(result, expected))

    def test_half_pixel_bilinear(self):
        value = torch.tensor([0.0, 2.0, 4.0, 6.0]).reshape(1, 2, 2, 1)
        result = resize(value=value, size=(4, 4), nearest=False, align=False, half=True)
        expected = F.interpolate(
            value.permute(0, 3, 1, 2), size=(4, 4), mode="bilinear", align_corners=False
        ).permute(0, 2, 3, 1)
        self.assertTrue(torch.equal(result, expected))

    def test_nearest_half_pixel_downsample(self):
        value = torch.arange(16, dtype=torch.float32).reshape(1, 4, 4, 1)
        result = resize(value=value, size=(2, 2), nearest=True, align=False, half=True)
        self.assertEqual(result.flatten().tolist(), [5, 7, 13, 15])

    def test_resize_legacy_coordinate(self):
        value = torch.tensor([0.0, 2.0]).reshape(1, 1, 2, 1)
        result = resize(
            value=value, size=(1, 4), nearest=False, align=False, half=False
        )
        self.assertEqual(result.flatten().tolist(), [0, 1, 2, 2])

    def test_reject_incompatible_resize_flags(self):
        with self.assertRaises(ValueError):
            resize(
                value=torch.ones(1, 2, 2, 1),
                size=(4, 4),
                nearest=True,
                align=True,
                half=True,
            )

    def test_reshape_transpose_preserve_nhwc(self):
        value = torch.arange(12).reshape(1, 2, 2, 3)
        result = execute(
            operator={"type": "RESHAPE", "options": {}},
            values=[value, torch.tensor([1, 4, 3])],
        )
        result = execute(
            operator={"type": "TRANSPOSE", "options": {}},
            values=[result, torch.tensor([0, 2, 1])],
        )
        self.assertTrue(torch.equal(result, value.reshape(1, 4, 3).permute(0, 2, 1)))

    def test_softmax_and_sum(self):
        value = torch.tensor([[1.0, 2.0, 3.0]])
        result = execute(
            operator={"type": "SOFTMAX", "options": {"Beta": 1.0}}, values=[value]
        )
        total = execute(
            operator={"type": "SUM", "options": {"KeepDims": True}},
            values=[result, torch.tensor([-1])],
        )
        self.assertTrue(torch.allclose(total, torch.ones(1, 1)))

    def test_bad_axis_rejected(self):
        with self.assertRaises(ValueError):
            execute(
                operator={"type": "SUM", "options": {"KeepDims": True}},
                values=[torch.ones(2, 2), torch.tensor([2])],
            )

    def test_fused_activation(self):
        value = torch.tensor([-2.0, 2.0, 9.0])
        self.assertEqual(activate(value=value, kind=3).tolist(), [0, 2, 6])
        with self.assertRaises(ValueError):
            activate(value=value, kind=99)

    def test_compare_does_not_accept_nan_or_mismatch(self):
        self.assertFalse(
            compare(expected=np.ones((2, 2)), actual=np.full((2, 2), np.nan))["passed"]
        )
        self.assertFalse(
            compare(expected=np.ones((2, 2)), actual=np.ones((1, 2)))["passed"]
        )

    @unittest.skipUnless(
        importlib.util.find_spec("tensorflow"),
        "TensorFlow export dependency not installed",
    )
    def test_reject_non_tflite(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "invalid.tflite"
            path.write_bytes(b"not a FlatBuffer")
            with self.assertRaises(ValueError):
                read_model(path=path)

    @unittest.skipUnless(
        importlib.util.find_spec("tensorflow"),
        "TensorFlow export dependency not installed",
    )
    def test_synthetic_flatbuffer_export_and_bad_constant(self):
        import flatbuffers
        from tensorflow.lite.python import schema_py_generated as schema

        model = schema.ModelT()
        model.version = 3
        empty, constant = schema.BufferT(), schema.BufferT()
        constant.data = np.ones(4, dtype=np.float32).view(np.uint8)
        model.buffers = [empty, constant]
        graph = schema.SubGraphT()
        graph.inputs, graph.outputs = [0], [2]
        graph.tensors = []
        for index in range(3):
            tensor = schema.TensorT()
            tensor.shape, tensor.type = [1, 2, 2, 1], schema.TensorType.FLOAT32
            tensor.buffer = 1 if index == 1 else 0
            graph.tensors.append(tensor)
        code = schema.OperatorCodeT()
        code.builtinCode = code.deprecatedBuiltinCode = schema.BuiltinOperator.ADD
        code.version = 1
        model.operatorCodes = [code]
        operator = schema.OperatorT()
        operator.inputs, operator.outputs = [0, 1], [2]
        operator.builtinOptionsType = schema.BuiltinOptions.AddOptions
        operator.builtinOptions = schema.AddOptionsT()
        graph.operators = [operator]
        model.subgraphs = [graph]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "synthetic.tflite"
            builder = flatbuffers.Builder(1024)
            root = model.Pack(builder)
            builder.Finish(root, file_identifier=b"TFL3")
            path.write_bytes(bytes(builder.Output()))
            recovered = TFLiteTorch(bundle=read_model(path=path))
            self.assertTrue(
                torch.equal(recovered(torch.zeros(1, 2, 2, 1)), torch.ones(1, 2, 2, 1))
            )
            constant.data = constant.data[:-1]
            builder = flatbuffers.Builder(1024)
            root = model.Pack(builder)
            builder.Finish(root, file_identifier=b"TFL3")
            path.write_bytes(bytes(builder.Output()))
            with self.assertRaisesRegex(ValueError, "byte size"):
                read_model(path=path)


if __name__ == "__main__":
    torch.set_num_threads(1)
    unittest.main()
