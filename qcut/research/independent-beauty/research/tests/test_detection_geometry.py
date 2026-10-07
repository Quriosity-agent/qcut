from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from detection_geometry import algorithm_size, detector_size, prepare_detection
from face_detection import Detector, HEAD_NAMES


def synthetic_detector(*, network_size):
    width, height = network_size
    outputs = []
    for index in range(6):
        stride = (8, 16, 32)[index % 3]
        shape = (1, height // stride, width // stride, 4 if index < 3 else 1)
        outputs.append(np.full(shape, 0 if index < 3 else -128, np.int64))
    engine = Detector.__new__(Detector)
    engine.session = Mock()
    engine.session.run.return_value = outputs
    engine.sha256 = "synthetic-test-model"
    return engine, outputs


class DetectionGeometryTests(unittest.TestCase):
    def test_algorithm_aspect_floor_and_small_images_do_not_upscale(self):
        for source, target in (((1448, 1086), (640, 480)), ((1024, 1536), (426, 640)),
                               ((321, 241), (321, 241)), ((641, 641), (640, 640))):
            self.assertEqual(algorithm_size(size=source), target)

    def test_detector_long_side_truncates_before_alignment_and_half_rounds_down(self):
        for size, target in (((426, 640), (320, 480)), ((640, 426), (480, 320)),
                             ((512, 640), (320, 384)), ((321, 241), (416, 320)),
                             ((336, 320), (320, 320)), ((337, 320), (352, 320))):
            actual, scales = detector_size(size=size)
            self.assertEqual(actual, target)
            np.testing.assert_array_equal(scales, np.array([target[0] / size[0], target[1] / size[1]], np.float32))

    def test_bgr_channel_order_signed_mean_and_input_ownership(self):
        source = np.full((320, 320, 4), [10, 128, 255, 19], np.uint8)
        before = source.copy()
        result = prepare_detection(rgba=source)
        np.testing.assert_array_equal(result["tensor"][0, 0, 0], [127, 0, -118])
        np.testing.assert_array_equal(result["prepared"][0, 0], [255, 128, 10])
        self.assertEqual(result["tensor"].dtype, np.int8)
        self.assertEqual(result["tensor"].shape, (1, 320, 320, 3))
        for key in ("algorithm", "source", "prepared", "tensor"):
            self.assertFalse(np.shares_memory(result[key], source))
        np.testing.assert_array_equal(source, before)

    def test_invalid_image_types_dimensions_and_extreme_aspects_reject(self):
        for size in ((True, 640), (31, 640), (4097, 640), (640., 480), [640, 480]):
            with self.subTest(size=size), self.assertRaises(ValueError):
                algorithm_size(size=size)
        for size in ((16, 640), (640, 15), (641, 640), (True, 320), [320, 320]):
            with self.subTest(size=size), self.assertRaises(ValueError):
                detector_size(size=size)
        for pixels in ([], np.zeros((320, 320, 3), np.uint8), np.zeros((320, 320, 4), float),
                       np.zeros((0, 320, 4), np.uint8)):
            with self.assertRaises(ValueError):
                prepare_detection(rgba=pixels)


class DetectorContractTests(unittest.TestCase):
    def test_dynamic_heads_decode_to_algorithm_boxes_in_both_orientations(self):
        for source, network, expected in (
                ((321, 241), (416, 320), [114, 63, 25, 25]),
                ((512, 640), (320, 384), [236, 140, 53, 54])):
            with self.subTest(source=source):
                engine, outputs = synthetic_detector(network_size=network)
                outputs[0][0, 12, 20] = 32
                outputs[3][0, 12, 20] = 0
                before = [value.copy() for value in outputs]
                rgba = np.full((source[1], source[0], 4), [10, 128, 255, 19], np.uint8)
                result = engine.detect(rgba=rgba)
                self.assertEqual(result["algorithm_size"], source)
                self.assertEqual(result["network_size"], network)
                np.testing.assert_array_equal(result["rects"], np.array([expected], np.float32))
                np.testing.assert_array_equal(result["scores"], np.array([.5], np.float32))
                self.assertEqual(result["model_sha256"], engine.sha256)
                names, feed = engine.session.run.call_args.args
                self.assertEqual(names, list(HEAD_NAMES))
                self.assertEqual(set(feed), {"data"})
                self.assertEqual(feed["data"].shape, (1, network[1], network[0], 3))
                self.assertEqual(feed["data"].dtype, np.int64)
                np.testing.assert_array_equal(feed["data"][0, 0, 0], [127, 0, -118])
                for name, original, value in zip(HEAD_NAMES, before, outputs, strict=True):
                    np.testing.assert_array_equal(value, original)
                    np.testing.assert_array_equal(result["heads"][name], original[0].astype(np.int8))

    def test_low_confidence_heads_return_typed_empty_outputs(self):
        engine, _ = synthetic_detector(network_size=(320, 320))
        result = engine.detect(rgba=np.zeros((320, 320, 4), np.uint8))
        self.assertEqual(result["rects"].shape, (0, 4))
        self.assertEqual(result["scores"].shape, (0,))
        self.assertEqual(result["rects"].dtype, np.float32)
        self.assertEqual(result["scores"].dtype, np.float32)
        engine.session.run.assert_called_once()

    def test_each_invalid_head_is_rejected_before_decoding(self):
        for index in range(6):
            for corruption in ("underflow", "overflow", "dtype", "channels", "spatial"):
                with self.subTest(index=index, corruption=corruption):
                    engine, outputs = synthetic_detector(network_size=(320, 320))
                    value = outputs[index]
                    if corruption in ("underflow", "overflow"):
                        value.flat[-1] = -129 if corruption == "underflow" else 128
                    elif corruption == "dtype":
                        outputs[index] = value.astype(np.float32)
                    elif corruption == "channels":
                        outputs[index] = np.zeros((*value.shape[:3], value.shape[3] + 1), np.int64)
                    else:
                        outputs[index] = value[:, :-1]
                    with patch("face_detection.decode") as decode, self.assertRaises(ValueError):
                        engine.detect(rgba=np.zeros((320, 320, 4), np.uint8))
                    decode.assert_not_called()

    def test_invalid_original_frame_is_rejected_before_inference(self):
        for rgba in (np.zeros((320, 320, 3), np.uint8), np.zeros((320, 320, 4), np.float32),
                     np.zeros((31, 320, 4), np.uint8), np.zeros((32, 4096, 4), np.uint8)):
            with self.subTest(shape=rgba.shape, dtype=rgba.dtype):
                engine, _ = synthetic_detector(network_size=(320, 320))
                with self.assertRaises(ValueError):
                    engine.detect(rgba=rgba)
                engine.session.run.assert_not_called()

    def test_model_identity_is_checked_before_session_construction(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.onnx"
            path.write_bytes(b"unexpected-model")
            with patch("face_detection.ort.InferenceSession") as session, self.assertRaises(ValueError):
                Detector(model=path)
            session.assert_not_called()

    def test_model_requires_dynamic_spatial_axes_and_exact_output_names(self):
        import hashlib
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.onnx"
            path.write_bytes(b"test-model")
            runner = Mock()
            runner.get_inputs.return_value = [Mock(name="data", type="tensor(int64)", shape=[1, 320, 576, 3])]
            runner.get_inputs.return_value[0].name = "data"
            runner.get_outputs.return_value = [Mock() for _ in HEAD_NAMES]
            for output, name in zip(runner.get_outputs.return_value, HEAD_NAMES, strict=True):
                output.name = name
            with patch("face_detection.MODEL_SHA256", hashlib.sha256(path.read_bytes()).hexdigest()), patch("face_detection.ort.InferenceSession", return_value=runner):
                with self.assertRaises(ValueError):
                    Detector(model=path)
                runner.get_inputs.return_value[0].shape = [1, "height", "width", 3]
                self.assertEqual(Detector(model=path).session, runner)
                runner.get_outputs.return_value[0].name = "wrong-head"
                with self.assertRaises(ValueError):
                    Detector(model=path)

    def test_corrupt_head_type_and_signed_byte_overflow_are_rejected(self):
        engine, _ = synthetic_detector(network_size=(320, 320))
        for value in (np.zeros((1, 40, 40, 4), np.float32), np.full((1, 40, 40, 4), 128, np.int64)):
            engine.session.run.return_value = [value] * 6
            with self.assertRaises(ValueError):
                engine.detect(rgba=np.zeros((320, 320, 4), np.uint8))

    def test_incomplete_and_malformed_head_shapes_are_rejected(self):
        engine, _ = synthetic_detector(network_size=(320, 320))
        for outputs in ([], [np.array(0, np.int64)] * 6,
                        [np.zeros((1, 40, 39, 4), np.int64)] * 6, [None] * 6):
            engine.session.run.return_value = outputs
            with self.assertRaises(ValueError):
                engine.detect(rgba=np.zeros((320, 320, 4), np.uint8))


if __name__ == "__main__":
    unittest.main()
