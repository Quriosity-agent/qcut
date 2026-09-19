"""Asset-free regression tests for the scoped ordered CPU arithmetic."""
import hashlib
import json
import unittest
from unittest.mock import patch

import torch

from matting_cpu_math import CPU_SOFTMAX, cpu_exp, fused, reciprocal_estimate
from matting_phase5_cases import holdout_cases
from matting_phase5_numeric import (four_lane_pointwise, ordered_convolution, ordered_tanh,
                                    ordered_upsample, pinned_sigmoid, pinned_tanh)
from matting_phase5_torch import ORDERED_PROFILE, OrderedMattingGraph
from matting_torch import (CPU_FORMAT, CPU_RUNTIME_SHA256, INPUT_SHAPES, LOADED_SHA256,
                           ORDERED_CPU_FORMAT, OUTPUT_SHAPES, SOURCE_SHA256, load_model)


class OrderedMathTests(unittest.TestCase):
    def setUp(self):
        torch.set_num_threads(1)

    def test_dense_non_square_stride_and_padding(self):
        conv = torch.nn.Conv2d(2, 3, (2, 3), stride=(2, 1), padding=(1, 1))
        with torch.no_grad():
            conv.weight.fill_(.25)
            conv.bias.fill_(.5)
        value = torch.arange(60, dtype=torch.float32).reshape(1, 2, 5, 6)
        self.assertTrue(torch.equal(ordered_convolution(value=value, conv=conv), conv(value)))

    def test_depthwise_non_square_and_batch(self):
        conv = torch.nn.Conv2d(4, 4, (3, 2), stride=(1, 2), padding=(1, 1), groups=4)
        with torch.no_grad():
            conv.weight.fill_(.125)
            conv.bias.fill_(.25)
        value = torch.arange(160, dtype=torch.float32).reshape(2, 4, 4, 5)
        self.assertTrue(torch.equal(ordered_convolution(value=value, conv=conv), conv(value)))

    def test_bias_last_pointwise_is_observable(self):
        conv = torch.nn.Conv2d(2, 1, 1)
        with torch.no_grad():
            conv.weight.fill_(1)
            conv.bias.fill_(1e8)
        value = torch.tensor([-1e8, 1.]).reshape(1, 2, 1, 1)
        self.assertEqual(ordered_convolution(value=value, conv=conv).item(), 0)
        self.assertEqual(ordered_convolution(value=value, conv=conv, bias_first=True).item(), 1)

    def test_layout_does_not_change_order(self):
        generator = torch.Generator().manual_seed(114)
        conv = torch.nn.Conv2d(3, 4, 3, padding=1)
        value = torch.randn(1, 3, 5, 8, generator=generator)
        reference = ordered_convolution(value=value, conv=conv)
        self.assertTrue(torch.equal(reference, ordered_convolution(value=value.contiguous(memory_format=torch.channels_last), conv=conv)))

    def test_convolution_rejects_unsupported_parameters(self):
        for conv in (torch.nn.Conv2d(4, 4, 1, groups=2), torch.nn.Conv2d(4, 4, 1, bias=False),
                     torch.nn.Conv2d(4, 4, 1, dilation=2)):
            with self.assertRaises(ValueError):
                ordered_convolution(value=torch.ones(1, 4, 3, 3), conv=conv)
        conv = torch.nn.Conv2d(1, 1, 1)
        with self.assertRaises(ValueError):
            ordered_convolution(value=torch.ones(1, 1, 3, 3), conv=conv, bias_first=1)

    def test_convolution_rejects_nonfinite_dtype_and_channels(self):
        conv = torch.nn.Conv2d(2, 2, 1)
        for value in (torch.zeros(1, 2, 2, 2, dtype=torch.float64), torch.zeros(1, 3, 2, 2),
                      torch.full((1, 2, 2, 2), float("nan"))):
            with self.assertRaises(ValueError):
                ordered_convolution(value=value, conv=conv)

    def test_four_lane_balanced_tree_not_left_associative(self):
        conv = torch.nn.Conv2d(16, 2, 1)
        with torch.no_grad():
            conv.weight.fill_(1)
            conv.bias.zero_()
        value = torch.zeros(1, 16, 1, 1)
        value[:, :4, 0, 0] = torch.tensor([1e8, -1e8, 1., 2.])
        self.assertTrue(torch.equal(four_lane_pointwise(value=value, conv=conv), torch.full((1, 2, 1, 1), 3.)))
        value[:, :4, 0, 0] = torch.tensor([1e8, 1., -1e8, 2.])
        self.assertTrue(torch.equal(four_lane_pointwise(value=value, conv=conv), torch.zeros(1, 2, 1, 1)))

    def test_four_lane_rejects_non_signature(self):
        for conv in (torch.nn.Conv2d(16, 3, 1), torch.nn.Conv2d(16, 2, 3), torch.nn.Conv2d(8, 2, 1)):
            with self.assertRaises(ValueError):
                four_lane_pointwise(value=torch.zeros(1, 16, 3, 3), conv=conv)

    def test_sigmoid_refinements_and_finite_range(self):
        value = torch.linspace(-20, 20, 128).reshape(1, 4, 4, 8)
        actual = pinned_sigmoid(value=value)
        self.assertTrue(torch.isfinite(actual).all())
        self.assertTrue(torch.allclose(actual, value.sigmoid(), atol=1e-5, rtol=1e-5))

    def test_tanh_tail_is_nhwc_not_nchw(self):
        value = torch.linspace(-.8, .8, 120).reshape(1, 5, 4, 6)
        output = ordered_tanh(value=value).permute(0, 2, 3, 1).flatten()
        tail = value.permute(0, 2, 3, 1).flatten()[-8:]
        expected = 2 / (1 + (-2 * tail).double().exp().float()) - 1
        self.assertTrue(torch.equal(output[-8:], expected))

    def test_tanh_vector_loop_retains_full_eight_element_tail(self):
        for size in (8, 9, 15, 16, 17, 24, 25):
            value = torch.linspace(-1, 1, size).reshape(1, 1, 1, size)
            start = (size - 1) // 8 * 8
            result = ordered_tanh(value=value).flatten()
            expected = 2 / (1 + (-2 * value.flatten()[start:]).double().exp().float()) - 1
            self.assertTrue(torch.equal(result[start:], expected))

    def test_tanh_fuses_last_multiply_and_subtract(self):
        value = torch.linspace(-.7, .7, 32).reshape(1, 1, 4, 8)
        denominator = 1 + cpu_exp(value=-2 * value)
        r = reciprocal_estimate(value=denominator)
        r = r * (2 - denominator.double() * r.double()).float()
        step = (2 - denominator.double() * r.double()).float()
        expected = fused(a=2 * r, b=step, c=-1)
        self.assertTrue(torch.equal(ordered_tanh(value=value).flatten()[:-8], expected.flatten()[:-8]))
        self.assertFalse(torch.equal(expected.flatten()[:-8], pinned_tanh(value=value).flatten()[:-8]))

    def test_tanh_rejects_nonfinite_shape_and_dtype(self):
        for value in (torch.ones(8), torch.ones(1, 1, 1, 7), torch.ones(1, 1, 1, 8, dtype=torch.float64),
                      torch.full((1, 1, 1, 8), float("inf"))):
            with self.assertRaises(ValueError):
                ordered_tanh(value=value)

    def test_resize_zero_padding_non_square(self):
        value = torch.ones(1, 4, 3, 5)
        result = ordered_upsample(value=value, formulation="pinned")
        self.assertEqual(result.shape, (1, 4, 6, 10))
        self.assertTrue(torch.equal(result[:, :, 1:-1, 1:-1], torch.ones(1, 4, 4, 8)))
        self.assertEqual(result[0, 0, 0, 0].item(), .5625)
        self.assertEqual(result[0, 0, 1, 0].item(), .75)

    def test_resize_channel_profile_changes_bottom_corner_rounding(self):
        generator = torch.Generator().manual_seed(8873)
        value = torch.rand(1, 4, 4, 32, generator=generator)
        result = ordered_upsample(value=value, formulation="pinned")
        self.assertTrue(torch.equal(result[:, :, -1, -1], (value[:, :, -1, -1] * .75) * .75))
        two = ordered_upsample(value=value[:, :2], formulation="pinned")
        self.assertTrue(torch.equal(two[:, :, -1, -1], value[:, :2, -1, -1] * .5625))

    def test_resize_rejects_unsupported_channel_and_profile(self):
        with self.assertRaises(ValueError):
            ordered_upsample(value=torch.ones(1, 3, 4, 4), formulation="pinned")
        with self.assertRaises(ValueError):
            ordered_upsample(value=torch.ones(1, 4, 4, 4), formulation="unknown")

    def test_holdouts_are_repeatable_full_shape_and_independent(self):
        left, right = holdout_cases(), holdout_cases()
        self.assertEqual(len(left), 4)
        for name in left:
            self.assertEqual({k: tuple(v.shape) for k, v in left[name].items()}, INPUT_SHAPES)
            self.assertTrue(all(torch.equal(v, right[name][key]) for key, v in left[name].items()))
        self.assertFalse(torch.equal(left["phase5-holdout-7103"]["data"], left["phase5-holdout-19019"]["data"]))


