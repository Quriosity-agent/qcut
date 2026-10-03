"""Separate 160 replacement routing; captured inputs remain reference-only."""
import argparse
import json
import unittest
from unittest.mock import patch

import numpy as np

import face_render_model_parity as parity
import face_render_model_parity_test as fixtures


class InitializationReplacementTests(unittest.TestCase):
    def test_160_signed_storage_exact_bytes_and_readonly_copies(self):
        value = np.zeros((1, 160, 160, 3), np.int8)
        value[0, 0, 0] = [-128, 0, 127]
        with patch.object(parity, "load_tensor", return_value=value.copy()):
            result = parity.validate_replacement_inputs(replacement_inputs={(160, 0): value},
                                                       network=fixtures.network_record(size=160), size=160)
        np.testing.assert_array_equal(result[(160, 0)], value)
        self.assertFalse(result[(160, 0)].flags.writeable)
        value[:] = 10
        self.assertEqual(result[(160, 0)][0, 0, 0, 0], -128)

    def test_160_profile_rejects_wrong_types_keys_storage_and_incomplete_input(self):
        value = np.zeros((1, 160, 160, 3), np.int8)
        for key, candidate in (((120, 0), value), ((160, False), value), ((160.0, 0), value),
                               ((160, 0), value.astype(np.int16)), ((160, 0), value[:, :120]),
                               ((160, 1), value)):
            with self.subTest(key=key), self.assertRaises(ValueError):
                parity.validate_replacement_inputs(replacement_inputs={key: candidate},
                                                  network=fixtures.network_record(size=160), size=160)
        for size in (False, 160.0, 119, 161, "160"):
            with self.subTest(size=size), self.assertRaises(ValueError):
                parity.validate_replacement_inputs(replacement_inputs=None, network={}, size=size)

    def test_reference_difference_is_rejected_not_used_as_input(self):
        value = np.zeros((1, 160, 160, 3), np.int8)
        with patch.object(parity, "load_tensor", return_value=value + 1), self.assertRaisesRegex(ValueError, "bit-exact"):
            parity.validate_replacement_inputs(replacement_inputs={(160, 0): value},
                                              network=fixtures.network_record(size=160), size=160)

    def test_160_execution_uses_separate_owned_mapping_and_keeps_all_head_gates(self):
        harness = fixtures.RunTests()
        harness.setUp()
        self.addCleanup(harness.doCleanups)
        (harness.capture / "report.json").write_text(json.dumps(harness.captured))
        (harness.root / "summary.json").write_text(json.dumps(harness.exported))
        harness.session.side_effect = harness.runners
        value = np.zeros((1, 160, 160, 3), np.int8)
        reads, real_load = [], parity.load_tensor

        def read(*, item):
            if item["name"] == "data" and item["dims_nwhc"] == [1, 160, 160, 3]:
                reads.append(item["inference"])
            return real_load(item=item)

        with patch.object(parity, "load_tensor", side_effect=read):
            result = parity.run(args=argparse.Namespace(capture=harness.capture, root=harness.root, out=harness.out),
                                initialization_inputs={(160, 0): value})
        self.assertTrue(result["passed"])
        self.assertFalse(result["independent_120_sampling_input_used"])
        self.assertTrue(result["independent_160_sampling_input_used"])
        self.assertFalse(result["full_frame_geometry_independent"])
        self.assertEqual(result["head_comparisons"], 10)
        self.assertEqual(reads, [0])
        np.testing.assert_array_equal(harness.runners[1].run.call_args.args[1]["data"], value.astype(np.int64))
        self.assertEqual(result["model_outputs"]["160"]["cases"][0]["input_source"], "replacement_inputs")
        self.assertEqual(result["model_outputs"]["160"]["cases"][0]["replacement_input_source"], "initialization_inputs[(160, 0)]")
        self.assertEqual(result["model_outputs"]["120"]["cases"][0]["input_source"], "captured_tensor")


if __name__ == "__main__":
    unittest.main()
