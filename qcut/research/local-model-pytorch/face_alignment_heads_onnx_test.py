"""Standalone original-output validation with self-authored float buffers."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

import espresso_oracle
import espresso_onnx_runtime
from espresso_graph import analyze
from face_alignment_heads_onnx_verify import compare_integer, no_torch, original_outputs, run


class StandaloneAlignmentTest(unittest.TestCase):
    def test_offline_cpu_session_factory_does_not_change_thread_budget(self):
        with patch("espresso_onnx_runtime.onnxruntime.SessionOptions") as options, patch(
                "espresso_onnx_runtime.onnxruntime.InferenceSession") as create:
            actual = espresso_onnx_runtime.session(path=Path("model.onnx"))
            self.assertIs(actual, create.return_value)
            self.assertEqual(options.return_value.intra_op_num_threads, 1)
            create.assert_called_once_with("model.onnx", sess_options=options.return_value, providers=["CPUExecutionProvider"])

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.graph = analyze("1 1\ndata 1 1 1 2 4 0\nSigmoid act data output 4 0\n")
        self.value = np.array([[[[0.25, 0.75]]]], np.float32)
        self.value.tofile(self.root / "output.raw")
        self.response = {"version": 2, "runtime_sha256": espresso_oracle.RUNTIME_SHA256,
                         "graph_sha256": "graph", "arena_sha256": "arena",
                         "outputs": [{"name": "output", "file": "output.raw", "raw": [4, 0], "dims_nwhc": [1, 1, 1, 2]}]}

    def read_outputs(self, *, response):
        (self.root / "response.json").write_text(json.dumps(response))
        return original_outputs(directory=self.root, graph=self.graph, graph_hash="graph", arena_hash="arena")

    def test_original_outputs_keep_float32_values(self):
        actual = self.read_outputs(response=self.response)
        np.testing.assert_array_equal(actual["output"][0], self.value)
        self.assertEqual(actual["output"][1], (4, 0))

    def test_response_provenance_and_complete_output_set(self):
        for key, value in (("version", 1), ("runtime_sha256", "bad"), ("graph_sha256", "bad"),
                           ("arena_sha256", "bad"), ("outputs", []), ("outputs", None),
                           ("outputs", self.response["outputs"] * 2)):
            with self.assertRaises(ValueError):
                self.read_outputs(response={**self.response, key: value})
        with self.assertRaises(ValueError):
            self.read_outputs(response=[])

    def test_wrong_output_name_shape_storage_and_path(self):
        for key, value in (("name", "missing"), ("dims_nwhc", [1, 2, 1, 2]), ("raw", [2, 0]),
                           ("file", "../output.raw"), ("file", "/tmp/output.raw"),
                           ("file", ""), ("file", None)):
            response = copy.deepcopy(self.response)
            response["outputs"][0][key] = value
            with self.assertRaises(ValueError):
                self.read_outputs(response=response)

    def test_wrong_output_bytes_and_nonfinite_values(self):
        for value in (np.zeros(1, np.float32), np.full(2, np.inf, np.float32)):
            value.tofile(self.root / "output.raw")
            with self.assertRaises(ValueError):
                self.read_outputs(response=self.response)

    def test_integer_comparison_requires_exact_signed_storage(self):
        expected = np.array([[[[-128, 127]]]], np.int8)
        args = {"actual": expected.astype(np.int64), "expected": expected,
                "descriptor": {"type": 1, "fraction": 6}, "raw": (1, 6)}
        self.assertTrue(compare_integer(**args)["passed"])
        for changes in ({"actual": expected.astype(np.int64) + 1}, {"actual": expected},
                        {"actual": expected.reshape(-1)}, {"raw": (1, 5)},
                        {"expected": expected.astype(np.float32)}):
            self.assertFalse(compare_integer(**{**args, **changes})["passed"])

    def test_installed_or_imported_torch_rejected(self):
        with patch("importlib.util.find_spec", return_value=object()), self.assertRaises(ValueError):
            no_torch()
        with patch("importlib.util.find_spec", return_value=None), patch.dict("sys.modules", {"torch.example": None}), self.assertRaises(ValueError):
            no_torch()

    def test_bad_summary_does_not_write_standalone_evidence(self):
        output = self.root / "standalone.json"
        with patch("face_alignment_heads_onnx_verify.no_torch"), patch("espresso_oracle.private_path", side_effect=lambda *, path: Path(path)):
            for summary in ([], {}, {"passed": 1}):
                (self.root / "summary.json").write_text(json.dumps(summary))
                with self.assertRaises(ValueError):
                    run(root=self.root, networks=self.root, output=output)
                self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
