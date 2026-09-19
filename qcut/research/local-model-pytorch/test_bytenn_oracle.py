"""Authored tensor and protocol fixtures; no vendor weights required."""
import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from bytenn_oracle import RUNTIME_SHA256, native_shape, predict, private_path, read_outputs


class ByteNNOracleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.x = np.arange(24, dtype=np.float32).reshape(1, 2, 3, 4)
        self.x.transpose(0, 2, 3, 1).tofile(self.root / "echo.f32")
        (self.x + 1).transpose(0, 2, 3, 1).tofile(self.root / "output.f32")
        self.response = {"version": 1, "forced_cpu": True, "forward_type": 0, "runtime_sha256": RUNTIME_SHA256,
                         "graph_sha256": "a" * 64, "arena_sha256": "b" * 64,
                         "inputs": [{"name": "x", "file": "echo.f32", "shape_nwhc": [1, 4, 3, 2]}],
                         "outputs": [{"name": "y", "file": "output.f32", "shape_nwhc": [1, 4, 3, 2]}]}

    def tearDown(self):
        self.temp.cleanup()

    def read(self, response=None):
        return read_outputs(out=self.root, response=self.response if response is None else response,
                            inputs={"x": self.x}, output_shapes={"y": self.x.shape}, graph_sha="a" * 64, arena_sha="b" * 64)

    def test_non_square_layout(self):
        self.assertEqual(native_shape(nchw=self.x.shape), [1, 4, 3, 2])
        np.testing.assert_array_equal(self.read()["y"].numpy(), self.x + 1)

    def test_shape_limits(self):
        for shape in ((1, 3, 0, 4), (1, 3, True, 4), (1, 3, 4.0, 4), (1, 3, 4), (16384,) * 4):
            with self.subTest(shape=shape), self.assertRaises(ValueError):
                native_shape(nchw=shape)

    def test_runtime_and_backend_guard(self):
        for key, value in (("version", 2), ("forced_cpu", False), ("forward_type", 1), ("runtime_sha256", "wrong"),
                           ("graph_sha256", "wrong"), ("arena_sha256", "wrong")):
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.read({**self.response, key: value})

    def test_empty_or_duplicate_outputs(self):
        for outputs in ([], self.response["outputs"] * 2):
            with self.assertRaises(ValueError):
                self.read({**self.response, "outputs": outputs})

    def test_descriptor_schema(self):
        for bad in ([], {**self.response, "outputs": "y"}, {**self.response, "outputs": ["y"]}):
            with self.assertRaises(ValueError):
                self.read(bad)

    def test_output_shape_and_byte_length(self):
        bad = copy.deepcopy(self.response)
        bad["outputs"][0]["shape_nwhc"] = [1, 3, 4, 2]
        with self.assertRaises(ValueError):
            self.read(bad)
        (self.root / "output.f32").write_bytes(bytes(4))
        with self.assertRaises(ValueError):
            self.read()

    def test_path_escape_and_symlink(self):
        for name in ("../outside.f32", "/tmp/outside.f32"):
            bad = copy.deepcopy(self.response)
            bad["outputs"][0]["file"] = name
            with self.assertRaises(ValueError):
                self.read(bad)
        (self.root / "link.f32").symlink_to(self.root / "output.f32")
        bad["outputs"][0]["file"] = "link.f32"
        with self.assertRaises(ValueError):
            self.read(bad)

    def test_nonfinite_output(self):
        np.full(24, np.nan, dtype=np.float32).tofile(self.root / "output.f32")
        with self.assertRaises(ValueError):
            self.read()

    def test_input_echo_including_signed_zero(self):
        echo = self.x.copy()
        echo[0, 0, 0, 0] = -0.0
        echo.transpose(0, 2, 3, 1).tofile(self.root / "echo.f32")
        with self.assertRaises(ValueError):
            self.read()

    def test_private_output_boundary(self):
        with patch("bytenn_oracle.PRIVATE", self.root):
            self.assertEqual(private_path(path=self.root / "case"), self.root / "case")
            for path in (self.root, self.root / "../outside"):
                with self.assertRaises(ValueError):
                    private_path(path=path)

    def test_no_stale_native_evidence(self):
        case = self.root / "case"
        case.mkdir()
        (case / "stale").write_bytes(b"synthetic")
        with patch("bytenn_oracle.PRIVATE", self.root), self.assertRaisesRegex(ValueError, "fresh"):
            predict(graph=None, arena=None, inputs={"x": self.x}, output_shapes={"y": self.x.shape}, out=case)

    def test_empty_maps_and_nonfinite_rejected_before_native(self):
        with patch("bytenn_oracle.PRIVATE", self.root):
            for inputs, outputs in (({}, {"y": self.x.shape}), ({"x": self.x}, {}),
                                    ({"x": self.x.astype(np.float64)}, {"y": self.x.shape})):
                with self.assertRaises(ValueError):
                    predict(graph=None, arena=None, inputs=inputs, output_shapes=outputs, out=self.root / "case")

    def test_native_failure_gets_durable_report(self):
        for name in ("graph", "arena", "binary", "library"):
            (self.root / name).write_bytes(b"synthetic")
        out = self.root / "case"
        with patch("bytenn_oracle.PRIVATE", self.root), patch("bytenn_oracle.sha256", return_value=RUNTIME_SHA256), \
                patch("bytenn_oracle.subprocess.run", side_effect=subprocess.TimeoutExpired("synthetic", 1)), \
                self.assertRaises(subprocess.TimeoutExpired):
            predict(graph=self.root / "graph", arena=self.root / "arena", inputs={"x": self.x},
                    output_shapes={"y": self.x.shape}, out=out, binary=self.root / "binary", library=self.root / "library")
        self.assertEqual(json.loads((out / "invocation.json").read_text())["status"], "native-failed")


if __name__ == "__main__":
    unittest.main()
