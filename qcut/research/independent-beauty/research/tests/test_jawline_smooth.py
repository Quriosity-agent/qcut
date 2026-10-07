from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from jawline_smooth import smooth


def edge_grid():
    return np.array([
        [[759.877686, 31.679049], [729.230713, 1109.870361],
         [435.698975, 714.148315], [792.223938, 654.867493],
         [1138.867432, 380.929840]],
        [[976.968079, 746.847107], [1048.669556, 1120.963989],
         [558.189392, 330.592133], [446.873932, 727.820862],
         [980.439941, 250.943192]],
        [[362.213531, 1081.339233], [238.849747, 178.966568],
         [546.911987, 170.799973], [854.991943, 1017.484619],
         [1105.368774, 713.369995]],
        [[965.406555, 182.487518], [1003.198914, 751.920837],
         [1047.840332, 420.857788], [316.297333, 121.034363],
         [994.767761, 1049.080322]],
    ], np.float32)


class JawlineSmoothTests(unittest.TestCase):
    # ARM64 fadd/fdiv order is observable here; decimal tolerances hide one-ULP changes.
    def assert_bits(self, *, actual, expected):
        np.testing.assert_array_equal(actual.view(np.uint32), np.asarray(expected, np.uint32))

    def test_left_edge_xy_matches_native_grouped_sum_golden(self):
        result = smooth(a=edge_grid())
        self.assert_bits(actual=result[1:-1, 0], expected=[
            [1146197235, 1144313550], [1141722395, 1145763235]])

    def test_right_edge_xy_matches_native_grouped_sum_golden(self):
        result = smooth(a=edge_grid())
        self.assert_bits(actual=result[1:-1, -1], expected=[
            [1149269328, 1140451084], [1149584292, 1143420870]])

    def test_top_edge_x_matches_native_adjacent_row_golden(self):
        result = smooth(a=edge_grid())
        self.assert_bits(actual=result[0, 1:-1, 0], expected=[
            1144652372, 1142143173, 1144711788])

    def test_bottom_edge_x_matches_native_adjacent_row_golden(self):
        result = smooth(a=edge_grid())
        self.assert_bits(actual=result[-1, 1:-1, 0], expected=[
            1145521980, 1145481191, 1143048092])

    def test_smoothing_preserves_input_corners_shape_and_dtype(self):
        original = edge_grid()
        saved = original.copy()
        result = smooth(a=original)
        np.testing.assert_array_equal(original, saved)
        np.testing.assert_array_equal(result[[0, -1]][:, [0, -1]], saved[[0, -1]][:, [0, -1]])
        self.assertEqual(result.shape, saved.shape)
        self.assertEqual(result.dtype, np.dtype(np.float32))
        self.assertFalse(np.shares_memory(result, original))

    def test_smallest_interior_grid_preserves_regular_coordinates(self):
        y, x = np.mgrid[:3, :3]
        original = np.stack((x, y), -1).astype(np.float32)
        np.testing.assert_array_equal(smooth(a=original), original)


if __name__ == '__main__':
    unittest.main()
