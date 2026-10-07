import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from alignment_infer import channels


class WorkerAlignmentTests(unittest.TestCase):
    def setUp(self):
        import onnxruntime as ort
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        root = Path(self.directory.name)
        for name in ("face-detector-320x576.onnx", "skin-seg-224x128.onnx", "saliency-matting-640.onnx"):
            (root / name).write_bytes(b"mock-weights")
        np.save(root / "landmark-order-106.npy", np.arange(106))
        self.heads = {size: {name: np.full((1, 1, 1, count), .12345678, np.float32)
                            for name, count in channels(size=size).items()} for size in (120, 160)}
        points = np.random.default_rng(97).uniform(40, 120, (106, 2)).astype(np.float32)
        self.heads[160]["fc_landmark_s1"] = points.reshape(1, 1, 1, 212)
        self.heads[120]["fc_landmark_s1"] = np.zeros((1, 1, 1, 212), np.float32)
        self.assets = {"order": np.arange(106, dtype=np.int32), "mean": points * np.float32(256 / 120)}
        self.models = {size: Mock(infer=Mock(return_value=self.heads[size])) for size in (120, 160)}
        runner = Mock()
        spec = importlib.util.spec_from_file_location("worker_alignment_test", Path(__file__).resolve().parents[1] / "worker.py")
        self.worker = importlib.util.module_from_spec(spec)
        self.detector = Mock()
        with patch.dict("os.environ", BEAUTY_RESEARCH_MODELS=str(root)), patch("face_detection.Detector", return_value=self.detector), patch("alignment_infer.Stage1", side_effect=lambda **kwargs: self.models[kwargs["size"]]), patch("alignment_assets.load_assets", return_value=self.assets), patch.object(ort, "InferenceSession", return_value=runner):
            spec.loader.exec_module(self.worker)

    def test_detector_and_landmark_decoders_remain_distinct(self):
        self.detector.detect.return_value = {"algorithm_size": (128, 128), "rects": np.empty((0, 4), np.float32),
                                             "scores": np.empty(0, np.float32)}
        self.assertEqual(self.worker.detect(np.zeros((128, 128, 3), np.uint8)), [])
        self.assertEqual(self.detector.detect.call_args.kwargs["rgba"].shape, (128, 128, 4))

    def test_detector_rectangles_preserve_algorithm_integer_coordinates(self):
        rect = np.array([[112, 42, 101, 136]], np.float32)
        self.detector.detect.return_value = {"algorithm_size": (321, 241), "rects": rect,
                                             "scores": np.array([.9], np.float32)}
        faces = self.worker.detect(np.zeros((241, 321, 3), np.uint8))
        self.assertEqual(faces[0]["algorithm_box"], rect[0].tolist())
        self.assertEqual(faces[0]["box"], rect[0].tolist())
        result = self.worker.landmarks(np.full((241, 321, 4), 128, np.uint8), faces[0])
        self.assertTrue(result["algorithm_box_preserved"])

    def test_invalid_algorithm_box_and_unobserved_expansion_reject(self):
        from alignment_photo import predict_photo
        rgba = np.full((241, 321, 4), 128, np.uint8)
        kwargs = {"rgba": rgba, "box": [224, 84, 202, 272], "model_root": Path("unused"),
                  "assets": self.assets, "models": self.models, "flags": [1, 0, 0]}
        for box, expansion in (([112.1, 42, 101, 136], 1), ([-1, 42, 101, 136], 1),
                               ([112, 42, 400, 136], 1), ([112, 42, 101, 136], 1.5)):
            with self.subTest(box=box, expansion=expansion), self.assertRaises(ValueError):
                predict_photo(**kwargs, algorithm_box=box, expansion=expansion)

    def test_original_space_roundtrip_cannot_shift_initialization_origin(self):
        from alignment_sequence import Sequence
        rect = np.array([[1, 42, 101, 136]], np.float32)
        self.detector.detect.return_value = {"algorithm_size": (640, 480), "rects": rect,
                                             "scores": np.array([.9], np.float32)}
        face = self.worker.detect(np.zeros((583, 777, 3), np.uint8))[0]
        roundtrip = np.float32(face["box"][0]) * np.float32(640 / 777)
        self.assertLess(roundtrip, 1)
        with patch.object(Sequence, "process", autospec=True, side_effect=Sequence.process) as process:
            self.worker.landmarks(np.full((583, 777, 4), 128, np.uint8), face)
        self.assertEqual(process.call_args_list[0].kwargs["face"]["initialization"]["call"]["rect"]["values"], rect[0].tolist())

    def test_algorithm_space_and_unrounded_heads_and_points(self):
        pixels = np.full((1280, 1024, 4), 128, np.uint8)
        result = self.worker.landmarks(pixels, {"box": [200, 300, 300, 400]})
        self.assertEqual(result["algorithm_size"], [512, 640])
        self.assertEqual(result["crop_coordinate_space"], "algorithm-image-pixels")
        self.assertTrue(result["final_tracking_points"])
        self.assertFalse(result["native_tracking_matrices_used"])
        self.assertEqual(result["tracking_history"], "fresh-photo")
        self.assertEqual(result["prediction_sizes"], [160, 120, 120])
        self.assertEqual(self.models[160].infer.call_count, 1)
        self.assertEqual(self.models[120].infer.call_count, 2)
        self.assertEqual(result["prob"][0], float(self.heads[120]["prob"].flat[0]))
        self.assertEqual(result["visible"][0], float(self.heads[120]["fc_visible"].flat[0]))
        self.assertTrue(any(value != round(value, 2) for row in result["points"] for value in row))
        self.assertEqual(len(result["input_tensor_sha256"]), 64)
        self.assertEqual(len(result["seed_tensor_sha256"]), 64)
        self.assertEqual(self.models[120].infer.call_args.kwargs["tensor"].dtype, np.int16)
        self.assertEqual(self.models[160].infer.call_args.kwargs["tensor"].dtype, np.int8)

    def test_final_prediction_resets_base_instead_of_smoothing_warm_points(self):
        from alignment_sequence import Sequence
        from consumer_points import total_face_points
        warm = {name: values.copy() for name, values in self.heads[120].items()}
        final = {name: values.copy() for name, values in self.heads[120].items()}
        warm["fc_landmark_s1"].fill(3)
        final["fc_landmark_s1"].fill(-2)
        self.models[120].infer.side_effect = [warm, final]
        observations = []
        original = Sequence.process

        def record(engine, **kwargs):
            result = original(engine, **kwargs)
            observations.append((kwargs["face"]["mode"], result))
            return result

        with patch.object(Sequence, "process", record):
            result = self.worker.landmarks(np.full((640, 426, 4), 128, np.uint8), {"box": [80, 120, 180, 240]})
        self.assertEqual([mode for mode, _ in observations], ["seed-160", "reset-120"])
        first, last = [value for _, value in observations]
        self.assertFalse(np.array_equal(first["points"], last["tracked"]))
        np.testing.assert_array_equal(last["points"], last["tracked"])
        expected = total_face_points(points=last["tracked"], algorithm_size=(426, 640), original_size=(426, 640))
        np.testing.assert_array_equal(result["points"], expected)
        self.assertEqual(result["prob"], final["prob"].reshape(-1).tolist())

    def test_two_photos_do_not_reuse_tracking_history(self):
        first = self.worker.landmarks(np.full((1280, 1024, 4), 128, np.uint8), {"box": [200, 300, 300, 400]})
        second = self.worker.landmarks(np.full((1280, 1024, 4), 128, np.uint8), {"box": [300, 350, 250, 300]})
        repeated = self.worker.landmarks(np.full((1280, 1024, 4), 128, np.uint8), {"box": [200, 300, 300, 400]})
        self.assertNotEqual(first["points"], second["points"])
        self.assertEqual(first, repeated)


if __name__ == "__main__":
    unittest.main()
