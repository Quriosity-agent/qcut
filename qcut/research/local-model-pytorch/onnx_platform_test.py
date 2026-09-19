"""Portable runtime/security regressions; no PyTorch, vendor library or private data."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile

import numpy as np
import onnx
from onnx import helper

from onnx_infer import ONNXModel, read_npz, run, validate_schema
from onnx_platform_checks import cli_roundtrip, compare, qualify_fixture, reload_and_reset
from onnx_platform_fixtures import (conv_reference, descriptor, fixtures, graph_model, integer_fixture,
                                    linear_resize_reference, recurrent_fixture, scalar_fixture, write_fixture)


def identity_fixture():
    model = graph_model(name="authored-identity", nodes=[helper.make_node("Identity", ["input"], ["output"])],
                        inputs=[descriptor(name="input", shape=[1, 4])], outputs=[descriptor(name="output", shape=[1, 4])])
    values = np.array([[0, -0., 0.25, -0.5]], dtype=np.float32)
    return {"name": "identity", "model": model, "feedback": {},
            "cases": [{"name": "fixture", "inputs": {"input": values}, "expected": {"output": values.copy()}}]}


class PlatformContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.fixture = identity_fixture()
        self.bundle = self.root / "bundle"
        qualify_fixture(fixture=self.fixture, root=self.bundle)
        self.contract = self.bundle / "contract.json"
        self.metadata = json.loads(self.contract.read_text(encoding="utf-8"))

    def tearDown(self):
        self.temp.cleanup()

    def save(self):
        self.contract.write_text(json.dumps(self.metadata), encoding="utf-8")

    def test_candidate_gate_is_default_closed(self):
        for status in ("candidate", "onnx-runtime-parity-failed", None):
            with self.subTest(status=status):
                self.metadata["status"] = status
                self.save()
                with self.assertRaisesRegex(ValueError, "not passed"):
                    ONNXModel(contract_path=self.contract)
                ONNXModel(contract_path=self.contract, allow_unverified=True)

    def test_model_digest_mismatch(self):
        self.metadata["artifact_sha256"] = "0" * 64
        self.save()
        with self.assertRaisesRegex(ValueError, "digest"):
            ONNXModel(contract_path=self.contract)

    def test_relative_and_absolute_path_escape(self):
        for path in ("../model.onnx", "sub/model.onnx", str(self.bundle / "model.onnx")):
            with self.subTest(path=path):
                self.metadata["artifact"] = path
                self.save()
                with self.assertRaisesRegex(ValueError, "adjacent"):
                    ONNXModel(contract_path=self.contract)

    def test_symlink_boundary_guard(self):
        with patch.object(Path, "is_symlink", return_value=True), self.assertRaisesRegex(ValueError, "boundary"):
            ONNXModel(contract_path=self.contract)

    def test_model_file_corruption(self):
        artifact = self.bundle / "model.onnx"
        artifact.write_bytes(artifact.read_bytes() + b"corrupt")
        with self.assertRaisesRegex(ValueError, "digest"):
            ONNXModel(contract_path=self.contract)

    def test_reject_external_and_custom_contracts(self):
        for key, value in (("external_data", True), ("custom_operators", ["vendor.foo"]), ("local_only", False)):
            original = self.metadata[key]
            with self.subTest(key=key):
                self.metadata[key] = value
                self.save()
                with self.assertRaisesRegex(ValueError, "unsupported"):
                    ONNXModel(contract_path=self.contract)
            self.metadata[key] = original

    def test_graph_names_and_schema_are_verified(self):
        for key in ("inputs", "outputs"):
            original = self.metadata[key]
            with self.subTest(key=key):
                self.metadata[key] = {"not_the_graph_name": {"dtype": "float32", "shape": [1, 4]}}
                self.save()
                with self.assertRaisesRegex(ValueError, "names"):
                    ONNXModel(contract_path=self.contract)
                self.metadata[key] = {name: {"dtype": "float32", "shape": [1, 5]} for name in original}
                self.save()
                with self.assertRaisesRegex(ValueError, "schema"):
                    ONNXModel(contract_path=self.contract)
            self.metadata[key] = original

    def test_input_names_shape_dtype_and_finite(self):
        model = ONNXModel(contract_path=self.contract)
        for value in ({}, {"unknown": np.zeros((1, 4), dtype=np.float32)},
                      {"input": np.zeros((4,), dtype=np.float32)}, {"input": np.zeros((1, 4), dtype=np.float64)},
                      {"input": np.full((1, 4), np.nan, dtype=np.float32)},
                      {"input": np.full((1, 4), np.inf, dtype=np.float32)}):
            with self.subTest(names=list(value)), self.assertRaises(ValueError):
                model(value)

    def test_thread_and_bypass_parameters_are_strict(self):
        for threads in (True, 0, -1, 65, 1.5):
            with self.subTest(threads=threads), self.assertRaises(ValueError):
                ONNXModel(contract_path=self.contract, threads=threads)
        for bypass in (1, "true", None):
            with self.subTest(bypass=bypass), self.assertRaises(ValueError):
                ONNXModel(contract_path=self.contract, allow_unverified=bypass)

    def test_range_guard(self):
        self.metadata["inputs"]["input"]["range"] = [-1, 1]
        self.save()
        with self.assertRaisesRegex(ValueError, "range"):
            ONNXModel(contract_path=self.contract)({"input": np.full((1, 4), 2, dtype=np.float32)})

    def test_schema_allocation_limits(self):
        for shape in ([True], [0], [-1], [16385], [1] * 9, [16384] * 4):
            with self.subTest(shape=shape), self.assertRaises(ValueError):
                validate_schema(schema={"input": {"shape": shape, "dtype": "float32"}})

    def test_noncontiguous_input(self):
        values = np.arange(8, dtype=np.float32).reshape(1, 8)[:, ::2]
        self.assertFalse(values.flags.c_contiguous)
        actual = ONNXModel(contract_path=self.contract)({"input": values})
        np.testing.assert_array_equal(actual["output"], values)

    def test_separate_process_roundtrip(self):
        self.assertTrue(cli_roundtrip(fixture=self.fixture, root=self.bundle)["passed"])

    def test_no_output_or_input_overwrite(self):
        source, output = self.bundle / "fixture/inputs.npz", self.root / "out.npz"
        run(contract=self.contract, inputs=source, out=output)
        with self.assertRaisesRegex(ValueError, "overwrite"):
            run(contract=self.contract, inputs=source, out=output)
        with self.assertRaisesRegex(ValueError, "separate"):
            run(contract=self.contract, inputs=source, out=source)

    def test_unicode_and_spaced_paths(self):
        bundle = self.root / "path with spaces \u6d4b\u8bd5"
        self.assertTrue(qualify_fixture(fixture=self.fixture, root=bundle)["passed"])
        self.assertTrue(cli_roundtrip(fixture=self.fixture, root=bundle)["passed"])


class PlatformNumericTests(unittest.TestCase):
    def test_all_authored_graphs_and_reloads(self):
        with tempfile.TemporaryDirectory() as temp:
            for fixture in fixtures():
                with self.subTest(name=fixture["name"]):
                    root = Path(temp) / fixture["name"]
                    self.assertTrue(qualify_fixture(fixture=fixture, root=root)["passed"])
                    self.assertTrue(reload_and_reset(fixture=fixture, root=root)["passed"])

    def test_only_standard_inlined_graphs(self):
        for fixture in fixtures():
            with self.subTest(name=fixture["name"]):
                self.assertFalse(fixture["model"].functions)
                self.assertTrue(all(node.domain in ("", "ai.onnx") for node in fixture["model"].graph.node))
                self.assertTrue(all(not item.external_data for item in fixture["model"].graph.initializer))
                onnx.checker.check_model(fixture["model"], full_check=True)

    def test_convolution_oracle_known_kernel(self):
        result = conv_reference(image=np.arange(9, dtype=np.float32).reshape(1, 1, 3, 3),
                                weights=np.ones((1, 1, 2, 2), dtype=np.float32), bias=np.array([1], dtype=np.float32))
        np.testing.assert_array_equal(result, np.array([[[[9, 13], [21, 25]]]], dtype=np.float32))

    def test_bilinear_oracle_known_ramp(self):
        result = linear_resize_reference(image=np.array([[[[0, 2], [4, 6]]]], dtype=np.float32), height=3, width=3)
        np.testing.assert_array_equal(result, np.array([[[[0, 1, 2], [2, 3, 4], [4, 5, 6]]]], dtype=np.float32))

    def test_integer_fixture_exercises_both_saturation_limits(self):
        arrays = [case["expected"]["quantized"] for case in integer_fixture()["cases"]]
        combined = np.concatenate(arrays)
        self.assertEqual(int(combined.min()), -32768)
        self.assertEqual(int(combined.max()), 32767)
        self.assertEqual(arrays[1][1, 0], 2)
        self.assertEqual(arrays[1][0, 2], -1)

    def test_integer_one_bit_error_fails(self):
        result = compare(actual={"x": np.array([30000], dtype=np.int16)}, expected={"x": np.array([30001], dtype=np.int16)})
        self.assertFalse(result["x"]["passed"])

    def test_scalar_signed_zero_is_exact(self):
        result = compare(actual={"x": np.array(0., dtype=np.float32)}, expected={"x": np.array(-0., dtype=np.float32)})
        self.assertFalse(result["x"]["passed"])

    def test_nonfinite_output_fails(self):
        fixture = scalar_fixture()
        fixture["model"] = graph_model(name="not-finite", nodes=[helper.make_node("Div", ["value", "value"], ["result"])],
                                       inputs=[descriptor(name="value", shape=[])], outputs=[descriptor(name="result", shape=[])])
        with tempfile.TemporaryDirectory() as temp:
            contract = write_fixture(fixture=fixture, root=Path(temp) / "fixture")
            with self.assertRaisesRegex(ValueError, "finite"):
                ONNXModel(contract_path=contract, allow_unverified=True)({"value": np.array(0, dtype=np.float32)})

    def test_bad_numeric_candidate_stays_disabled(self):
        fixture = identity_fixture()
        fixture["cases"][0]["expected"]["output"] += 1
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "bad"
            self.assertFalse(qualify_fixture(fixture=fixture, root=root)["passed"])
            with self.assertRaisesRegex(ValueError, "not passed"):
                ONNXModel(contract_path=root / "contract.json")

    def test_recurrence_uses_explicit_state(self):
        fixture = recurrent_fixture()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "state"
            qualify_fixture(fixture=fixture, root=root)
            model = ONNXModel(contract_path=root / "contract.json")
            values = {name: value.copy() for name, value in fixture["cases"][12]["inputs"].items()}
            actual = model(values)
            values["hidden"][:] = 0
            values["memory"][:] = 0
            reset = model(values)
            self.assertFalse(np.array_equal(actual["next_memory"], reset["next_memory"]))

    def test_import_does_not_load_torch(self):
        code = "import sys; import onnx_platform_checks, onnx_platform_fixtures; assert 'torch' not in sys.modules"
        result = subprocess.run([sys.executable, "-c", code], cwd=Path(__file__).parent,
                                capture_output=True, text=True, timeout=30, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)


class PlatformNPZTests(unittest.TestCase):
    def test_rejects_nonfinite_object_empty_and_wrong_dtype(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "input.npz"
            for values in ({}, {"x": np.array([{}], dtype=object)}, {"x": np.array([1], dtype=np.float64)},
                           {"x": np.array([np.inf], dtype=np.float32)}, {"x": np.array([np.nan], dtype=np.float32)}):
                with self.subTest(names=list(values)):
                    np.savez(path, **values)
                    with self.assertRaises(ValueError):
                        read_npz(path=path)

    def test_rejects_duplicate_members(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "duplicate.npz"
            with warnings.catch_warnings(), zipfile.ZipFile(path, "w") as archive:
                warnings.simplefilter("ignore", UserWarning)
                archive.writestr("x.npy", b"first")
                archive.writestr("x.npy", b"second")
            with self.assertRaisesRegex(ValueError, "duplicate"):
                read_npz(path=path)

    def test_rejects_excessive_members(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "many.npz"
            np.savez(path, **{f"x{i}": np.array(0, dtype=np.float32) for i in range(65)})
            with self.assertRaisesRegex(ValueError, "member count"):
                read_npz(path=path)


class PlatformHarnessTests(unittest.TestCase):
    def test_machine_aliases(self):
        from onnx_platform_suite import normalized_machine
        for original, expected in (("AMD64", "x86_64"), ("aarch64", "arm64"), ("arm64", "arm64")):
            self.assertEqual(normalized_machine(machine=original), expected)

    def test_wrong_os_or_architecture_writes_failed_report(self):
        from onnx_platform_suite import environment, run_suite
        state = environment()
        state["system"], state["normalized_machine"] = "Linux", "arm64"
        with tempfile.TemporaryDirectory() as temp, patch("onnx_platform_suite.environment", return_value=state):
            for index, expected in enumerate(({"expected_system": "Windows"}, {"expected_machine": "x86_64"})):
                root = Path(temp) / str(index)
                report = run_suite(out=root, **expected)
                self.assertFalse(report["passed"])
                self.assertEqual(report["private_models_tested"], 0)
                self.assertEqual(report["graph_count"], 0)
                self.assertIn("qualification target", report["error"])
                self.assertFalse(json.loads((root / "report.json").read_text())["passed"])

    def test_torch_environment_cannot_qualify(self):
        from onnx_platform_suite import environment, run_suite
        state = environment()
        state["torch_installed"] = True
        with tempfile.TemporaryDirectory() as temp, patch("onnx_platform_suite.environment", return_value=state):
            report = run_suite(out=Path(temp) / "blocked", require_no_torch=True)
            self.assertFalse(report["passed"])
            self.assertIn("without torch", report["error"])

    def test_reports_cannot_overwrite_existing_directory(self):
        from onnx_platform_suite import run_suite
        with tempfile.TemporaryDirectory() as temp, self.assertRaises(FileExistsError):
            run_suite(out=Path(temp))


if __name__ == "__main__":
    unittest.main()
