"""Synthetic, redistributable fixtures only; never requires private model weights."""
import copy
import json
import pathlib
import struct
import tempfile
import unittest
import zipfile

import numpy as np
import torch
import torch.nn.functional as F

from batch_export import run_batch
from espresso_archive import UnsupportedModel, conv_weight, parse_blobs, read_archive, tensor_blob
from espresso_torch import EspressoTorch, load_model
from inventory import RUNTIMES, manifest_sources
from espresso_archive import sha256
from verify import compare, input_cases


def layer(*, kind, bottom="x", top="y", **fields):
    return {"type": kind, "name": top, "bottom": bottom, "top": top, **fields}


def spec(*, layers, shape=None, shapes=None, outputs=None):
    return {"layers": layers, "shapes": shapes or {},
            "inputs": {"x": {"shape": shape or [1, 1, 2, 2], "allowed_shapes": []}},
            "outputs": outputs or [layers[-1]["top"]]}


def archive_fixture(*, path, extra=None):
    graph = {"format_version": 200, "layers": [layer(kind="activation", mode=0)]}
    metadata = [{"inputSchema": [{"name": "x", "type": "MultiArray", "dataType": "Float32", "shape": "[1,1,2,2]"}],
                 "outputSchema": [{"name": "y"}]}]
    with zipfile.ZipFile(path, "w") as archive:
        for name, data in {"model.espresso.net": graph, "model.espresso.shape": {"layer_shapes": {}}, "metadata.json": metadata}.items():
            archive.writestr("fixture.mlmodelc/" + name, json.dumps(data))
        archive.writestr("fixture.mlmodelc/model.espresso.weights", struct.pack("<Q", 0))
        if extra:
            archive.writestr(extra, "unsafe")


class BlobTests(unittest.TestCase):
    def test_blob_table(self):
        value = struct.pack("<Q", 2) + struct.pack("<QQQQ", 7, 4, 12, 0) + b"abcd"
        self.assertEqual(parse_blobs(data=value), {7: b"abcd", 12: b""})

    def test_corrupt_tables(self):
        cases = [b"", struct.pack("<Q", 100001), struct.pack("<QQQ", 1, 2, 100),
                 struct.pack("<QQQQQ", 2, 1, 0, 1, 0), struct.pack("<Q", 0) + b"x"]
        for data in cases:
            with self.subTest(data=data), self.assertRaises(ValueError):
                parse_blobs(data=data)

    def test_nonfinite_and_misaligned(self):
        for data in (b"x", struct.pack("<f", float("nan"))):
            with self.assertRaises(ValueError):
                tensor_blob(blobs={1: data}, key=1)

    def test_fp16(self):
        value = tensor_blob(blobs={1: np.array([0.5, -2], dtype="<f2").tobytes()}, key=1, dtype="<f2")
        self.assertTrue(torch.equal(value, torch.tensor([0.5, -2])))

    def test_unsigned_quantization(self):
        conv = layer(kind="convolution", C=2, K=1, n_groups=1, Ny=1, Nx=2,
                     weights={"W_U8": 0, "per_ch_qscale": 1, "per_ch_qbias": 2})
        blobs = {0: bytes([0, 255, 100, 200]), 1: np.array([0.25, 0.5], dtype="<f4").tobytes(),
                 2: np.array([-1, -2], dtype="<f4").tobytes()}
        self.assertTrue(torch.equal(conv_weight(layer=conv, blobs=blobs).flatten(), torch.tensor([-1, 62.75, 48, 98])))

    def test_unknown_weight_layout(self):
        conv = layer(kind="convolution", C=1, K=1, n_groups=1, Nx=1, Ny=1, weights={"unknown": 0})
        with self.assertRaises(UnsupportedModel):
            conv_weight(layer=conv, blobs={})


