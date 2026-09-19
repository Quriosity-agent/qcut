"""Portable inference and media-verification contracts with authored fixtures."""
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import torch

from espresso_torch import EspressoTorch
from infer import load_inputs, load_predictor, run_inference, shot_predictor
from media_verify import decode_frames, frame_tensor, verify_sequence
from native_oracle import align_batch_axis, predict_native


def fixture_model(*, root):
    spec = {"layers": [{"type": "activation", "mode": 0, "name": "relu", "bottom": "x", "top": "y"}],
            "inputs": {"x": {"shape": [1, 1, 2, 2], "allowed_shapes": []}}, "outputs": ["y"], "shapes": {}}
    path = root / "model.pt"
    torch.save(EspressoTorch(spec=spec).bundle(provenance={"synthetic": True}), path)
    return path


class PortableInferenceTests(unittest.TestCase):
    def test_roundtrip_npz(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            model = fixture_model(root=root)
            inputs = root / "input.npz"
            np.savez(inputs, x=np.array([[[[-1, 2], [3, -4]]]], dtype=np.float32))
            report = run_inference(model_path=model, input_path=inputs, output_path=root / "out.npz", warmup=1, repeats=3)
            with np.load(root / "out.npz", allow_pickle=False) as output:
                self.assertEqual(output["y"].tolist(), [[[[0, 2], [3, 0]]]])
            self.assertEqual(report["repeats"], 3)
            self.assertFalse(report["vendor_runtime_loaded"])
            self.assertTrue((root / "out.json").is_file())

    def test_reject_bad_inputs(self):
        for value in (np.array([float("nan")], dtype=np.float32), np.array([1], dtype=np.int32), np.array([{}], dtype=object)):
            with self.subTest(value=value.dtype), tempfile.TemporaryDirectory() as temp:
                path = pathlib.Path(temp) / "input.npz"
                np.savez(path, x=value)
                with self.assertRaises(ValueError):
                    load_inputs(path=path)

    def test_reject_empty(self):
        with tempfile.TemporaryDirectory() as temp:
            path = pathlib.Path(temp) / "input.npz"
            np.savez(path)
            with self.assertRaises(ValueError):
                load_inputs(path=path)

    def test_fixed_point_npz_preserves_signed_bits(self):
        with tempfile.TemporaryDirectory() as temp:
            path = pathlib.Path(temp) / "input.npz"
            values = np.array([-32768, -1, 0, 32767], dtype=np.int16)
            np.savez(path, x=values)
            loaded = load_inputs(path=path)["x"]
            self.assertEqual(loaded.dtype, torch.int16)
            np.testing.assert_array_equal(loaded.numpy(), values)

    def test_float_model_rejects_integer_input(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            model = fixture_model(root=root)
            inputs = root / "input.npz"
            np.savez(inputs, x=np.ones((1, 1, 2, 2), dtype=np.int16))
            with self.assertRaisesRegex(ValueError, "float32 inputs required"):
                run_inference(model_path=model, input_path=inputs, output_path=root / "out.npz")

    def test_tracking_requires_selection(self):
        with tempfile.TemporaryDirectory() as temp:
            path = pathlib.Path(temp) / "model.pt"
            torch.save({"format": "qcut-private-tracking-pytorch-v1"}, path)
            with self.assertRaisesRegex(ValueError, "explicit --network"):
                load_predictor(path=path)
            with patch("tracking_torch.load_model", return_value=lambda inputs: inputs) as loader:
                predict, _ = load_predictor(path=path, network="head")
                loader.assert_called_once_with(path=path, name="head")
                self.assertEqual(predict({"x": torch.ones(1, dtype=torch.int16)})["x"].dtype, torch.int16)

    def test_selection_not_ignored_for_other_formats(self):
        with tempfile.TemporaryDirectory() as temp:
            path = fixture_model(root=pathlib.Path(temp))
            with self.assertRaisesRegex(ValueError, "only for tracking"):
                load_predictor(path=path, network="head")

    def test_failed_candidates_are_not_dispatched(self):
        with tempfile.TemporaryDirectory() as temp:
            path = pathlib.Path(temp) / "model.pt"
            for kind in ("qcut-private-matting-gru-v1", "qcut-private-matting-gru-cpu-v2",
                         "qcut-private-ocr-recognizer-logits-pytorch-v1",
                         "qcut-private-ocr-recognizer-logits-pytorch-v2",
                         "qcut-private-ocr-recognizer-logits-pytorch-v3"):
                torch.save({"format": kind}, path)
                with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, "unsupported bundle"):
                    load_predictor(path=path)

    def test_reject_repeats(self):
        with self.assertRaises(ValueError):
            run_inference(model_path=None, input_path=None, output_path=None, repeats=0)

    def test_do_not_overwrite_input(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            with self.assertRaisesRegex(ValueError, "separate"):
                run_inference(model_path=root / "model.pt", input_path=root / "input.npz", output_path=root / "input.npz")

    def test_reject_unknown_format(self):
        with tempfile.TemporaryDirectory() as temp:
            path = pathlib.Path(temp) / "input.pt"
            torch.save({"format": "unknown"}, path)
            with self.assertRaises(ValueError):
                load_predictor(path=path)

    def test_reject_nondictionary_bundle(self):
        with tempfile.TemporaryDirectory() as temp:
            path = pathlib.Path(temp) / "bad.pt"
            torch.save(torch.zeros(1), path)
            with self.assertRaisesRegex(ValueError, "dictionary"):
                load_predictor(path=path)

    def test_report_does_not_overwrite_model(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            with self.assertRaisesRegex(ValueError, "separate"):
                run_inference(model_path=root / "out.json", input_path=root / "in.npz", output_path=root / "out.npz")

    def test_empty_and_nonfinite_outputs_rejected(self):
        invalid = ({}, {"x": torch.empty(0)}, {"x": torch.tensor([float("nan")])}, {"x": 1})
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            for outputs in invalid:
                with self.subTest(outputs=outputs), patch("infer.load_inputs", return_value={"x": torch.ones(1)}), patch("infer.load_predictor", return_value=(lambda _: outputs, "synthetic")), self.assertRaises(ValueError):
                    run_inference(model_path=root / "m.pt", input_path=root / "i.npz", output_path=root / "o.npz")

    def test_shot_windows_are_not_interchangeable(self):
        for shape in ((7, 3, 96, 96), (11, 3, 128, 128)):
            predict = shot_predictor(backbone=lambda x: x.mean(dim=(2, 3)), head=lambda x: x.mean(dim=0), shape=shape)
            output = predict({"frames": torch.ones(shape)})
            self.assertEqual(output["features"].shape, (shape[0], 3))
            with self.assertRaises(ValueError):
                predict({"frames": torch.ones((shape[0] + 1, *shape[1:]))})

    def test_tflite_dispatch_preserves_logits(self):
        with tempfile.TemporaryDirectory() as temp:
            path = pathlib.Path(temp) / "model.pt"
            torch.save({"format": "qcut-bounded-tflite-pytorch"}, path)
            with patch("tflite_torch.load_model", return_value=lambda x: x * 3):
                predict, _ = load_predictor(path=path)
            output = predict({"image": torch.tensor([2.0])})
            self.assertEqual(output["logits"].item(), 6.0)
            with self.assertRaises(ValueError):
                predict({"pixels": torch.ones(1)})

    def test_bytenn_dictionary_dispatch(self):
        formats = (("qcut-private-denoise-pytorch-v1", "denoise_torch.load_model"),
                   ("qcut-private-facefitting3d-pytorch-v1", "facefitting_torch.load_model"),
                   ("qcut-private-classifier-pytorch-v1", "classifier_torch.load_model"),
                   ("qcut-private-ocr-detector-pytorch-v1", "ocr_torch.load_model"),
                   ("qcut-private-vision-batch-pytorch-v1", "vision_batch_torch.load_model"),
                   ("qcut-private-ocr-recognizer-logits-pytorch-v4", "ocr_rec_torch.load_validated_model"))
        with tempfile.TemporaryDirectory() as temp:
            path = pathlib.Path(temp) / "model.pt"
            for kind, loader in formats:
                torch.save({"format": kind}, path)
                with self.subTest(kind=kind), patch(loader, return_value=lambda inputs: inputs):
                    predict, actual_kind = load_predictor(path=path)
                    self.assertEqual(actual_kind, kind)
                    self.assertEqual(predict({"data": torch.ones(1)})["data"].item(), 1)


class MediaTests(unittest.TestCase):
    def test_rgb_bgr(self):
        frame = np.array([[[255, 128, 0]]], dtype=np.uint8)
        rgb = frame_tensor(rgb=frame, bgr=False)
        bgr = frame_tensor(rgb=frame, bgr=True)
        self.assertEqual(rgb.shape, (1, 3, 1, 1))
        self.assertTrue(torch.equal(bgr, rgb.flip(1)))

    def test_decode_bounds(self):
        for frames, fps in ((0, 4), (601, 4), (24, 0), (24, 100)):
            with self.assertRaises(ValueError):
                decode_frames(video=None, width=1, height=1, frames=frames, fps=fps)

    def test_axis_alignment_is_limited(self):
        actual = np.zeros((1, 1, 4, 4), dtype=np.float32)
        self.assertEqual(align_batch_axis(actual=actual, expected=actual[0]).shape, actual.shape)
        wrong = np.zeros((4, 4), dtype=np.float32)
        self.assertEqual(align_batch_axis(actual=actual, expected=wrong).shape, wrong.shape)

    def test_native_output_path_boundary(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            directory = root / "case"
            directory.mkdir()
            (directory / "outputs.json").write_text(json.dumps({"y": {"path": str(root / "outside"), "shape": [1]}}))
            with patch("native_oracle.subprocess.run"), self.assertRaises(ValueError):
                predict_native(oracle=root / "oracle", native_model=root / "model", inputs={"x": np.zeros(1)}, directory=directory)

    def test_independent_feedback_and_reset(self):
        class Model:
            spec = {"inputs": {name: {"shape": shape} for name, shape in
                               (("data", [1, 3, 2, 2]), ("prev_img", [1, 3, 2, 2]), ("prev_mask", [1, 1, 2, 2]))}}

            def __call__(self, inputs):
                return {"nn_3": inputs["prev_mask"] * 0.5 + inputs["data"].mean()}

        native_states = []

        def native(**kwargs):
            inputs = kwargs["inputs"]
            native_states.append(inputs["prev_mask"].clone())
            return {"nn_3": (inputs["prev_mask"] * 0.5 + inputs["data"].mean() + 0.000001).numpy()}

        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            artifact, video = root / "model.pt", root / "source.mp4"
            artifact.write_bytes(b"synthetic")
            video.write_bytes(b"synthetic")
            (root / "oracle.mlmodelc").mkdir()
            with patch("media_verify.load_model", return_value=Model()), patch("media_verify.decode_frames", return_value=np.full((4, 2, 2, 3), 128, dtype=np.uint8)), patch("media_verify.predict_native", side_effect=native):
                report = verify_sequence(artifact=artifact, video=video, oracle=root / "oracle", output=root)
            self.assertTrue(report["passed"])
            self.assertEqual(native_states[0].sum().item(), 0)
            self.assertEqual(native_states[2].sum().item(), 0)
            self.assertGreater(native_states[1].mean().item(), 128 / 255)
            self.assertEqual([case["reset"] for case in report["cases"]], [True, False, True, False])


if __name__ == "__main__":
    torch.set_num_threads(1)
    unittest.main()
