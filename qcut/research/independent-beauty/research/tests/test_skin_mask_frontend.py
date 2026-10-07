import sys
from pathlib import Path
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from skin_mask_frontend import algorithm_size, segmentation_size, prepare_skin_tensor, alpha_texture, predict_skin_mask


class SkinMaskFrontendTests(unittest.TestCase):
    def test_whole_frame_dimensions_preserve_aspect_and_truncate(self):
        self.assertEqual(algorithm_size(width=1083, height=1280), (541, 640))
        self.assertEqual(algorithm_size(width=1280, height=959), (640, 479))
        self.assertEqual(algorithm_size(width=256, height=512), (256, 512))

    def test_network_dimensions_round_long_side_to_sixteen(self):
        self.assertEqual(segmentation_size(width=541, height=640), (128, 144))
        self.assertEqual(segmentation_size(width=479, height=640), (128, 176))
        self.assertEqual(segmentation_size(width=640, height=479), (176, 128))
        self.assertEqual(segmentation_size(width=640, height=640), (128, 128))
        self.assertEqual(segmentation_size(width=640, height=360), (224, 128))

    def test_network_long_side_caps_extreme_aspects(self):
        self.assertEqual(segmentation_size(width=16, height=640), (128, 256))
        self.assertEqual(segmentation_size(width=640, height=16), (256, 128))

    def test_preparation_preserves_input_and_signed_bgr_channels(self):
        rgba = np.empty((16, 16, 4), np.uint8)
        rgba[:] = [17, 128, 255, 73]
        original = rgba.copy()
        tensor, receipt = prepare_skin_tensor(rgba=rgba)
        np.testing.assert_array_equal(rgba, original)
        self.assertEqual(tensor.shape, (1, 128, 128, 3))
        self.assertEqual(tensor.dtype, np.int16)
        np.testing.assert_array_equal(tensor, np.broadcast_to([127, 0, -111], tensor.shape))
        self.assertEqual(receipt["algorithmSize"], [16, 16])

    def test_alpha_truncates_in_float32_and_keeps_texture_rgb_zero(self):
        p = np.asarray([[0, .5, 1]], np.float32)
        texture = alpha_texture(probabilities=p)
        np.testing.assert_array_equal(texture[..., :3], 0)
        np.testing.assert_array_equal(texture[..., 3], [[0, 127, 255]])
        np.testing.assert_array_equal(p, [[0, .5, 1]])

    def test_alpha_rejects_nonfinite_out_of_range_and_untyped_arrays(self):
        for p in (np.asarray([[np.nan]], np.float32), np.asarray([[1.001]], np.float32),
                  np.asarray([[-.001]], np.float32), np.asarray([[.5]], np.float64),
                  np.asarray([.5], np.float32)):
            with self.subTest(p=p), self.assertRaises(ValueError):
                alpha_texture(probabilities=p)

    def test_preparation_rejects_unbounded_or_non_rgba_inputs(self):
        for rgba in (None, np.zeros((16, 16, 3), np.uint8), np.zeros((16, 16, 4), np.float32),
                     np.zeros((1281, 16, 4), np.uint8)):
            with self.subTest(shape=getattr(rgba, "shape", None)), self.assertRaises(ValueError):
                prepare_skin_tensor(rgba=rgba)

    def test_dimensions_reject_bools_and_zero(self):
        for function in (algorithm_size, segmentation_size):
            for pair in ((True, 128), (128, 0), (128.0, 128)):
                with self.subTest(function=function.__name__, pair=pair), self.assertRaises(ValueError):
                    function(width=pair[0], height=pair[1])

    def test_unverified_aspect_profile_fails_before_loading_model(self):
        with self.assertRaisesRegex(ValueError, "unverified skin segmentation profile"):
            predict_skin_mask(rgba=np.zeros((320, 640, 4), np.uint8), runtime=Path("absent-runtime"))


if __name__ == "__main__":
    unittest.main()
