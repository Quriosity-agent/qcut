"""Bit-level regression for portable replacements of the audited CPU primitives."""
from pathlib import Path
import tempfile
import unittest
import warnings

import numpy as np
import onnxruntime as ort
import torch

import onnx_numeric as portable
import tracking_numeric as reference


class NumericGraph(torch.nn.Module):
    def forward(self, value):
        exponential = portable.exp_estimate(value=value)
        return exponential, portable.reciprocal_estimate(value=1 + exponential)


class PortableNumericTests(unittest.TestCase):
    def test_exp_bit_patterns_across_clamp_boundaries(self):
        values = torch.cat((torch.linspace(-100, 100, 1000001), torch.tensor([-87.33654022216797, 88.72283172607422])))
        self.assertTrue(torch.equal(portable.exp_estimate(value=values).view(torch.int32), reference.exp_estimate(value=values).view(torch.int32)))

    def test_reciprocal_exponent_and_bucket_boundaries(self):
        mantissa = 1 + torch.arange(512, dtype=torch.float32).reshape(1, -1) / 512
        values = torch.ldexp(mantissa, torch.arange(127).reshape(-1, 1))
        self.assertTrue(torch.equal(portable.reciprocal_estimate(value=values), reference.reciprocal_estimate(value=values)))

    def test_pair_layout_and_scalar_tail(self):
        for rows in (1, 3, 4, 5, 3125):
            value = torch.randn((rows, 2, 1, 1), generator=torch.Generator().manual_seed(rows)) * 20
            with self.subTest(rows=rows):
                self.assertTrue(torch.equal(portable.pair_softmax(value=value), reference.pair_softmax(value=value)))

    def test_actual_onnx_primitives(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "synthetic.onnx"
            values = torch.linspace(-100, 100, 65536).reshape(16, 4096)
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                torch.onnx.export(NumericGraph(), (values,), str(path), opset_version=18, dynamo=False,
                                  input_names=["x"], output_names=["exp", "reciprocal"])
            options = ort.SessionOptions()
            options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
            options.intra_op_num_threads = 2
            session = ort.InferenceSession(str(path), options, providers=["CPUExecutionProvider"])
            expected_exp = reference.exp_estimate(value=values)
            expected_reciprocal = reference.reciprocal_estimate(value=1 + expected_exp)
            for actual, expected in zip(session.run(None, {"x": values.numpy()}), (expected_exp, expected_reciprocal), strict=True):
                np.testing.assert_array_equal(actual.view(np.uint32), expected.numpy().view(np.uint32))

    def test_pinned_sigmoid_actual_onnx(self):
        from ocr_rec_numeric import PinnedSigmoid
        values = torch.linspace(-80, 80, 65536).reshape(16, 4096)
        expected = PinnedSigmoid()(values)
        self.assertTrue(torch.equal(portable.PinnedSigmoid()(values), expected))
        with tempfile.TemporaryDirectory() as temp, warnings.catch_warnings():
            path = Path(temp) / "sigmoid.onnx"
            warnings.simplefilter("ignore")
            torch.onnx.export(portable.PinnedSigmoid(), (values,), str(path), dynamo=False, opset_version=18,
                              input_names=["x"], output_names=["y"])
            options = ort.SessionOptions()
            options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
            options.intra_op_num_threads = 2
            session = ort.InferenceSession(path.read_bytes(), options, providers=["CPUExecutionProvider"])
            actual = session.run(None, {"x": values.numpy()})[0]
            np.testing.assert_array_equal(actual.view(np.uint32), expected.numpy().view(np.uint32))


if __name__ == "__main__":
    torch.set_num_threads(2)
    unittest.main()
