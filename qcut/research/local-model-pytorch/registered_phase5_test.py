from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import torch

from infer import load_predictor
from matting_validated import ARTIFACT_SHA256, load_model
from onnx_export import export_model


class Phase5RegistrationTests(unittest.TestCase):
    def test_matting_requires_the_approved_complete_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fake.pt"
            torch.save({"format": "qcut-private-matting-gru-cpu-v3", "validation_status": "native-parity-passed"}, path)
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                load_predictor(path=path)

    def test_wrapper_never_accepts_a_caller_bypass(self):
        with patch("matting_validated.load_candidate", return_value="model") as candidate:
            self.assertEqual(load_model(path="approved.pt"), "model")
            candidate.assert_called_once_with(path="approved.pt", expected_sha256=ARTIFACT_SHA256, allow_unverified=True)
        with self.assertRaises(TypeError):
            load_model(path="fake.pt", allow_unverified=True)

    def test_legacy_failed_formats_remain_unregistered(self):
        for kind in ("qcut-private-matting-gru-v1", "qcut-private-matting-gru-cpu-v2"):
            with patch("infer.torch.load", return_value={"format": kind}), self.assertRaisesRegex(ValueError, "unsupported bundle"):
                load_predictor(path="not-loaded.pt")

    def test_matting_onnx_requires_its_own_qualification(self):
        with patch("onnx_export.torch.load", return_value={"format": "qcut-private-matting-gru-cpu-v3"}):
            with self.assertRaisesRegex(ValueError, "ONNX numeric adapter is not qualified"):
                export_model(path="not-loaded.pt")


if __name__ == "__main__":
    unittest.main()
