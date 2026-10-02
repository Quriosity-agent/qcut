"""Self-authored alignment graphs, float-tail policies and actual artifact reloads."""
import copy
import gc
from pathlib import Path
import tempfile
import unittest

import numpy as np
import torch

from espresso_integer_export import compare, export_onnx, profile, session
from face_alignment_heads_parity import case_passed, comparisons, compare_float
from face_alignment_heads_torch import EspressoAlignmentGraph, global_average_float, load, stable_sigmoid


def synthetic_network(*, size=120):
    kind, fraction, classes = (2, 7, 3) if size == 120 else (1, 2, 5)
    rows = [f"data 1 {size} {size} 3 {kind} 6",
            f"Convolution stem 128 1 1 32 32 0 0 0 0 1 6 4 0 {kind} {fraction} data features",
            "PoolingDown pool 1 1 1 1 0 0 4 0 AVE features pooled GLOBAL",
            "OnnxOp1 reshape Reshape pooled vector 4 0 1 1 1 128 2",
            "InnerProduct landmark 212 1 0 4 0 4 0 4 0 vector landmarks",
            "InnerProduct visible-head 106 1 0 4 0 4 0 4 0 vector visible-logits",
            "Sigmoid visibility visible-logits visible 4 0",
            f"InnerProduct class-head {classes} 1 0 4 0 4 0 4 0 vector logits",
            "Softmax probabilities logits probabilities 4 0",
            "InnerProduct yaw-head 1 1 0 4 0 4 0 4 0 vector yaw",
            "InnerProduct pitch-head 1 1 0 4 0 4 0 4 0 vector pitch"]
    rng = np.random.default_rng(611 + size)
    arena = rng.integers(-8, 9, 128 * 3, dtype=np.int8).tobytes()
    for channels in (212, 106, classes, 1, 1):
        arena += rng.uniform(-0.1, 0.1, (channels, 128)).astype("<f4").tobytes()
        arena += rng.uniform(-0.2, 0.2, channels).astype("<f4").tobytes()
    return "1 10\n" + "\n".join(rows) + "\n", arena


def synthetic_report(*, model):
    report = {"passed": True, "blobs": {}}
    comparators = comparisons(graph=model.graph)
    for layer in model.execution_layers:
        if layer["op"] == "Input":
            continue
        for name in layer["outputs"]:
            descriptor = model.graph["descriptors"][name]
            floating = descriptor["type"] == 4
            value = np.zeros(model.graph["shapes"][name], np.float32 if floating else np.int64)
            checker = comparators.get(name, compare)
            check = checker(actual=value, expected=value if floating else value.astype(np.int16),
                            descriptor=descriptor, raw=(descriptor["type"], descriptor["fraction"]))
            keys = ("pytorch", "onnx", "pytorch_reloaded", "onnx_terminal") if name in model.output_names else ("pytorch", "onnx")
            report["blobs"][name] = {key: dict(check) for key in keys}
    return report