class OperatorTests(unittest.TestCase):
    def setUp(self):
        self.x = torch.tensor([[[[-1., 2.], [3., -4.]]]])

    def execute(self, *, layers, shape=None, shapes=None, outputs=None):
        model = EspressoTorch(spec=spec(layers=layers, shape=shape, shapes=shapes, outputs=outputs)).eval()
        return model({"x": self.x})

    def test_activation_modes(self):
        for mode, expected in ((0, self.x.relu()), (3, self.x.sigmoid()), (6, self.x)):
            with self.subTest(mode=mode):
                out = self.execute(layers=[layer(kind="activation", mode=mode)])
                self.assertTrue(torch.equal(out["y"], expected))

    def test_affine(self):
        out = self.execute(layers=[layer(kind="activation", mode=6, alpha=-1, beta=2)])
        self.assertTrue(torch.equal(out["y"], 2 - self.x))

    def test_elementwise_and_fanout(self):
        layers = [layer(kind="activation", top="a", mode=0),
                  layer(kind="elementwise", bottom="x,a", top="b", operation=0),
                  layer(kind="elementwise", bottom="x,b", operation=1)]
        out = self.execute(layers=layers)
        self.assertTrue(torch.equal(out["y"], self.x * (self.x + self.x.relu())))

    def test_concat_split(self):
        layers = [layer(kind="concat", bottom="x,x", top="z"),
                  layer(kind="split_nd", bottom="z", top="a,b", nd_axis=-3)]
        out = self.execute(layers=layers, shapes={"a": {"k": 1}, "b": {"k": 1}}, outputs=["a", "b"])
        self.assertTrue(torch.equal(out["a"], self.x))
        self.assertTrue(torch.equal(out["b"], self.x))

    def test_upsample(self):
        out = self.execute(layers=[layer(kind="upsample", mode=1, scaling_factor_x=2, scaling_factor_y=2)])
        self.assertTrue(torch.equal(out["y"], F.interpolate(self.x, scale_factor=2, mode="bilinear", align_corners=False)))

    def test_max_pool(self):
        out = self.execute(layers=[layer(kind="pool", avg_or_max=1, top_shape_style=2, size_x=2, size_y=2, stride_x=2, stride_y=2)])
        self.assertEqual(out["y"].item(), 3)

    def test_constant(self):
        layers = [layer(kind="load_constant", bottom="", top="c", n=1, k=1, h=2, w=2, constant_blob=7),
                  layer(kind="elementwise", bottom="x,c", operation=0)]
        model = EspressoTorch(spec=spec(layers=layers), blobs={7: np.ones(4, dtype="<f4").tobytes()})
        self.assertTrue(torch.equal(model({"x": self.x})["y"], self.x + 1))

    def test_promoted_scalar_constant(self):
        layers = [layer(kind="load_constant", bottom="", top="c", n=1, k=1, h=1, w=1, nd_rank=1, constant_blob=7),
                  layer(kind="elementwise", bottom="x,c", operation=0)]
        model = EspressoTorch(spec=spec(layers=layers), blobs={7: struct.pack("<f", 1)})
        self.assertTrue(torch.equal(model({"x": self.x})["y"], self.x + 1))

    def test_grouped_conv_asymmetric_pad(self):
        conv = layer(kind="convolution", C=2, K=2, n_groups=2, Ny=1, Nx=1,
                     blob_weights=1, has_biases=0, pad_l=1)
        shape = [1, 2, 2, 2]
        model = EspressoTorch(spec=spec(layers=[conv], shape=shape), blobs={1: np.array([2, 3], dtype="<f4").tobytes()})
        x = self.x.expand(*shape).contiguous()
        out = model({"x": x})["y"]
        expected = F.pad(x * torch.tensor([2, 3]).reshape(1, 2, 1, 1), (1, 0, 0, 0))
        self.assertTrue(torch.equal(out, expected))

    def test_depthwise_deconvolution(self):
        conv = layer(kind="deconvolution", C=1, K=1, n_groups=1, Ny=2, Nx=2, stride_x=2, stride_y=2,
                     blob_weights=1, has_biases=0, pad_l=1, pad_r=1, pad_t=1, pad_b=1)
        model = EspressoTorch(spec=spec(layers=[conv]), blobs={1: np.ones(4, dtype="<f4").tobytes()})
        expected = F.conv_transpose2d(self.x, torch.ones(1, 1, 2, 2), stride=2, padding=1)
        self.assertTrue(torch.equal(model({"x": self.x})["y"], expected))

    def test_reject_semantics(self):
        cases = [layer(kind="mystery"), layer(kind="activation", mode=12),
                 layer(kind="elementwise", bottom="x,x", operation=2), layer(kind="split_nd", nd_axis=2),
                 layer(kind="upsample", mode=1, align_corners=1)]
        for candidate in cases:
            with self.subTest(candidate=candidate), self.assertRaises(UnsupportedModel):
                EspressoTorch(spec=spec(layers=[candidate]))

    def test_unknown_field_rejected(self):
        with self.assertRaises(UnsupportedModel):
            EspressoTorch(spec=spec(layers=[layer(kind="activation", mode=0, fused_magic=1)]))

    def test_wrong_arity_rejected(self):
        with self.assertRaises(ValueError):
            EspressoTorch(spec=spec(layers=[layer(kind="activation", mode=0, bottom="x,x")]))

    def test_invalid_graph(self):
        with self.assertRaises(ValueError):
            EspressoTorch(spec=spec(layers=[layer(kind="activation", bottom="missing", mode=0)]))

    def test_input_validation(self):
        model = EspressoTorch(spec=spec(layers=[layer(kind="activation", mode=0)]))
        for inputs in ({}, {"x": self.x.double()}, {"x": self.x.flatten()}):
            with self.assertRaises(ValueError):
                model(inputs)


