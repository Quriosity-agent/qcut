"""Pure replacement contracts and mocked ONNX routing; no vendor/runtime calls."""
import argparse
import json
import unittest
from unittest.mock import Mock, patch

import numpy as np

import face_render_model_parity as probe
import face_render_model_parity_test as fixtures


class ReplacementTests(unittest.TestCase):
    def setUp(self):
        self.values = np.zeros((1, 120, 120, 3), np.int16)
        self.network = fixtures.network_record()
        self.network["successful_inferences"] = [0, 1]
        self.network["inputs"].append(dict(self.network["inputs"][0], inference=1))
        self.reader = Mock(return_value=self.values.copy())
        replacement = patch.object(probe, "load_tensor", self.reader)
        replacement.start()
        self.addCleanup(replacement.stop)

    def validate(self, *, values):
        return probe.validate_replacement_inputs(replacement_inputs=values, network=self.network)

    def replacements(self):
        return {(120, inference): self.values.copy() for inference in (0, 1)}

    def test_none_keeps_default_without_reading_captured_tensors(self):
        self.assertIsNone(self.validate(values=None))
        self.reader.assert_not_called()

    def test_complete_inputs_are_isolated_readonly_and_bit_exact(self):
        values = self.replacements()
        values[(120, 0)] = self.values.transpose(0, 2, 1, 3)
        values[(120, 1)].setflags(write=False)
        validated = self.validate(values=values)
        self.assertEqual(set(validated), {(120, 0), (120, 1)})
        for key, actual in validated.items():
            np.testing.assert_array_equal(actual, values[key])
            self.assertFalse(np.shares_memory(actual, values[key]))
            self.assertFalse(actual.flags.writeable)
            self.assertTrue(actual.flags.c_contiguous)
        values[(120, 0)].fill(127)
        self.assertEqual(int(validated[(120, 0)].max()), 0)
        self.assertEqual(self.reader.call_count, 2)

    def test_signed_limits_are_valid_without_clipping_or_channel_changes(self):
        self.values[0, 0, 0] = [-128, 0, 127]
        self.reader.return_value = self.values.copy()
        actual = self.validate(values=self.replacements())
        np.testing.assert_array_equal(actual[(120, 0)][0, 0, 0], [-128, 0, 127])

    def test_only_bounded_plain_dicts_accept_unique_keys(self):
        class DuplicateItems(dict):
            def items(self):
                return [((120, 0), self[(120, 0)])] * 2

        for value in (False, [], [((120, 0), self.values)] * 2, {},
                      DuplicateItems({(120, 0): self.values}),
                      {(120, inference): self.values for inference in range(130)}):
            with self.subTest(kind=type(value).__name__), self.assertRaisesRegex(ValueError, "dict"):
                self.validate(values=value)
        self.reader.assert_not_called()

    def test_missing_unknown_and_160_keys_reject_before_capture_reads(self):
        for values in ({(120, 0): self.values}, {(120, 2): self.values},
                       {**self.replacements(), (120, 2): self.values},
                       {**self.replacements(), (160, 0): self.values}):
            with self.subTest(keys=list(values)), self.assertRaises(ValueError):
                self.validate(values=values)
        self.reader.assert_not_called()

    def test_keys_reject_bool_numeric_aliases_wrong_profiles_and_shapes(self):
        for key in (None, 120, "120,0", (120,), (120, 0, 0), (True, 0), (120.0, 0),
                    ("120", 0), (160, 0), (120, False), (120, True), (120, 0.0),
                    (120, "0"), (120, -1), (120, 129), (np.int64(120), 0), (120, np.int64(0))):
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "keys"):
                self.validate(values={key: self.values})
        self.reader.assert_not_called()

    def test_array_type_dtype_shape_and_range_reject_before_capture_reads(self):
        values = [None, False, [], {}, np.ma.array(self.values), self.values.astype(">i2"),
                  *(self.values.astype(dtype) for dtype in (np.int8, np.int32, np.float32, np.bool_)),
                  *(np.zeros(shape, np.int16) for shape in ((120, 120, 3), (2, 120, 120, 3),
                                                          (1, 160, 160, 3), (1, 120, 120, 4), (0, 120, 120, 3))),
                  *(np.full(self.values.shape, value, np.int16) for value in (-129, 128, -32768, 32767))]
        for value in values:
            with self.subTest(dtype=getattr(value, "dtype", None), shape=getattr(value, "shape", None)), \
                    self.assertRaisesRegex(ValueError, "signed int16"):
                self.validate(values={(120, 0): value, (120, 1): self.values})
        self.reader.assert_not_called()

    def test_actual_inference_indices_are_bounded_typed_and_unique(self):
        for inferences in ([], None, [False], [0.0], [np.int64(0)], [0, 0], [-1], [129], list(range(130))):
            self.network["successful_inferences"] = inferences
            with self.subTest(indices=inferences), self.assertRaisesRegex(ValueError, "inference indices"):
                self.validate(values=self.replacements())
        self.reader.assert_not_called()

    def test_all_129_actual_inferences_can_be_replaced(self):
        self.network["successful_inferences"] = list(range(129))
        self.network["inputs"] = [dict(self.network["inputs"][0], inference=inference) for inference in range(129)]
        values = {(120, inference): self.values for inference in range(129)}
        self.assertEqual(len(self.validate(values=values)), 129)
        self.assertEqual(self.reader.call_count, 129)

    def test_each_replacement_requires_exact_actual_bytes_dtype_and_shape(self):
        for actual in (np.ones(self.values.shape, np.int16), self.values.astype(np.int8), self.values[:, :, :, :2]):
            self.reader.side_effect = [self.values.copy(), actual]
            with self.subTest(shape=actual.shape, dtype=actual.dtype), self.assertRaisesRegex(ValueError, "bit-exact"):
                self.validate(values=self.replacements())

    def test_actual_tensor_storage_is_not_relaxed(self):
        for changes in ({"name": "other"}, {"raw": [1, 6]}, {"dims_nwhc": [1, 160, 160, 3]}):
            original = self.network["inputs"][0]
            self.network["inputs"][0] = dict(original, **changes)
            with self.subTest(changes=changes), self.assertRaisesRegex(ValueError, "storage mismatch"):
                self.validate(values=self.replacements())
            self.network["inputs"][0] = original
        self.reader.assert_not_called()