class AlignmentTailTest(unittest.TestCase):
    def test_saturated_sigmoid_keeps_small_probabilities_in_onnx(self):
        class SigmoidProbe(torch.nn.Module):
            def forward(self, value):
                return stable_sigmoid(value=value)

        value = torch.tensor([-80, -40, -25, -17, -10, -1, 0, 1, 10, 17, 25, 40, 80], dtype=torch.float32)
        expected = (1 / (1 + np.exp(-value.numpy().astype(np.float64)))).astype(np.float32)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sigmoid.onnx"
            torch.onnx.export(SigmoidProbe(), (value,), str(path), opset_version=18, dynamo=False,
                              input_names=["value"], output_names=["probability"])
            portable = session(path=path)
            for actual in (stable_sigmoid(value=value).numpy(), portable.run(None, {"value": value.numpy()})[0]):
                np.testing.assert_allclose(actual, expected, atol=0, rtol=0.00001)
                self.assertTrue(np.all(actual > 0))
            portable = None
        gc.collect()

    def test_both_profiles_produce_all_five_terminal_heads(self):
        torch.set_num_threads(1)
        for size in (120, 160):
            text, arena = synthetic_network(size=size)
            model = EspressoAlignmentGraph(text=text, arena=arena)
            outputs = model(torch.zeros((1, size, size, 3), dtype=torch.int64))
            self.assertEqual(model.output_names, ("landmarks", "visible", "probabilities", "yaw", "pitch"))
            self.assertEqual([value.shape[3] for value in outputs], [212, 106, 3 if size == 120 else 5, 1, 1])
            self.assertTrue(all(value.dtype == torch.float32 for value in outputs))
            np.testing.assert_allclose(outputs[2].sum(-1), 1, atol=1e-7)

    def test_pooling_uses_rounded_reciprocal_not_division(self):
        value = torch.zeros((1, 5, 5, 128), dtype=torch.int64)
        value[0, 0, 0] = torch.arange(-64, 64)
        result = global_average_float(value=value, fraction=2)
        expected = value.numpy().sum((1, 2), keepdims=True).astype(np.float32) * np.float32(0.01)
        np.testing.assert_array_equal(result, expected)
        self.assertTrue(np.any(result.numpy() != value.numpy().sum((1, 2), keepdims=True).astype(np.float32) / np.float32(100)))

    def test_pooling_rejects_wrong_dtype_shape_fraction_and_empty_input(self):
        value = torch.zeros((1, 4, 4, 128), dtype=torch.int64)
        for candidate, fraction in ((value.float(), 7), (value.reshape(16, 128), 7), (value[:, :0], 7),
                                     (value, True), (value, -1), (value, 32)):
            with self.assertRaises(ValueError):
                global_average_float(value=candidate, fraction=fraction)

    def test_network_rejects_unknown_float_sequence_or_missing_tail(self):
        text, arena = synthetic_network()
        for candidate in (text.replace("Sigmoid visibility", "Tanh visibility"),
                          text.replace("1 10\n", "1 1\n").split("PoolingDown")[0]):
            with self.assertRaisesRegex(ValueError, "floating"):
                EspressoAlignmentGraph(text=candidate, arena=arena)

    def test_wrong_image_feature_and_class_profiles_rejected(self):
        text, arena = synthetic_network()
        for candidate in (text.replace("120 120 3 2 6", "120 120 3 1 6"),
                          text.replace("120 120 3", "119 119 3"),
                          text.replace("2 7 data features", "2 6 data features"),
                          text.replace("class-head 3", "class-head 4")):
            with self.assertRaises(ValueError):
                EspressoAlignmentGraph(text=candidate, arena=arena)

    def test_dense_storage_bias_relu_and_wiring_rejected(self):
        text, arena = synthetic_network()
        for candidate in (text.replace("landmark 212 1 0", "landmark 212 0 0"),
                          text.replace("landmark 212 1 0", "landmark 212 1 1"),
                          text.replace("4 0 vector landmarks", "4 0 pooled landmarks"),
                          text.replace("212 1 0 4 0 4 0", "212 1 0 2 0 4 0")):
            with self.assertRaises(ValueError):
                EspressoAlignmentGraph(text=candidate, arena=arena)

    def test_global_pool_and_reshape_contract_rejected(self):
        text, arena = synthetic_network()
        for candidate in (text.replace("AVE", "MAX"), text.replace(" GLOBAL", ""),
                          text.replace("1 128 2\n", "1 128 3\n")):
            with self.assertRaises(ValueError):
                EspressoAlignmentGraph(text=candidate, arena=arena)

    def test_complete_arena_and_nonfinite_weights_are_checked(self):
        text, arena = synthetic_network()
        for candidate in (arena[:-1], arena + b"0", arena[:384] + np.array([np.nan], "<f4").tobytes() + arena[388:]):
            with self.assertRaises(ValueError):
                EspressoAlignmentGraph(text=text, arena=candidate)

    def test_prefix_dynamic_profile_and_unknown_or_duplicate_outputs_rejected(self):
        text, arena = synthetic_network()
        for changes in ({"prefix_output": "features"}, {"input_shapes": {"data": (1, 160, 160, 3)}},
                        {"output_names": ["missing"]}, {"output_names": ["yaw", "yaw"]}, {"output_names": []}):
            with self.assertRaises(ValueError):
                EspressoAlignmentGraph(text=text, arena=arena, **changes)

    def test_runtime_input_shape_dtype_and_source_ownership(self):
        text, arena = synthetic_network()
        model = EspressoAlignmentGraph(text=text, arena=arena)
        value = torch.zeros((1, 120, 120, 3), dtype=torch.int64)
        for candidate in (value.float(), value[:, :-1]):
            with self.assertRaises(ValueError):
                model(candidate)
        snapshot = value.clone()
        blobs = model.intermediate(inputs={"data": value})
        self.assertEqual(len(blobs), 11)
        self.assertEqual(blobs["features"].dtype, torch.int64)
        self.assertEqual(blobs["pooled"].dtype, torch.float32)
        self.assertTrue(torch.equal(value, snapshot))

    def test_onnx_and_pt2_reload_change_with_runtime_input_for_both_profiles(self):
        for size in (120, 160):
            text, arena = synthetic_network(size=size)
            model = EspressoAlignmentGraph(text=text, arena=arena).eval()
            value = torch.zeros((1, size, size, 3), dtype=torch.int64)
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                export_onnx(model=model, inputs=(value,), path=root / "model.onnx")
                portable = session(path=root / "model.onnx")
                torch.export.save(torch.export.export(model, (value,)), root / "model.pt2")
                reloaded = torch.export.load(root / "model.pt2").module()
                for candidate in (value, torch.full_like(value, 63), torch.full_like(value, -64)):
                    expected = model(candidate)
                    actual = portable.run(None, {"data": candidate.numpy()})
                    for converted, saved, reference in zip(actual, reloaded(candidate), expected, strict=True):
                        np.testing.assert_allclose(converted, reference, atol=1e-6, rtol=1e-5)
                        np.testing.assert_array_equal(saved, reference)
                portable = reloaded = model = None
            gc.collect()

    def test_shared_export_profile_accepts_explicit_alignment_loader(self):
        text, arena = synthetic_network()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "graph.txt").write_bytes(text.encode("ascii"))
            (root / "arena.bin").write_bytes(arena)
            runner = profile(network=root, inputs={"data": (np.zeros((1, 120, 120, 3), np.int64), (2, 6))},
                             out=root / "artifacts", loader=load)
            self.assertEqual(len(runner["names"]), 10)
            self.assertEqual(len(runner["model"].output_names), 5)
            runner.clear()
        gc.collect()


