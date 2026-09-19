"""Synthetic diagnostic tests; native/full-network evidence is recorded separately."""
import json
import unittest
from pathlib import Path
from unittest.mock import patch

import torch

from matting_cpu_boundary import (bucket_fields, bucket_witnesses, channels_last_experiment, convolution_profiles,
                                   metrics, sequential_conv, teacher_forced)
from matting_cpu_math import two_channel_softmax
from matting_cpu_media import validate_video
from matting_cpu_counterexample import reproduce
from matting_cpu_test import synthetic_model
from matting_torch import INPUT_SHAPES


class BoundaryTests(unittest.TestCase):
    def setUp(self):
        torch.set_num_threads(1)

    def test_bitwise_comparison_keeps_signed_zero(self):
        result = metrics(actual=torch.tensor([-0.]), expected=torch.tensor([0.]))
        self.assertTrue(result["passed"])
        self.assertFalse(result["bitwise_equal"])
        self.assertEqual(result["bitwise_differing_values"], 1)

    def test_teacher_forced_does_not_propagate_previous_error(self):
        model = synthetic_model()
        inputs = {name: torch.zeros(shape) for name, shape in INPUT_SHAPES.items()}
        with torch.inference_mode():
            trace = model(inputs, trace=True)
        propagated = {**trace, "logits": trace["logits"] + 0.01}
        rows = teacher_forced(model=model, native=trace, propagated=propagated)
        local = next(row for row in rows if row["tensor"] == "logits")
        self.assertFalse(local["propagated"]["passed"])
        self.assertTrue(local["same_native_inputs"]["bitwise_equal"])
        self.assertTrue(all(row["same_native_inputs"]["bitwise_equal"] for row in rows))

    def test_evaluate_node_matches_complete_forward(self):
        model = synthetic_model()
        generator = torch.Generator().manual_seed(9701)
        inputs = {name: torch.rand(shape, generator=generator) for name, shape in INPUT_SHAPES.items()}
        sequential = dict(inputs)
        with torch.inference_mode():
            trace = model(inputs, trace=True)
            for index in range(len(model.nodes)):
                sequential.update(model.evaluate_node(index=index, values=sequential))
        self.assertEqual(set(trace), set(sequential))
        self.assertTrue(all(torch.equal(trace[name], sequential[name]) for name in trace))

    def test_convolution_profile_does_not_modify_parameters(self):
        model = synthetic_model()
        saved = {name: value.clone() for name, value in model.state_dict().items()}
        with torch.inference_mode():
            trace = model({name: torch.zeros(shape) for name, shape in INPUT_SHAPES.items()}, trace=True)
            result = convolution_profiles(model=model, native=trace)
        self.assertEqual(len(result), 1)
        self.assertEqual(len(result[0]["profiles"]), 11)
        self.assertTrue(all(value["bitwise_equal"] for value in result[0]["profiles"].values()))
        self.assertTrue(all(torch.equal(saved[name], value) for name, value in model.state_dict().items()))

    def test_sequential_dense_convolution_non_square_stride_padding(self):
        conv = torch.nn.Conv2d(2, 3, (2, 3), stride=(2, 1), padding=(1, 1))
        with torch.no_grad():
            conv.weight.fill_(0.25)
            conv.bias.fill_(0.5)
        value = torch.arange(60, dtype=torch.float32).reshape(1, 2, 5, 6)
        for spatial in (False, True):
            for bias_first in (False, True):
                for fma in (False, True):
                    actual = sequential_conv(value=value, conv=conv, spatial_major=spatial,
                                             bias_first=bias_first, use_fma=fma)
                    self.assertTrue(torch.equal(actual, conv(value)))

    def test_reduction_is_bounded_and_rejects_other_convolutions(self):
        for conv in (torch.nn.Conv2d(65, 2, 1), torch.nn.Conv2d(2, 2, 1, groups=2),
                     torch.nn.Conv2d(2, 2, 1, bias=False), torch.nn.Conv2d(2, 2, 2, dilation=2)):
            with self.assertRaises(ValueError):
                sequential_conv(value=torch.zeros(1, conv.in_channels, 3, 3), conv=conv,
                                spatial_major=False, bias_first=True, use_fma=True)

    def test_layout_experiment_preserves_candidate_and_all_outputs(self):
        model = synthetic_model()
        inputs = {name: torch.zeros(shape) for name, shape in INPUT_SHAPES.items()}
        with torch.inference_mode():
            trace = model(inputs, trace=True)
        report = channels_last_experiment(model=model, inputs=inputs, native=trace)
        self.assertEqual(set(report["outputs"]), set(model.output_shapes))
        self.assertTrue(all(value["bitwise_equal"] for value in report["outputs"].values()))
        self.assertIn("not persisted", report["scope"])
        with torch.inference_mode():
            after = model(inputs, trace=True)
        self.assertTrue(all(torch.equal(trace[name], after[name]) for name in trace))

    def test_identical_logits_produce_no_false_witness(self):
        value = torch.zeros(1, 2, 4, 4)
        report = bucket_witnesses(actual_logits=value, native_logits=value,
                                 native_probabilities=two_channel_softmax(value=value))
        self.assertEqual(report["failing_pixels"], 0)
        self.assertEqual(report["bucket_changed_pixels"], 0)
        self.assertEqual(report["witnesses"], [])
        self.assertTrue(report["isolated_softmax_native_logits"]["bitwise_equal"])

    def test_boundary_crossing_has_explanatory_witness_and_cap(self):
        native = torch.zeros(1, 2, 4, 4)
        actual = native.clone()
        actual[:, 1] = 0.1
        report = bucket_witnesses(actual_logits=actual, native_logits=native,
                                 native_probabilities=two_channel_softmax(value=native), limit=3)
        self.assertEqual(report["failing_pixels"], 16)
        self.assertEqual(len(report["witnesses"]), 3)
        self.assertTrue(report["all_failures_have_bucket_change"])
        self.assertTrue(all(row["bucket_changed"] for row in report["witnesses"]))
        self.assertIn("not a native-parity", report["standard_softmax_control"]["scope"])

    def test_wrong_native_output_is_not_excused_as_boundary(self):
        value = torch.zeros(1, 2, 4, 4)
        report = bucket_witnesses(actual_logits=value, native_logits=value,
                                 native_probabilities=torch.zeros_like(value))
        self.assertFalse(report["isolated_softmax_native_logits"]["passed"])
        self.assertFalse(report["all_failures_have_bucket_change"])

    def test_invalid_boundary_schema_and_limits(self):
        value = torch.zeros(1, 2, 4, 4)
        for limit in (0, 65, True, 2.5):
            with self.assertRaises(ValueError):
                bucket_witnesses(actual_logits=value, native_logits=value,
                                 native_probabilities=value, limit=limit)
        with self.assertRaises(ValueError):
            bucket_witnesses(actual_logits=value, native_logits=value[:, :, :2], native_probabilities=value)

    def test_bucket_fields_include_exponent(self):
        value = torch.zeros(1, 2, 1, 8)
        value[:, 1] = torch.linspace(-4, 4, 8)
        fields = bucket_fields(logits=value)
        self.assertEqual(fields["bucket"].shape, (1, 1, 8))
        self.assertTrue(((fields["bucket"] >= 256) & (fields["bucket"] < 512)).all())
        self.assertGreater(len(torch.unique(fields["exponent"])), 1)

    def test_invalid_fps_fails_before_filesystem_access(self):
        for fps in (0, 31, 4.5, True):
            with patch("matting_cpu_media.fresh_directory", side_effect=AssertionError("must not create directory")):
                with self.assertRaises(ValueError):
                    validate_video(run=Path("missing"), out=Path("unused"), video=Path("missing"), frames=24, fps=fps)

    def test_counterexample_requires_completed_cpu_trace(self):
        for native in ({"status": "unverified", "forward_type": 0}, {"status": "completed", "forward_type": 1}):
            with patch("pathlib.Path.read_text", return_value=json.dumps({"native": native})):
                with self.assertRaisesRegex(ValueError, "completed CPU"):
                    reproduce(trace=Path("missing"), out=Path("unused"))

    def test_counterexample_cannot_invent_failing_pixels(self):
        source = {"native": {"status": "completed", "forward_type": 0}}
        values = torch.zeros(1, 2, 256, 256)
        with patch("pathlib.Path.read_text", return_value=json.dumps(source)):
            with patch("matting_cpu_counterexample.read_tensor", side_effect=[values, values, two_channel_softmax(value=values)]):
                with patch("matting_cpu_counterexample.fresh_directory", side_effect=AssertionError("must not create")):
                    with self.assertRaisesRegex(ValueError, "four distinct failing"):
                        reproduce(trace=Path("missing"), out=Path("unused"))


if __name__ == "__main__":
    unittest.main()
