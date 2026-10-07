from pathlib import Path
import hashlib
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import align160_infer as owned


def heads():
    return {name: np.ones((1, 1, 1, count), np.float32) for name, count in owned.HEAD_CHANNELS.items()}


class HeadInferenceTests(unittest.TestCase):
    def test_signed_input_shape_type_and_ownership(self):
        value = np.arange(76800).astype(np.int8).reshape(1, 160, 160, 3)
        np.testing.assert_array_equal(owned.validate_tensor(tensor=value), value)
        sliced = value[:, :, ::-1]
        self.assertTrue(owned.validate_tensor(tensor=sliced).flags.c_contiguous)
        for bad in (value.astype(np.uint8), value.astype(np.int64), value[0], value[:, :120], value.tolist()):
            with self.subTest(dtype=type(bad)), self.assertRaises(ValueError):
                owned.validate_tensor(tensor=bad)

    def test_head_schema_rejects_missing_extra_dtype_shape_and_nonfinite(self):
        for error in ("missing", "extra", "dtype", "shape", "nan", "inf"):
            values = heads()
            if error == "missing":
                values.pop("prob")
            if error == "extra":
                values["other"] = np.ones((1, 1, 1, 1), np.float32)
            if error == "dtype":
                values["prob"] = values["prob"].astype(np.float64)
            if error == "shape":
                values["prob"] = values["prob"].reshape(5)
            if error in ("nan", "inf"):
                values["prob"][0, 0, 0, 0] = float(error)
            with self.subTest(error=error), self.assertRaises(ValueError):
                owned.validate_heads(heads=values)

    def test_exact_outputs_pass_with_no_mismatches(self):
        report = owned.compare_heads(actual=heads(), expected=heads())
        self.assertEqual(sum(row["elements"] for row in report.values()), 325)
        self.assertTrue(all(row["exact"] and row["passed"] for row in report.values()))

    def test_fixed_absolute_relative_gates_detect_corruption_in_every_head(self):
        for name in owned.HEAD_CHANNELS:
            actual, expected = heads(), heads()
            actual[name][0, 0, 0, 0] += .01
            report = owned.compare_heads(actual=actual, expected=expected)
            self.assertFalse(report[name]["passed"])
            self.assertEqual(report[name]["mismatches"], 1)
            self.assertEqual((report[name]["atol"], report[name]["rtol"], report[name]["relative_limit"]), owned.GATES[name])

    def test_probability_relative_gate_catches_tiny_denominator_error(self):
        actual, expected = heads(), heads()
        expected["prob"].fill(1e-9)
        actual["prob"].fill(2e-9)
        self.assertFalse(owned.compare_heads(actual=actual, expected=expected)["prob"]["passed"])
        expected["prob"].fill(0)
        actual["prob"].fill(0)
        self.assertTrue(owned.compare_heads(actual=actual, expected=expected)["prob"]["passed"])

    def test_tiny_visible_and_pose_rounding_is_within_existing_gates(self):
        actual, expected = heads(), heads()
        for name in owned.HEAD_CHANNELS:
            actual[name] += np.float32(1e-7)
        self.assertTrue(all(row["passed"] for row in owned.compare_heads(actual=actual, expected=expected).values()))

    def test_wrong_model_is_rejected_before_runtime_session(self):
        model = Mock()
        model.read_bytes.return_value = b"wrong model"
        with self.assertRaises(ValueError):
            owned.infer(tensor=np.zeros((1, 160, 160, 3), np.int8), model=model)

    def test_cpu_metadata_and_signed_int64_feed_are_checked(self):
        import onnxruntime as ort
        for error in (None, "input", "dtype", "outputs", "shape", "provider", "runtime"):
            model, runner = Mock(), Mock()
            model.read_bytes.return_value = b"fixture"
            source = SimpleNamespace(name="data", shape=[1, 160, 160, 3], type="tensor(int64)")
            outputs = [SimpleNamespace(name=name, shape=[1, 1, 1, count], type="tensor(float)") for name, count in owned.HEAD_CHANNELS.items()]
            if error == "input":
                source.shape = [1, 3, 160, 160]
            if error == "dtype":
                source.type = "tensor(float)"
            if error == "outputs":
                outputs.reverse()
            if error == "shape":
                outputs[0].shape = [1, 212]
            runner.get_inputs.return_value, runner.get_outputs.return_value = [source], outputs
            runner.get_providers.return_value = ["CoreMLExecutionProvider"] if error == "provider" else ["CPUExecutionProvider"]
            runner.run.return_value = list(heads().values())
            tensor = np.full((1, 160, 160, 3), -128, np.int8)
            with self.subTest(error=error), patch.object(owned, "MODEL_SHA256", hashlib.sha256(b"fixture").hexdigest()), patch.object(ort, "InferenceSession", return_value=runner), patch.object(ort, "__version__", "1.23.0" if error == "runtime" else "1.22.1"):
                if error:
                    with self.assertRaises(ValueError):
                        owned.infer(tensor=tensor, model=model)
                    runner.run.assert_not_called()
                    continue
                owned.infer(tensor=tensor, model=model)
                feed = runner.run.call_args.args[1]["data"]
                self.assertEqual(feed.dtype, np.int64)
                np.testing.assert_array_equal(feed, tensor)

    def test_private_library_and_reused_output_are_rejected_without_writes(self):
        with tempfile.TemporaryDirectory(dir=owned.ROOT / "output") as directory:
            root = Path(directory)
            source = root / "prepared.npz"
            np.savez(source, tensor=np.zeros((1, 160, 160, 3), np.int8))
            output = root / "heads"
            with patch.object(owned, "infer", return_value=heads()), patch.object(owned, "native_images", return_value={"private_native_images": ["liblens.dylib"]}), self.assertRaises(ValueError):
                owned.run(prepared=source, model=Path("unused"), output=output)
            self.assertFalse(output.exists())
            output.mkdir()
            with self.assertRaises(ValueError):
                owned.run(prepared=source, model=Path("unused"), output=output)


if __name__ == "__main__":
    unittest.main()
