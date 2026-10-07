import copy
import hashlib
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from slimface_consumer_input import consumer_request


def fixture():
    points = np.arange(212, dtype="<f4")
    mesh = np.arange(1555, dtype="<f4")
    weights = np.column_stack((np.arange(62), np.zeros((62, 2)))).astype(np.float32)
    degrees = np.zeros(22, np.float32)
    degrees[[1, 10, 16, 20]] = [.08, -.2, -.01, -.2]
    record = {"width": 1280., "height": 960., "yaw": -3.4, "pitch": 0.,
              "points": points.tolist(), "mesh": mesh.tolist(),
              "points_sha256": hashlib.sha256(points.tobytes()).hexdigest(),
              "mesh_sha256": hashlib.sha256(mesh.tobytes()).hexdigest(),
              "input_unchanged": True, "flags": [2, 1, 1],
              "degrees": degrees.tolist(), "weights": weights.tolist()}
    return record, {"weights": weights}


class ConsumerInputTests(unittest.TestCase):
    def test_exact_consumer_points_and_pose_survive_replay_conversion(self):
        record, assets = fixture()
        before = copy.deepcopy(record)
        request = consumer_request(record=record, intensity=100, size=[1280, 960], assets=assets)
        points = np.asarray(request["points"], "<f4")
        self.assertEqual(points.shape, (106, 2))
        self.assertEqual(hashlib.sha256(points.tobytes()).hexdigest(), record["points_sha256"])
        self.assertEqual((request["yaw"], request["pitch"]), (-3.4, 0.))
        self.assertEqual(record, before)

    def test_corrupt_point_or_output_mesh_buffer_is_rejected(self):
        for name in ("points", "mesh"):
            record, assets = fixture()
            record[name][12] += .01
            with self.subTest(name=name), self.assertRaises(ValueError):
                consumer_request(record=record, intensity=100, size=[1280, 960], assets=assets)

    def test_incomplete_or_nonfinite_buffers_are_rejected(self):
        for name in ("points", "mesh"):
            for value in ([], [float("nan")] * (212 if name == "points" else 1555)):
                record, assets = fixture()
                record[name] = value
                with self.subTest(name=name), self.assertRaises(ValueError):
                    consumer_request(record=record, intensity=100, size=[1280, 960], assets=assets)

    def test_wrong_frame_size_or_mode_or_mutated_input_is_rejected(self):
        for name, value in (("width", 1279), ("height", 959), ("flags", [2, 0, 1]),
                            ("input_unchanged", False), ("input_unchanged", 1)):
            record, assets = fixture()
            record[name] = value
            with self.subTest(name=name, value=value), self.assertRaises(ValueError):
                consumer_request(record=record, intensity=100, size=[1280, 960], assets=assets)

    def test_other_active_controls_and_wrong_strength_are_rejected(self):
        for index in (0, 1, 10, 16, 20, 21):
            record, assets = fixture()
            record["degrees"][index] += .01
            with self.subTest(index=index), self.assertRaises(ValueError):
                consumer_request(record=record, intensity=100, size=[1280, 960], assets=assets)
        record, assets = fixture()
        with self.assertRaises(ValueError):
            consumer_request(record=record, intensity=50, size=[1280, 960], assets=assets)

    def test_weights_require_exact_validated_local_coefficients(self):
        for value in ([], [[0, 0, 0]] * 62):
            record, assets = fixture()
            record["weights"] = value
            with self.assertRaises(ValueError):
                consumer_request(record=record, intensity=100, size=[1280, 960], assets=assets)

    def test_pose_does_not_silently_clamp_or_convert_radians(self):
        for name, value in (("yaw", 50.001), ("yaw", -50.001), ("yaw", float("nan")),
                            ("yaw", True), ("yaw", "3.4"), ("pitch", 1.), ("pitch", False)):
            record, assets = fixture()
            record[name] = value
            with self.subTest(name=name, value=value), self.assertRaises(ValueError):
                consumer_request(record=record, intensity=100, size=[1280, 960], assets=assets)

    def test_invalid_strength_and_zero_have_no_consumer_replay(self):
        record, assets = fixture()
        for intensity in (0, -1, 101, True, float("nan"), "100"):
            with self.subTest(intensity=intensity), self.assertRaises(ValueError):
                consumer_request(record=record, intensity=intensity, size=[1280, 960], assets=assets)

    def test_fractional_strength_keeps_float32_coefficients(self):
        record, assets = fixture()
        record["degrees"] = (np.asarray(record["degrees"], np.float32) * np.float32(.333)).tolist()
        request = consumer_request(record=record, intensity=33.3, size=[1280, 960], assets=assets)
        self.assertEqual(request["intensity"], 33.3)


if __name__ == "__main__":
    unittest.main()
