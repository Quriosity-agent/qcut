import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "independent-beauty/research"))
from body_skeleton_decode import crop_layout_and_roi, refine_tensor
from body_swing_networks import coreml_coarse_size, coreml_input


def prepare(*, rgb):
    height, width = coreml_coarse_size(width=rgb.shape[1], height=rgb.shape[0])
    box = [0, 0, rgb.shape[1], rgb.shape[0]]
    tensor = refine_tensor(rgb, box, out_h=height, out_w=width)
    geometry, _ = crop_layout_and_roi(box, (width, height))
    return coreml_input(tensor=tensor)[None], geometry


class ReadyCoarseInputTests(unittest.TestCase):
    def test_compiled_shape_orientation_and_threshold(self):
        cases = [(360, 640, (128, 224)), (640, 360, (224, 128)),
                 (512, 640, (176, 224)), (640, 512, (224, 176)),
                 (680, 1000, (176, 224)), (679, 1000, (128, 224)),
                 (1000, 680, (224, 176)), (640, 640, (176, 224))]
        for width, height, expected in cases:
            with self.subTest(width=width, height=height):
                self.assertEqual(coreml_coarse_size(width=width, height=height), expected[::-1])

    def test_padding_is_normalized_byte128_not_float_zero(self):
        output, receipt = prepare(rgb=np.zeros((640, 360, 3), np.uint8))
        self.assertEqual(output.shape, (1, 224, 128, 3))
        self.assertEqual(output.dtype, np.float32)
        self.assertEqual(receipt, [1, 0, 126, 224])
        np.testing.assert_array_equal(output[0, :, 1:-1], np.float32(-2))
        np.testing.assert_array_equal(output[0, :, (0, -1)], np.float32(0.007843255996704102))

    def test_wide_color_content_reorders_rgb_and_preserves_input(self):
        source = np.empty((360, 640, 3), np.uint8)
        source[:] = (255, 128, 0)
        original = source.copy()
        output, receipt = prepare(rgb=source)
        np.testing.assert_array_equal(source, original)
        self.assertEqual(receipt, [0, 1, 224, 126])
        np.testing.assert_array_equal(output[0, 1, 0], np.asarray([-2, 0.007843255996704102, 2.000000238418579], np.float32))

    def test_independent_endpoint_truncation_regressions(self):
        for width, height, expected in ((640, 512, [1, 0, 221, 176]),
                                        (512, 640, [0, 1, 176, 221]),
                                        (435, 640, [0, 17, 128, 189]),
                                        (436, 640, [11, 0, 153, 224])):
            with self.subTest(width=width, height=height):
                _, layout = prepare(rgb=np.zeros((height, width, 3), np.uint8))
                self.assertEqual(layout, expected)

    def test_rejects_noninteger_dimensions_and_nonbyte_tensor(self):
        for value in (0, -1, 640.0, True):
            with self.assertRaises(ValueError):
                coreml_coarse_size(width=value, height=640)
        for source in (np.zeros((20, 20), np.int16), np.zeros((20, 20, 4), np.int16), np.zeros((20, 20, 3), np.float32), np.full((20, 20, 3), 128, np.int16)):
            with self.assertRaises(ValueError):
                coreml_input(tensor=source)


if __name__ == "__main__":
    unittest.main()
