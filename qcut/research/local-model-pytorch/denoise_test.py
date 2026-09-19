#!/usr/bin/env python3
"""Synthetic tests without the original model, decoded graph, or native runtime."""
import copy
import tempfile
import unittest
from pathlib import Path

import numpy as np
import torch

from denoise_torch import DenoiseGraph, load_model, read_descriptors


def fixture():
    return [
        ["DataV2", f"data{i}", "1", "16", "16", "3", "4", "0", "0"] for i in range(3)
    ] + [
        ["Concat", "joined", "3", "data0", "data1", "data2", "joined", "4", "0"],
        ["Convolution", "conv", "3", "3", "3", "1", "1", "1", "1", "1", "0", "4", "0", "4", "0", "4", "0", "joined", "filtered"],
        ["Eltwise", "residual", "filtered", "data1", "Add_38", "4", "0", "0"],
    ]


class DenoiseTests(unittest.TestCase):
    def setUp(self):
        self.nodes = fixture()
        self.weights = np.zeros(246, dtype=np.float32)
        self.inputs = {f"data{i}": torch.rand(1, 3, 16, 16) for i in range(3)}

    def test_middle_frame_residual(self):
        model = DenoiseGraph(nodes=self.nodes, weights=self.weights)
        torch.testing.assert_close(model(self.inputs)["Add_38"], self.inputs["data1"], rtol=0, atol=0)

    def test_weight_count(self):
        with self.assertRaises(ValueError):
            DenoiseGraph(nodes=self.nodes, weights=np.zeros(245, dtype=np.float32))

    def test_extra_weights(self):
        with self.assertRaises(ValueError):
            DenoiseGraph(nodes=self.nodes, weights=np.zeros(247, dtype=np.float32))

    def test_nonfinite_weights(self):
        self.weights[0] = np.nan
        with self.assertRaises(ValueError):
            DenoiseGraph(nodes=self.nodes, weights=self.weights)

    def test_unknown_operator(self):
        self.nodes.append(["Unsupported", "layer"])
        with self.assertRaises(ValueError):
            DenoiseGraph(nodes=self.nodes)

    def test_input_shape_mismatch(self):
        self.inputs["data0"] = torch.zeros(1, 3, 32, 32)
        with self.assertRaises(ValueError):
            DenoiseGraph(nodes=self.nodes)(self.inputs)

    def test_nonfinite_input(self):
        self.inputs["data0"][0, 0, 0, 0] = float("inf")
        with self.assertRaises(ValueError):
            DenoiseGraph(nodes=self.nodes)(self.inputs)

    def test_input_dtype(self):
        self.inputs["data0"] = self.inputs["data0"].double()
        with self.assertRaises(ValueError):
            DenoiseGraph(nodes=self.nodes)(self.inputs)

    def test_missing_temporal_input(self):
        self.inputs.pop("data0")
        with self.assertRaises(ValueError):
            DenoiseGraph(nodes=self.nodes)(self.inputs)

    def test_huge_channel_count(self):
        self.nodes[4][2] = "999999"
        with self.assertRaises(ValueError):
            DenoiseGraph(nodes=self.nodes)

    def test_unknown_resize_mode(self):
        self.nodes.append(["UpSampling", "up", "Add_38", "up", "LINEAR"])
        with self.assertRaises(ValueError):
            DenoiseGraph(nodes=self.nodes)

    def test_unknown_bundle_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "synthetic.pt"
            torch.save({"format": "other"}, path)
            with self.assertRaises(ValueError):
                load_model(path=path)

    def test_parameter_roundtrip(self):
        before = DenoiseGraph(nodes=self.nodes)
        after = DenoiseGraph(nodes=copy.deepcopy(self.nodes))
        after.load_state_dict(before.state_dict(), strict=True)
        self.assertTrue(all(torch.equal(value, after.state_dict()[key]) for key, value in before.state_dict().items()))
        self.assertTrue(torch.equal(before(self.inputs)["Add_38"], after(self.inputs)["Add_38"]))

    def test_raw_native_descriptors(self):
        text = "\n".join(f"{name}\t1\t64\t32\t3\t-7\t42" for name in ("data0", "data1", "data2", "Add_38"))
        result = read_descriptors(text=text, height=32, width=64)
        self.assertEqual(result["data0"]["raw_i32_at_24"], -7)
        self.assertEqual(result["Add_38"]["raw_i32_at_28"], 42)

    def test_native_descriptor_shape_mismatch(self):
        with self.assertRaises(ValueError):
            read_descriptors(text="data0\t1\t32\t64\t3\t0\t0", height=32, width=64)

    def test_native_descriptor_missing_output(self):
        with self.assertRaises(ValueError):
            read_descriptors(text="data0\t1\t64\t32\t3\t0\t0", height=32, width=64)


if __name__ == "__main__":
    torch.set_num_threads(2)
    unittest.main()
