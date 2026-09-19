"""Synthetic-only unit tests; no licensed graph, weight, or runtime is required."""
import copy
import hashlib
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import torch

from tracking_export import compare_case, read_native, verified_network
from tracking_graph import compile_graph, unpack12
from tracking_numeric import exp_estimate, pair_softmax, reciprocal_estimate
from tracking_probe import PRIVATE, make_cases, private_directory
from tracking_torch import FORMAT, RUNTIME_SHA256, SOURCE_SHA256, TrackingGraph, load_model, load_models, requantize, saturate


def graph(*, fixed, rows):
    return "\n".join(["B" if fixed else "D", f"1 {len(rows) - 1} 7", *rows]) + "\n"


def pack12(*, values):
    values = np.asarray(values, dtype=np.int32).reshape(-1, 2) + 2047
    return np.stack((values[:, 0] >> 4, ((values[:, 0] & 15) << 4) | (values[:, 1] >> 8),
                     values[:, 1] & 255), axis=1).astype(np.uint8).tobytes()


def fixture(*, fixed):
    text = graph(fixed=fixed, rows=[f"DataV2 x 1 2 3 2 {'2 2' if fixed else '4 0'} 0",
                                    f"Convolution c 2 1 1 1 1 0 0 1 0 {'2 3 4 5 2 2' if fixed else '4 0 4 0 4 0'} x y"])
    weight = [8, 0, 0, 8] if fixed else [1, 0, 0, 1]
    arena = ((pack12(values=weight) + np.array([0, 0], dtype="<i4").tobytes()) if fixed else
             np.array([*weight, 0, 0], dtype="<f4").tobytes()) + struct.pack("<I", 7)
    return text, arena


class GraphTests(unittest.TestCase):
    def setUp(self):
        torch.set_num_threads(2)

    def test_packed_extremes_and_zero(self):
        values = [-2047, -1, 0, 1, 2047, 2048]
        np.testing.assert_array_equal(unpack12(data=pack12(values=values)), values)
        with self.assertRaises(ValueError):
            unpack12(data=b"\0")

    def test_float_and_fixed_identity_non_square_layout(self):
        for fixed in (False, True):
            text, arena = fixture(fixed=fixed)
            model = TrackingGraph(text=text, arena=arena)
            values = torch.arange(12).reshape(1, 2, 3, 2).to(torch.int16 if fixed else torch.float32)
            self.assertTrue(torch.equal(model({"x": values})["y"], values))
            self.assertEqual(model.input_schema["x"]["shape"], [1, 2, 3, 2])

    def test_quantized_rounding_and_saturation(self):
        values = torch.tensor([-7, -6, -5, -2, -1, 0, 1, 2, 3, 6])
        self.assertEqual(requantize(value=values, shift=2).tolist(), [-2, -1, -1, 0, 0, 0, 0, 1, 1, 2])
        self.assertEqual(saturate(value=torch.tensor([-32768, -2048, 2048, 32767])).tolist(), [-2047, -2047, 2047, 2047])
        self.assertEqual(requantize(value=torch.tensor([-2, 3]), shift=-2).tolist(), [-8, 12])
        with self.assertRaises(ValueError):
            requantize(value=values, shift=31)

    def test_residual_rounds_once(self):
        text = graph(fixed=True, rows=["DataV2 x 1 1 1 2 2 3 0", "Eltwise add x x y 2 2 0"])
        model = TrackingGraph(text=text, arena=struct.pack("<I", 7))
        self.assertEqual(model({"x": torch.tensor([[[[1]], [[-1]]]], dtype=torch.int16)})["y"].flatten().tolist(), [1, -1])

    def test_concat_rescales_and_crop_axes(self):
        text = graph(fixed=True, rows=["DataV2 x 1 4 3 2 2 3 0", "Crop cut 1 1 1 2 2 1 x part 3",
                                        "Concat join 2 part part y 2 2"])
        model = TrackingGraph(text=text, arena=struct.pack("<I", 7))
        x = torch.arange(24).reshape(1, 2, 3, 4).to(torch.int16)
        part = (x[:, 1:, 1:, 1:3].to(torch.int64) + 1) >> 1
        self.assertTrue(torch.equal(model({"x": x})["y"], torch.cat((part, part), dim=1).to(torch.int16)))

    def test_depthwise_hwc_weight_order(self):
        text = graph(fixed=False, rows=["DataV2 x 1 3 3 2 4 0 0",
            "DepthwiseSeparableConvolution c 2 3 3 1 1 0 0 1 0 4 0 4 0 4 0 x y"])
        weights = np.arange(18, dtype="<f4").reshape(3, 3, 2)
        arena = weights.tobytes() + bytes(8) + struct.pack("<I", 7)
        model = TrackingGraph(text=text, arena=arena)
        y = model({"x": torch.ones(1, 2, 3, 3)})["y"].flatten()
        self.assertTrue(torch.equal(y, torch.tensor(weights.sum(axis=(0, 1)))))

    def test_slice_constant_scalar_and_all_outputs(self):
        text = graph(fixed=False, rows=["DataV2 x 1 1 1 4 4 0 0", "Slice s x 1 1 2 2 a 0 b 0",
            "Constant k 0 1 1 1 1 k 4 0", "OnnxOp2 divide Div a k y 4 0"])
        model = TrackingGraph(text=text, arena=struct.pack("<fI", 2, 7))
        self.assertEqual(set(model.output_schema), {"b", "y"})
        outputs = model({"x": torch.tensor([[[[2.]], [[4.]], [[6.]], [[8.]]]])})
        self.assertEqual(outputs["y"].flatten().tolist(), [1, 2])
        self.assertEqual(outputs["b"].flatten().tolist(), [6, 8])

    def test_reshape_uses_nchw_then_transpose_uses_nhwc(self):
        text = graph(fixed=False, rows=["DataV2 x 1 2 1 4 4 0 0",
            "OnnxOp1 r Reshape x r 4 0 2 2 1 2 4", "Transpose t 1 3 0 2 r y"])
        model = TrackingGraph(text=text, arena=struct.pack("<I", 7))
        x = torch.arange(8, dtype=torch.float32).reshape(1, 4, 1, 2)
        expected = x.reshape(2, 2, 1, 2).permute(0, 2, 3, 1).permute(1, 3, 0, 2).permute(0, 3, 1, 2)
        self.assertTrue(torch.equal(model({"x": x})["y"], expected))

    def test_corrupt_or_unconsumed_arena_rejected(self):
        text, arena = fixture(fixed=True)
        for invalid in (arena[:-1], arena + bytes(4), arena[:-4] + struct.pack("<I", 8)):
            with self.subTest(arena=invalid):
                with self.assertRaises(ValueError):
                    TrackingGraph(text=text, arena=invalid)

    def test_nonfinite_weights_rejected(self):
        text, arena = fixture(fixed=False)
        with self.assertRaises(ValueError):
            TrackingGraph(text=text, arena=struct.pack("<f", float("nan")) + arena[4:])

    def test_unsupported_semantics_rejected(self):
        text, _ = fixture(fixed=True)
        variants = [text.replace("B\n", "Z\n"), text.replace("1 1 7", "1 2 7"),
                    text.replace("Convolution", "Unknown"), text.replace("2 3 4 5 2 2", "2 3 4 6 2 2"),
                    text.replace("2 3 4 5 2 2", "4 0 4 0 4 0"), text.replace(" x y", " x x"),
                    text.replace(" x y", " x ../escape"), text.replace("1 2 3 2", "1 2 3 0")]
        for variant in variants:
            with self.subTest(graph=variant):
                with self.assertRaises(ValueError):
                    compile_graph(text=variant)

    def test_wrong_inputs_rejected(self):
        for fixed in (False, True):
            text, arena = fixture(fixed=fixed)
            model = TrackingGraph(text=text, arena=arena)
            dtype = torch.int16 if fixed else torch.float32
            value = torch.zeros(1, 2, 3, 2, dtype=dtype)
            bad = [{}, {"other": value}, {"x": value, "extra": value}, {"x": value.double()}, {"x": value[:, :, :, :1]}]
            invalid = value.clone()
            invalid.flatten()[0] = 2048 if fixed else float("inf")
            bad.append({"x": invalid})
            for inputs in bad:
                with self.assertRaises(ValueError):
                    model(inputs)


