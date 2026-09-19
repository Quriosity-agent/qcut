"""Synthetic tests; never load vendor weights for unit coverage."""

import struct
import tempfile
import unittest
from pathlib import Path

import numpy as np
import torch

from matting_torch import MattingGraph, linear_upsample, load_model, parse_graph, read_case, read_weights


class MattingTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(torch.set_num_threads, torch.get_num_threads())
        torch.set_num_threads(1)

    def test_graph_counts_exclude_data(self):
        result = parse_graph(text="D\\n\n1 1 0\\n\nDataV2 data 1 2 2 1 4 0 0\\n\nTanh value data value 4 0\\n\n")
        self.assertEqual(len(result), 2)

    def test_graph_rejects_header(self):
        with self.assertRaises(ValueError):
            parse_graph(text="X\n1 1 0\nTanh t x y 4 0")

    def test_graph_rejects_missing_node(self):
        with self.assertRaises(ValueError):
            parse_graph(text="D\n1 1 0\nDataV2 x 1 2 2 1 4 0 0")

    def test_unknown_operator_rejected(self):
        with self.assertRaises(ValueError):
            MattingGraph(nodes=[["Surprise", "x"]])

    def test_zero_border_resize(self):
        actual = linear_upsample(value=torch.ones(1, 1, 2, 2))
        expected = torch.tensor([[0.5625, 0.75, 0.75, 0.5625], [0.75, 1, 1, 0.75],
                                 [0.75, 1, 1, 0.75], [0.5625, 0.75, 0.75, 0.5625]])
        self.assertTrue(torch.equal(actual[0, 0], expected))

    def test_resize_preserves_batch(self):
        actual = linear_upsample(value=torch.stack([torch.zeros(1, 2, 2), torch.ones(1, 2, 2)]))
        self.assertEqual(tuple(actual.shape), (2, 1, 4, 4))
        self.assertEqual(float(actual[0].sum()), 0)
        self.assertGreater(float(actual[1].sum()), 0)

    def test_bm_excludes_opaque_trailer(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "synthetic.bin"
            header = struct.pack("<9I", 0x02004D42, 48, 3, 4, 36, 8, 40, 0, 48)
            path.write_bytes(header + b"test" + np.array([1, -2], dtype="<f2").tobytes() + b"ABCD")
            self.assertTrue(np.array_equal(read_weights(path=path), np.array([1, -2], dtype=np.float32)))

    def test_bm_rejects_truncation(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bad.bin"
            path.write_bytes(b"BM\0\2")
            with self.assertRaises(ValueError):
                read_weights(path=path)

    def test_bm_rejects_nonfinite(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bad.bin"
            header = struct.pack("<9I", 0x02004D42, 46, 3, 4, 36, 6, 40, 0, 46)
            path.write_bytes(header + b"test" + np.array([np.inf], dtype="<f2").tobytes() + b"ABCD")
            with self.assertRaises(ValueError):
                read_weights(path=path)

    def test_conv_layout_and_roundtrip(self):
        rows = [["DataV2", "input", "1", "2", "2", "1", "4", "0", "0"],
                "Convolution c 1 1 1 1 1 0 0 1 0 4 0 4 0 4 0 input output".split()]
        model = MattingGraph(nodes=rows, weights=np.array([2, 3], dtype=np.float32))
        actual = model.convs["1"](torch.ones(1, 1, 2, 2))
        self.assertTrue(torch.equal(actual, torch.full_like(actual, 5)))
        clone = MattingGraph(nodes=rows)
        clone.load_state_dict(model.state_dict(), strict=True)
        self.assertTrue(all(torch.equal(t, clone.state_dict()[k]) for k, t in model.state_dict().items()))

    def test_weights_must_be_exhausted(self):
        with self.assertRaises(ValueError):
            MattingGraph(nodes=[["DataV2", "x", "1", "1", "1", "1", "4", "0", "0"]], weights=np.ones(1, dtype=np.float32))

    def test_missing_input_rejected(self):
        model = MattingGraph(nodes=[["DataV2", "x", "1", "1", "1", "1", "4", "0", "0"]])
        with self.assertRaises(ValueError):
            model({})

    def test_nonfinite_input_rejected(self):
        model = MattingGraph(nodes=[["DataV2", "x", "1", "1", "1", "1", "4", "0", "0"]])
        with self.assertRaises(ValueError):
            model({"x": torch.full((1, 1, 1, 1), float("nan"))})

    def test_loader_rejects_wrong_format(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bad.pt"
            torch.save({"format": "not-matting"}, path)
            with self.assertRaises(ValueError):
                load_model(path)

    def test_empty_native_trace_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            (directory / "tensors.tsv").write_text("")
            with self.assertRaises(ValueError):
                read_case(directory=directory)

    def test_incomplete_graph_row_rejected(self):
        with self.assertRaises(ValueError):
            parse_graph(text="D\n0 1 0\nTanh")


if __name__ == "__main__":
    unittest.main()
