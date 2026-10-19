"""Native observed source-resize extents and prepared face-detector coordinates."""
import unittest
from unittest.mock import patch
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from body_algorithm_size import body_algorithm_size
from detection_geometry import prepare_detection


class BodyAlgorithmSize(unittest.TestCase):
    def test_native_float32_axis_and_two_pass_area_boundaries(self):
        observed = [
            ((3342, 1235), False, (974, 360)),
            ((2523, 2330), False, (640, 591)),
            ((649, 1948), False, (360, 1080)),
            ((333, 777), False, (333, 777)),
            ((400, 100), True, (400, 100)),
        ]
        for size, changed, expected in observed:
            with self.subTest(size=size, changed=changed):
                self.assertEqual(body_algorithm_size(size=size, source_changed=changed), expected)

    def test_native_source_resize_extent_matrix(self):
        observed = [
            ((1080, 1920), (128, 227), (360, 640)),
            ((640, 640), (224, 224), (640, 640)),
            ((333, 777), (128, 298), (333, 777)),
            ((64, 96), (64, 96), (64, 96)),
            ((32, 32), (32, 32), (32, 32)),
            ((200, 300), (149, 224), (200, 300)),
            ((400, 100), (400, 100), (400, 100)),
            ((500, 1000), (128, 256), (360, 720)),
            ((250, 700), (128, 358), (250, 700)),
            ((1000, 1000), (224, 224), (640, 640)),
            ((555, 777), (160, 224), (457, 640)),
            ((361, 1001), (128, 354), (360, 998)),
            ((359, 1001), (128, 356), (359, 1001)),
            ((650, 641), (224, 220), (640, 631)),
            ((319, 700), (128, 280), (319, 700)),
            ((320, 700), (128, 280), (320, 700)),
            ((400, 711), (128, 227), (360, 640)),
            ((400, 712), (128, 227), (360, 640)),
            ((720, 1281), (128, 227), (360, 640)),
        ]
        for size, transient, active in observed:
            for transpose in (False, True):
                source, first, steady = ((item[::-1] if transpose else item)
                                         for item in (size, transient, active))
                with self.subTest(size=source):
                    self.assertEqual(body_algorithm_size(size=source, source_changed=True), first)
                    self.assertEqual(body_algorithm_size(size=source), steady)

    def test_invalid_source_or_unbounded_network_is_rejected(self):
        for size in ((31, 100), (4097, 100), (100, True), [640, 360], (32, 4096), (360, 1281)):
            with self.subTest(size=size), self.assertRaises(ValueError):
                body_algorithm_size(size=size)
        with self.assertRaises(ValueError):
            body_algorithm_size(size=(640, 360), source_changed=1)

    def test_prepared_algorithm_avoids_a_second_resize_and_keeps_original_scales(self):
        rgba = np.full((1001, 359, 4), 255, np.uint8)
        rgba[..., :3] = [12, 80, 140]
        with patch('detection_geometry.resize_rgba') as resize:
            result = prepare_detection(rgba=rgba, prepared_algorithm=True)
        resize.assert_not_called()
        self.assertIs(result['algorithm'], rgba)
        self.assertEqual(result['algorithm_size'], (359, 1001))
        self.assertEqual(result['network_size'], (320, 896))
        np.testing.assert_array_equal(result['scales'], np.array([320 / 359, 896 / 1001], np.float32))
        np.testing.assert_array_equal(result['tensor'][0, 0, 0], [12, -48, -116])


if __name__ == '__main__':
    unittest.main()
