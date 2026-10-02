"""Fail-closed evidence checks; no proprietary files or native library required."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

from espresso_integer_export import capture_case, compare, evaluate, run
from espresso_integer_test import graph
from espresso_integer_torch import EspressoIntegerGraph


class IntegerEvidenceTest(unittest.TestCase):
    def test_integer_gate_rejects_shape_empty_float_and_descriptor_mismatch(self):
        expected = np.array([[[[1, -2]]]], dtype=np.int8)
        good = {"actual": expected.astype(np.int64), "expected": expected,
                "descriptor": {"type": 1, "fraction": 6}, "raw": (1, 6)}
        self.assertTrue(compare(**good)["passed"])
        for changed in (
            {"actual": good["actual"].reshape(-1)},
            {"actual": good["actual"].astype(np.float64)},
            {"expected": expected.astype(np.float32)},
            {"raw": (1, 5)},
            {"actual": good["actual"] + 1},
            {"actual": np.zeros((0,), dtype=np.int64), "expected": np.zeros((0,), dtype=np.int8)},
        ):
            self.assertFalse(compare(**{**good, **changed})["passed"])

    def capture(self, *, directory, inputs=True, outputs=True, bad_bytes=False, raw=(1, 6)):
        text = graph(rows=["Eltwise add data data output 1 6 0"], shape=(1, 1, 1, 1))
        (directory / "000-espresso.graph.txt").write_text(text)
        (directory / "000-espresso.json").write_text(json.dumps({"index": 0, "kind": "espresso", "detail": "self=42"}))
        for index, kind, name, enabled in ((1, "espresso-input", "data", inputs), (2, "espresso-output", "output", outputs)):
            if not enabled:
                continue
            fields = f"self=42 name={name} inference=0 dims=1,1,1,1 raw={raw[0]},{raw[1]}"
            (directory / f"{index:03}-{kind}.json").write_text(json.dumps({"index": index, "kind": kind, "detail": fields}))
            (directory / f"{index:03}-{kind}.bin").write_bytes(b"" if bad_bytes else bytes([10]))
        return hashlib.sha256(text.encode()).hexdigest(), {"data": {"type": 1, "fraction": 6}, "output": {"type": 1, "fraction": 6}}

    def test_capture_requires_matching_graph_and_complete_nonempty_case(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            digest, descriptors = self.capture(directory=root)
            case = capture_case(capture=root, graph_digest=digest, descriptors=descriptors)
            self.assertEqual(case["inputs"]["data"][0].shape, (1, 1, 1, 1))
            self.assertEqual(len(case["files"]), 2)
            with self.assertRaisesRegex(ValueError, "no complete"):
                capture_case(capture=root, graph_digest="wrong", descriptors=descriptors)
        for inputs, outputs in ((False, True), (True, False)):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                digest, descriptors = self.capture(directory=root, inputs=inputs, outputs=outputs)
                with self.assertRaisesRegex(ValueError, "no complete"):
                    capture_case(capture=root, graph_digest=digest, descriptors=descriptors)

    def test_capture_rejects_truncated_tensor_and_wrong_raw_descriptor(self):
        for options, message in (({"bad_bytes": True}, "byte count"), ({"raw": (1, 5)}, "storage descriptor")):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                digest, descriptors = self.capture(directory=root, **options)
                with self.assertRaisesRegex(ValueError, message):
                    capture_case(capture=root, graph_digest=digest, descriptors=descriptors)

    def test_capture_rejects_duplicate_tensors(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            digest, descriptors = self.capture(directory=root)
            item = json.loads((root / "001-espresso-input.json").read_text())
            item["index"] = 3
            (root / "003-espresso-input.json").write_text(json.dumps(item))
            (root / "003-espresso-input.bin").write_bytes(bytes([10]))
            with self.assertRaisesRegex(ValueError, "duplicate"):
                capture_case(capture=root, graph_digest=digest, descriptors=descriptors)

    def test_output_cannot_escape_private_root(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / "public"
            with self.assertRaisesRegex(ValueError, "private ignored"):
                run(network=Path(directory), out=out, seeds=[17])
            self.assertFalse(out.exists())

    def test_prior_evidence_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            marker = root / "marker"
            marker.write_text("keep")
            with patch("espresso_integer_export.espresso_oracle.private_path", return_value=root):
                with self.assertRaisesRegex(ValueError, "fresh output"):
                    run(network=root, out=root, seeds=[17])
            self.assertEqual(marker.read_text(), "keep")

    def test_evaluate_rejects_wrong_shape_and_raw_before_oracle(self):
        model = EspressoIntegerGraph(text=graph(rows=["UpSampling up data output LINEAR"]), arena=b"")
        runner = {"model": model}
        for inputs in ({"data": (np.zeros((1, 4, 3, 2), dtype=np.int64), (1, 6))},
                       {"data": (np.zeros((1, 4, 4, 2), dtype=np.int64), (1, 5))}):
            with patch("espresso_integer_export.espresso_oracle.predict") as oracle:
                with self.assertRaisesRegex(ValueError, "profile|storage descriptor"):
                    evaluate(network=Path("unused"), inputs=inputs, runner=runner, out=Path("unused"))
                oracle.assert_not_called()


if __name__ == "__main__":
    unittest.main()
