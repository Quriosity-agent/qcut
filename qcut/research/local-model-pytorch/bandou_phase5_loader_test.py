"""Synthetic provenance tests for the new format without enabling older candidates."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import torch

from bandou_phase5_torch import EXECUTION_PROFILE, FORMAT, NATIVE_REPORT_SHA256, PROFILE, load_model
from vision_batch_profiles import FORMAT as OLD_FORMAT, PROFILES, RUNTIME_SHA256
from vision_batch_test import conv_row, data_row, graph_text
from vision_batch_torch import VisionGraph, digest, state_digest


class ValidatedBandouLoaderTests(unittest.TestCase):
    def setUp(self):
        torch.set_num_threads(2)
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "synthetic.pt"
        nodes = [data_row(), conv_row()]
        self.model = VisionGraph(nodes=nodes, weights=np.arange(12, dtype=np.float32) / 7)
        text = graph_text(nodes=nodes)
        self.spec = {**PROFILES["bandou"], "input_shape": [1, 3, 4, 4], "outputs": {"conv": [1, 3, 4, 4]},
                     "graph_sha256": digest(data=text.encode()), "state_sha256": state_digest(state=self.model.state_dict())}
        self.bundle = {"format": FORMAT, "profile": PROFILE, "execution_profile": EXECUTION_PROFILE,
                       "local_only": True, "verification_status": "native-parity-passed", "runtime_sha256": RUNTIME_SHA256,
                       "native_report_sha256": NATIVE_REPORT_SHA256, "state_dict": self.model.state_dict(), "graph_text": text,
                       **{key: self.spec[key] for key in ("source_sha256", "bm_sha256", "graph_sha256", "state_sha256")}}

    def restore(self, **options):
        torch.save(self.bundle, self.path)
        with patch.dict(PROFILES, {"bandou": self.spec}):
            return load_model(path=self.path, **options)

    def test_new_format_uses_ordered_arithmetic_and_preserves_state(self):
        result = self.restore()
        self.assertTrue(result.ordered_resize)
        self.assertEqual(state_digest(state=result.state_dict()), self.spec["state_sha256"])
        self.assertFalse(PROFILES["bandou"]["native_verified"])

    def test_old_and_diagnostic_formats_are_always_refused(self):
        for format_name in (OLD_FORMAT, "qcut-private-bandou-phase5-diagnostic-v1", "qcut-private-bandou-ordered-pytorch-v0", None):
            self.bundle["format"] = format_name
            with self.assertRaisesRegex(ValueError, "validated ordered"):
                self.restore()

    def test_not_native_passed_status_cannot_load(self):
        for status in ("verification-failed", "candidate-native-unverified", True, None):
            self.bundle["verification_status"] = status
            with self.assertRaisesRegex(ValueError, "unapproved"):
                self.restore()

    def test_source_graph_state_runtime_and_evidence_binding(self):
        original = deepcopy(self.bundle)
        for key in ("source_sha256", "bm_sha256", "graph_sha256", "state_sha256", "runtime_sha256", "native_report_sha256",
                    "execution_profile", "profile", "local_only"):
            self.bundle = deepcopy(original)
            self.bundle[key] = "forged"
            with self.assertRaises(ValueError, msg=key):
                self.restore()

    def test_rehashed_altered_weights_still_fail_static_identity(self):
        self.bundle["state_dict"]["layers.1.weight"][0, 0, 0, 0] += 0.5
        self.bundle["state_sha256"] = state_digest(state=self.bundle["state_dict"])
        with self.assertRaisesRegex(ValueError, "identity"):
            self.restore()

    def test_altered_weights_with_original_digest_fail(self):
        self.bundle["state_dict"]["layers.1.bias"][0] += 1
        with self.assertRaisesRegex(ValueError, "state digest"):
            self.restore()

    def test_rehashed_graph_and_whitespace_fail(self):
        self.bundle["graph_text"] += "\n"
        with self.assertRaisesRegex(ValueError, "graph hash"):
            self.restore()
        self.bundle["graph_sha256"] = digest(data=self.bundle["graph_text"].encode())
        with self.assertRaisesRegex(ValueError, "identity"):
            self.restore()

    def test_schema_must_match_fixed_profile(self):
        self.spec["input_shape"] = [1, 3, 4, 5]
        with self.assertRaisesRegex(ValueError, "schema"):
            self.restore()

    def test_hash_and_weights_only_use_same_bounded_payload(self):
        original = torch.load
        observations = []

        def spy(stream, **options):
            observations.append(digest(data=stream.getvalue()))
            self.assertTrue(options["weights_only"])
            self.assertEqual(options["map_location"], "cpu")
            return original(stream, **options)

        with patch("bandou_phase5_torch.torch.load", side_effect=spy):
            self.restore()
        self.assertEqual(observations, [digest(data=self.path.read_bytes())])
        with self.assertRaisesRegex(ValueError, "artifact hash"):
            self.restore(expected_sha256="0" * 64)

    def test_no_unverified_bypass_argument(self):
        with self.assertRaises(TypeError):
            self.restore(allow_unverified=True)

    def test_nonfinite_or_non_float_state_refused(self):
        for tensor in (torch.tensor([float("nan")]), torch.zeros(3, dtype=torch.float64)):
            self.bundle["state_dict"]["layers.1.bias"] = tensor
            with self.assertRaisesRegex(ValueError, "finite CPU float32"):
                self.restore()

    def test_empty_and_oversized_bundles_refused(self):
        self.path.touch()
        with self.assertRaisesRegex(ValueError, "bundle size"):
            load_model(path=self.path)
        with self.path.open("wb") as stream:
            stream.truncate(64 * 1024 * 1024 + 1)
        with self.assertRaisesRegex(ValueError, "bundle size"):
            load_model(path=self.path)


if __name__ == "__main__":
    unittest.main()