class NumericTests(unittest.TestCase):
    def test_reciprocal_arm_estimate_buckets(self):
        value = torch.tensor([1., 1.001, 1.004, 2.])
        expected = torch.tensor([0.998046875, 0.998046875, 0.994140625, 0.4990234375])
        self.assertTrue(torch.equal(reciprocal_estimate(value=value), expected))
        with self.assertRaises(ValueError):
            reciprocal_estimate(value=torch.tensor([0.5]))

    def test_exp_profile_and_scalar_tail(self):
        value = torch.linspace(-10, 10, 101)
        self.assertTrue(torch.allclose(exp_estimate(value=value), value.exp(), atol=1e-4, rtol=1e-4))
        pairs = torch.tensor([[0., -7.]] * 5).reshape(5, 2, 1, 1)
        result = pair_softmax(value=pairs).reshape(5, 2)
        self.assertTrue(torch.equal(result[:4, 1], torch.full((4,), 1 / 512)))
        self.assertLess(float(result[-1, 1]), 0.001)
        self.assertTrue(torch.equal(result.sum(dim=1), torch.ones(5)))
        with self.assertRaises(ValueError):
            pair_softmax(value=torch.ones(1, 3, 1, 1))


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        PRIVATE.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="tracking-synthetic-", dir=PRIVATE)
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)

    def test_complete_holdout_all_outputs_required(self):
        record = {"parameter_roundtrip_exact": True, "native": {"forced_cpu": True, "forward_type": 0, "status": "completed"},
                  "output_schema": {"a": {}, "b": {}}, "cases": [{"role": "holdout", "passed": True, "finite": True,
                  "roundtrip_exact": True, "input_echo_exact": True, "outputs": {"a": {"passed": True}, "b": {"passed": True}}}]}
        self.assertTrue(verified_network(record=record))
        variants = []
        for field in ("finite", "roundtrip_exact", "input_echo_exact", "passed"):
            invalid = copy.deepcopy(record)
            invalid["cases"][0][field] = False
            variants.append(invalid)
        invalid = copy.deepcopy(record)
        invalid["cases"][0]["outputs"].pop("b")
        variants.append(invalid)
        invalid = copy.deepcopy(record)
        invalid["cases"][0]["role"] = "calibration"
        variants.append(invalid)
        variants.extend([{**record, "cases": []}, {**record, "output_schema": {}},
                         {**record, "native": {"forced_cpu": True, "forward_type": 1, "status": "completed"}}])
        for invalid in variants:
            self.assertFalse(verified_network(record=invalid))

    def test_native_shape_finite_echo_and_files(self):
        text, arena = fixture(fixed=False)
        model = TrackingGraph(text=text, arena=arena)
        array = np.arange(12, dtype="<f4").reshape(1, 3, 2, 2)
        for name in ("x", "y"):
            array.tofile(self.directory / f"native-{name}.bin")
        descriptor = self.directory / "native-tensors.tsv"
        good = "x\t1\t2\t3\t2\t4\t0\t48\ny\t1\t2\t3\t2\t4\t0\t48\n"
        descriptor.write_text(good)
        result = compare_case(directory=self.directory, model=model, restored=model, array=array, native_available=True)
        self.assertTrue(result["passed"])
        descriptor.write_text(good.replace("y\t1\t2\t3", "y\t1\t3\t2"))
        with self.assertRaises(ValueError):
            read_native(directory=self.directory, schemas={**model.input_schema, **model.output_schema})
        descriptor.write_text(good + good.splitlines()[0] + "\n")
        with self.assertRaises(ValueError):
            read_native(directory=self.directory, schemas={**model.input_schema, **model.output_schema})
        descriptor.write_text(good)
        invalid = array.copy()
        invalid.flat[0] = 42
        invalid.tofile(self.directory / "native-x.bin")
        self.assertFalse(compare_case(directory=self.directory, model=model, restored=model, array=array, native_available=True)["passed"])
        invalid.flat[0] = float("nan")
        invalid.tofile(self.directory / "native-y.bin")
        self.assertFalse(compare_case(directory=self.directory, model=model, restored=model, array=array, native_available=True)["passed"])
        (self.directory / "native-y.bin").write_bytes(bytes(4))
        with self.assertRaises(ValueError):
            read_native(directory=self.directory, schemas={**model.input_schema, **model.output_schema})

    def test_fresh_private_directory_and_independent_cases(self):
        with self.assertRaises(ValueError):
            private_directory(out=Path("/tmp/tracking-public-forbidden"))
        (self.directory / "exists").write_text("synthetic")
        with self.assertRaises(ValueError):
            private_directory(out=self.directory)
        cases = make_cases(shape=(1, 2, 3, 2), fixed=True, extended=True)
        self.assertEqual(len(cases), 13)
        self.assertFalse(np.array_equal(cases["holdout-new-full-range"], cases["random-17"]))

    def test_weights_only_roundtrip_and_provenance_rejection(self):
        text, arena = fixture(fixed=True)
        model = TrackingGraph(text=text, arena=arena)
        registry = {"synthetic": {"offset": 123, "graph_sha256": hashlib.sha256(text.encode()).hexdigest()}}
        bundle = {"format": FORMAT, "local_only": True, "source_sha256": SOURCE_SHA256,
                  "runtime_sha256": RUNTIME_SHA256, "networks": {"synthetic": {"graph": text,
                  "network_id": "bm-offset-0000007b", "state_dict": model.state_dict()}}}
        path = self.directory / "synthetic.pt"
        torch.save(bundle, path)
        with patch("tracking_torch.NETWORKS", registry), patch("tracking_torch.torch.load", wraps=torch.load) as loader:
            restored = load_model(path=path, name="synthetic")
            self.assertTrue(loader.call_args.kwargs["weights_only"])
            for name, value in model.state_dict().items():
                self.assertTrue(torch.equal(value, restored.state_dict()[name]))
            x = torch.arange(12).reshape(1, 2, 3, 2).to(torch.int16)
            self.assertTrue(torch.equal(model({"x": x})["y"], restored({"x": x})["y"]))
            with self.assertRaises(ValueError):
                load_models(path=path, expected_sha256="0" * 64)
            with self.assertRaises(ValueError):
                load_model(path=path, name="unknown")
            variants = [{**bundle, "source_sha256": "0" * 64}, {**bundle, "networks": {}}, {**bundle, "local_only": False}]
            for change in ("graph", "network_id", "state"):
                invalid = copy.deepcopy(bundle)
                item = invalid["networks"]["synthetic"]
                if change == "state":
                    item["state_dict"]["tensors.w1"] = item["state_dict"]["tensors.w1"].float()
                else:
                    item[change] += "bad"
                variants.append(invalid)
            for invalid in variants:
                torch.save(invalid, path)
                with self.assertRaises(ValueError):
                    load_models(path=path)


if __name__ == "__main__":
    unittest.main()