class AlignmentFloatGateTest(unittest.TestCase):
    def test_declared_limits_accept_rounding_but_not_wrong_dtype_or_descriptor(self):
        expected = np.ones((1, 1, 1, 3), np.float32)
        args = {"actual": expected + np.float32(1e-6), "expected": expected,
                "descriptor": {"type": 4, "fraction": 0}, "raw": (4, 0),
                "atol": 0.0001, "rtol": 0.00001, "relative_limit": None}
        self.assertTrue(compare_float(**args)["passed"])
        for changed in ({"actual": expected + 0.1}, {"actual": expected.astype(np.float64)},
                        {"expected": expected.astype(np.float64)}, {"actual": np.full_like(expected, np.nan)},
                        {"expected": np.full_like(expected, np.inf)}, {"raw": (4, 1)},
                        {"actual": expected.reshape(-1)}, {"actual": np.zeros((0,), np.float32), "expected": np.zeros((0,), np.float32)}):
            self.assertFalse(compare_float(**{**args, **changed})["passed"])

    def test_pooling_requires_exact_values_and_tiny_probabilities_need_relative_accuracy(self):
        value = np.full((1, 1, 1, 3), 1e-15, np.float32)
        args = {"expected": value, "descriptor": {"type": 4, "fraction": 0}, "raw": (4, 0)}
        self.assertFalse(compare_float(**args, actual=value * 2, atol=0.0, rtol=0.0, relative_limit=None)["passed"])
        self.assertFalse(compare_float(**args, actual=value * 2, atol=1e-6, rtol=1e-5, relative_limit=0.001)["passed"])
        self.assertTrue(compare_float(**args, actual=value, atol=0.0, rtol=0.0, relative_limit=None)["passed"])

    def test_full_report_requires_every_stage_and_serialized_terminal(self):
        text, arena = synthetic_network()
        model = EspressoAlignmentGraph(text=text, arena=arena)
        report = synthetic_report(model=model)
        self.assertTrue(case_passed(report=report, graph=model.graph, terminals=model.output_names))
        for name, checks in report["blobs"].items():
            for key in checks:
                candidate = copy.deepcopy(report)
                candidate["blobs"][name].pop(key)
                self.assertFalse(case_passed(report=candidate, graph=model.graph, terminals=model.output_names))

    def test_gate_rejects_integer_error_changed_tolerance_nonfinite_and_missing_metrics(self):
        text, arena = synthetic_network()
        model = EspressoAlignmentGraph(text=text, arena=arena)
        original = synthetic_report(model=model)
        for name, key, value in (("features", "max_abs", 1), ("landmarks", "atol", 0.01),
                                  ("landmarks", "rtol", 1.0), ("landmarks", "max_abs", float("nan")),
                                  ("landmarks", "passed", 1), ("pooled", "atol", False),
                                  ("probabilities", "max_relative", 0.01), ("visible", "exact", 1),
                                  ("features", "elements", 1), ("landmarks", "elements", 1)):
            report = copy.deepcopy(original)
            report["blobs"][name]["pytorch"][key] = value
            self.assertFalse(case_passed(report=report, graph=model.graph, terminals=model.output_names))
        for key in original["blobs"]["landmarks"]["pytorch"]:
            report = copy.deepcopy(original)
            report["blobs"]["landmarks"]["pytorch"].pop(key)
            self.assertFalse(case_passed(report=report, graph=model.graph, terminals=model.output_names))

    def test_gate_rejects_empty_extra_duplicate_terminals_and_malformed_report(self):
        text, arena = synthetic_network()
        model = EspressoAlignmentGraph(text=text, arena=arena)
        for report in (None, {}, [], {"passed": True, "blobs": []}):
            self.assertFalse(case_passed(report=report, graph=model.graph, terminals=model.output_names))
        report = synthetic_report(model=model)
        for terminals in ((), ("yaw", "yaw"), ("unknown",)):
            self.assertFalse(case_passed(report=report, graph=model.graph, terminals=terminals))
        self.assertFalse(case_passed(report={**report, "passed": 1}, graph=model.graph, terminals=model.output_names))


if __name__ == "__main__":
    unittest.main()
