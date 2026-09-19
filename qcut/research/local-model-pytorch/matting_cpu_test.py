"""Synthetic matting schemas and CPU arithmetic tests; no vendor assets/runtime."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import torch

from matting_cpu_export import compare, fresh_directory, read_tensor, verify_case, write_schema, write_tensor
from matting_cpu_math import CPU_SOFTMAX, cpu_exp, reciprocal_estimate, two_channel_softmax
from matting_torch import (CPU_FORMAT, CPU_RUNTIME_SHA256, INPUT_SHAPES, LOADED_SHA256,
                           OUTPUT_SHAPES, SOURCE_SHA256, MattingGraph, load_model, validate_state)
from ocr_torch import widen_fp16


def synthetic_model():
    nodes = [["DataV2", name, str(n), str(h), str(w), str(c), "4", "0", "0"]
             for name, (n, c, h, w) in INPUT_SHAPES.items()]
    nodes.append("Convolution c 2 1 1 1 1 0 0 1 0 4 0 4 0 4 0 data logits".split())
    nodes.append("Softmax nn_3 logits nn_3".split())
    for source, target in zip(("data1", "data2", "data3"), ("Add_196", "Add_213", "Add_230")):
        nodes.append(f"Tanh t_{source} {source} {target} 4 0".split())
    return MattingGraph(nodes=nodes, weights=np.zeros(8, dtype=np.float32), softmax_profile=CPU_SOFTMAX).eval()


class CPUMathTests(unittest.TestCase):
    def setUp(self):
        torch.set_num_threads(1)

    def test_reciprocal_estimate_landmarks(self):
        actual = reciprocal_estimate(value=torch.tensor([1., 2., 4., 1.5, float("inf")]))
        self.assertTrue(torch.equal(actual, torch.tensor([511 / 512, 511 / 1024, 511 / 2048, 341 / 512, 0.])))

    def test_reciprocal_buckets(self):
        values = 1 + torch.arange(256, dtype=torch.float32) / 256
        expected = torch.tensor([(((524288 // (2 * (256 + i) + 1)) + 1) // 2) / 512 for i in range(256)])
        self.assertTrue(torch.equal(reciprocal_estimate(value=values), expected))

    def test_reciprocal_rejects_unsupported_values(self):
        for value in (torch.tensor([0.]), torch.tensor([-1.]), torch.tensor([float("nan")]), torch.ones(2, dtype=torch.float64)):
            with self.subTest(value=value), self.assertRaises(ValueError):
                reciprocal_estimate(value=value)

    def test_exp_is_finite_over_large_finite_range(self):
        actual = cpu_exp(value=torch.linspace(-1000, 1000, 1024))
        self.assertTrue(torch.isfinite(actual).all())
        self.assertTrue((actual > 0).all())

    def test_two_channel_complement_and_saturation(self):
        values = torch.tensor([1000., -1000., 0., 0.]).reshape(1, 2, 1, 2)
        actual = two_channel_softmax(value=values)
        self.assertTrue(torch.equal(actual.sum(1), torch.ones(1, 1, 2)))
        self.assertEqual(float(actual[0, 0, 0, 0]), 511 / 512)
        self.assertEqual(float(actual[0, 1, 0, 0]), 1 / 512)

    def test_softmax_rejects_schema(self):
        for value in (torch.ones(1, 3, 2, 2), torch.ones(2, 2), torch.ones(1, 2, 1, 1, dtype=torch.float64),
                      torch.full((1, 2, 1, 1), float("nan"))):
            with self.subTest(shape=value.shape), self.assertRaises(ValueError):
                two_channel_softmax(value=value)

    def test_fp16_vector_tail_is_distinct(self):
        bits = np.array([0x1f6] * 6, dtype=np.uint16)
        actual = widen_fp16(bits=bits)
        ieee = bits.view(np.float16).astype(np.float32)
        self.assertTrue(np.array_equal(actual[-2:], ieee[-2:]))
        self.assertTrue(np.all(actual[:4] != ieee[:4]))
        self.assertEqual(float(actual[0]), 2.3573637008666992e-05)


class CPUSchemaTests(unittest.TestCase):
    def setUp(self):
        torch.set_num_threads(1)
        self.model = synthetic_model()
        self.inputs = {name: torch.zeros(shape) for name, shape in INPUT_SHAPES.items()}

    def test_all_four_forward_schemas(self):
        with torch.inference_mode():
            outputs = self.model(self.inputs)
        self.assertEqual({name: tuple(value.shape) for name, value in outputs.items()}, OUTPUT_SHAPES)
        self.assertTrue(all(torch.isfinite(value).all() for value in outputs.values()))

    def test_exact_state_and_forward_roundtrip(self):
        clone = synthetic_model()
        state = self.model.state_dict()
        validate_state(model=clone, state=state)
        clone.load_state_dict(state, strict=True)
        with torch.inference_mode():
            before, after = self.model(self.inputs), clone(self.inputs)
        self.assertTrue(all(torch.equal(before[name], after[name]) for name in OUTPUT_SHAPES))

    def test_each_input_missing_extra_wrong_shape_dtype_nonfinite(self):
        for name in INPUT_SHAPES:
            invalid = [self.inputs[name].flatten(), self.inputs[name].double(), self.inputs[name] + float("nan")]
            for value in invalid:
                inputs = {**self.inputs, name: value}
                with self.subTest(name=name, shape=value.shape, dtype=value.dtype), self.assertRaises(ValueError):
                    self.model(inputs)
            with self.subTest(missing=name), self.assertRaises(ValueError):
                self.model({key: value for key, value in self.inputs.items() if key != name})
        with self.assertRaises(ValueError):
            self.model({**self.inputs, "surprise": torch.zeros(1)})

    def test_state_rejects_extra_missing_shape_dtype_nonfinite(self):
        state = self.model.state_dict()
        name = next(iter(state))
        invalid = [{}, {**state, "extra": torch.ones(1)}, {**state, name: state[name].flatten()},
                   {**state, name: state[name].double()}, {**state, name: state[name] + float("inf")}, {**state, name: []}]
        for candidate in invalid:
            with self.subTest(keys=list(candidate)), self.assertRaises(ValueError):
                validate_state(model=self.model, state=candidate)

    def test_weights_and_profiles_rejected(self):
        for weights in (np.zeros(8, dtype=np.float64), np.zeros((2, 4), dtype=np.float32), np.full(8, np.nan, dtype=np.float32)):
            with self.assertRaises(ValueError):
                MattingGraph(nodes=self.model.nodes, weights=weights)
        with self.assertRaises(ValueError):
            MattingGraph(nodes=self.model.nodes, softmax_profile="unknown")

    def test_loader_rejects_modified_semantics_without_vendor_access(self):
        bundle = {"format": CPU_FORMAT, "source_asset": {"sha256": SOURCE_SHA256},
                  "loaded_buffer": {"sha256": LOADED_SHA256}, "resize_profile": "half-pixel-zero-border",
                  "softmax_profile": CPU_SOFTMAX, "runtime_sha256": CPU_RUNTIME_SHA256,
                  "nodes": self.model.nodes, "state_dict": self.model.state_dict()}
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "synthetic.pt"
            torch.save(bundle, path)
            with self.assertRaisesRegex(ValueError, "graph semantics"):
                load_model(path=path, allow_unverified=True)
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                load_model(path=path, expected_sha256="0" * 64)
            for malformed in ([], None, {"source_asset": 2}):
                torch.save(malformed, path)
                with self.assertRaises(ValueError):
                    load_model(path=path)

    def test_cpu_candidate_requires_explicit_opt_in(self):
        bundle = {"format": CPU_FORMAT, "source_asset": {"sha256": SOURCE_SHA256},
                  "loaded_buffer": {"sha256": LOADED_SHA256}, "resize_profile": "half-pixel-zero-border"}
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "synthetic.pt"
            torch.save(bundle, path)
            with patch("matting_torch.MattingGraph", side_effect=AssertionError("candidate must not instantiate")):
                with self.assertRaisesRegex(ValueError, "allow_unverified=True"):
                    load_model(path=path)
                with self.assertRaisesRegex(ValueError, "allow_unverified=True"):
                    load_model(path=path, allow_unverified=False)

    def test_cpu_candidate_status_cannot_bypass_opt_in(self):
        bundle = {"format": CPU_FORMAT, "source_asset": {"sha256": SOURCE_SHA256},
                  "loaded_buffer": {"sha256": LOADED_SHA256}, "resize_profile": "half-pixel-zero-border"}
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "synthetic.pt"
            for status in ("native-parity-passed", "verified", None):
                torch.save({**bundle, "validation_status": status}, path)
                with self.subTest(status=status), self.assertRaisesRegex(ValueError, "allow_unverified=True"):
                    load_model(path=path)

    def test_candidate_opt_in_rejects_truthy_non_booleans(self):
        for value in (1, "true", [True], None):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "explicit boolean"):
                load_model(path="not-read.pt", allow_unverified=value)

    def test_tensor_exchange_non_square_layout_and_byte_count(self):
        value = torch.arange(30, dtype=torch.float32).reshape(1, 3, 2, 5)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "tensor.f32"
            write_tensor(path=path, value=value)
            self.assertTrue(torch.equal(read_tensor(path=path, shape=(1, 3, 2, 5)), value))
            write_schema(path=Path(temp) / "schema.tsv", shapes={"test": value.shape})
            self.assertEqual((Path(temp) / "schema.tsv").read_text(), "test\t1\t5\t2\t3\n")
            path.write_bytes(path.read_bytes()[:-1])
            with self.assertRaises(ValueError):
                read_tensor(path=path, shape=(1, 3, 2, 5))

    def test_compare_rejects_nonfinite_shape_and_keeps_fixed_tolerance(self):
        reference = torch.zeros(2)
        self.assertFalse(compare(actual=torch.ones(2) * 0.00011, expected=reference)["passed"])
        self.assertFalse(compare(actual=torch.ones(3), expected=reference)["passed"])
        self.assertFalse(compare(actual=torch.full((2,), float("nan")), expected=reference)["passed"])

    def test_evidence_requires_complete_echo_and_all_outputs(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)
            with torch.inference_mode():
                actual = self.model(self.inputs)
            rows = []
            for kind, values in (("input", self.inputs), ("output", actual)):
                for name, value in values.items():
                    n, c, h, w = value.shape
                    rows.append(f"{kind}\t{name}\t{n}\t{w}\t{h}\t{c}\t4\t0")
                    prefixes = ("applied", "echo") if kind == "input" else ("out",)
                    for prefix in prefixes:
                        write_tensor(path=path / f"{prefix}-{name}.f32", value=value)
            descriptor = path / "native-descriptors.tsv"
            descriptor.write_text("\n".join(rows) + "\n")
            self.assertTrue(verify_case(path=path, actual=actual, supplied=self.inputs)["passed"])
            for bad_rows in (rows[:-1], rows + [rows[0]], [row.replace("\t4\t0", "\t2\t0") for row in rows]):
                descriptor.write_text("\n".join(bad_rows) + "\n")
                self.assertFalse(verify_case(path=path, actual=actual, supplied=self.inputs)["passed"])
            descriptor.write_text("\n".join(rows) + "\n")
            write_tensor(path=path / "echo-data.f32", value=self.inputs["data"] + 1)
            self.assertFalse(verify_case(path=path, actual=actual, supplied=self.inputs)["passed"])

    def test_private_fresh_boundary(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with patch("matting_cpu_export.PRIVATE", root):
                with self.assertRaises(ValueError):
                    fresh_directory(path=root)
                with self.assertRaises(ValueError):
                    fresh_directory(path=root.parent / "outside")
                path = fresh_directory(path=root / "new")
                (path / "old").touch()
                with self.assertRaises(ValueError):
                    fresh_directory(path=path)


if __name__ == "__main__":
    unittest.main()
