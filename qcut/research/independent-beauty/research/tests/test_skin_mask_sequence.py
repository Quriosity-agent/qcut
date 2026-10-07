import hashlib
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import skin_mask_sequence as sequence


class SkinMaskSequenceTests(unittest.TestCase):
    def test_gray_uses_truncated_integer_weights(self):
        bgr = np.full((16, 16, 3), [200, 100, 50], np.uint8)
        gray = sequence.gray_from_bgr(bgr=bgr)
        self.assertTrue(np.array_equal(gray, np.full((16, 16), 96, np.uint8)))
        self.assertRaises(ValueError, sequence.gray_from_bgr, bgr=bgr.astype(np.float32))
        self.assertRaises(ValueError, sequence.gray_from_bgr, bgr=np.zeros((16, 16, 4), np.uint8))

    def test_remap_direction_and_constant_border(self):
        import cv2
        alpha = np.arange(16 * 16, dtype=np.uint8).reshape(16, 16)
        flow = np.zeros((16, 16, 2), np.float32)
        flow[..., 0] = 1
        actual = sequence.propagate_alpha(alpha=alpha, displacement=flow, cv=cv2)
        self.assertTrue(np.array_equal(actual[:, :-1], alpha[:, 1:]))
        self.assertTrue(np.array_equal(actual[:, -1], np.zeros(16, np.uint8)))

    def test_flow_motion_uses_sequential_float32_and_fma(self):
        flow = np.full((16, 16, 2), [.003, .004], np.float32)
        motion = sequence.flow_motion(displacement=flow)
        self.assertAlmostEqual(motion, .000025, places=9)
        flow[0, 0, 0] = np.nan
        self.assertRaises(ValueError, sequence.flow_motion, displacement=flow)
        self.assertRaises(ValueError, sequence.flow_motion, displacement=np.zeros((0, 0, 2), np.float32))

    def fixtures(self):
        rgba = np.zeros((128, 128, 4), np.uint8)
        rgba[..., 3] = 255
        tensor = np.full((1, 128, 128, 3), -128, np.int16)
        receipt = {"maskSize": [128, 128], "algorithmSize": [128, 128],
                   "originalRgbaSha256": hashlib.sha256(rgba.tobytes()).hexdigest()}
        texture = np.zeros((128, 128, 4), np.uint8)
        texture[..., 3] = np.arange(128, dtype=np.uint8)[None]
        return rgba, tensor, receipt, texture

    def test_two_initial_seeks_then_owned_propagation(self):
        rgba, tensor, prepared, texture = self.fixtures()
        isolation = {"private_native_images": []}
        with patch.object(sequence, "prepare_skin_tensor", return_value=(tensor, prepared)), \
             patch.object(sequence, "predict_skin_mask", return_value=(texture, isolation | {
                 "signedBgrSha256": "model-input", "originalRgbaSha256": "model-original"})) as infer, \
             patch.object(sequence, "native_images", return_value=isolation):
            state = sequence.SkinMaskSequence("runtime")
            results = [state.process(rgba=rgba) for _ in range(4)]
            self.assertEqual(infer.call_count, 2)
            self.assertEqual([r[1]["sequence"]["phase"] for r in results],
                             ["warm-start", "initialize-temporal", "cached-network-optical-flow", "cached-network-optical-flow"])
            self.assertTrue(all(np.array_equal(r[0], texture) for r in results))
            self.assertEqual(results[-1][1]["sequence"]["seekIndex"], 3)
            self.assertFalse(results[-1][1]["nativeInputsUsed"])
            self.assertEqual(results[-1][1]["networkInputSignedBgrSha256"], "model-input")
            self.assertEqual(results[-1][1]["networkPredictionOriginalRgbaSha256"], "model-original")
            self.assertEqual(results[-1][1]["sequence"]["networkPredictionSeekIndex"], 1)
            state.reset()
            state.process(rgba=rgba)
            self.assertEqual(infer.call_count, 3)

    def test_dimension_change_requires_explicit_reset(self):
        rgba, tensor, prepared, texture = self.fixtures()
        with patch.object(sequence, "prepare_skin_tensor", return_value=(tensor, prepared)), \
             patch.object(sequence, "predict_skin_mask", return_value=(texture, {"private_native_images": []})), \
             patch.object(sequence, "native_images", return_value={"private_native_images": []}):
            state = sequence.SkinMaskSequence("runtime")
            state.process(rgba=rgba)
            self.assertRaisesRegex(ValueError, "dimensions changed", state.process,
                                   rgba=np.zeros((129, 128, 4), np.uint8))
            self.assertEqual(state.seek_index, 1)

    def test_unverified_refresh_branch_fails_without_consuming_seek(self):
        rgba, tensor, prepared, texture = self.fixtures()
        with patch.object(sequence, "prepare_skin_tensor", return_value=(tensor, prepared)), \
             patch.object(sequence, "predict_skin_mask", return_value=(texture, {"private_native_images": []})), \
             patch.object(sequence, "native_images", return_value={"private_native_images": []}):
            state = sequence.SkinMaskSequence("runtime")
            state.process(rgba=rgba)
            state.process(rgba=rgba)
            with patch.object(sequence, "flow_motion", return_value=.01):
                self.assertRaisesRegex(ValueError, "refresh branch", state.process, rgba=rgba)
            self.assertEqual(state.seek_index, 2)
            self.assertTrue(np.array_equal(state.previous_alpha, texture[..., 3]))

    def test_native_image_loaded_after_initialization_fails_closed(self):
        rgba, tensor, prepared, texture = self.fixtures()
        with patch.object(sequence, "prepare_skin_tensor", return_value=(tensor, prepared)), \
             patch.object(sequence, "predict_skin_mask", return_value=(texture, {"private_native_images": []})), \
             patch.object(sequence, "native_images", return_value={"private_native_images": ["libcccreator.dylib"]}):
            state = sequence.SkinMaskSequence("runtime")
            self.assertRaisesRegex(ValueError, "private native image", state.process, rgba=rgba)
            self.assertEqual(state.seek_index, 0)


if __name__ == "__main__":
    unittest.main()
