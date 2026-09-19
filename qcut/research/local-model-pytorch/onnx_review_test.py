"""Independent phase4 review: authored fixtures and failure-durability regressions."""
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import warnings

import numpy as np
import onnx
from onnx import TensorProto, helper
import onnxruntime as ort
import torch

from espresso_torch import EspressoTorch
from onnx_batch import run_batch
from onnx_export import PRIVATE, TupleGraph, export
from onnx_infer import ONNXModel, digest, run
from onnx_replay import replay
from onnx_test import fixture
from onnx_tracking import ONNXTrackingFixed
from tracking_test import graph, pack12
from tracking_torch import TrackingGraph


class DataDependentFixture(torch.nn.Module):
    def forward(self, inputs):
        offset = 1 if bool((inputs["x"] > 0).all()) else -1
        return {"y": inputs["x"] + offset}


class ONNXReviewTests(unittest.TestCase):
    def setUp(self):
        torch.set_num_threads(1)
        PRIVATE.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="onnx-review-synthetic-", dir=PRIVATE)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def source(self):
        spec = {"layers": [{"type": "activation", "mode": 0, "name": "relu", "bottom": "x", "top": "y"}],
                "inputs": {"x": {"shape": [1, 1, 2, 2], "allowed_shapes": []}}, "outputs": ["y"], "shapes": {}}
        model, inputs = self.root / "authored.pt", self.root / "inputs.npz"
        torch.save(EspressoTorch(spec=spec).bundle(provenance={"synthetic_review": True}), model)
        np.savez(inputs, x=np.ones((1, 1, 2, 2), dtype=np.float32))
        return model, inputs

    def test_incomplete_batch_never_leaves_passed_checkpoint(self):
        model, inputs = self.source()
        manifest, out = self.root / "jobs.json", self.root / "exports"
        manifest.write_text(json.dumps([
            {"name": "first", "model": str(model), "input": str(inputs)},
            {"name": "missing-model-field", "input": str(inputs)},
        ]))
        try:
            run_batch(manifest=manifest, out=out)
        except (KeyError, ValueError):
            pass
        checkpoint = out / "batch-jobs-report.json"
        if checkpoint.exists():
            report = json.loads(checkpoint.read_text())
            self.assertFalse(report["passed"], f"incomplete {len(report['jobs'])}/2 jobs incorrectly marked passed")

    def test_missing_source_retains_export_failure_report(self):
        _, inputs = self.source()
        out = self.root / "missing-source-export"
        try:
            export(model_path=self.root / "missing.pt", input_path=inputs, out=out)
        except FileNotFoundError:
            pass
        self.assertTrue((out / "report.json").exists(), "source digest failed outside report-producing try block")
        self.assertNotEqual(json.loads((out / "report.json").read_text())["status"], "onnx-runtime-parity-passed")

    def test_malformed_contract_retains_replay_failure_report(self):
        contracts, out = self.root / "contracts", self.root / "replay"
        contract, _ = fixture(root=contracts / "a-valid", shape=(1,))
        case = contract.parent / "provided-fixture"
        case.mkdir()
        np.savez(case / "inputs.npz", x=np.ones(1, dtype=np.float32))
        np.savez(case / "pytorch.npz", y=np.ones(1, dtype=np.float32))
        invalid = contracts / "b-invalid"
        invalid.mkdir()
        (invalid / "contract.json").write_text("{truncated")
        try:
            replay(root=contracts, out=out)
        except json.JSONDecodeError:
            pass
        self.assertTrue((out / "report.json").exists(), "contract parse escaped per-model failure handling")
        self.assertFalse(json.loads((out / "report.json").read_text())["passed"])

    def test_nonfinite_runtime_output_cannot_write_success(self):
        contract, metadata = fixture(root=self.root / "nonfinite", shape=(1,))
        graph_model = helper.make_model(helper.make_graph(
            [helper.make_node("Div", ["x", "x"], ["y"])], "authored-zero-division",
            [helper.make_tensor_value_info("x", TensorProto.FLOAT, [1])],
            [helper.make_tensor_value_info("y", TensorProto.FLOAT, [1])]),
            opset_imports=[helper.make_opsetid("", 18)], ir_version=10)
        onnx.save(graph_model, contract.parent / "model.onnx")
        metadata["artifact_sha256"] = digest(path=contract.parent / "model.onnx")
        contract.write_text(json.dumps(metadata))
        inputs, out = self.root / "zero.npz", self.root / "nonfinite-result.npz"
        np.savez(inputs, x=np.zeros(1, dtype=np.float32))
        with self.assertRaisesRegex(ValueError, "finite"):
            run(contract=contract, inputs=inputs, out=out)
        self.assertFalse(out.exists())
        self.assertFalse(out.with_suffix(".json").exists())

    def test_actual_trace_mismatch_keeps_failed_contract_gated(self):
        model, inputs = self.source()
        with patch("onnx_export.export_model", return_value=(DataDependentFixture(), "authored-review")):
            result = export(model_path=model, input_path=inputs, out=self.root / "mismatched-export")
        self.assertEqual(result["status"], "onnx-runtime-parity-failed", result)
        self.assertEqual(len(result["cases"]), 4)
        self.assertTrue(result["cases"][0]["passed"])
        self.assertTrue(any(not case["passed"] for case in result["cases"][1:]))
        with self.assertRaisesRegex(ValueError, "not passed"):
            ONNXModel(contract_path=result["contract"])

    def test_missing_frozen_reference_fails_replay(self):
        contract, _ = fixture(root=self.root / "contracts/model", shape=(1,))
        case = contract.parent / "provided-fixture"
        case.mkdir()
        np.savez(case / "inputs.npz", x=np.ones(1, dtype=np.float32))
        report = replay(root=contract.parent.parent, out=self.root / "replay")
        self.assertFalse(report["passed"])
        self.assertIn("FileNotFoundError", report["models"][0]["error"])

    def test_one_lsb_integer_reference_mismatch_fails_replay(self):
        contract, _ = fixture(root=self.root / "contracts/model", shape=(1,), dtype="int16")
        case = contract.parent / "provided-fixture"
        case.mkdir()
        np.savez(case / "inputs.npz", x=np.array([2047], dtype=np.int16))
        np.savez(case / "pytorch.npz", y=np.array([2046], dtype=np.int16))
        report = replay(root=contract.parent.parent, out=self.root / "replay")
        self.assertFalse(report["passed"])
        self.assertEqual(report["models"][0]["cases"][0]["outputs"]["y"]["max_abs"], 1)

    def test_empty_replay_cannot_pass(self):
        report = replay(root=self.root / "empty", out=self.root / "replay")
        self.assertFalse(report["passed"])
        self.assertEqual(report["models"], [])

    def test_completed_batch_requires_nonzero_child_failure(self):
        model, inputs = self.source()
        invalid = self.root / "not-a-model.pt"
        torch.save({"format": "unsupported-review"}, invalid)
        manifest = self.root / "jobs.json"
        manifest.write_text(json.dumps([
            {"name": "valid", "model": str(model), "input": str(inputs)},
            {"name": "invalid", "model": str(invalid), "input": str(inputs)},
        ]))
        results = run_batch(manifest=manifest, out=self.root / "exports")
        self.assertEqual(len(results), 2)
        self.assertTrue(results[0]["passed"])
        self.assertFalse(results[1]["passed"])
        checkpoint = json.loads((self.root / "exports/batch-jobs-report.json").read_text())
        self.assertFalse(checkpoint["passed"])

    def check_fixed(self, *, rows, arena, values, name):
        original = TrackingGraph(text=graph(fixed=True, rows=rows), arena=arena).eval()
        adapter = ONNXTrackingFixed(original=original).eval()
        inputs = {"x": values}
        with torch.inference_mode():
            expected, adapted = original(inputs), adapter(inputs)
        self.assertEqual(set(expected), set(adapted))
        for key in expected:
            self.assertTrue(torch.equal(expected[key], adapted[key]), key)
        artifact = self.root / f"{name}.onnx"
        with warnings.catch_warnings(), torch.inference_mode():
            warnings.simplefilter("ignore")
            torch.onnx.export(TupleGraph(model=adapter, inputs=["x"], outputs=list(expected)), (values,), str(artifact),
                              dynamo=False, opset_version=18, input_names=["x"], output_names=list(expected))
        onnx.checker.check_model(onnx.load(artifact), full_check=True)
        options = ort.SessionOptions()
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
        options.intra_op_num_threads, options.inter_op_num_threads = 1, 1
        session = ort.InferenceSession(artifact.read_bytes(), sess_options=options, providers=["CPUExecutionProvider"])
        actual = session.run(list(expected), {"x": values.numpy()})
        for name, value in zip(expected, actual, strict=True):
            self.assertEqual(value.dtype, np.int16)
            np.testing.assert_array_equal(value, expected[name].numpy())
        return expected

    def test_fixed_conv_overflow_wrap_precedes_round_and_saturation(self):
        rows = ["DataV2 x 1 3 2 2 2 0 0",
                "Convolution c 2 1 1 1 1 0 0 1 0 2 0 4 0 2 0 x y"]
        arena = pack12(values=[2047, 2047, -2047, -2047]) + np.array([2147483647, -2147483648], dtype="<i4").tobytes() + struct.pack("<I", 7)
        values = torch.tensor([2047, -2047, 0, 1, -1, 2046] * 2, dtype=torch.int16).reshape(1, 2, 2, 3)
        result = self.check_fixed(rows=rows, arena=arena, values=values, name="overflow")
        self.assertEqual(result["y"][0, :, 0, 0].tolist(), [-2047, 2047])

    def test_fixed_depthwise_non_square_stride_pad_negative_half_ties(self):
        rows = ["DataV2 x 1 5 3 2 2 0 0",
                "DepthwiseSeparableConvolution c 2 3 3 2 2 1 1 1 0 2 2 4 2 2 0 x y"]
        weights = np.zeros((3, 3, 2), dtype=np.int16)
        weights[1, 1] = [1, -1]
        arena = pack12(values=weights) + np.array([0, 0], dtype="<i4").tobytes() + struct.pack("<I", 7)
        values = torch.arange(-15, 15, dtype=torch.int16).reshape(1, 2, 3, 5)
        result = self.check_fixed(rows=rows, arena=arena, values=values, name="depthwise")
        self.assertEqual(tuple(result["y"].shape), (1, 2, 2, 3))
        self.assertEqual(int(result["y"][0, 0, 0, 1]), -3)

    def test_fixed_concat_and_residual_mixed_shifts_all_outputs(self):
        rows = ["DataV2 x 1 3 2 2 2 3 0", "Concat join 2 x x cat 2 4",
                "Eltwise add x x sum 2 2 0"]
        values = torch.tensor([-2047, -3, -1, 0, 1, 2047] * 2, dtype=torch.int16).reshape(1, 2, 2, 3)
        result = self.check_fixed(rows=rows, arena=struct.pack("<I", 7), values=values, name="branches")
        self.assertEqual(set(result), {"cat", "sum"})
        self.assertTrue(torch.equal(result["sum"], values))


if __name__ == "__main__":
    unittest.main()
