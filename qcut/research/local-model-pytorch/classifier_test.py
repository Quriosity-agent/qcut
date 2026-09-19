"""Synthetic contracts; no vendor assets or native runtime required."""
import copy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import torch

from classifier_export import PRIVATE, build_cases, compare_outputs, safe_directory
from classifier_torch import ClassifierGraph, EXECUTION_PROFILE, FORMAT, PROFILES, RUNTIME_SHA256, digest, fused_activation, hard_sigmoid, load_model, parse_spec, state_digest


def data_node():
    return ["DataV2", "data", "1", "224", "224", "3", "4", "0", "0"]


def conv_node(*, op="Convolution", source="data", output="conv", co=3, kernel=1, mode="0"):
    return [op, output, str(co), str(kernel), str(kernel), "1", "1", str(kernel // 2), str(kernel // 2), "1", mode,
            "4", "0", "4", "0", "4", "0", source, output]


def synthetic_bundle():
    nodes = [data_node(), ["OnnxOp1", "reduce", "ReduceSum", "data", "reduced", "4", "0", "2", "2", "3", "1"],
             ["InnerProduct", "dense", "1", "1", "0", "4", "0", "4", "0", "4", "0", "reduced", "dense"]]
    source = "dense"
    for index in range(116):
        output = f"value{index}"
        nodes.append(["Sigmoid", f"layer{index}", source, output, "4", "0"])
        source = output
    text = "D\\n\n1 118 0\\n\n" + "\n".join(" ".join(row) + "\\n" for row in nodes) + "\n"
    profile = {"source_sha256": "1" * 64, "bm_sha256": "2" * 64, "graph_sha256": digest(data=text.encode()),
               "output_name": source, "output_channels": 1}
    model = ClassifierGraph(nodes=nodes, weights=np.asarray([0.1, 0.2, 0.3, 0.4], dtype=np.float32)).eval()
    profile["state_sha256"] = state_digest(state=model.state_dict())
    bundle = {"format": FORMAT, "profile": "synthetic", "source_sha256": profile["source_sha256"],
              "bm_sha256": profile["bm_sha256"], "graph_sha256": profile["graph_sha256"], "runtime_sha256": RUNTIME_SHA256,
              "local_only": True, "graph_text": text, "state_dict": model.state_dict(), "execution_profile": EXECUTION_PROFILE}
    return model, profile, bundle


class ClassifierTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(2)
        PRIVATE.mkdir(parents=True, exist_ok=True)

    def test_hard_eight_boundaries(self):
        value = torch.tensor([-8, -4, -2, 0, 2, 4, 8], dtype=torch.float32)
        expected = torch.tensor([0, 0, 0.25, 0.5, 0.75, 1, 1])
        self.assertTrue(torch.equal(hard_sigmoid(value=value), expected))
        self.assertTrue(torch.equal(fused_activation(value=value, mode="2"), expected))
        self.assertEqual((value * hard_sigmoid(value=value)).min().item(), -0.5)
        with self.assertRaises(ValueError):
            fused_activation(value=value, mode="3")

    def test_convolution_ohwi(self):
        values = np.arange(2 * 3 * 3 * 3 + 2, dtype=np.float32) / 100
        model = ClassifierGraph(nodes=[data_node(), conv_node(co=2, kernel=3)], weights=values)
        for out in range(2):
            for channel in range(3):
                for y in range(3):
                    for x in range(3):
                        self.assertEqual(model.layers["1"].weight[out, channel, y, x].item(), values[((out * 3 + y) * 3 + x) * 3 + channel])
        self.assertTrue(torch.equal(model.layers["1"].bias, torch.from_numpy(values[-2:])))

    def test_depthwise_hwc(self):
        values = np.arange(30, dtype=np.float32)
        model = ClassifierGraph(nodes=[data_node(), conv_node(op="DepthwiseSeparableConvolution", kernel=3)], weights=values)
        self.assertEqual(model.layers["1"].groups, 3)
        for channel in range(3):
            self.assertTrue(torch.equal(model.layers["1"].weight[channel, 0], torch.from_numpy(values[:27].reshape(3, 3, 3)[:, :, channel])))

    def test_sum_divide_uses_weight_scalar_not_spatial_mean(self):
        nodes = [data_node(), ["OnnxOp1", "sum", "ReduceSum", "data", "sum", "4", "0", "2", "2", "3", "1"],
                 ["Constant", "scalar", "0", "1", "1", "1", "1", "scalar", "4", "0"],
                 ["OnnxOp2", "div", "Div", "sum", "scalar", "out", "4", "0"]]
        model = ClassifierGraph(nodes=nodes, weights=np.asarray([2048], dtype=np.float32))
        output = model({"data": torch.ones(1, 3, 224, 224)})["out"]
        self.assertTrue(torch.equal(output, torch.full((1, 3, 1, 1), 224 * 224 / 2048)))
        with torch.no_grad():
            model.constants["2"].zero_()
        with self.assertRaises(ValueError):
            model({"data": torch.ones(1, 3, 224, 224)})

    def test_unknown_field_mutations_rejected(self):
        for field, value in ((2, "999"), (3, "7"), (5, "3"), (7, "4"), (9, "0"), (10, "4"), (11, "2"), (12, "1"), (17, "future")):
            row = conv_node()
            row[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                ClassifierGraph(nodes=[data_node(), row])
        for op in ("GhostNet", "GRU", "Padding", "Resize"):
            with self.subTest(op=op), self.assertRaises(ValueError):
                ClassifierGraph(nodes=[data_node(), [op, "output"]])

    def test_unknown_activation_divisor_rejected(self):
        for row in (["ReluHardSwish", "out", "data", "out", "4", "0", "6", "0"],
                    ["ReluHardSigmoid", "out", "data", "out", "4", "0", "8", "1"],
                    ["Sigmoid", "out", "data", "out", "4", "0", "extra"]):
            with self.subTest(row=row), self.assertRaises(ValueError):
                ClassifierGraph(nodes=[data_node(), row])

    def test_invalid_topology_rejected(self):
        for nodes in ([data_node(), conv_node(output="data")],
                      [data_node(), conv_node(op="DepthwiseSeparableConvolution", co=6)],
                      [data_node(), conv_node(co=1), conv_node(op="DepthwiseSeparableConvolution", source="conv", output="depth", co=2)],
                      [data_node(), ["Eltwise", "add", "data", "missing", "out", "4", "0", "0"]],
                      [data_node(), ["SEScale", "scale", "data", "data", "out", "4", "0", "0"]]):
            with self.subTest(nodes=nodes), self.assertRaises(ValueError):
                ClassifierGraph(nodes=nodes)

    def test_weight_bounds_and_nonfinite(self):
        for values in (np.zeros(11, dtype=np.float32), np.zeros(13, dtype=np.float32), np.zeros(12, dtype=np.float64), np.full(12, np.nan, dtype=np.float32)):
            with self.subTest(size=values.size, dtype=str(values.dtype)), self.assertRaises(ValueError):
                ClassifierGraph(nodes=[data_node(), conv_node()], weights=values)

    def test_input_shape_dtype_and_finite(self):
        model = ClassifierGraph(nodes=[data_node(), conv_node()], weights=np.zeros(12, dtype=np.float32))
        inputs = ({}, {"wrong": torch.zeros(1, 3, 224, 224)}, {"data": torch.zeros(1, 3, 224, 223)},
                  {"data": torch.zeros(1, 3, 224, 224, dtype=torch.float64)}, {"data": torch.full((1, 3, 224, 224), float("nan"))})
        for value in inputs:
            with self.subTest(names=list(value)), self.assertRaises(ValueError):
                model(value)

    def test_comparison_is_not_vacuous_and_checks_every_output(self):
        good = torch.zeros(1, 3, 1, 1)
        bad = good.clone()
        bad[0, 2] = 0.0002
        self.assertFalse(compare_outputs(expected={}, actual={})["passed"])
        self.assertFalse(compare_outputs(expected={"x": good}, actual={"y": good})["passed"])
        self.assertFalse(compare_outputs(expected={"x": good}, actual={"x": bad})["passed"])
        self.assertFalse(compare_outputs(expected={"x": good}, actual={"x": good.flatten()})["passed"])
        self.assertFalse(compare_outputs(expected={"x": good}, actual={"x": good + float("nan")})["passed"])
        self.assertTrue(compare_outputs(expected={"x": good}, actual={"x": good})["passed"])

    def test_fresh_private_directory(self):
        with self.assertRaises(ValueError):
            safe_directory(out=PRIVATE)
        with self.assertRaises(ValueError):
            safe_directory(out=Path("/tmp/classifier-public"))
        with tempfile.TemporaryDirectory(dir=PRIVATE) as directory:
            out = safe_directory(out=Path(directory) / "new")
            (out / "stale").touch()
            with self.assertRaises(ValueError):
                safe_directory(out=out)

    def test_holdouts_are_finite_distinct_original_shape(self):
        cases = build_cases()
        self.assertGreaterEqual(sum(key.startswith("holdout-") for key in cases), 4)
        self.assertEqual(len({digest(data=value.tobytes()) for value in cases.values()}), len(cases))
        for value in cases.values():
            self.assertEqual(value.shape, (1, 3, 224, 224))
            self.assertEqual(value.dtype, np.float32)
            self.assertTrue(np.isfinite(value).all())

    def test_weights_only_load_exact_state_forward(self):
        model, profile, bundle = synthetic_bundle()
        with tempfile.TemporaryDirectory(dir=PRIVATE) as directory, patch.dict(PROFILES, {"synthetic": profile}):
            path = Path(directory) / "synthetic.pt"
            torch.save(bundle, path)
            with patch("torch.load", wraps=torch.load) as loader:
                restored = load_model(path=path, expected_sha256=digest(data=path.read_bytes()))
                self.assertIs(loader.call_args.kwargs["weights_only"], True)
                self.assertEqual(loader.call_args.kwargs["map_location"], "cpu")
            for name, value in model.state_dict().items():
                self.assertTrue(torch.equal(value, restored.state_dict()[name]))
            inputs = {"data": torch.ones(1, 3, 224, 224)}
            self.assertTrue(torch.equal(model(inputs)[profile["output_name"]], restored(inputs)[profile["output_name"]]))
            with self.assertRaises(ValueError):
                load_model(path=path, expected_sha256="0" * 64)

    def test_loader_provenance_graph_and_state_rejections(self):
        _, profile, original = synthetic_bundle()
        changes = [("format", "other"), ("profile", "other"), ("runtime_sha256", "0" * 64),
                   ("source_sha256", "0" * 64), ("bm_sha256", "0" * 64), ("graph_sha256", "0" * 64),
                   ("local_only", False), ("graph_text", original["graph_text"].replace("224", "112")),
                   ("execution_profile", "standard-hard6"),
                   ("state_dict", {}), ("extra", True)]
        with tempfile.TemporaryDirectory(dir=PRIVATE) as directory, patch.dict(PROFILES, {"synthetic": profile}):
            path = Path(directory) / "bad.pt"
            for key, value in changes:
                bundle = {**original, key: value}
                torch.save(bundle, path)
                with self.subTest(key=key), self.assertRaises(ValueError):
                    load_model(path=path)
            for tensor in (torch.full((1, 3), float("inf")), torch.zeros(1, 3, dtype=torch.float64), torch.zeros(3, 1), torch.zeros(1, 3)):
                bundle = copy.deepcopy(original)
                bundle["state_dict"]["layers.2.weight"] = tensor
                torch.save(bundle, path)
                with self.subTest(dtype=str(tensor.dtype), shape=list(tensor.shape)), self.assertRaises(ValueError):
                    load_model(path=path)

    def test_graph_hash_gate(self):
        for profile in ("c73", "dance"):
            with self.assertRaises(ValueError):
                parse_spec(text="D\\n\n1 118 0\\n\n", profile=profile)

    def test_unknown_reduction_constant_scale_pool_dense_fields(self):
        invalid = [
            ["OnnxOp1", "sum", "ReduceSum", "data", "out", "4", "0", "2", "1", "3", "1"],
            ["OnnxOp1", "sum", "ReduceMean", "data", "out", "4", "0", "2", "2", "3", "1"],
            ["Constant", "scalar", "0", "1", "1", "1", "2", "scalar", "4", "0"],
            ["OnnxOp2", "div", "Mul", "data", "data", "out", "4", "0"],
            ["OnnxOp2", "div", "Div", "data", "data", "out", "4", "0"],
            ["SEScale", "scale", "data", "data", "out", "4", "0", "1"],
            ["Eltwise", "sum", "data", "data", "out", "4", "0", "1"],
            ["PoolingDown", "pool", "7", "7", "1", "1", "0", "0", "4", "0", "MAX", "data", "out", "GLOBAL"],
            ["InnerProduct", "dense", "1", "1", "1", "4", "0", "4", "0", "4", "0", "data", "out"],
        ]
        for row in invalid:
            with self.subTest(op=row[0]), self.assertRaises(ValueError):
                ClassifierGraph(nodes=[data_node(), row])

    def test_scale_and_residual_preserve_channels(self):
        nodes = [data_node(), ["OnnxOp1", "sum", "ReduceSum", "data", "sum", "4", "0", "2", "2", "3", "1"],
                 ["SEScale", "scale", "data", "sum", "scaled", "4", "0", "0"],
                 ["Eltwise", "add", "scaled", "data", "out", "4", "0", "0"]]
        model = ClassifierGraph(nodes=nodes)
        values = torch.ones(1, 3, 224, 224) * torch.tensor([1, 2, 3]).reshape(1, 3, 1, 1)
        self.assertTrue(torch.equal(model({"data": values})["out"], values * values.sum((2, 3), keepdim=True) + values))

    def test_state_hash_is_order_independent_but_content_sensitive(self):
        state = {"a": torch.zeros(3), "b": torch.ones(1)}
        self.assertEqual(state_digest(state=state), state_digest(state=dict(reversed(list(state.items())))))
        changed = {"a": torch.ones(3), "b": torch.ones(1)}
        self.assertNotEqual(state_digest(state=state), state_digest(state=changed))


if __name__ == "__main__":
    unittest.main()
