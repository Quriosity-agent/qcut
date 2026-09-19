"""Authored ONNX contract and export fixtures, without vendor assets."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import numpy as np
import onnx
from onnx import TensorProto, helper
import torch

from espresso_torch import EspressoTorch
from onnx_export import compare, export
from onnx_infer import FORMAT, ONNXModel, digest, read_npz, run, validate_schema
from onnx_replay import replay


def fixture(*, root, shape=(1, 3), dtype="float32"):
    code = TensorProto.FLOAT if dtype == "float32" else TensorProto.INT16
    graph = helper.make_graph([helper.make_node("Identity", ["x"], ["y"])], "authored-identity",
                              [helper.make_tensor_value_info("x", code, list(shape))],
                              [helper.make_tensor_value_info("y", code, list(shape))])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 18)], ir_version=10)
    root.mkdir(parents=True, exist_ok=True)
    artifact = root / "model.onnx"
    onnx.save(model, artifact)
    schema = {"shape": list(shape), "dtype": dtype}
    metadata = {"format": FORMAT, "local_only": True, "status": "onnx-runtime-parity-passed", "custom_operators": [],
                "external_data": False, "artifact": artifact.name, "artifact_sha256": digest(path=artifact),
                "inputs": {"x": schema}, "outputs": {"y": dict(schema)}}
    contract = root / "contract.json"
    contract.write_text(json.dumps(metadata))
    return contract, metadata


class ONNXContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.contract, self.metadata = fixture(root=self.root)

    def tearDown(self):
        self.temp.cleanup()

    def save(self):
        self.contract.write_text(json.dumps(self.metadata))

    def test_identity_cpu(self):
        model = ONNXModel(contract_path=self.contract)
        values = np.array([[0, -0., 3]], dtype=np.float32)
        self.assertEqual(model({"x": values})["y"].tobytes(), values.tobytes())
        self.assertEqual(model.session.get_providers(), ["CPUExecutionProvider"])

    def test_scalar_preserves_rank(self):
        contract, _ = fixture(root=self.root / "scalar", shape=())
        result = ONNXModel(contract_path=contract)({"x": np.array(2, dtype=np.float32)})
        self.assertEqual(result["y"].shape, ())

    def test_int16_preserves_bits(self):
        contract, _ = fixture(root=self.root / "int", dtype="int16")
        values = np.array([[-2047, 0, 2047]], dtype=np.int16)
        np.testing.assert_array_equal(ONNXModel(contract_path=contract)({"x": values})["y"], values)

    def test_wrong_inputs(self):
        model = ONNXModel(contract_path=self.contract)
        for values in ({}, {"x": np.ones((3,), dtype=np.float32)}, {"x": np.ones((1, 3), dtype=np.float64)},
                       {"x": np.full((1, 3), np.nan, dtype=np.float32)}, {"wrong": np.ones((1, 3), dtype=np.float32)}):
            with self.subTest(values=values), self.assertRaises(ValueError):
                model(values)

    def test_candidate_rejected(self):
        self.metadata["status"] = "onnx-runtime-parity-failed"
        self.save()
        with self.assertRaisesRegex(ValueError, "not passed"):
            ONNXModel(contract_path=self.contract)
        ONNXModel(contract_path=self.contract, allow_unverified=True)

    def test_corrupt_digest(self):
        self.metadata["artifact_sha256"] = "0" * 64
        self.save()
        with self.assertRaisesRegex(ValueError, "digest"):
            ONNXModel(contract_path=self.contract)

    def test_path_escape(self):
        for name in ("../model.onnx", str(self.root / "model.onnx")):
            self.metadata["artifact"] = name
            self.save()
            with self.assertRaises(ValueError):
                ONNXModel(contract_path=self.contract)

    def test_symlink_rejected(self):
        (self.root / "link.onnx").symlink_to(self.root / "model.onnx")
        self.metadata["artifact"] = "link.onnx"
        self.save()
        with self.assertRaisesRegex(ValueError, "boundary"):
            ONNXModel(contract_path=self.contract)

    def test_unexpected_graph_schema(self):
        for key in ("inputs", "outputs"):
            original = self.metadata[key]
            self.metadata[key] = {"x" if key == "inputs" else "y": {"shape": [1, 4], "dtype": "float32"}}
            self.save()
            with self.assertRaisesRegex(ValueError, "schema"):
                ONNXModel(contract_path=self.contract)
            self.metadata[key] = original

    def test_custom_external_contract_rejected(self):
        for key, value in (("external_data", True), ("custom_operators", ["org.pytorch"]), ("local_only", False)):
            original = self.metadata[key]
            self.metadata[key] = value
            self.save()
            with self.assertRaises(ValueError):
                ONNXModel(contract_path=self.contract)
            self.metadata[key] = original

    def test_schema_bounds(self):
        for shape in ([0], [-1], [True], [65536], [16384, 16384, 16384], [1] * 9):
            with self.subTest(shape=shape), self.assertRaises(ValueError):
                validate_schema(schema={"x": {"shape": shape, "dtype": "float32"}})

    def test_range_validation(self):
        self.metadata["inputs"]["x"]["range"] = [-1, 1]
        self.save()
        model = ONNXModel(contract_path=self.contract)
        with self.assertRaisesRegex(ValueError, "range"):
            model({"x": np.ones((1, 3), dtype=np.float32) * 2})
        for limits in ([], [2, 1], [0, float("inf")], "bad"):
            with self.assertRaises(ValueError):
                validate_schema(schema={"x": {"shape": [1], "dtype": "float32", "range": limits}})

    def test_npz_rejects_invalid_types(self):
        for value in (np.array([{}], dtype=object), np.array([1], dtype=np.float64), np.array([np.inf], dtype=np.float32)):
            np.savez(self.root / "i.npz", x=value)
            with self.assertRaises(ValueError):
                read_npz(path=self.root / "i.npz")

    def test_npz_rejects_duplicate_members(self):
        with zipfile.ZipFile(self.root / "dup.npz", "w") as archive:
            archive.writestr("x.npy", b"a")
            archive.writestr("x.npy", b"b")
        with self.assertRaisesRegex(ValueError, "duplicate"):
            read_npz(path=self.root / "dup.npz")

    def test_cli_io_roundtrip_and_no_overwrite(self):
        values = np.ones((1, 3), dtype=np.float32)
        inputs, out = self.root / "i.npz", self.root / "o.npz"
        np.savez(inputs, x=values)
        self.assertTrue(run(contract=self.contract, inputs=inputs, out=out)["passed"])
        with self.assertRaises(ValueError):
            run(contract=self.contract, inputs=inputs, out=out)
        with self.assertRaises(ValueError):
            run(contract=self.contract, inputs=inputs, out=inputs)

    def test_integer_comparison_requires_exact(self):
        result = compare(actual={"x": np.array([2046], dtype=np.int16)}, expected={"x": torch.tensor([2047], dtype=torch.int16)})
        self.assertFalse(result["x"]["passed"])


class ExportTests(unittest.TestCase):
    def test_actual_synthetic_export_and_target_replay(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            spec = {"layers": [{"type": "activation", "mode": 0, "name": "relu", "bottom": "x", "top": "y"}],
                    "inputs": {"x": {"shape": [1, 1, 2, 2], "allowed_shapes": []}}, "outputs": ["y"], "shapes": {}}
            torch.save(EspressoTorch(spec=spec).bundle(provenance={"synthetic": True}), root / "m.pt")
            np.savez(root / "i.npz", x=np.ones((1, 1, 2, 2), dtype=np.float32))
            with patch("onnx_export.PRIVATE", root):
                report = export(model_path=root / "m.pt", input_path=root / "i.npz", out=root / "exports/model")
            self.assertEqual(report["status"], "onnx-runtime-parity-passed", report)
            self.assertEqual(len(report["cases"]), 4)
            target = replay(root=root / "exports", out=root / "target")
            self.assertTrue(target["passed"])

    def test_no_torch_requirement(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with patch("onnx_replay.importlib.util.find_spec", return_value=object()), self.assertRaisesRegex(ValueError, "without torch"):
                replay(root=root, out=root.parent / "unused-onnx-test", require_no_torch=True)


if __name__ == "__main__":
    torch.set_num_threads(1)
    unittest.main()
