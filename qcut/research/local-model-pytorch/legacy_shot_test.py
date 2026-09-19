#!/usr/bin/env python3
"""Synthetic regression tests, without vendor assets or native libraries."""
import pathlib
import struct
import tempfile
import unittest

import numpy as np
import torch

from legacy_shot_export import HIDDEN, WINDOW, LegacyGRU, LegacyHead, arena_for, load_legacy, read_layers, specs_from_rows
from legacy_shot_probe import PRIVATE, header, private_output


class LegacyTests(unittest.TestCase):
    def test_header_uses_its_own_offsets(self):
        raw = bytearray(104)
        struct.pack_into("<7I", raw, 0, 67128642, 104, 7, 8, 68, 28, 76)
        self.assertEqual(header(raw=raw), {"arena_offset": 76, "arena_bytes": 28, "arena_floats": 7})

    def test_truncated_header(self):
        with self.assertRaises(ValueError):
            header(raw=b"BM")

    def test_header_bounds(self):
        raw = bytearray(104)
        struct.pack_into("<7I", raw, 0, 67128642, 104, 7, 8, 68, 100, 76)
        with self.assertRaises(ValueError):
            header(raw=raw)

    def test_private_directory_required(self):
        with self.assertRaises(ValueError):
            private_output(path=pathlib.Path("/tmp/public-model-output"))

    def test_reject_unknown_model(self):
        with tempfile.TemporaryDirectory(dir=PRIVATE) as directory:
            path = pathlib.Path(directory) / "synthetic.bin"
            path.write_bytes(b"not-a-model")
            with self.assertRaises(ValueError):
                arena_for(path=path, role="backbone")

    def test_reject_unknown_bundle(self):
        with tempfile.TemporaryDirectory(dir=PRIVATE) as directory:
            path = pathlib.Path(directory) / "synthetic.pt"
            torch.save({"format": "unknown", "version": 1}, path)
            with self.assertRaises(ValueError):
                load_legacy(path=path)

    def test_gru_matches_pytorch(self):
        h = HIDDEN
        block = np.random.default_rng(7).normal(0, 0.01, 6 * h * h + 4 * h).astype(np.float32)
        cell = LegacyGRU(block=block)
        reference = torch.nn.GRU(h, h)
        with torch.no_grad():
            reference.weight_ih_l0.copy_(torch.cat([cell.Wr, cell.Wz, cell.Wn]))
            reference.weight_hh_l0.copy_(torch.cat([cell.Rr, cell.Rz, cell.Rn]))
            reference.bias_ih_l0.copy_(torch.cat([cell.bias[0], cell.bias[1], cell.bias[2]]))
            reference.bias_hh_l0.zero_()
            reference.bias_hh_l0[2 * h:].copy_(cell.bias[3])
            sequence = torch.rand((WINDOW, h), generator=torch.Generator().manual_seed(41))
            expected, _ = reference(sequence.unsqueeze(1))
            torch.testing.assert_close(cell(sequence), expected[:, 0], rtol=1e-5, atol=1e-6)

    def test_gru_rejects_wrong_length(self):
        with self.assertRaises(ValueError):
            LegacyGRU(block=np.zeros(12, dtype=np.float32))

    def test_similarity_groups_are_interleaved(self):
        model = LegacyHead(specs=[], alphas=[])
        inputs = torch.rand((WINDOW, HIDDEN), generator=torch.Generator().manual_seed(3))
        expected = torch.stack([
            torch.nn.functional.normalize(inputs[:, group::4], dim=-1) @
            torch.nn.functional.normalize(inputs[:, group::4], dim=-1).T
            for group in range(4)
        ]).unsqueeze(0)
        torch.testing.assert_close(model.similarity_map(inputs), expected)

    def test_head_rejects_new_model_dimensions(self):
        with self.assertRaises(ValueError):
            LegacyHead(specs=[], alphas=[])(torch.zeros(7, 128))

    def test_layer_table_rejects_missing_layer(self):
        with tempfile.TemporaryDirectory(dir=PRIVATE) as directory:
            path = pathlib.Path(directory) / "synthetic.tsv"
            path.write_text("1\tlayer\tConvolution\t3\t3\t3\t8\t128\t128\t2,2\t1,1\n")
            with self.assertRaises(ValueError):
                read_layers(path=path)

    def test_nonsquare_kernel_rejected(self):
        rows = [["0", "layer", "Convolution", "3", "5", "3", "8", "128", "128", "2,2", "1,1"]]
        with self.assertRaises(ValueError):
            specs_from_rows(rows=rows)


if __name__ == "__main__":
    PRIVATE.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(2)
    unittest.main()