class ArchiveAndBatchTests(unittest.TestCase):
    def test_manifest_integrity_and_layout(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            for runtime in RUNTIMES:
                current = root / runtime / "current"
                current.mkdir(parents=True)
                relative = "Models/demo.model" if runtime == "JianyingFilter" else "demo.model"
                base = current / "Models" if runtime == "JianyingBasicVideo" else current
                path = base / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"fixture")
                entry = {"relativePath" if runtime == "JianyingBasicVideo" else "path": relative,
                         "bytes": path.stat().st_size, "sha256": sha256(path=path)}
                (current / "manifest.json").write_text(json.dumps({"files": [entry]}))
            self.assertEqual(len(manifest_sources(root=root)), 5)
            path.write_bytes(b"changed")
            with self.assertRaises(ValueError):
                manifest_sources(root=root)

    def test_unknown_quantization_profile(self):
        schema = spec(layers=[layer(kind="activation", mode=0)])
        schema["quantization_profile"] = "unknown"
        with self.assertRaises(UnsupportedModel):
            EspressoTorch(spec=schema)

    def test_failed_conversion_is_recorded(self):
        with tempfile.TemporaryDirectory() as temp:
            path = pathlib.Path(temp) / "bad.model"
            archive_fixture(path=path, extra="../outside")
            report = run_batch(sources=[path], output=pathlib.Path(temp) / "out")
            self.assertEqual(report["summary"], {"failed": 1})

    def test_shot_hash_guard(self):
        from shot_export import SOURCES, export_shots
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            models = root / "Resources/models"
            models.mkdir(parents=True)
            for name, _ in SOURCES.values():
                (models / name).write_bytes(b"unknown model revision")
            with self.assertRaisesRegex(ValueError, "unsupported model hash"):
                export_shots(runtime=root, tables=root, output=root / "out")

    def test_prefixed_zip(self):
        with tempfile.TemporaryDirectory() as temp:
            path = pathlib.Path(temp) / "model.model"
            archive_fixture(path=path)
            path.write_bytes(b"private-header" + path.read_bytes())
            model_spec, blobs, prefix = read_archive(path=path)
            self.assertEqual(model_spec["outputs"], ["y"])
            self.assertEqual(blobs, {})
            self.assertEqual(prefix, "fixture.mlmodelc/")

    def test_path_traversal(self):
        for name in ("../escape", "/absolute", "..\\escape"):
            with tempfile.TemporaryDirectory() as temp:
                path = pathlib.Path(temp) / "model.model"
                archive_fixture(path=path, extra=name)
                with self.assertRaises(ValueError):
                    read_archive(path=path)

    def test_no_graph_is_not_success(self):
        with tempfile.TemporaryDirectory() as temp:
            path = pathlib.Path(temp) / "script.model"
            path.write_bytes(b"not a model graph")
            report = run_batch(sources=[path], output=pathlib.Path(temp) / "out")
            self.assertEqual(report["summary"], {"unsupported": 1})
            self.assertNotIn("artifact", report["models"][0])

    def test_batch_duplicate_roundtrip(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            path, duplicate = root / "one.model", root / "two.model"
            archive_fixture(path=path)
            duplicate.write_bytes(path.read_bytes())
            report = run_batch(sources=[path, duplicate], output=root / "out")
            self.assertEqual(report["summary"], {"duplicate": 1, "roundtrip-passed-native-unverified": 1})
            model = load_model(path=report["models"][0]["artifact"])
            self.assertEqual(model({"x": torch.ones(1, 1, 2, 2)})["y"].sum().item(), 4)

    def test_bad_bundle_version(self):
        with tempfile.TemporaryDirectory() as temp:
            path = pathlib.Path(temp) / "bad.pt"
            torch.save({"format": "wrong", "version": 1}, path)
            with self.assertRaises(ValueError):
                load_model(path=path)

    def test_comparison_failures(self):
        self.assertFalse(compare(actual=np.zeros(2), expected=np.zeros(3))["passed"])
        self.assertFalse(compare(actual=np.array([np.nan]), expected=np.zeros(1))["passed"])
        self.assertFalse(compare(actual=np.ones(2), expected=np.zeros(2))["passed"])

    def test_flexible_cases_and_temporal_reset(self):
        schema = spec(layers=[layer(kind="activation", mode=0)])
        schema["inputs"]["x"]["allowed_shapes"] = [[1, 1, 2, 2], [1, 1, 4, 4]]
        labels = [name for name, _ in input_cases(spec=schema)]
        self.assertIn("shape-1x1x4x4", labels)
        temporal = copy.deepcopy(schema)
        temporal["inputs"] = {name: {"shape": [1, 1, 2, 2], "allowed_shapes": []} for name in ("data", "prev_img", "prev_mask")}
        reset = dict(input_cases(spec=temporal))["temporal-reset"]
        self.assertEqual(reset["prev_img"].sum(), 0)
        self.assertEqual(reset["prev_mask"].sum(), 0)


if __name__ == "__main__":
    torch.set_num_threads(1)
    unittest.main()
