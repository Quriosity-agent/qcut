"""CPU-only Extra bundle contracts; optional real export and frozen-output checks.

QCUT_FACE_EXTRA_MODEL_ROOT enables real Torch-free inference. Optional SOURCE,
EXPORT_PYTHON and REFERENCE_ROOT variables enable fresh export and historical
synthetic oracle comparisons. No native process or GPU is started.
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

import numpy as np

import face_extra_heads_onnx as extra


def manifest(*, model=b"synthetic-test-model"):
    return dict(schema=extra.SCHEMA, graph_sha256=extra.GRAPH_SHA256,
        arena_sha256=extra.ARENA_SHA256, opset=18, input=copy.deepcopy(extra.INPUT),
        output=copy.deepcopy(extra.OUTPUT), validation=copy.deepcopy(extra.VALIDATION),
        exporter_sha256=hashlib.sha256(Path(extra.__file__).read_bytes()).hexdigest(),
        model_sha256=hashlib.sha256(model).hexdigest(),
        versions=dict(torch="2.10.0", onnx="1.23.0", onnxruntime=extra.ORT_VERSION))


def bundle(*, root, model=b"synthetic-test-model"):
    root.mkdir()
    (root / "model.onnx").write_bytes(model)
    value = manifest(model=model)
    (root / "manifest.json").write_text(json.dumps(value))
    return value


class FakeSession:
    def __init__(self):
        self.inputs = [SimpleNamespace(name="data", type="tensor(int64)", shape=[1, 160, 160, 3])]
        self.outputs = [SimpleNamespace(name="fc", type="tensor(float)", shape=[240, 1, 1, 2])]
        self.providers = ["CPUExecutionProvider"]
        self.value = np.arange(480, dtype=np.float32).reshape(240, 1, 1, 2)
        self.calls = []
        self.after_run = None

    def get_inputs(self):
        return self.inputs

    def get_outputs(self):
        return self.outputs

    def get_providers(self):
        return self.providers

    def run(self, names, feed):
        self.calls.append((names, feed))
        if self.after_run is not None:
            self.after_run()
        return [self.value]


class ManifestTests(unittest.TestCase):
    def validate(self, *, value):
        extra.validate_manifest(manifest=value, exporter_sha256=manifest()["exporter_sha256"])

    def test_valid_contract(self):
        self.validate(value=manifest())

    def test_missing_extra_and_malformed_top_level(self):
        source = manifest()
        for value in (None, [], {}, dict(source, extra=True), {k: v for k, v in source.items() if k != "opset"}):
            with self.subTest(value_type=type(value).__name__), self.assertRaises(ValueError):
                self.validate(value=value)

    def test_rejects_wrong_provenance_and_policy(self):
        changes = dict(schema="other", graph_sha256="0" * 64, arena_sha256="0" * 64,
                       exporter_sha256="0" * 64, opset=18.0, model_sha256="Z" * 64)
        for key, value in changes.items():
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.validate(value=dict(manifest(), **{key: value}))

    def test_typed_nested_contract_and_truthful_scope(self):
        changes = (("input", "minimum", -129), ("input", "storage_type", 2.0),
            ("input", "fraction", 7), ("input", "shape", [True, 160, 160, 3]),
            ("output", "order", "primary106"), ("output", "shape", [240, 2]),
            ("validation", "native_oracle_run", 0), ("validation", "geometry_parity_verified", True),
            ("validation", "product_parity_verified", True), ("validation", "seeds", [17]),
            ("validation", "bit_mismatches", [0, 1, 0]))
        for section, key, value in changes:
            item = manifest()
            item[section][key] = value
            with self.subTest(section=section, key=key), self.assertRaises(ValueError):
                self.validate(value=item)

    def test_rejects_missing_wrong_or_unbounded_versions(self):
        for versions in (None, {}, dict(torch=True, onnx="1", onnxruntime=extra.ORT_VERSION),
                         dict(torch="2", onnx="1", onnxruntime="1.30.0"),
                         dict(torch="x" * 65, onnx="1", onnxruntime=extra.ORT_VERSION)):
            with self.subTest(versions=versions), self.assertRaises(ValueError):
                self.validate(value=dict(manifest(), versions=versions))


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.root = self.base / "model"
        bundle(root=self.root)
        self.session = FakeSession()
        self.loader = mock.patch.object(extra, "cpu_session", return_value=self.session).start()
        self.addCleanup(mock.patch.stopall)

    def heads(self):
        return extra.ExtraHeads(root=self.root)

    def test_loads_verified_bytes_and_stable_version(self):
        first, second = self.heads(), self.heads()
        self.assertEqual(first.version, second.version)
        self.assertTrue(first.version.startswith("extra-heads-v1:"))
        self.assertEqual(self.loader.call_args.kwargs["model"], b"synthetic-test-model")
        first.verify()

    def test_valid_signed_inputs_and_detached_raw_output(self):
        heads = self.heads()
        for dtype in (np.int16, np.int64):
            for endpoint in (-128, 0, 127):
                values = np.full(extra.INPUT_SHAPE, endpoint, dtype)
                result = heads.infer(values=values)
                self.assertEqual((result.shape, result.dtype), ((240, 2), np.dtype("float32")))
                np.testing.assert_array_equal(result, self.session.value.reshape(240, 2))
                names, feed = self.session.calls[-1]
                self.assertEqual(names, ["fc"])
                self.assertEqual(feed["data"].dtype, np.int64)
                self.assertFalse(np.shares_memory(feed["data"], values))
                self.assertFalse(np.shares_memory(result, self.session.value))

    def test_noncontiguous_input_is_owned_contiguous_copy(self):
        values = np.zeros((1, 160, 160, 6), np.int16)[..., ::2]
        self.heads().infer(values=values)
        feed = self.session.calls[-1][1]["data"]
        self.assertTrue(feed.flags.c_contiguous)
        self.assertFalse(np.shares_memory(feed, values))

    def test_wrong_type_dtype_shape_and_nonfinite_input(self):
        values = np.zeros(extra.INPUT_SHAPE, np.int16)
        invalid = [[], values[0], values[..., :2], values.reshape(1, 160, 3, 160),
                   np.full(extra.INPUT_SHAPE, np.nan, np.float32),
                   np.full(extra.INPUT_SHAPE, np.inf, np.float64)]
        invalid.extend(values.astype(dtype) for dtype in (np.int8, np.int32, np.uint16, np.uint64,
                                                          np.bool_, np.float32, object))
        heads = self.heads()
        for value in invalid:
            with self.subTest(dtype=getattr(value, "dtype", None)), self.assertRaises(ValueError):
                heads.infer(values=value)
        self.assertEqual(self.session.calls, [])

    def test_out_of_range_inputs_rejected_before_inference(self):
        heads = self.heads()
        for value in (-129, 128, np.iinfo(np.int64).min, np.iinfo(np.int64).max):
            with self.subTest(value=value), self.assertRaises(ValueError):
                heads.infer(values=np.full(extra.INPUT_SHAPE, value, np.int64))
        self.assertEqual(self.session.calls, [])

    def test_malformed_and_nonfinite_output(self):
        heads = self.heads()
        for value in (None, np.zeros((240, 2), np.float32), np.zeros(extra.OUTPUT_SHAPE, np.float64),
                      np.full(extra.OUTPUT_SHAPE, np.nan, np.float32),
                      np.full(extra.OUTPUT_SHAPE, np.inf, np.float32)):
            self.session.value = value
            with self.subTest(value_type=type(value).__name__), self.assertRaises(ValueError):
                heads.infer(values=np.zeros(extra.INPUT_SHAPE, np.int16))

    def test_wrong_output_count(self):
        for value in (None, (), [], [np.zeros(extra.OUTPUT_SHAPE, np.float32)] * 2):
            with self.subTest(value_type=type(value).__name__), self.assertRaises(ValueError):
                extra.output_values(outputs=value)

    def test_metadata_and_provider_rejected(self):
        changes = (("inputs", "name", "pixels"), ("inputs", "type", "tensor(int16)"),
                   ("inputs", "shape", [1, 120, 120, 3]), ("outputs", "name", "points"),
                   ("outputs", "type", "tensor(double)"), ("outputs", "shape", [240, 2]))
        for collection, key, value in changes:
            original = getattr(getattr(self.session, collection)[0], key)
            setattr(getattr(self.session, collection)[0], key, value)
            with self.subTest(collection=collection, key=key), self.assertRaises(ValueError):
                self.heads()
            setattr(getattr(self.session, collection)[0], key, original)
        for providers in ([], ["CUDAExecutionProvider"], ["CPUExecutionProvider", "CoreMLExecutionProvider"]):
            self.session.providers = providers
            with self.subTest(providers=providers), self.assertRaises(ValueError):
                self.heads()

    def test_runtime_provider_and_version_changes_fail_closed(self):
        heads = self.heads()
        with mock.patch("onnxruntime.__version__", "1.30.0"), self.assertRaises(ValueError):
            heads.verify()
        self.session.providers = ["CoreMLExecutionProvider"]
        with self.assertRaises(ValueError):
            heads.infer(values=np.zeros(extra.INPUT_SHAPE, np.int16))
        self.assertEqual(self.session.calls, [])

    def test_runtime_rejects_torch_import(self):
        with mock.patch.dict(sys.modules, {"torch": object()}), self.assertRaises(ValueError):
            self.heads()

    def test_bad_model_hash_and_empty_model_fail_before_ort(self):
        for content in (b"changed", b""):
            (self.root / "model.onnx").write_bytes(content)
            with self.subTest(content=content), self.assertRaises(ValueError):
                self.heads()
        self.loader.assert_not_called()

    def test_strict_manifest_json_and_size(self):
        for content in ('{"schema":1,"schema":2}', '{"value":NaN}', '{"value":1e999}',
                        '[]', ' ', ' ' * (64 * 1024 + 1)):
            (self.root / "manifest.json").write_text(content)
            with self.subTest(length=len(content)), self.assertRaises(ValueError):
                self.heads()
        self.loader.assert_not_called()

    def test_incomplete_bundle_rejected(self):
        (self.root / "manifest.json").unlink()
        with self.assertRaises(FileNotFoundError):
            self.heads()
        self.loader.assert_not_called()

    def test_root_and_artifact_symlinks_rejected(self):
        alias = self.base / "alias"
        alias.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            extra.ExtraHeads(root=alias)
        for name in ("model.onnx", "manifest.json"):
            target = self.base / name
            shutil.copyfile(self.root / name, target)
            (self.root / name).unlink()
            (self.root / name).symlink_to(target)
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.heads()
            (self.root / name).unlink()
            shutil.copyfile(target, self.root / name)

    def test_model_changed_after_load_rejected_before_run(self):
        heads = self.heads()
        (self.root / "model.onnx").write_bytes(b"changed")
        with self.assertRaises(ValueError):
            heads.infer(values=np.zeros(extra.INPUT_SHAPE, np.int16))
        self.assertEqual(self.session.calls, [])

    def test_manifest_changed_during_inference_rejects_output(self):
        heads = self.heads()
        self.session.after_run = lambda: (self.root / "manifest.json").write_text("{}")
        with self.assertRaises(ValueError):
            heads.infer(values=np.zeros(extra.INPUT_SHAPE, np.int16))
        self.assertEqual(len(self.session.calls), 1)

    def test_same_bytes_new_inode_rejected(self):
        heads = self.heads()
        replacement = self.base / "replacement"
        shutil.copyfile(self.root / "model.onnx", replacement)
        replacement.replace(self.root / "model.onnx")
        with self.assertRaises(ValueError):
            heads.verify()

    def test_same_bundle_replacement_root_rejected(self):
        heads = self.heads()
        previous = self.base / "previous"
        self.root.rename(previous)
        shutil.copytree(previous, self.root)
        with self.assertRaises(ValueError):
            heads.verify()

    def test_root_replaced_by_symlink_rejected(self):
        heads = self.heads()
        previous = self.base / "previous"
        self.root.rename(previous)
        self.root.symlink_to(previous, target_is_directory=True)
        with self.assertRaises(ValueError):
            heads.verify()


class ExportGuardTests(unittest.TestCase):
    def test_existing_directory_or_file_never_overwritten(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            target = base / "file"
            target.write_text("preserve")
            for out in (base, target):
                with self.subTest(out=out.name), self.assertRaises(FileExistsError):
                    extra.export_model(source=base / "missing", out=out)
            self.assertEqual(target.read_text(), "preserve")

    def test_dangling_output_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            link = root / "link"
            link.symlink_to(root / "missing")
            with self.assertRaises(FileExistsError):
                extra.export_model(source=root / "missing", out=link)

    def test_unpinned_source_rejected_without_output_or_torch(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "graph.txt").write_text("untrusted graph")
            (root / "arena.bin").write_bytes(b"untrusted weights")
            with self.assertRaises(ValueError):
                extra.export_model(source=root, out=root / "new")
            self.assertFalse((root / "new").exists())
            self.assertNotIn("torch", sys.modules)


@unittest.skipUnless(os.environ.get("QCUT_FACE_EXTRA_MODEL_ROOT"), "private Extra model root not configured")
class RealCpuTests(unittest.TestCase):
    def test_real_inference_contract_and_repeatability(self):
        heads = extra.ExtraHeads(root=Path(os.environ["QCUT_FACE_EXTRA_MODEL_ROOT"]))
        for dtype in (np.int16, np.int64):
            values = extra.synthetic_input(seed=17).astype(dtype)
            first, second = heads.infer(values=values), heads.infer(values=values)
            self.assertEqual(first.shape, (240, 2))
            self.assertEqual(first.dtype, np.float32)
            self.assertTrue(np.isfinite(first).all())
            np.testing.assert_array_equal(first.view(np.uint32), second.view(np.uint32))
        self.assertNotIn("torch", sys.modules)

    @unittest.skipUnless(os.environ.get("QCUT_FACE_EXTRA_REFERENCE_ROOT"), "frozen synthetic references not configured")
    def test_three_regenerated_inputs_against_historical_native_fc(self):
        heads = extra.ExtraHeads(root=Path(os.environ["QCUT_FACE_EXTRA_MODEL_ROOT"]))
        root = Path(os.environ["QCUT_FACE_EXTRA_REFERENCE_ROOT"])
        for seed in extra.SEEDS:
            directory = root / f"parity-final2-seed{seed}/7938cfc3abdb0934"
            reference = json.loads((directory / "response.json").read_text())
            self.assertEqual(reference["graph_sha256"], extra.GRAPH_SHA256)
            self.assertEqual(reference["arena_sha256"], extra.ARENA_SHA256)
            rows = [row for row in reference["outputs"] if row["name"] == "fc"]
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["raw"], [4, 0])
            self.assertEqual(rows[0]["dims_nwhc"], [240, 1, 1, 2])
            filename = rows[0]["file"]
            self.assertEqual(Path(filename).name, filename)
            expected = np.fromfile(directory / filename, dtype="<f4").reshape(240, 2)
            actual = heads.infer(values=extra.synthetic_input(seed=seed))
            with self.subTest(seed=seed):
                np.testing.assert_array_equal(actual.view(np.uint32), expected.view(np.uint32))

    @unittest.skipUnless(os.environ.get("QCUT_FACE_EXTRA_SOURCE") and os.environ.get("QCUT_FACE_EXTRA_EXPORT_PYTHON"),
                         "private source and export interpreter not configured")
    def test_full_signed_range_pytorch_and_onnx_fc_parity(self):
        script = """