class ComparisonCountTests(unittest.TestCase):
    def capture(self, *, count):
        captured = fixtures.capture_report()
        captured["comparisons"] = [dict(equal=True) for _ in range(count)]
        return captured

    def test_default_four_stays_strict_and_never_infers_report_count(self):
        probe.validate_capture(captured=self.capture(count=4))
        for count in (0, 1, 3, 5, 7, 24, 25):
            with self.subTest(count=count), self.assertRaisesRegex(ValueError, "pixel-neutral"):
                probe.validate_capture(captured=self.capture(count=count))

    def test_explicit_one_seven_and_24_counts_are_accepted_but_wrong_counts_reject(self):
        for count in (1, 7, 24):
            probe.validate_capture(captured=self.capture(count=count), expected_comparisons=count)
            with self.subTest(count=count), self.assertRaisesRegex(ValueError, "pixel-neutral"):
                probe.validate_capture(captured=self.capture(count=4), expected_comparisons=count)

    def test_bool_nonintegers_and_out_of_bounds_are_not_counts(self):
        for count in (False, True, 0, -1, 25, 4.0, "4", None, [], np.int64(4)):
            with self.subTest(count=count), self.assertRaisesRegex(ValueError, "typed expected comparison"):
                probe.validate_capture(captured=self.capture(count=4), expected_comparisons=count)

    def test_explicit_count_does_not_relax_pixel_neutrality_or_capture_provenance(self):
        for key, value in (("passed", 1), ("native_analysis_bypassed", True), ("captures", {})):
            captured = self.capture(count=7)
            captured[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                probe.validate_capture(captured=captured, expected_comparisons=7)
        captured = self.capture(count=7)
        captured["comparisons"][3]["equal"] = 1
        with self.assertRaisesRegex(ValueError, "pixel-neutral"):
            probe.validate_capture(captured=captured, expected_comparisons=7)


class ReplacementRunTests(fixtures.RunTests):
    def setUp(self):
        super().setUp()
        self.replacement_inputs = None
        self.expected_comparisons = 4

    def run_probe(self):
        (self.capture / "report.json").write_text(json.dumps(self.captured))
        (self.root / "summary.json").write_text(json.dumps(self.exported))
        self.session.reset_mock()
        self.session.side_effect = self.runners
        return probe.run(args=argparse.Namespace(capture=self.capture, root=self.root, out=self.out),
                         replacement_inputs=self.replacement_inputs, expected_comparisons=self.expected_comparisons)

    def use_replacements(self):
        self.replacement_inputs = {(120, 0): np.zeros((1, 120, 120, 3), np.int16)}

    def add_actual_inference(self):
        network = self.evidence["networks"]["120"]
        values = np.full((1, 120, 120, 3), 7, np.int16)
        values[0, 0, 0] = [-128, 0, 127]
        path = self.capture / "second-120-input.bin"
        path.write_bytes(values.tobytes())
        network["successful_inferences"].append(1)
        network["inputs"].append(dict(network["inputs"][0], inference=1, path=str(path), sha256=probe.digest(data=values.tobytes())))
        network["outputs"].extend([dict(item, inference=1) for item in network["outputs"]])
        self.evidence["successful_inferences"] += 1
        return values

    def test_default_report_keeps_sampling_flag_false_and_160_captured(self):
        result = self.run_probe()
        self.assertIs(result["independent_120_sampling_input_used"], False)
        for network in result["model_outputs"].values():
            for case in network["cases"]:
                self.assertEqual(case["input_source"], "captured_tensor")
                self.assertIsNone(case["replacement_input_sha256"])
                self.assertIsNone(case["replacement_input_source"])

    def test_all_actual_120_inputs_feed_replacements_not_reference_or_reload(self):
        self.use_replacements()
        self.replacement_inputs[(120, 1)] = self.add_actual_inference()
        real_load = probe.load_tensor
        reads = []

        def load_once(*, item):
            if item["name"] == "data" and item["dims_nwhc"] == [1, 120, 120, 3]:
                self.assertNotIn(item["inference"], reads, "captured 120 input reused after replacement validation")
                reads.append(item["inference"])
            return real_load(item=item)
        with patch.object(probe, "load_tensor", side_effect=load_once):
            result = self.run_probe()
        self.assertIs(result["independent_120_sampling_input_used"], True)
        self.assertIs(result["full_frame_geometry_independent"], False)
        self.assertFalse(result["native_inference_called"])
        self.assertEqual(result["head_comparisons"], 15)
        self.assertEqual(reads, [0, 1])
        for inference, call in enumerate(self.runners[0].run.call_args_list):
            np.testing.assert_array_equal(call.args[1]["data"], self.replacement_inputs[(120, inference)].astype(np.int64))
            case = result["model_outputs"]["120"]["cases"][inference]
            self.assertEqual(case["input_source"], "replacement_inputs")
            self.assertEqual(case["replacement_input_sha256"], probe.digest(data=self.replacement_inputs[(120, inference)].tobytes()))
            self.assertEqual(case["replacement_input_source"], f"replacement_inputs[(120, {inference})]")
        self.assertFalse(result["model_outputs"]["120"]["cases"][1]["recorded_reference_input_equal"])
        self.assertEqual(result["model_outputs"]["160"]["cases"][0]["input_source"], "captured_tensor")

    def test_caller_mutation_after_validation_does_not_change_used_input(self):
        self.use_replacements()
        validate = probe.validate_replacement_inputs

        def mutate_after_snapshot(**kwargs):
            result = validate(**kwargs)
            self.replacement_inputs[(120, 0)].fill(127)
            return result
        with patch.object(probe, "validate_replacement_inputs", side_effect=mutate_after_snapshot):
            report = self.run_probe()
        self.assertIs(report["independent_120_sampling_input_used"], True)
        self.assertEqual(int(self.runners[0].run.call_args.args[1]["data"].max()), 0)
        self.assertEqual(report["model_outputs"]["120"]["cases"][0]["replacement_input_sha256"],
                         probe.digest(data=np.zeros((1, 120, 120, 3), np.int16).tobytes()))

    def test_missing_unknown_or_nonexact_replacement_fails_before_any_onnx_session(self):
        self.use_replacements()
        self.add_actual_inference()
        self.assert_failed(message="cover all actual", before_session=True)
        self.replacement_inputs[(120, 1)] = np.zeros((1, 120, 120, 3), np.int16)
        self.assert_failed(message="bit-exact", before_session=True)
        self.replacement_inputs[(160, 0)] = np.zeros((1, 160, 160, 3), np.int16)
        self.assert_failed(message="keys", before_session=True)
        result = json.loads((self.out / "report.json").read_text())
        self.assertIs(result["independent_120_sampling_input_used"], False)
        for runner in self.runners:
            runner.run.assert_not_called()

    def test_runner_failure_cannot_claim_all_replacement_inputs_were_used(self):
        self.use_replacements()
        self.runners[0].run.side_effect = RuntimeError("mock ONNX failed")
        self.assert_failed(message="mock ONNX failed", error=RuntimeError)
        result = json.loads((self.out / "report.json").read_text())
        self.assertIs(result["independent_120_sampling_input_used"], False)

    def test_supplied_replacements_do_not_relax_native_head_gates(self):
        self.use_replacements()
        self.runners[0].run.return_value = [np.ones((1, 1, 1, 3), np.float32) for _ in range(5)]
        self.assert_failed(message="without loosening gates", error=RuntimeError)
        result = json.loads((self.out / "report.json").read_text())
        self.assertIs(result["independent_120_sampling_input_used"], True)
        self.assertTrue(any(not check["passed"] for case in result["model_outputs"]["120"]["cases"]
                            for check in case["checks"].values()))

    def test_four_comparison_capture_gate_remains_unchanged_with_replacements(self):
        self.use_replacements()
        self.captured["comparisons"] *= 2
        self.assert_failed(message="pixel-neutral", before_session=True)

    def test_explicit_seven_comparison_run_uses_replacements_and_records_count(self):
        self.use_replacements()
        self.captured["comparisons"] = [dict(equal=True) for _ in range(7)]
        self.assert_failed(message="pixel-neutral", before_session=True)
        self.expected_comparisons = 7
        report = self.run_probe()
        self.assertTrue(report["passed"] and report["independent_120_sampling_input_used"])
        self.assertEqual(report["expected_comparisons"], 7)

    def test_run_passes_count_explicitly_and_rejects_wrong_bool_or_unbounded_count(self):
        for count in (3, 5, True, False, 0, -1, 25, 4.0, "4", None):
            self.expected_comparisons = count
            with self.subTest(count=count):
                self.assert_failed(message="pixel-neutral|typed expected comparison", before_session=True)
        self.expected_comparisons = 4
        with patch.object(probe, "validate_capture", wraps=probe.validate_capture) as validate:
            self.assertTrue(self.run_probe()["passed"])
        self.assertEqual(validate.call_args.kwargs["expected_comparisons"], 4)


if __name__ == "__main__":
    unittest.main()