class OrderedLoaderTests(unittest.TestCase):
    def bundle(self):
        nodes = [["DataV2", "fake"] for _ in range(198)]
        return {"format": ORDERED_CPU_FORMAT, "source_asset": {"sha256": SOURCE_SHA256},
                "loaded_buffer": {"sha256": LOADED_SHA256}, "resize_profile": "half-pixel-zero-border",
                "runtime_sha256": CPU_RUNTIME_SHA256, "softmax_profile": CPU_SOFTMAX,
                "arithmetic_profile": ORDERED_PROFILE, "input_schema": INPUT_SHAPES,
                "output_schema": OUTPUT_SHAPES, "fp16_decoder_profile": "arm64-four-lane-xor-subnormal-standard-tail",
                "nodes": nodes, "validation_status": "native-parity-passed"}

    def test_new_format_does_not_self_promote(self):
        with patch("matting_torch.torch.load", return_value=self.bundle()):
            with self.assertRaisesRegex(ValueError, "allow_unverified=True"):
                load_model(path="unused")

    def test_wrong_profile_rejected_before_model_creation(self):
        bundle = self.bundle()
        bundle["arithmetic_profile"] = "almost-exact"
        sha = hashlib.sha256(json.dumps(bundle["nodes"], separators=(",", ":")).encode()).hexdigest()
        with patch("matting_torch.NODES_SHA256", sha), patch("matting_torch.torch.load", return_value=bundle):
            with self.assertRaisesRegex(ValueError, "arithmetic profile mismatch"):
                load_model(path="unused", allow_unverified=True)

    def test_old_format_cannot_smuggle_ordered_profile(self):
        bundle = self.bundle()
        bundle["format"] = CPU_FORMAT
        sha = hashlib.sha256(json.dumps(bundle["nodes"], separators=(",", ":")).encode()).hexdigest()
        with patch("matting_torch.NODES_SHA256", sha), patch("matting_torch.torch.load", return_value=bundle):
            with self.assertRaisesRegex(ValueError, "legacy matting arithmetic"):
                load_model(path="unused", allow_unverified=True)

    def test_runtime_and_schema_are_still_pinned(self):
        for key, value in (("runtime_sha256", "0" * 64), ("input_schema", {}), ("output_schema", {})):
            bundle = {**self.bundle(), key: value}
            sha = hashlib.sha256(json.dumps(bundle["nodes"], separators=(",", ":")).encode()).hexdigest()
            with patch("matting_torch.NODES_SHA256", sha), patch("matting_torch.torch.load", return_value=bundle):
                with self.assertRaisesRegex(ValueError, "runtime or tensor schema"):
                    load_model(path="unused", allow_unverified=True)

    def test_ordered_relu_normalizes_negative_zero(self):
        nodes = ["DataV2 data 1 1 1 1 4 0 0".split(),
                 "Convolution out 1 1 1 1 1 0 0 1 1 4 0 4 0 4 0 data out".split()]
        model = OrderedMattingGraph(nodes=nodes)
        with patch("matting_phase5_torch.ordered_convolution", return_value=torch.tensor([[[[-0.]]]])):
            actual = model.evaluate_node(index=1, values={"data": torch.zeros(1, 1, 1, 1)})["out"]
        self.assertFalse(torch.signbit(actual).any())


if __name__ == "__main__":
    unittest.main()
