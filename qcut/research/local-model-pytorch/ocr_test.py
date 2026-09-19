"""Synthetic OCR semantics and rejection tests; no private model fixture required."""
import copy
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import torch

from ocr_export import PRIVATE, compare, fresh_directory, read_native
from ocr_torch import FORMAT, RUNTIME_SHA256, SOURCE_SHA256, OCRDetector, checked_input, decode_arena, load_model, parse_graph, widen_fp16


def graph(*, rows):
    return "\n".join(["E\\n", f"1 {len(rows) - 1} 123\\n", *(" ".join(row) + "\\n" for row in rows)]) + "\n"


def input_row():
    return "DataV2 data 1 1 1 3 4 0 0".split()


def convolution(*, name="unit", source="data", channels=2, kernel=1, stride=1, relu=0):
    return f"Convolution {name} {channels} {kernel} {kernel} {stride} {stride} {kernel // 2} {kernel // 2} 1 {relu} 4 0 4 0 4 0 {source} {name}".split()


class OCRTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(2)
        PRIVATE.mkdir(parents=True, exist_ok=True)

    def test_half_normal_values(self):
        values = np.array([0, -0., 1, -1, 65504, 2**-14], dtype=np.float16)
        self.assertTrue(np.array_equal(widen_fp16(bits=values.view(np.uint16)).view(np.uint32), values.astype(np.float32).view(np.uint32)))

    def test_half_vector_xor_and_scalar_tail(self):
        bits = np.array([1, 0x8001, 0x3ff, 0x83ff, 1, 0x8001, 0x3ff], dtype=np.uint16)
        standard = bits.view(np.float16).astype(np.float32)
        expected = standard.view(np.uint32).copy()
        expected[:4] ^= (bits[:4].astype(np.uint32) & 0x7fff) << 13
        self.assertTrue(np.array_equal(widen_fp16(bits=bits).view(np.uint32), expected))

    def test_half_reject_nonfinite(self):
        for bits in (0x7c00, 0xfc00, 0x7c01, 0xffff):
            with self.subTest(bits=bits), self.assertRaises(ValueError):
                widen_fp16(bits=np.array([bits], dtype=np.uint16))

    def test_half_reject_wrong_dtype_or_rank(self):
        for values in (np.ones(4, dtype=np.uint32), np.ones((2, 2), dtype=np.uint16)):
            with self.assertRaises(ValueError):
                widen_fp16(bits=values)

    def test_arena_bounds(self):
        arena = np.ones(6, dtype=np.float16).tobytes() + b"abcd"
        self.assertEqual(len(decode_arena(arena=arena, count=6)), 6)
        for altered in (arena[:-1], arena + b"x", b""):
            with self.assertRaises(ValueError):
                decode_arena(arena=altered, count=6)

    def test_header_rejects_unknown_prefix_and_counts(self):
        text = graph(rows=[input_row(), convolution()])
        for altered in (text.replace("E", "D", 1), text.replace("1 1 123", "1 2 123"), text.replace("1 1 123", "2 1 123"), ""):
            with self.assertRaises(ValueError):
                parse_graph(text=altered)

    def test_convolution_ohwi_weights(self):
        rows = [input_row(), convolution()]
        weights = np.arange(8, dtype=np.float32) / 8
        model = OCRDetector(nodes=rows, weights=weights)
        value = torch.arange(3 * 32 * 64, dtype=torch.float32).reshape(1, 3, 32, 64) / 100
        expected = torch.einsum("oc,nchw->nohw", torch.from_numpy(weights[:6].reshape(2, 3)), value)
        expected += torch.from_numpy(weights[6:])[None, :, None, None]
        self.assertTrue(torch.allclose(model({"data": value})["unit"], expected))

    def test_transpose_ohwi_weights_and_output_padding(self):
        row = "ConvTranspose2d up 2 1 3 3 2 2 1 1 1 1 1 0 4 0 4 0 4 0 data up".split()
        weights = np.arange(56, dtype=np.float32) / 50
        model = OCRDetector(nodes=[input_row(), row], weights=weights)
        value = torch.randn(1, 3, 32, 64)
        kernel = torch.from_numpy(weights[:54].reshape(2, 3, 3, 3).copy()).permute(3, 0, 1, 2)
        expected = torch.nn.functional.conv_transpose2d(value, kernel, torch.from_numpy(weights[54:]), stride=2, padding=1, output_padding=1)
        self.assertTrue(torch.equal(model({"data": value})["up"], expected))
        self.assertEqual(tuple(expected.shape), (1, 2, 64, 128))

    def test_pool_activation_residual_concat(self):
        rows = [input_row(), convolution(channels=3, relu=1),
                "OnnxOp2 add Sum unit data added 4 0".split(),
                "Relu rel added positive 0 0".split(),
                "PoolingDown pool 3 3 2 2 1 1 4 0 MAX positive small".split(),
                "Concat2 cat 1 2 small small joined 4 0".split(),
                "Sigmoid sig joined result 4 0".split()]
        weights = np.concatenate((np.eye(3, dtype=np.float32).flatten(), np.zeros(3, dtype=np.float32)))
        model = OCRDetector(nodes=rows, weights=weights)
        value = torch.randn(1, 3, 32, 64)
        pooled = torch.nn.functional.max_pool2d((value.relu() + value).relu(), 3, 2, 1)
        expected = torch.cat([pooled, pooled], dim=1).sigmoid()
        self.assertTrue(torch.equal(model({"data": value})["result"], expected))

    def test_unsupported_graph_semantics(self):
        original = [input_row(), convolution()]
        altered_nodes = []
        for position, token in ((0, "Unknown"), (9, "0"), (10, "2"), (11, "2"), (17, "missing"), (18, "data")):
            rows = copy.deepcopy(original)
            rows[1][position] = token
            altered_nodes.append(rows)
        altered_nodes.append([input_row(), "Concat2 bad 2 2 data data out 4 0".split()])
        altered_nodes.append([input_row(), "OnnxOp2 bad Mul data data out 4 0".split()])
        for rows in altered_nodes:
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                OCRDetector(nodes=rows)

    def test_weight_count_and_nonfinite_rejected(self):
        for weights in (np.zeros(7, dtype=np.float32), np.zeros(9, dtype=np.float32),
                        np.full(8, np.nan, dtype=np.float32), np.zeros(8, dtype=np.float64)):
            with self.assertRaises(ValueError):
                OCRDetector(nodes=[input_row(), convolution()], weights=weights)

    def test_input_schema(self):
        for value in (torch.zeros(1, 3, 32, 33), torch.zeros(2, 3, 32, 32), torch.zeros(1, 1, 32, 32),
                      torch.zeros(1, 3, 32, 32, dtype=torch.float64), torch.full((1, 3, 32, 32), float("nan")),
                      torch.zeros(1, 3, 16, 32), np.zeros((1, 3, 32, 32), dtype=np.float32)):
            with self.assertRaises(ValueError):
                checked_input(tensor=value)

    def test_input_names_exact(self):
        model = OCRDetector(nodes=[input_row(), convolution()])
        for inputs in ({}, {"wrong": torch.zeros(1, 3, 32, 32)}, {"data": torch.zeros(1, 3, 32, 32), "other": 0}):
            with self.assertRaises(ValueError):
                model(inputs)

    def test_output_nonfinite_rejected(self):
        model = OCRDetector(nodes=[input_row(), convolution()], weights=np.full(8, 1e30, dtype=np.float32))
        with self.assertRaises(ValueError):
            model({"data": torch.full((1, 3, 32, 32), 1e30)})

    def test_roundtrip_weights_only_and_provenance(self):
        text = graph(rows=[input_row(), convolution()])
        model = OCRDetector(nodes=parse_graph(text=text), weights=np.arange(8, dtype=np.float32))
        bundle = {"format": FORMAT, "source_sha256": SOURCE_SHA256, "runtime_sha256": RUNTIME_SHA256,
                  "local_only": True, "graph": text, "state_dict": model.state_dict()}
        with tempfile.TemporaryDirectory(dir=PRIVATE, prefix="ocr-test-") as directory:
            path = Path(directory) / "synthetic.pt"
            torch.save(bundle, path)
            with patch("ocr_torch.GRAPH_SHA256", hashlib.sha256(text.encode()).hexdigest()):
                with patch("ocr_torch.torch.load", wraps=torch.load) as loading:
                    restored = load_model(path=path)
                    self.assertIs(loading.call_args.kwargs["weights_only"], True)
                self.assertTrue(all(torch.equal(v, restored.state_dict()[k]) for k, v in model.state_dict().items()))
                value = {"data": torch.ones(1, 3, 32, 64)}
                self.assertTrue(torch.equal(model(value)["unit"], restored(value)["unit"]))
                for key, invalid in (("source_sha256", "wrong"), ("runtime_sha256", "wrong"), ("local_only", False), ("graph", "invalid")):
                    changed = {**bundle, key: invalid}
                    torch.save(changed, path)
                    with self.assertRaises(ValueError):
                        load_model(path=path)

    def test_load_rejects_bad_state_and_artifact_hash(self):
        text = graph(rows=[input_row(), convolution()])
        model = OCRDetector(nodes=parse_graph(text=text))
        bundle = {"format": FORMAT, "source_sha256": SOURCE_SHA256, "runtime_sha256": RUNTIME_SHA256,
                  "local_only": True, "graph": text, "state_dict": model.state_dict()}
        with tempfile.TemporaryDirectory(dir=PRIVATE, prefix="ocr-test-") as directory:
            path = Path(directory) / "synthetic.pt"
            with patch("ocr_torch.GRAPH_SHA256", hashlib.sha256(text.encode()).hexdigest()):
                torch.save(bundle, path)
                with self.assertRaises(ValueError):
                    load_model(path=path, expected_sha256="wrong")
                for state in ({}, {"bad": torch.tensor(float("nan"))}, {"bad": torch.ones(1, dtype=torch.float64)}):
                    torch.save({**bundle, "state_dict": state}, path)
                    with self.assertRaises((ValueError, RuntimeError)):
                        load_model(path=path)

    def test_compare_fixed_tolerance(self):
        self.assertFalse(compare(actual=torch.tensor([0.0002]), expected=torch.zeros(1))["passed"])
        self.assertTrue(compare(actual=torch.tensor([0.00009]), expected=torch.zeros(1))["passed"])
        self.assertFalse(compare(actual=torch.tensor([float("nan")]), expected=torch.zeros(1))["passed"])
        self.assertFalse(compare(actual=torch.zeros(2), expected=torch.zeros(1))["passed"])

    def test_paths_and_stale_evidence(self):
        with self.assertRaises(ValueError):
            fresh_directory(path=Path("/tmp/ocr-not-private"))
        with self.assertRaises(ValueError):
            fresh_directory(path=PRIVATE)
        with tempfile.TemporaryDirectory(dir=PRIVATE, prefix="ocr-test-") as directory:
            path = fresh_directory(path=Path(directory) / "new")
            (path / "old").write_text("synthetic")
            with self.assertRaises(ValueError):
                fresh_directory(path=path)

    def test_native_evidence_rejects_missing_duplicate_nonfinite_and_bytes(self):
        with tempfile.TemporaryDirectory(dir=PRIVATE, prefix="ocr-test-") as directory:
            path = Path(directory)
            desc = "data\t1\t32\t32\t3\t4\t0\nout\t1\t1\t1\t1\t4\t0\n"
            for text, values in ((desc.replace("out", "wrong"), np.zeros(1, dtype=np.float32)),
                                 (desc + desc, np.zeros(1, dtype=np.float32)),
                                 (desc, np.full(1, np.nan, dtype=np.float32)),
                                 (desc, np.zeros(2, dtype=np.float32))):
                (path / "descriptors.tsv").write_text(text)
                values.tofile(path / "native-0.f32")
                with self.assertRaises(ValueError):
                    read_native(directory=path, names=["out"])

    def test_failed_recognizer_is_not_a_default_loader(self):
        from ocr_rec_torch import load_model as load_recognizer
        with self.assertRaisesRegex(ValueError, "failed native parity"):
            load_recognizer(path="unused.pt")


if __name__ == "__main__":
    unittest.main()
