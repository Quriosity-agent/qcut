from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from consumer_pose import SOURCE, total_face_pose
from slimface_mesh_render import run


def bits(*, value):
    return struct.unpack("<I", struct.pack("<f", value))[0]


class ConsumerPoseTests(unittest.TestCase):
    def test_units_sign_and_abi_rounding_at_right_angle(self):
        pose = total_face_pose(raw_yaw=90, raw_pitch=-12)
        self.assertEqual(bits(value=pose["yaw_radians"]), 0xbfc90fdc)
        self.assertEqual(bits(value=pose["yaw"]), 0xc2b40001)
        self.assertEqual(pose["pitch"], 0)
        self.assertEqual(pose["source"], SOURCE)

    def test_signed_zero_survives_yaw_but_pitch_is_positive_zero(self):
        for raw, expected in ((0.0, 0x80000000), (-0.0, 0)):
            pose = total_face_pose(raw_yaw=raw, raw_pitch=-0.0)
            self.assertEqual(bits(value=pose["yaw"]), expected)
            self.assertEqual(bits(value=pose["pitch"]), 0)

    def test_yaw_symmetry_and_pitch_head_does_not_enter_TotalFace(self):
        for value in (np.float32(.1), 1, 30.25, 50, 360):
            positive = total_face_pose(raw_yaw=value, raw_pitch=35)
            negative = total_face_pose(raw_yaw=-value, raw_pitch=-35)
            self.assertEqual(positive["yaw"], -negative["yaw"])
            self.assertEqual(positive["pitch"], negative["pitch"])
            self.assertEqual(positive, total_face_pose(raw_yaw=value, raw_pitch=0))

    def test_untyped_nonfinite_and_out_of_budget_heads_fail_closed(self):
        for value in (True, np.bool_(False), "30", None, [], float("nan"), float("inf"), -361, 360.01):
            for key in ("raw_yaw", "raw_pitch"):
                values = {"raw_yaw": 0, "raw_pitch": 0, key: value}
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    total_face_pose(**values)

    def test_original_inference_pose_is_consumed_and_reported(self):
        pose = total_face_pose(raw_yaw=-25, raw_pitch=4)
        prediction = {"points": np.ones((106, 2), np.float32).tolist(), "consumer_pose": pose}
        rgba = np.full((32, 32, 4), 128, np.uint8)
        mesh = {"prepared_source": np.zeros((106, 2)), "deformed_landmarks": np.zeros((106, 2))}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            assets = root / "assets.npz"
            assets.write_bytes(b"synthetic")
            with patch("slimface_mesh_render.single_face_prediction", return_value=prediction), \
                    patch("slimface_mesh_render.load_assets", return_value={}), \
                    patch("slimface_mesh_render.generate_mesh", return_value=mesh) as generate, \
                    patch("slimface_mesh_render.render_mesh", return_value=(rgba, {})):
                receipt = run(rgba=rgba, intensity=100, output=root / "owned.png", report=root / "owned.json", assets_path=assets)
            self.assertEqual(generate.call_args.kwargs["yaw"], pose["yaw"])
            self.assertEqual(generate.call_args.kwargs["pitch"], 0)
            self.assertEqual(receipt["consumer_pose"], pose)
            self.assertEqual(receipt["pose_source"], SOURCE)
            self.assertFalse(receipt["fixed_landmarks"])

    def test_positive_render_cannot_silently_fall_back_to_zero_pose(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch("slimface_mesh_render.single_face_prediction", return_value={"points": np.ones((106, 2)).tolist()}), \
                patch("slimface_mesh_render.load_assets") as assets:
            root = Path(directory)
            with self.assertRaises(KeyError):
                run(rgba=np.zeros((32, 32, 4), np.uint8), intensity=100, output=root / "bad.png",
                    report=root / "bad.json", assets_path=root / "missing.npz")
            assets.assert_not_called()
            self.assertFalse((root / "bad.png").exists())


if __name__ == "__main__":
    unittest.main()
