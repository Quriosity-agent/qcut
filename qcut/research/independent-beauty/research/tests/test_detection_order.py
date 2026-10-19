import hashlib
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from detection_order import native_score_order
from vendor.face_detector import decode


TIED_SCORES = [0, 0, 1, .5, 0, .5, 0, 0, 1, .5, .5, 0, 0, .5, 0, 0,
               1, 0, 0, 0, .5, .5, 0, .5, 1, 0, 1, 0, 1, 1, 0]
TIED_ORDER = [29, 28, 2, 26, 24, 8, 16, 3, 5, 23, 9, 10, 21, 20, 13, 15,
              14, 17, 18, 19, 12, 11, 22, 7, 6, 25, 4, 27, 1, 0, 30]


def order_digest(order):
    return hashlib.sha256(order.astype('<u4').tobytes()).hexdigest()


class DetectorOrderTests(unittest.TestCase):
    def test_partition_swaps_preserve_the_native_equal_score_order(self):
        actual = native_score_order(scores=TIED_SCORES)
        np.testing.assert_array_equal(actual, TIED_ORDER)
        self.assertNotEqual(actual.tolist(), np.argsort(-np.asarray(TIED_SCORES), kind='stable').tolist())

    def test_native_golden_orders_cover_all_sort_thresholds(self):
        # Original liblens Box sort/partial_sort; synthetic scores, no model data.
        cases = [
            (29, None, '64faa781a9e3bf001132babe3140ed4b3d415473dc3cd368e557dc58cda7c6e6'),
            (30, None, '2550c4b5a8fce7989c21988ab313ab8077937ddaa810c896416a70cc67968c82'),
            (31, None, 'b37dcf4f48ec88b506f4f23ad30ccbebf642ed29c9d63cd8aaf4bdc24bca47f3'),
            (999, None, '9044d0a0b08ee02d9d0b20f900885bfe3fde0a1c4540ea15b743a6da537e6aa0'),
            (1000, None, 'fa9c6cbd0119ff8a8bac796c66820c3fb1fe34fd231239a6f6861dac8958a012'),
            (1499, 1500, '594160eb698e3d83e652adcf5a3197f1faf0d6f40d1fc5c1108e553197c93342'),
            (1500, None, 'ead96b51324f2673142869747e6efa4a3904a4dc9105421f99122f73e1d358ee'),
            (1500, 1500, '4a56c9793f83a7427b53138674b4d310325150db85d4ddd688e3f59ac9f610f5'),
            (1501, None, '5d6f2892c18d4d597679971d99ee80ff9a73a0db4b54c134bc2a0ee849bedbeb'),
            (1501, 1500, '042ba5781d4064536f13bc88c8272d6791ce1196e9fd5cbb1c31584e301fe3b2'),
        ]
        for count, limit, expected in cases:
            scores = np.array([(index * 17 % 29) / 28 for index in range(count)], np.float32)
            with self.subTest(count=count, limit=limit):
                self.assertEqual(order_digest(native_score_order(scores=scores, before=limit)), expected)

    def test_all_equal_heap_order_is_distinct_from_full_sort(self):
        for count in (0, 1, 2, 3, 4, 5, 31, 1500):
            scores = np.full(count, .5, np.float32)
            np.testing.assert_array_equal(native_score_order(scores=scores), np.arange(count))
        order = native_score_order(scores=np.full(1500, .5, np.float32), before=1500)
        self.assertEqual(order_digest(order), 'd8d65a855a92378e3457f2437fda5bc9f25b4e9a6a147d8c4cacdc231772d02f')

    def test_partial_sort_retains_only_best_scores_and_owns_its_output(self):
        scores = np.asarray(TIED_SCORES, np.float32)[::-1]
        original = scores.copy()
        for limit in (1, 2, 7, len(scores), len(scores) + 1):
            order = native_score_order(scores=scores, before=limit)
            np.testing.assert_array_equal(scores[order], np.sort(scores)[::-1][:limit])
            np.testing.assert_array_equal(scores, original)
            self.assertFalse(np.shares_memory(order, scores))
            self.assertEqual(len(np.unique(order)), len(order))

    def test_decode_uses_native_order_before_suppressing_overlapping_ties(self):
        boxes = np.zeros((31, 5), np.float32)
        boxes[:, 0] = np.arange(31) * np.float32(.01)
        boxes[:, 2:4] = 100
        boxes[:, 4] = TIED_SCORES
        with patch('vendor.face_detector.proposals', return_value=boxes):
            result = decode(heads=None, image_size=(128, 128), strides=None,
                            minimum_sizes=None, confidence=0, before=1500, after=200, iou=.3)
        np.testing.assert_array_equal(result, boxes[[29]])

    def test_rejects_invalid_scores_and_limits(self):
        for scores in ([[.5]], [.1, np.nan], [np.inf], [-.01], [1.01], np.zeros(20001)):
            with self.subTest(scores=type(scores)), self.assertRaises(ValueError):
                native_score_order(scores=scores)
        for limit in (True, 0, -1, 20001, 1.5):
            with self.subTest(limit=limit), self.assertRaises(ValueError):
                native_score_order(scores=[.5], before=limit)


if __name__ == '__main__':
    unittest.main()