import hashlib, json, sys
from pathlib import Path
import numpy as np
import torch
sys.path.insert(0, sys.argv[1])
import face_extra_heads_onnx as extra
source, root = Path(sys.argv[2]), Path(sys.argv[3])
text, arena = (source / 'graph.txt').read_bytes(), (source / 'arena.bin').read_bytes()
assert hashlib.sha256(text).hexdigest() == extra.GRAPH_SHA256
assert hashlib.sha256(arena).hexdigest() == extra.ARENA_SHA256
torch.set_num_threads(1)
model = extra.build_module(text=text.decode(), arena=arena)
runner = extra.cpu_session(model=(root / 'model.onnx').read_bytes())
cases = {str(v): np.full(extra.INPUT_SHAPE, v, np.int64) for v in (-128, 0, 127)}
cases['ramp'] = (np.arange(np.prod(extra.INPUT_SHAPE), dtype=np.int64) % 256 - 128).reshape(extra.INPUT_SHAPE)
for seed in extra.SEEDS:
    cases[f'full-range-{seed}'] = np.random.default_rng(seed).integers(-128, 128, size=extra.INPUT_SHAPE, dtype=np.int64)
results = {}
for name, values in cases.items():
    with torch.no_grad():
        expected = extra.output_values(outputs=[model(torch.from_numpy(values)).numpy()])
    actual = extra.output_values(outputs=runner.run(['fc'], {'data': values}))
    results[name] = int((actual.view(np.uint32) != expected.view(np.uint32)).sum())
