"""Synthetic contracts for the narrow vision interpreter and artifact loader."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import torch
from torch.nn import functional as F

from vision_batch_export import fresh_directory, synthetic_cases, synthetic_input_cases
from vision_batch_profiles import (ORDERED_EXECUTION_PROFILE, execution_profile,
                                   input_shapes as profile_input_shapes)
from vision_batch_torch import (EXECUTION_PROFILE, FORMAT, PROFILES, RUNTIME_SHA256,
                                VisionGraph, digest, load_model, parse_graph, separable_bilinear, state_digest)


def data_row(*, h=4, w=4, name="data"):
    return ["DataV2", name, "1", str(h), str(w), "3", "4", "0", "0"]


def conv_row(*, kind="Convolution", name="conv", cin="data", co=3, kernel=1, relu=0):
    return [kind, name, str(co), str(kernel), str(kernel), "1", "1", str(kernel // 2), str(kernel // 2),
            "1", str(relu), "4", "0", "4", "0", "4", "0", cin, name]


def graph_text(*, nodes, inputs=1):
    return f"{inputs} {len(nodes) - inputs} 0\\n\n" + "\n".join(" ".join(row) + "\\n" for row in nodes) + "\n"


class VisionGraphTests(unittest.TestCase):
    def setUp(self):
        torch.set_num_threads(1)

    def test_parser_accepts_only_audited_prefix(self):
        text = graph_text(nodes=[data_row(), conv_row()])
        self.assertEqual(parse_graph(text=text), parse_graph(text="D\\n\n" + text))
        self.assertEqual(parse_graph(text=text), parse_graph(text="E\\n\nD\\n\n" + text))
        for prefix in ("B", "unknown", "D\\n\nE"):
            with self.assertRaises(ValueError):
                parse_graph(text=prefix + "\n" + text)

    def test_parser_rejects_bad_count_empty_and_oversize(self):
        for text in ("", "1 2 0\nDataV2 x", "1 -1 0\n", "x" * 131073, None):
            with self.assertRaises(ValueError):
                parse_graph(text=text)

    def test_pointwise_ohwi_and_bias(self):
        weights = np.arange(12, dtype=np.float32) / 16
        model = VisionGraph(nodes=[data_row(), conv_row()], weights=weights)
        value = torch.arange(48, dtype=torch.float32).reshape(1, 3, 4, 4)
        expected = torch.einsum("oc,nchw->nohw", torch.from_numpy(weights[:9]).reshape(3, 3), value)
        expected += torch.from_numpy(weights[-3:])[None, :, None, None]
        torch.testing.assert_close(model({"data": value})["conv"], expected, atol=0, rtol=0)

    def test_depthwise_hwc_weight_order(self):
        weights = np.arange(30, dtype=np.float32) / 32
        model = VisionGraph(nodes=[data_row(), conv_row(kind="DepthwiseSeparableConvolution", kernel=3)], weights=weights)
        value = torch.arange(48, dtype=torch.float32).reshape(1, 3, 4, 4)
        expected = torch.cat([F.conv2d(value[:, c:c+1], torch.from_numpy(weights[:27][c::3]).reshape(1, 1, 3, 3),
                                       bias=torch.tensor([weights[27+c]]), padding=1) for c in range(3)], dim=1)
        torch.testing.assert_close(model({"data": value})["conv"], expected, atol=0, rtol=0)

    def test_shuffle_channel_interleave(self):
        nodes = [data_row(), conv_row(co=16), ["Shuffle", "shuffle", "4", "2", "conv", "shuffle"]]
        weights = np.concatenate([np.zeros(48, np.float32), np.arange(16, dtype=np.float32)])
        model = VisionGraph(nodes=nodes, weights=weights)
        value = torch.zeros(1, 3, 4, 4)
        self.assertEqual(model({"data": value})["shuffle"][0, :, 0, 0].tolist(),
                         [0, 1, 2, 3, 8, 9, 10, 11, 4, 5, 6, 7, 12, 13, 14, 15])

    def test_nearest_and_bilinear_half_pixel(self):
        value = torch.arange(48, dtype=torch.float32).reshape(1, 3, 4, 4)
        for mode in ("NEAREST", "BILINEAR"):
            model = VisionGraph(nodes=[data_row(), ["UpSampling", "up", "data", "up", mode]])
            expected = F.interpolate(value, scale_factor=2, mode=mode.lower(), align_corners=False if mode == "BILINEAR" else None)
            torch.testing.assert_close(model({"data": value})["up"], expected, atol=0, rtol=0)

    def test_residual_relu_and_all_terminals(self):
        nodes = [data_row(), conv_row(), ["Eltwise", "sum", "data", "data", "sum", "4", "0", "1"]]
        model = VisionGraph(nodes=nodes, weights=np.zeros(12, np.float32))
        result = model({"data": -torch.ones(1, 3, 4, 4)})
        self.assertEqual(set(result), {"conv", "sum"})
        self.assertEqual(result["sum"].count_nonzero().item(), 0)

    def test_global_pool_dense_and_singleton_reshape(self):
        nodes = [data_row(), ["PoolingDown", "pool", "4", "4", "1", "1", "0", "0", "4", "0", "AVE", "data", "pool", "GLOBAL"],
                 ["OnnxOp1", "reshape", "Reshape", "pool", "reshape", "4", "0", "1", "1", "1", "3", "2"],
                 ["InnerProduct", "fc", "2", "1", "1", "4", "0", "4", "0", "4", "0", "reshape", "fc"]]
        weights = np.array([1, 0, 0, 0, 1, 0, -1, 2], np.float32)
        model = VisionGraph(nodes=nodes, weights=weights)
        output = model({"data": torch.ones(1, 3, 4, 4)})["fc"]
        self.assertEqual(output.flatten().tolist(), [0, 3])

    def test_average_pool_2x2(self):
        row = ["PoolingDown", "pool", "2", "2", "2", "2", "0", "0", "4", "0", "AVE", "data", "pool"]
        model = VisionGraph(nodes=[data_row(), row])
        value = torch.arange(48, dtype=torch.float32).reshape(1, 3, 4, 4)
        torch.testing.assert_close(model({"data": value})["pool"], F.avg_pool2d(value, 2, 2), atol=0, rtol=0)

    def test_condition_gate_sigmoid_and_fractional_upsample(self):
        nodes = [data_row(), data_row(h=1, w=1, name="cond"), conv_row(name="feat"),
                 conv_row(name="gate", cin="cond"), ["Sigmoid", "sig", "gate", "sig", "4", "0"],
                 ["SEScale", "scaled", "feat", "sig", "scaled", "4", "0", "0"],
                 ["Upsample", "up", "1.5", "linear", "0", "1", "scaled", "up"]]
        weights = np.concatenate([np.arange(12, dtype=np.float32), np.arange(12, dtype=np.float32)[::-1].copy()])
        model = VisionGraph(nodes=parse_graph(text=graph_text(nodes=nodes, inputs=2)), weights=weights)
        self.assertEqual(model.input_shapes, {"data": (1, 3, 4, 4), "cond": (1, 3, 1, 1)})
        self.assertEqual(model.output_shapes, {"up": (1, 3, 6, 6)})
        image, cond = torch.rand(1, 3, 4, 4), torch.rand(1, 3, 1, 1)
        result = model({"data": image, "cond": cond}, capture=True)
        expected_scaled = result["feat"] * torch.sigmoid(result["gate"])
        torch.testing.assert_close(result["scaled"], expected_scaled, atol=0, rtol=0)
        torch.testing.assert_close(result["up"], F.interpolate(expected_scaled, size=(6, 6), mode="bilinear",
                                                              align_corners=False), atol=0, rtol=0)

    def test_inputs_must_lead_and_gate_must_be_singleton(self):
        with self.assertRaises(ValueError):
            VisionGraph(nodes=[data_row(), conv_row(), data_row(name="late")])
        with self.assertRaises(ValueError):
            VisionGraph(nodes=[data_row(), data_row(name="other"), conv_row(), conv_row(name="b", cin="other"),
                               ["SEScale", "s", "conv", "b", "s", "4", "0", "0"]])
        for row in (["Upsample", "up", "0.5", "linear", "0", "1", "conv", "up"],
                    ["Upsample", "up", "2", "nearest", "0", "1", "conv", "up"],
                    ["Upsample", "up", "2", "linear", "1", "1", "conv", "up"]):
            with self.assertRaises(ValueError):
                VisionGraph(nodes=[data_row(), conv_row(), row])
        with self.assertRaises(ValueError):
            parse_graph(text=graph_text(nodes=[data_row(), data_row(name="other"), conv_row()], inputs=1))

    def test_profile_input_shapes_and_multi_input_cases(self):
        self.assertEqual(profile_input_shapes(profile={"input_shape": [1, 3, 4, 4]}), {"data": (1, 3, 4, 4)})
        shapes = profile_input_shapes(profile={"input_shapes": {"data0": [1, 3, 4, 4], "data1": [1, 3, 1, 1]}})
        cases = synthetic_input_cases(shapes=shapes)
        self.assertEqual(len(cases), 10)
        self.assertEqual({tuple(v.shape) for case in cases.values() for v in case.values()}, {(1, 3, 4, 4), (1, 3, 1, 1)})
        first, second = cases["random-17"]["data0"].flatten()[:3], cases["random-17"]["data1"].flatten()
        self.assertFalse(np.array_equal(first, second))
        np.testing.assert_array_equal(cases["random-17"]["data0"], synthetic_cases(shape=(1, 3, 4, 4))["random-17"])

    def test_dilated_conv_max_pool_split_multiply_and_reduce(self):
        nodes = [data_row(h=8, w=8), conv_row(name="feat"),
                 ["Conv2D", "dil", "1", "3", "4", "3", "3", "1", "1", "2", "2", "2", "2", "2", "2", "1", "1", "4", "0", "4", "0", "4", "0", "feat", "dil"],
                 ["Pooling", "pool", "2", "2", "2", "2", "0", "0", "4", "0", "MAX", "dil", "pool"],
                 ["Slice", "split", "dil", "1", "1", "3", "2", "rgb", "0", "rest", "0"],
                 ["OnnxOp2", "mul", "Mul", "rgb", "data", "mul", "4", "0"],
                 ["OnnxOp1", "sum", "ReduceSum", "mul", "sum", "4", "0", "1", "1", "1"],
                 ["Eltwise", "add", "sum", "rest", "add", "4", "0", "0"]]
        weights = np.linspace(-1, 1, 12 + 4 * 3 * 9 + 4, dtype=np.float32)
        text = f"E\\n\nD\\n\n" + graph_text(nodes=nodes)
        model = VisionGraph(nodes=parse_graph(text=text), weights=weights)
        self.assertEqual(model.output_shapes, {"pool": (1, 4, 4, 4), "add": (1, 1, 8, 8)})
        value = torch.rand(1, 3, 8, 8)
        result = model({"data": value}, capture=True)
        layer = model.layers["2"]
        torch.testing.assert_close(result["dil"], F.conv2d(result["feat"], layer.weight, layer.bias, padding=2, dilation=2).relu(), atol=0, rtol=0)
        torch.testing.assert_close(result["pool"], F.max_pool2d(result["dil"], 2, 2), atol=0, rtol=0)
        torch.testing.assert_close(result["rgb"], result["dil"][:, :3], atol=0, rtol=0)
        torch.testing.assert_close(result["rest"], result["dil"][:, 3:], atol=0, rtol=0)
        torch.testing.assert_close(result["add"], (result["rgb"] * value).sum(1, keepdim=True) + result["rest"], atol=0, rtol=0)
        ordered = VisionGraph(nodes=parse_graph(text=text), weights=weights, ordered=True)
        torch.testing.assert_close(ordered({"data": value})["add"], result["add"], atol=1e-5, rtol=1e-5)
        with self.assertRaises(ValueError):
            VisionGraph(nodes=[data_row(), conv_row(), ["Slice", "s", "conv", "1", "1", "3", "2", "a", "0", "b", "0"]])

    def test_separable_bilinear_matches_half_pixel_resize(self):
        value = torch.rand(1, 3, 3, 4)
        for size in ((6, 8), (5, 7)):
            torch.testing.assert_close(separable_bilinear(value=value, size=size),
                                       F.interpolate(value, size=size, mode="bilinear", align_corners=False),
                                       atol=4e-6, rtol=0)
        constant = torch.full((1, 2, 3, 3), 0.7)
        self.assertTrue(torch.equal(separable_bilinear(value=constant, size=(5, 5)), torch.full((1, 2, 5, 5), 0.7)))

    def test_ordered_execution_matches_plain_within_rounding(self):
        nodes = [data_row(), conv_row(name="a", kernel=3), conv_row(kind="DepthwiseSeparableConvolution", name="b", cin="a", kernel=3),
                 ["Tanh", "t", "b", "t", "4", "0"], ["Sigmoid", "s", "b", "s", "4", "0"], ["UpSampling", "u", "b", "u", "BILINEAR"]]
        weights = np.linspace(-1, 1, 84 + 30, dtype=np.float32)
        plain = VisionGraph(nodes=nodes, weights=weights)
        ordered = VisionGraph(nodes=nodes, weights=weights, ordered=True)
        value = torch.rand(1, 3, 4, 4)
        for name in ("t", "s", "u"):
            torch.testing.assert_close(ordered({"data": value})[name], plain({"data": value})[name], atol=1e-5, rtol=1e-5)
        with self.assertRaises(ValueError):
            VisionGraph(nodes=nodes, ordered=1)
        self.assertEqual(execution_profile(profile={"execution": "ordered-fma"}), ORDERED_EXECUTION_PROFILE)
        self.assertNotEqual(execution_profile(profile={}), ORDERED_EXECUTION_PROFILE)

    def test_bad_weight_arena_rejected(self):
        for weights in (np.zeros(11, np.float32), np.zeros(13, np.float32), np.zeros(12, np.float64),
                        np.full(12, np.nan, np.float32), np.zeros((3, 4), np.float32)):
            with self.assertRaises(ValueError):
                VisionGraph(nodes=[data_row(), conv_row()], weights=weights)

    def test_unsupported_operator_and_storage_rejected(self):
        for row in (["Softmax", "x", "data", "x"], ["GridSample", "x"],
                    conv_row(kind="DilationSeparableConvolution"), conv_row(relu=2)):
            with self.assertRaises(ValueError):
                VisionGraph(nodes=[data_row(), row])
        row = conv_row()
        row[11] = "1"
        with self.assertRaises(ValueError):
            VisionGraph(nodes=[data_row(), row])

    def test_missing_input_duplicate_layer_and_output(self):
        bad = ([data_row(), conv_row(cin="missing")], [data_row(), conv_row(), conv_row()],
               [data_row(), ["Tanh", "new", "data", "data", "4", "0"]])
        for nodes in bad:
            with self.assertRaises(ValueError):
                VisionGraph(nodes=nodes)

    def test_depthwise_multiplier_and_residual_broadcast_rejected(self):
        with self.assertRaises(ValueError):
            VisionGraph(nodes=[data_row(), conv_row(kind="DepthwiseSeparableConvolution", co=6)])
        with self.assertRaises(ValueError):
            VisionGraph(nodes=[data_row(), conv_row(co=1), ["Eltwise", "sum", "data", "conv", "sum", "4", "0", "0"]])

    def test_invalid_inputs_rejected(self):
        model = VisionGraph(nodes=[data_row(), conv_row()])
        for values in ({}, {"data": torch.zeros(1, 3, 4, 4), "extra": 1},
                       {"data": torch.zeros(1, 3, 4, 4, dtype=torch.float64)},
                       {"data": torch.zeros(1, 3, 4, 4, dtype=torch.int16)},
                       {"data": torch.full((1, 3, 4, 4), float("inf"))},
                       {"data": torch.zeros(1, 3, 4, 5)}):
            with self.assertRaises(ValueError):
                model(values)

    def test_nonfinite_terminal_rejected(self):
        model = VisionGraph(nodes=[data_row(), conv_row()], weights=np.full(12, 1e30, np.float32))
        with self.assertRaises(ValueError):
            model({"data": torch.full((1, 3, 4, 4), 1e30)})

    def test_input_strides_cannot_change_replay(self):
        model = VisionGraph(nodes=[data_row(), conv_row(kernel=3)], weights=np.arange(84, dtype=np.float32) / 16)
        value = torch.arange(48, dtype=torch.float32).reshape(1, 3, 4, 4) / 7
        alternate = value.contiguous(memory_format=torch.channels_last)
        self.assertNotEqual(value.stride(), alternate.stride())
        self.assertTrue(torch.equal(model({"data": value})["conv"], model({"data": alternate})["conv"]))

    def test_holdout_inputs_are_deterministic_and_distinct(self):
        cases = synthetic_cases(shape=(1, 3, 4, 4))
        self.assertEqual(len(cases), 10)
        self.assertEqual(sum(k.startswith("holdout") for k in cases), 4)
        self.assertEqual(len({digest(data=v.tobytes()) for v in cases.values()}), 10)
        for name, value in synthetic_cases(shape=(1, 3, 4, 4)).items():
            np.testing.assert_array_equal(value, cases[name])

    def test_output_path_escape_rejected(self):
        with self.assertRaises(ValueError):
            fresh_directory(path=Path("/tmp/vision-output"))


class VisionBundleTests(unittest.TestCase):
    def setUp(self):
        nodes = [data_row(), conv_row()]
        self.model = VisionGraph(nodes=nodes, weights=np.arange(12, dtype=np.float32))
        text = graph_text(nodes=nodes)
        self.profile = {"source_sha256": "a" * 64, "bm_sha256": "b" * 64,
                        "graph_sha256": digest(data=text.encode()), "input_shape": [1, 3, 4, 4],
                        "outputs": {"conv": [1, 3, 4, 4]}, "native_verified": True,
                        "state_sha256": state_digest(state=self.model.state_dict())}
        self.bundle = {"format": FORMAT, "local_only": True, "profile": "synthetic", **self.profile,
                       "runtime_sha256": RUNTIME_SHA256, "execution_profile": EXECUTION_PROFILE,
                       "graph_text": text, "state_dict": self.model.state_dict(),
                       "state_sha256": state_digest(state=self.model.state_dict()),
                       "verification_status": "native-parity-passed"}
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "synthetic.pt"

    def load(self, *, allow_unverified=False, expected_sha256=None):
        torch.save(self.bundle, self.path)
        with patch.dict(PROFILES, {"synthetic": self.profile}):
            return load_model(path=self.path, allow_unverified=allow_unverified, expected_sha256=expected_sha256)

    def test_ordered_profile_requires_ordered_bundle_stamp(self):
        self.profile["execution"] = "ordered-fma"
        with self.assertRaises(ValueError):
            self.load()
        self.bundle["execution_profile"] = ORDERED_EXECUTION_PROFILE
        self.assertTrue(self.load().ordered)

    def test_weights_only_roundtrip(self):
        clone = self.load()
        for name, tensor in self.model.state_dict().items():
            self.assertTrue(torch.equal(tensor, clone.state_dict()[name]))

    def test_candidate_requires_explicit_opt_in(self):
        self.bundle["verification_status"] = "verification-failed"
        with self.assertRaisesRegex(ValueError, "not native verified"):
            self.load()
        self.load(allow_unverified=True)

    def test_truthy_candidate_opt_in_rejected(self):
        self.bundle["verification_status"] = "verification-failed"
        for value in ("false", "true", 1, 0, None, []):
            with self.assertRaisesRegex(ValueError, "explicit boolean"):
                self.load(allow_unverified=value)

    def test_hash_and_deserialization_share_same_bytes(self):
        real_load = torch.load
        observed = []

        def wrapped(stream, **kwargs):
            self.assertFalse(isinstance(stream, (str, Path)))
            observed.append(digest(data=stream.getvalue()))
            self.assertTrue(kwargs["weights_only"])
            self.assertEqual(kwargs["map_location"], "cpu")
            return real_load(stream, **kwargs)

        with patch("vision_batch_torch.torch.load", side_effect=wrapped):
            self.load()
        self.assertEqual(observed, [digest(data=self.path.read_bytes())])

    def test_malformed_profile_rejected_cleanly(self):
        for value in ([], {}, None, 1, "unknown"):
            self.bundle["profile"] = value
            with self.assertRaisesRegex(ValueError, "source provenance"):
                self.load()

    def test_provenance_tampering_rejected(self):
        original = deepcopy(self.bundle)
        for key in ("source_sha256", "bm_sha256", "graph_sha256", "runtime_sha256", "execution_profile", "graph_text", "state_sha256", "format"):
            self.bundle = deepcopy(original)
            self.bundle[key] = "tampered"
            with self.assertRaises(ValueError, msg=key):
                self.load()

    def test_weights_and_artifact_hash_tampering_rejected(self):
        self.bundle["state_dict"]["layers.1.weight"] += 1
        with self.assertRaisesRegex(ValueError, "state digest"):
            self.load()
        with self.assertRaisesRegex(ValueError, "artifact hash"):
            self.load(expected_sha256="0" * 64)

    def test_rehashed_forged_weights_still_rejected(self):
        self.bundle["state_dict"]["layers.1.weight"] += 1
        self.bundle["state_sha256"] = state_digest(state=self.bundle["state_dict"])
        with self.assertRaisesRegex(ValueError, "state digest"):
            self.load()

    def test_forged_candidate_status_still_rejected(self):
        self.profile["native_verified"] = False
        with self.assertRaisesRegex(ValueError, "not native verified"):
            self.load()
        self.load(allow_unverified=True)

    def test_state_digest_includes_shape_and_name(self):
        tensor = torch.zeros(2, 3)
        self.assertNotEqual(state_digest(state={"x": tensor}), state_digest(state={"x": tensor.reshape(3, 2)}))
        self.assertNotEqual(state_digest(state={"x": tensor}), state_digest(state={"y": tensor}))

    def test_state_rejects_empty_nonfinite_and_wrong_dtype(self):
        for state in ({}, {"x": torch.tensor(float("nan"))}, {"x": torch.zeros(2, dtype=torch.int16)}, {"x": np.zeros(2)}):
            with self.assertRaises(ValueError):
                state_digest(state=state)


class VisionONNXReplayTests(unittest.TestCase):
    def test_named_outputs_cannot_be_missing_or_extra(self):
        from vision_batch_onnx_replay import compare
        value = np.ones((1, 2), np.float32)
        for actual, expected in (({}, {}), ({"a": value}, {"b": value}),
                                 ({"a": value, "b": value}, {"a": value})):
            with self.assertRaisesRegex(ValueError, "named outputs"):
                compare(actual=actual, expected=expected)

    def test_tolerance_is_fixed_and_reference_relative(self):
        from vision_batch_onnx_replay import compare
        reference = np.array([0, 10], np.float32)
        good = np.array([0.00009, 10.001], np.float32)
        bad = np.array([0.00011, 10.002], np.float32)
        self.assertTrue(compare(actual={"out": good}, expected={"out": reference})["passed"])
        result = compare(actual={"out": bad}, expected={"out": reference})
        self.assertFalse(result["passed"])
        self.assertEqual(result["outputs"]["out"]["failing_elements"], 2)

    def test_shape_dtype_and_nonfinite_cannot_broadcast_or_cast(self):
        from vision_batch_onnx_replay import compare
        expected = {"out": np.ones((1, 2), np.float32)}
        for value in (np.ones(2, np.float32), np.ones((1, 2), np.float64),
                      np.ones((1, 2), np.int16), np.full((1, 2), np.nan, np.float32)):
            with self.assertRaisesRegex(ValueError, "dtype, shape"):
                compare(actual={"out": value}, expected=expected)

    def test_case_set_must_include_all_eighteen_unique_names(self):
        from vision_batch_onnx_replay import check_cases
        for cases in ([], [{}], [{"case": "same"}] * 18):
            with self.assertRaises(ValueError):
                check_cases(entry={"cases": cases}, native_report={"cases": cases})

    def test_contract_requires_exact_source_bundle_and_fixed_schema(self):
        from vision_batch_onnx_replay import check_contract
        entry = {"profile": "clip2m", "artifact_sha256": "b" * 64}
        metadata = {"source_format": FORMAT, "source_bundle_sha256": "b" * 64, "network": None,
                    "inputs": {"data": {"shape": [1, 3, 224, 224], "dtype": "float32"}},
                    "outputs": {"v_projector": {"shape": [1, 128, 1, 1], "dtype": "float32"}}}
        check_contract(metadata=metadata, entry=entry)
        for key, value in (("source_bundle_sha256", "bad"), ("network", "main"),
                           ("outputs", {"wrong": {"shape": [1, 128, 1, 1], "dtype": "float32"}})):
            changed = {**metadata, key: value}
            with self.assertRaisesRegex(ValueError, "source/schema"):
                check_contract(metadata=changed, entry=entry)


if __name__ == "__main__":
    unittest.main()
