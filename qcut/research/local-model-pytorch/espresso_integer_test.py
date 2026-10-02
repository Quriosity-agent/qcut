"""Public synthetic checks for integer PyTorch replay and standard-operator ONNX export."""
import tempfile
import unittest
from pathlib import Path

import numpy as np
import torch

import espresso_fixed
from espresso_integer_torch import EspressoIntegerGraph, requantize, upsample_x2, wrap32


def graph(*, rows, shape=(1, 4, 4, 2), storage=(1, 6)):
    return f"1 {len(rows)}\ndata {' '.join(map(str, (*shape, *storage)))}\n" + "\n".join(rows) + "\n"


class IntegerReplayTest(unittest.TestCase):
    def assert_replay(self, *, text, arena, value):
        model = EspressoIntegerGraph(text=text, arena=arena).eval()
        original = model.graph["descriptors"]["data"]
        raw = (original["type"], original["fraction"])
        expected = espresso_fixed.run(text, arena, {"data": (value, raw)})
        tensors = model.intermediate(inputs={"data": torch.from_numpy(value)})
        for name, tensor in tensors.items():
            np.testing.assert_array_equal(tensor.numpy(), expected[name]["data"], err_msg=name)
        return model

    def test_negative_half_up_and_left_shift(self):
        value = torch.tensor([-9, -8, -7, -4, -1, 0, 1, 4, 7, 8, 9], dtype=torch.int64)
        for shift in (-3, 0, 1, 3):
            np.testing.assert_array_equal(requantize(value=value, shift=shift), espresso_fixed.requantize(value.numpy(), shift))

    def test_int32_overflow(self):
        value = torch.tensor([-(1 << 32) - 1, -(1 << 31), (1 << 31) - 1, 1 << 31, 1 << 32], dtype=torch.int64)
        np.testing.assert_array_equal(wrap32(value=value), espresso_fixed.wrap32(value.numpy()))

    def test_convolution_bias_overflow_and_rounding_intermediate(self):
        text = graph(rows=["Convolution conv 2 1 1 1 1 0 0 1 0 1 0 4 0 1 0 data output"], storage=(1, 1))
        kernel = np.array([127, 127, -128, -128], dtype="i1")
        bias = np.array([(1 << 31) - 1, -(1 << 31)], dtype="<i4")
        value = np.full((1, 4, 4, 2), 127, dtype=np.int64)
        self.assert_replay(text=text, arena=kernel.tobytes() + bias.tobytes(), value=value)

    def test_depthwise_stride_padding(self):
        text = graph(rows=["DepthwiseSeparableConvolution conv 2 3 3 2 2 1 1 1 1 1 2 4 8 1 5 data output"])
        arena = np.arange(-9, 9, dtype="i1").tobytes() + np.array([-777, 12345], dtype="<i4").tobytes()
        value = np.arange(-16, 16, dtype=np.int64).reshape(1, 4, 4, 2)
        self.assert_replay(text=text, arena=arena, value=value)

    def test_dilated_depthwise(self):
        text = graph(rows=["DilationSeparableConvolution conv 2 3 3 2 2 1 1 2 2 0 0 1 2 4 8 1 5 data output"])
        value = np.arange(-16, 16, dtype=np.int64).reshape(1, 4, 4, 2)
        self.assert_replay(text=text, arena=np.arange(-9, 9, dtype="i1").tobytes(), value=value)

    def test_packed_int12_and_stamp(self):
        text = "B\n1 1 1234\nDataV2 data 1 1 1 2 2 6 6\nConvolution conv 2 1 1 1 1 0 0 0 0 2 5 4 11 2 6 data output\n"
        arena = bytes([0, 15, 255, 127, 248, 0]) + (1234).to_bytes(4, "little")
        self.assert_replay(text=text, arena=arena, value=np.array([[[[-2047, 2047]]]], dtype=np.int64))
        with self.assertRaisesRegex(ValueError, "stamp"):
            EspressoIntegerGraph(text=text, arena=arena[:-4] + bytes(4))

    def test_concat_and_slice_requantize_per_blob(self):
        text = graph(rows=[
            "Slice split data 1 1 1 2 left 4 right 7",
            "Concat merge 2 left right merged 1 5",
            "Eltwise add merged data output 1 4 0",
        ])
        value = np.arange(-16, 16, dtype=np.int64).reshape(1, 4, 4, 2)
        self.assert_replay(text=text, arena=b"", value=value)

    def test_same_fraction_concat_and_slice_do_not_clamp(self):
        text = graph(rows=["Slice split data 1 1 1 2 left 6 right 6", "Concat merge 2 left right output 2 6"], storage=(2, 6))
        value = np.full((1, 4, 4, 2), 4096, dtype=np.int64)
        self.assert_replay(text=text, arena=b"", value=value)

    def test_legacy_eltwise_applies_relu(self):
        text = graph(rows=["Eltwise add data data output 1 6"])
        value = np.arange(-16, 16, dtype=np.int64).reshape(1, 4, 4, 2)
        self.assert_replay(text=text, arena=b"", value=value)

    def test_zero_padded_upsample_negative_values(self):
        value = np.arange(-12, 12, dtype=np.int64).reshape(1, 3, 4, 2)
        np.testing.assert_array_equal(upsample_x2(value=torch.from_numpy(value)),
                                      espresso_fixed.upsample_x2({"data": value, "type": 1, "frac": 6})["data"])
        self.assert_replay(text=graph(rows=["UpSampling up data output LINEAR"], shape=value.shape), arena=b"", value=value)

    def test_missing_weights_and_float_heads_fail_closed(self):
        text = graph(rows=["Convolution conv 2 1 1 1 1 0 0 0 0 1 0 4 0 1 0 data output"])
        with self.assertRaisesRegex(ValueError, "byte count"):
            EspressoIntegerGraph(text=text, arena=b"")
        with self.assertRaisesRegex(ValueError, "unsupported integer operator Softmax"):
            EspressoIntegerGraph(text=graph(rows=["Softmax softmax data output 4 0"]), arena=b"")
        with self.assertRaisesRegex(ValueError, "floating-point blobs"):
            EspressoIntegerGraph(text=graph(rows=["UpSampling up data output LINEAR"], storage=(4, 0)), arena=b"")

    def test_input_and_output_contract(self):
        text = graph(rows=["UpSampling up data output LINEAR"])
        model = EspressoIntegerGraph(text=text, arena=b"")
        with self.assertRaisesRegex(ValueError, "int64"):
            model(torch.zeros((1, 4, 4, 2)))
        with self.assertRaisesRegex(ValueError, "fixed profile"):
            model(torch.zeros((1, 4, 3, 2), dtype=torch.int64))
        with self.assertRaisesRegex(ValueError, "input count"):
            model()
        for outputs in ([], ["missing"], ["output", "output"]):
            with self.assertRaisesRegex(ValueError, "unique existing"):
                EspressoIntegerGraph(text=text, arena=b"", output_names=outputs)
        with self.assertRaisesRegex(ValueError, "spatial"):
            EspressoIntegerGraph(text=text, arena=b"", input_shapes={"data": (2, 4, 4, 2)})

    def test_fixed_spatial_profile(self):
        text = graph(rows=["UpSampling up data output LINEAR"])
        model = EspressoIntegerGraph(text=text, arena=b"", input_shapes={"data": (1, 3, 7, 2)})
        self.assertEqual(tuple(model(torch.ones((1, 3, 7, 2), dtype=torch.int64))[0].shape), (1, 6, 14, 2))

    def test_onnx_standard_integer_ops_and_pytorch_roundtrip(self):
        import onnx
        import onnxruntime

        text = graph(rows=[
            "Convolution conv 2 1 1 1 1 0 0 1 0 1 0 4 0 1 0 data conv",
            "UpSampling up conv output LINEAR",
        ], storage=(1, 1))
        arena = np.array([127, 127, -128, -128], dtype="i1").tobytes() + np.array([(1 << 31) - 1, -(1 << 31)], dtype="<i4").tobytes()
        value = torch.arange(-16, 16, dtype=torch.int64).reshape(1, 4, 4, 2)
        model = self.assert_replay(text=text, arena=arena, value=value.numpy())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.onnx"
            torch.onnx.export(model, (value,), str(path), input_names=["data"], output_names=["output"], opset_version=18, dynamo=False)
            onnx.checker.check_model(str(path), full_check=True)
            self.assertTrue(all(node.domain in ("", "ai.onnx") for node in onnx.load(path).graph.node))
            options = onnxruntime.SessionOptions()
            options.intra_op_num_threads = 1
            session = onnxruntime.InferenceSession(str(path), sess_options=options, providers=["CPUExecutionProvider"])
            for candidate in (value, torch.full_like(value, 127), torch.full_like(value, -128)):
                expected = model(candidate)[0].numpy()
                np.testing.assert_array_equal(session.run(None, {"data": candidate.numpy()})[0], expected)
            artifact = Path(directory) / "model.pt2"
            torch.export.save(torch.export.export(model, (value,)), artifact)
            np.testing.assert_array_equal(torch.export.load(artifact).module()(value)[0].detach(), model(value)[0])

    def test_onnx_multibranch_requantization(self):
        import onnxruntime

        text = graph(rows=[
            "Slice split data 1 1 1 2 left 4 right 7",
            "Concat merge 2 left right merged 1 5",
            "Eltwise add merged data output 1 4 0",
        ])
        value = torch.arange(-16, 16, dtype=torch.int64).reshape(1, 4, 4, 2)
        model = self.assert_replay(text=text, arena=b"", value=value.numpy())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "branches.onnx"
            torch.onnx.export(model, (value,), str(path), input_names=["data"], output_names=["output"], opset_version=18, dynamo=False)
            options = onnxruntime.SessionOptions()
            options.intra_op_num_threads = 1
            session = onnxruntime.InferenceSession(str(path), sess_options=options, providers=["CPUExecutionProvider"])
            for candidate in (value, torch.full_like(value, 127), torch.full_like(value, -128)):
                np.testing.assert_array_equal(session.run(None, {"data": candidate.numpy()})[0], model(candidate)[0])


if __name__ == "__main__":
    unittest.main()
