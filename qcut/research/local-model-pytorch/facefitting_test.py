"""Synthetic tests for face-fitting topology, weights and strict CPU loading."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
import torch

from facefitting_export import build_cases, compare_native_case, safe_directory
from facefitting_torch import (
    ARENA_FLOATS, BM_SHA256, FORMAT, SOURCE_SHA256, FaceFittingGraph, load_model, parse_spec,
)


def synthetic_text():
    rows = [["D"], ["1", "6", "123"], ["DataV2", "x", "1", "1", "1", "212", "4", "0", "0", "2"]]
    source = "x"
    for index, size in enumerate((512, 512, 442)):
        name = f"linear_{index}"
        rows.append(["InnerProduct", name, str(size), "1", "1" if index < 2 else "0", "4", "0", "4", "0", "4", "0", source, name])
        source = name
    rows.extend([["Sigmoid", "sig", source, "sig", "4", "0"],
                 ["Constant", "scale", "0", "1", "1", "1", "1", "scale", "4", "0"],
                 ["OnnxOp2", "mul", "Mul", "sig", "scale", "out", "4", "0"]])
    return "\n".join(" ".join(row) + "\\n" for row in rows) + "\n"


def synthetic_bundle():
    model = FaceFittingGraph(spec=parse_spec(text=synthetic_text()), weights=np.zeros(ARENA_FLOATS, dtype=np.float32))
    return {"format": FORMAT, "source_sha256": SOURCE_SHA256, "bm_sha256": BM_SHA256,
            "local_only": True, "spec": model.spec, "state_dict": model.state_dict()}


class FaceFittingTests(unittest.TestCase):
    def test_strict_graph_topology(self):
        text = synthetic_text()
        spec = parse_spec(text=text)
        self.assertEqual(spec["input_shape"], [1, 212])
        self.assertEqual(spec["output_shape"], [1, 442])
        for old, new in (("1 6 123", "1 7 123"), ("212 4 0 0 2", "212 4 0 0 3"),
                         ("linear_0 linear_1", "missing linear_1"), ("Mul sig scale out", "Add sig scale out"),
                         ("Constant scale 0 1 1 1 1", "Constant scale 0 1 2 1 1"), ("scale out 4", "scale sig 4")):
            with self.subTest(old=old), self.assertRaises(ValueError):
                parse_spec(text=text.replace(old, new))

    def test_exact_arena_consumption(self):
        spec = parse_spec(text=synthetic_text())
        for data in (np.zeros(ARENA_FLOATS - 1, dtype=np.float32), np.zeros(ARENA_FLOATS + 1, dtype=np.float32),
                     np.zeros(ARENA_FLOATS, dtype=np.float64), np.full(ARENA_FLOATS, np.nan, dtype=np.float32)):
            with self.assertRaises(ValueError):
                FaceFittingGraph(spec=spec, weights=data)

    def test_dense_mapping_relu_sigmoid_scale(self):
        weights = np.zeros(ARENA_FLOATS, dtype=np.float32)
        cursor = 0
        for cin, cout in ((212, 512), (512, 512), (512, 442)):
            weights[cursor] = 2
            cursor += cin * cout
            weights[cursor] = 1
            cursor += cout
        weights[cursor] = 2
        model = FaceFittingGraph(spec=parse_spec(text=synthetic_text()), weights=weights)
        input_tensor = torch.zeros((1, 212))
        input_tensor[0, 0] = 1
        with torch.inference_mode():
            actual = model({"x": input_tensor})["out"]
        expected = torch.ones((1, 442))
        expected[0, 0] = torch.sigmoid(torch.tensor(15.0)) * 2
        torch.testing.assert_close(actual, expected, rtol=0, atol=0)

    def test_invalid_inputs(self):
        model = FaceFittingGraph(spec=parse_spec(text=synthetic_text()))
        for inputs in ({}, {"other": torch.zeros((1, 212))}, {"x": torch.zeros((212,))},
                       {"x": torch.zeros((2, 212))}, {"x": torch.zeros((1, 212), dtype=torch.float64)},
                       {"x": torch.full((1, 212), float("inf"))}):
            with self.assertRaises(ValueError):
                model(inputs)

    def test_bundle_roundtrip_and_artifact_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.pt"
            bundle = synthetic_bundle()
            torch.save(bundle, path)
            model = load_model(path=path, expected_sha256=hashlib.sha256(path.read_bytes()).hexdigest())
            self.assertFalse(model.training)
            self.assertTrue(all(value.device.type == "cpu" for value in model.state_dict().values()))
            self.assertTrue(all(torch.equal(value, model.state_dict()[name]) for name, value in bundle["state_dict"].items()))
            with self.assertRaises(ValueError):
                load_model(path=path, expected_sha256="0" * 64)

    def test_invalid_bundle_provenance_and_state(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.pt"
            original = synthetic_bundle()
            for key in ("format", "source_sha256", "bm_sha256", "local_only"):
                bundle = dict(original)
                bundle[key] = "wrong"
                torch.save(bundle, path)
                with self.assertRaises(ValueError):
                    load_model(path=path)
            bundle = copy.deepcopy(original)
            bundle["state_dict"]["scale"] = torch.tensor(float("nan"))
            torch.save(bundle, path)
            with self.assertRaises(ValueError):
                load_model(path=path)
            bundle = copy.deepcopy(original)
            bundle["state_dict"].pop("scale")
            torch.save(bundle, path)
            with self.assertRaises(RuntimeError):
                load_model(path=path)

    def test_cases_are_nonempty_deterministic_and_finite(self):
        cases, repeated = build_cases(), build_cases()
        self.assertEqual(len(cases), 11)
        for name, values in cases.items():
            self.assertEqual(values.shape, (1, 212))
            self.assertTrue(np.isfinite(values).all())
            np.testing.assert_array_equal(values, repeated[name])
        self.assertTrue(any(np.any(values) for values in cases.values()))

    def test_public_output_rejected(self):
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(ValueError):
            safe_directory(out=Path(directory))

    def test_missing_native_files_preserve_serializable_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            result = compare_native_case(directory=Path(directory), output_scale=256)
            self.assertFalse(result["passed"])
            self.assertIsNone(result["max_abs"])
            self.assertIn("reason", result)
            json.dumps(result, allow_nan=False)

    def test_malformed_native_outputs_preserve_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / "native-shape.json").write_text("[1,1,1,442]")
            (path / "input.f32").write_bytes(bytes(212 * 4))
            (path / "native-input.f32").write_bytes(bytes(212 * 4))
            (path / "pytorch-output.f32").write_bytes(bytes(442 * 4))
            for values in (np.zeros(441, dtype=np.float32), np.full(442, np.nan, dtype=np.float32)):
                values.tofile(path / "native-output.f32")
                result = compare_native_case(directory=path, output_scale=256)
                self.assertFalse(result["passed"])
                self.assertIsNone(result["max_abs"])
                json.dumps(result, allow_nan=False)
            np.zeros(442, dtype=np.float32).tofile(path / "native-output.f32")
            self.assertTrue(compare_native_case(directory=path, output_scale=256)["passed"])
            (path / "native-input.f32").write_bytes(b"wrong")
            self.assertFalse(compare_native_case(directory=path, output_scale=256)["passed"])
            (path / "native-input.f32").write_bytes(b"")
            (path / "input.f32").write_bytes(b"")
            self.assertFalse(compare_native_case(directory=path, output_scale=256)["passed"])

    def test_malformed_native_metadata_preserves_serializable_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            for shape in ("[NaN,1,1,442]", "[Infinity,1,1,442]", "null", "{}", "not-json", "[true,1,1,442]"):
                with self.subTest(shape=shape):
                    (path / "native-shape.json").write_text(shape)
                    result = compare_native_case(directory=path, output_scale=256)
                    self.assertFalse(result["passed"])
                    self.assertIsNone(result["shape"])
                    self.assertIsNone(result["max_abs"])
                    self.assertIn("reason", result)
                    json.dumps(result, allow_nan=False)

    def test_finite_extreme_native_values_do_not_overflow_metrics(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / "native-shape.json").write_text("[1,1,1,442]")
            (path / "input.f32").write_bytes(bytes(212 * 4))
            (path / "native-input.f32").write_bytes(bytes(212 * 4))
            limit = np.finfo(np.float32).max
            np.full(442, limit, dtype=np.float32).tofile(path / "native-output.f32")
            np.full(442, -limit, dtype=np.float32).tofile(path / "pytorch-output.f32")
            result = compare_native_case(directory=path, output_scale=256)
            self.assertFalse(result["passed"])
            self.assertTrue(np.isfinite(result["max_abs"]))
            self.assertIn("reason", result)
            json.dumps(result, allow_nan=False)
            for scale in (0, float("inf"), float("nan")):
                result = compare_native_case(directory=path, output_scale=scale)
                self.assertFalse(result["passed"])
                self.assertIsNone(result["max_abs"])
                json.dumps(result, allow_nan=False)


if __name__ == "__main__":
    torch.set_num_threads(1)
    unittest.main()
