"""Portable human segmentation contracts without model downloads or Apple frameworks."""
import hashlib
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

import numpy as np

from body import onnx_mask
from body.background import protect_background


class OnnxMaskTests(unittest.TestCase):
    def setUp(self):
        self.rgba = np.zeros((96, 128, 4), np.uint8)
        self.rgba[..., 3] = 255
        self.prediction = np.zeros((1, 2, 192, 192), np.float32)
        self.prediction[:, 0] = 1
        self.prediction[0, 1, 24:144, 36:108] = 1
        self.prediction[0, 0] = 1 - self.prediction[0, 1]
        self.session = Mock()
        self.session.run.return_value = [self.prediction]

    def infer(self, **overrides):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(onnx_mask, "verified_model_bytes", return_value=b"verified"), \
                patch.object(onnx_mask, "_session", return_value=self.session):
            return onnx_mask.get_person_mask(**{"rgba": self.rgba, "work": directory, **overrides})

    def test_rgb_channels_and_signed_normalization_match_upstream(self):
        self.rgba[..., :3] = [255, 127, 0]
        tensor = onnx_mask.prepare_input(rgba=self.rgba)
        self.assertEqual(tensor.shape, (1, 3, 192, 192))
        self.assertEqual(tensor.dtype, np.float32)
        self.assertTrue(tensor.flags.c_contiguous)
        np.testing.assert_allclose(tensor[0, :, 50, 50], [1, 127 / 127.5 - 1, -1], atol=1e-7)

    def test_original_aspect_and_top_left_orientation_are_restored(self):
        mask, report = self.infer()
        self.assertEqual(mask.shape, (96, 128))
        self.assertEqual(mask.dtype, np.uint8)
        self.assertEqual(mask[20, 30], 255)
        self.assertEqual(mask[85, 30], 0)
        self.assertEqual(mask[20, 100], 0)
        self.assertEqual(report["sourceSize"], [128, 96])
        self.assertEqual(report["orientation"], "top-left")
        self.assertEqual(report["executionProvider"], "CPUExecutionProvider")
        self.assertFalse(report["operatingSystemModel"])
        self.assertFalse(report["nativeVendorLibraries"])
        self.session.run.assert_called_once()
        args = self.session.run.call_args.args
        self.assertEqual(args[0], [onnx_mask.OUTPUT_NAME])
        self.assertEqual(list(args[1]), ["x"])

    def test_source_is_unchanged_and_result_is_not_an_alias(self):
        before = self.rgba.copy()
        mask, _ = self.infer()
        np.testing.assert_array_equal(self.rgba, before)
        self.assertFalse(np.shares_memory(mask, self.rgba))
        self.assertFalse(np.shares_memory(mask, self.prediction))

    def test_model_mask_integrates_with_exact_background_protection(self):
        mask, _ = self.infer()
        warped = self.rgba.copy()
        warped[..., :3] = 255
        result, report = protect_background(
            original=self.rgba, warped=warped, source_mask=mask, warped_mask=mask)
        self.assertGreater(report["protectedPixels"], 1000)
        self.assertEqual(report["changedProtectedPixels"], 0)
        np.testing.assert_array_equal(result[90], self.rgba[90])
        np.testing.assert_array_equal(result[25, 35], warped[25, 35])

    def test_no_person_and_all_person_fail_closed(self):
        for foreground in (0, 1):
            with self.subTest(foreground=foreground):
                self.prediction[0, 1] = foreground
                self.prediction[0, 0] = 1 - foreground
                with self.assertRaisesRegex(ValueError, "no usable separation"):
                    self.infer()

    def test_uncertain_ties_are_background_as_in_upstream_argmax(self):
        self.prediction[:] = .5
        with self.assertRaisesRegex(ValueError, "no usable separation"):
            self.infer()

    def test_malformed_model_outputs_fail_closed(self):
        invalid = [None, self.prediction.tolist(), self.prediction.astype(np.float64),
                   self.prediction[:, :, :100], self.prediction + .1,
                   np.full_like(self.prediction, np.nan), np.full_like(self.prediction, np.inf)]
        for prediction in invalid:
            with self.subTest(type=type(prediction)):
                self.session.run.return_value = [prediction]
                with self.assertRaisesRegex(ValueError, "probabilities"):
                    self.infer()
        for response in (None, [], [self.prediction, self.prediction], self.prediction):
            self.session.run.return_value = response
            with self.assertRaisesRegex(ValueError, "response"):
                self.infer()

    def test_invalid_photos_reject_before_model_load(self):
        transparent = self.rgba.copy()
        transparent[0, 0, 3] = 0
        for rgba in (None, self.rgba[..., :3], transparent, self.rgba.astype(float), self.rgba[:20]):
            with patch.object(onnx_mask, "verified_model_bytes") as loader:
                with self.assertRaises(ValueError):
                    onnx_mask.get_person_mask(rgba=rgba, work=".")
                loader.assert_not_called()

    def test_invalid_work_directory_rejects_without_inference(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            file = path / "file"
            file.write_text("not a directory")
            link = path / "link"
            try:
                link.symlink_to(path, target_is_directory=True)
            except OSError:
                link = file
            for work in (file, path / "missing", link):
                with self.assertRaisesRegex(ValueError, "work directory"):
                    self.infer(work=work)
        self.session.run.assert_not_called()

    def test_invalid_output_dimensions_reject_without_allocation(self):
        sizes = [(0, 32), (32, 4097), (4096, 4096), (32.0, 32), (True, 32), (32,), None]
        for size in sizes:
            with self.subTest(size=size):
                with self.assertRaisesRegex(ValueError, "dimensions"):
                    onnx_mask.restore_mask(prediction=self.prediction, size=size)

    def test_model_hash_is_verified_every_request_even_with_cached_session(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "mask.onnx"
            payload = b"verified-model"
            path.write_bytes(payload)
            digest = hashlib.sha256(payload).hexdigest()
            with patch.object(onnx_mask, "MODEL_PATH", path), \
                    patch.object(onnx_mask, "MODEL_SIZE", len(payload)), \
                    patch.object(onnx_mask, "MODEL_SHA256", digest), \
                    patch.object(onnx_mask, "model_manifest", return_value={
                        "sourceDocumentation": "test-source", "license": "Apache-2.0"}), \
                    patch.object(onnx_mask, "_session", return_value=self.session):
                onnx_mask.get_person_mask(rgba=self.rgba, work=directory)
                path.write_bytes(b"tampered-model")
                with self.assertRaisesRegex(ValueError, "SHA-256"):
                    onnx_mask.get_person_mask(rgba=self.rgba, work=directory)
            self.session.run.assert_called_once()

    def test_missing_truncated_and_symlink_models_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.onnx"
            with self.assertRaises(ValueError):
                onnx_mask.verified_model_bytes(path=path)
            path.write_bytes(b"short")
            with self.assertRaises(ValueError):
                onnx_mask.verified_model_bytes(path=path)
            link = Path(directory) / "link"
            try:
                link.symlink_to(path)
            except OSError:
                return
            with self.assertRaises(ValueError):
                onnx_mask.verified_model_bytes(path=link)

    def test_session_has_only_the_verified_cpu_contract(self):
        input_meta = types.SimpleNamespace(name="x", shape=[1, 3, 192, 192], type="tensor(float)")
        output_meta = types.SimpleNamespace(
            name=onnx_mask.OUTPUT_NAME, shape=[1, 2, 192, 192], type="tensor(float)")
        runtime_session = Mock()
        runtime_session.get_inputs.return_value = [input_meta]
        runtime_session.get_outputs.return_value = [output_meta]
        runtime_session.get_providers.return_value = ["CPUExecutionProvider"]
        runtime = types.SimpleNamespace(
            SessionOptions=Mock(return_value=types.SimpleNamespace()),
            InferenceSession=Mock(return_value=runtime_session))
        with patch.dict("sys.modules", {"onnxruntime": runtime}):
            self.assertIs(onnx_mask._session.__wrapped__(model_bytes=b"verified"), runtime_session)
            runtime.InferenceSession.assert_called_once()
            self.assertEqual(runtime.InferenceSession.call_args.args[0], b"verified")
            self.assertEqual(runtime.InferenceSession.call_args.kwargs["providers"], ["CPUExecutionProvider"])
            runtime_session.get_providers.return_value = ["CoreMLExecutionProvider", "CPUExecutionProvider"]
            with self.assertRaises(ValueError):
                onnx_mask._session.__wrapped__(model_bytes=b"verified")
            runtime_session.get_providers.return_value = ["CPUExecutionProvider"]
            input_meta.shape = [1, 192, 192, 3]
            with self.assertRaises(ValueError):
                onnx_mask._session.__wrapped__(model_bytes=b"verified")

    def test_manifest_hash_and_license_are_pinned(self):
        manifest = onnx_mask.model_manifest()
        self.assertEqual(manifest["size"], onnx_mask.MODEL_SIZE)
        self.assertEqual(manifest["license"], "Apache-2.0")
        license_bytes = (onnx_mask.BODY_ROOT / manifest["licenseFile"]).read_bytes()
        self.assertEqual(hashlib.sha256(license_bytes).hexdigest(), manifest["licenseSha256"])
        self.assertIn(manifest["revision"], manifest["url"])
        with patch.object(Path, "read_text", return_value=json.dumps({"sha256": "bad", "size": 0})):
            with self.assertRaisesRegex(ValueError, "manifest"):
                onnx_mask.model_manifest()




if __name__ == "__main__":
    unittest.main()
