"""Portable ONNX integrity, contracts and bounded session caching without private weights."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import portable_models


class PortableModelTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="body-portable-model-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.manifest = portable_models.load_manifest()
        self.created = []
        self.fault = None
        self.data_specs = {}
        for name, specification in self.manifest["files"].items():
            data = name.encode("ascii")
            specification.update(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
            (self.root / name).write_bytes(data)
            self.data_specs[data] = specification
        self.manifest_path = self.root / "manifest.json"
        self.write_manifest()
        self.real_load_manifest = portable_models.load_manifest
        self.loader = patch.object(portable_models, "load_manifest",
                                   side_effect=lambda: self.real_load_manifest(path=self.manifest_path))
        self.loader.start()
        self.addCleanup(self.loader.stop)
        self.ort = SimpleNamespace(__version__="1.22.1", SessionOptions=SimpleNamespace,
                                   GraphOptimizationLevel=SimpleNamespace(ORT_DISABLE_ALL=0),
                                   InferenceSession=self.session)
        self.module_patch = patch.dict(sys.modules, {"onnxruntime": self.ort})
        self.module_patch.start()
        self.addCleanup(self.module_patch.stop)

    def write_manifest(self):
        self.manifest_path.write_text(json.dumps(self.manifest), encoding="utf-8")

    def session(self, data, *, sess_options, providers):
        self.assertEqual(providers, ["CPUExecutionProvider"])
        self.assertEqual(sess_options.intra_op_num_threads, 1)
        self.assertEqual(sess_options.inter_op_num_threads, 1)
        self.assertEqual(sess_options.graph_optimization_level, 0)
        specification = self.data_specs[data]
        self.created.append(data)
        input_shape = list(specification["inputShape"])
        if self.fault == "input-shape":
            input_shape[1] += 16
        inputs = [SimpleNamespace(name="input", type="tensor(int16)", shape=input_shape)]
        outputs = [SimpleNamespace(name=name, type="tensor(int16)", shape=shape)
                   for name, shape in specification["outputShapes"].items()]
        if self.fault == "output-type":
            outputs[0].type = "tensor(float)"
        if self.fault == "output-order":
            outputs.reverse()

        def run(names, feeds):
            self.assertEqual(names, specification["outputs"])
            self.assertTrue(feeds["input"].flags.c_contiguous)
            dtype = np.float32 if self.fault == "result-type" else np.int16
            return [np.zeros(specification["outputShapes"][name], dtype=dtype) for name in names]

        return SimpleNamespace(get_inputs=lambda: inputs, get_outputs=lambda: outputs,
                               get_providers=lambda: ["CUDAExecutionProvider"] if self.fault == "provider"
                               else ["CPUExecutionProvider"], run=run)

    def tensor(self, *, height=224, width=160):
        return np.zeros((1, height, width, 3), np.int16)

    def test_all_supported_aspects_have_distinct_file_models(self):
        shapes = portable_models.supported_shapes()
        self.assertEqual(len(shapes["coarse"]), 25)
        self.assertEqual(shapes["refine"], ((1, 192, 144, 3),))
        self.assertIn((1, 32, 224, 3), shapes["coarse"])
        self.assertIn((1, 224, 32, 3), shapes["coarse"])
        result = portable_models.verify_models(runtime=self.root)
        self.assertEqual(result["files"], 26)
        self.assertFalse(result["inferencePerformed"])

    def test_real_manifest_is_stable_and_declares_original_weight_origin(self):
        manifest = self.real_load_manifest()
        self.assertEqual(sum(item["bytes"] for item in manifest["files"].values()), 56_461_752)
        self.assertIn("not independently trained", manifest["weightsOrigin"])
        self.assertEqual(manifest["onnx"], "1.19.0")

    def test_manifest_rejects_unbounded_paths_duplicate_shapes_and_missing_models(self):
        original = deepcopy(self.manifest)
        first = next(iter(original["files"]))
        variations = []
        for malicious in ("../weights.onnx", "/tmp/weights.onnx", "other.bin", "dir\\weights.onnx", "C:weights.onnx"):
            value = deepcopy(original)
            value["files"][malicious] = value["files"].pop(first)
            variations.append(value)
        value = deepcopy(original)
        value["files"]["duplicate.onnx"] = deepcopy(value["files"][first])
        variations.append(value)
        value = deepcopy(original)
        value["files"].pop(first)
        variations.append(value)
        for value in variations:
            with self.subTest(value=value):
                self.manifest = value
                self.write_manifest()
                with self.assertRaises(ValueError):
                    portable_models.load_manifest()

    def test_manifest_rejects_bad_integrity_shapes_and_schema(self):
        original = deepcopy(self.manifest)
        first = next(iter(original["files"]))
        for field, value in (("bytes", True), ("bytes", 10**12), ("sha256", "z" * 64),
                             ("network", []), ("inputShape", [1, 200, 160, 3]),
                             ("outputs", ["unexpected"]), ("outputShapes", {})):
            with self.subTest(field=field, value=value):
                self.manifest = deepcopy(original)
                self.manifest["files"][first][field] = value
                self.write_manifest()
                with self.assertRaises(ValueError):
                    portable_models.load_manifest()
        self.manifest_path.write_text("[]", encoding="utf-8")
        with self.assertRaises(ValueError):
            portable_models.load_manifest()

    def test_loader_requires_verified_ort_version_without_numpy_fallback(self):
        self.ort.__version__ = "1.99.0"
        with self.assertRaisesRegex(ValueError, "1.22.1"):
            portable_models.load_skeleton(runtime=self.root)
        self.assertEqual(self.created, [])

    def test_valid_models_accept_noncontiguous_inputs_and_return_named_int16_arrays(self):
        networks = portable_models.load_skeleton(runtime=self.root)
        tensor = self.tensor()[:, :, ::-1]
        actual = networks.infer(tensor=tensor)
        self.assertEqual(tuple(actual), portable_models.OUTPUTS["coarse"])
        self.assertTrue(all(value.dtype == np.int16 for value in actual.values()))
        self.assertFalse(networks.provenance["npzLoadedForInference"])
        self.assertFalse(networks.provenance["nativeRuntimeLoaded"])
        self.assertEqual(len(networks.provenance["models"]), 1)

    def test_invalid_inputs_fail_before_loading_ort_session(self):
        networks = portable_models.load_skeleton(runtime=self.root)
        values = (self.tensor().astype(np.float32), self.tensor()[0], np.zeros((1, 192, 160, 3), np.int16),
                  np.zeros((2, 224, 160, 3), np.int16), np.zeros((1, 224, 160, 4), np.int16), [], None)
        for value in values:
            with self.subTest(value=type(value)), self.assertRaises(ValueError):
                networks.infer(tensor=value)
        for network in ("missing", [], None):
            with self.subTest(network=network), self.assertRaises(ValueError):
                networks.infer(tensor=self.tensor(), network=network)
        self.assertEqual(self.created, [])

    def test_refine_model_uses_only_192_by_144_input(self):
        networks = portable_models.load_skeleton(runtime=self.root)
        actual = networks.infer(tensor=self.tensor(height=192, width=144), network="refine")
        self.assertEqual(tuple(actual), ("output_0",))
        with self.assertRaises(ValueError):
            networks.infer(tensor=self.tensor(), network="refine")

    def test_missing_corrupt_same_size_or_truncated_model_fails_without_fallback(self):
        key = "body-coarse-224x160-fp64.onnx"
        path = self.root / key
        data = path.read_bytes()
        for replacement in (None, bytes(len(data)), data[:-1]):
            if replacement is None:
                path.unlink()
            else:
                path.write_bytes(replacement)
            with self.subTest(replacement=replacement), self.assertRaises(ValueError):
                portable_models.load_skeleton(runtime=self.root).infer(tensor=self.tensor())
            path.write_bytes(data)
        self.assertEqual(self.created, [])

    def test_file_and_root_symlinks_are_rejected(self):
        path = self.root / "body-coarse-224x160-fp64.onnx"
        original = self.root / "original.onnx"
        path.rename(original)
        path.symlink_to(original)
        with self.assertRaises(ValueError):
            portable_models.load_skeleton(runtime=self.root).infer(tensor=self.tensor())
        directory = self.root / "directory-link"
        directory.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            portable_models.load_skeleton(runtime=directory).infer(tensor=self.tensor())

    def test_cached_session_rechecks_file_integrity(self):
        networks = portable_models.load_skeleton(runtime=self.root)
        networks.infer(tensor=self.tensor())
        path = self.root / "body-coarse-224x160-fp64.onnx"
        path.write_bytes(bytes(path.stat().st_size))
        with self.assertRaisesRegex(ValueError, "integrity"):
            networks.infer(tensor=self.tensor())
        self.assertEqual(len(self.created), 1)

    def test_lru_eviction_is_bounded_and_recently_used_session_is_retained(self):
        networks = portable_models.load_skeleton(runtime=self.root)
        for width in (32, 48, 64, 80):
            networks.infer(tensor=self.tensor(width=width))
        networks.infer(tensor=self.tensor(width=32))
        networks.infer(tensor=self.tensor(width=96))
        self.assertEqual(len(networks.sessions), 4)
        self.assertIn(("coarse", (1, 224, 32, 3)), networks.sessions)
        self.assertNotIn(("coarse", (1, 224, 48, 3)), networks.sessions)
        self.assertEqual(len(self.created), 5)
        self.assertEqual(len(networks.provenance["models"]), 4)

    def test_session_metadata_and_returned_tensor_contracts_fail_closed(self):
        for fault in ("input-shape", "output-type", "output-order", "provider", "result-type"):
            self.fault = fault
            with self.subTest(fault=fault), self.assertRaisesRegex(ValueError, "contract|invalid output"):
                portable_models.load_skeleton(runtime=self.root).infer(tensor=self.tensor())









if __name__ == "__main__":
    unittest.main()