print(json.dumps(results))
"""
        command = [os.environ["QCUT_FACE_EXTRA_EXPORT_PYTHON"], "-B", "-c", script,
                   str(Path(extra.__file__).resolve().parent), os.environ["QCUT_FACE_EXTRA_SOURCE"],
                   os.environ["QCUT_FACE_EXTRA_MODEL_ROOT"]]
        environment = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", OMP_NUM_THREADS="1", OPENBLAS_NUM_THREADS="1")
        result = subprocess.run(command, env=environment, capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {name: 0 for name in
            ("-128", "0", "127", "ramp", "full-range-17", "full-range-41", "full-range-509")})
        self.assertNotIn("torch", sys.modules)

    @unittest.skipUnless(os.environ.get("QCUT_FACE_EXTRA_SOURCE") and os.environ.get("QCUT_FACE_EXTRA_EXPORT_PYTHON"),
                         "private source and export interpreter not configured")
    def test_cli_fresh_export_load_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "export"
            command = [os.environ["QCUT_FACE_EXTRA_EXPORT_PYTHON"], "-B", str(Path(extra.__file__).resolve()),
                       "--source", os.environ["QCUT_FACE_EXTRA_SOURCE"], "--out", str(root)]
            environment = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", PYTHONWARNINGS="ignore",
                               OMP_NUM_THREADS="1", OPENBLAS_NUM_THREADS="1")
            completed = subprocess.run(command, env=environment, capture_output=True, text=True, timeout=120)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            receipt = json.loads(completed.stdout)
            self.assertFalse(receipt["validation"]["native_oracle_run"])
            heads = extra.ExtraHeads(root=root)
            original = extra.ExtraHeads(root=Path(os.environ["QCUT_FACE_EXTRA_MODEL_ROOT"]))
            for seed in extra.SEEDS:
                values = extra.synthetic_input(seed=seed)
                np.testing.assert_array_equal(heads.infer(values=values).view(np.uint32),
                                              original.infer(values=values).view(np.uint32))
            hashes = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in root.iterdir()}
            repeated = subprocess.run(command, env=environment, capture_output=True, text=True, timeout=30)
            self.assertNotEqual(repeated.returncode, 0)
            self.assertIn("FileExistsError", repeated.stderr)
            self.assertEqual(hashes, {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in root.iterdir()})
            heads.verify()
        self.assertNotIn("torch", sys.modules)


if __name__ == "__main__":
    unittest.main()
