from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from face_metal import PASS_SHAPES, render


class FaceMetalTests(unittest.TestCase):
    def passes(self, *, shift=0):
        result = []
        for index, (name, count, triangles) in enumerate(PASS_SHAPES):
            vertices = np.zeros((count, 5), np.float32)
            vertices[:4, :2] = [[-1, 1], [1, 1], [-1, -1], [1, -1]]
            vertices[:4, 3:] = [[0, 1], [1, 1], [0, 0], [1, 0]]
            if index == 1:
                vertices[:4, 3] += shift
            indices = np.zeros((triangles, 3), np.uint16)
            indices[:2] = [[0, 1, 2], [2, 1, 3]]
            result.append({'name': name, 'vertices': vertices, 'triangles': indices})
        return result

    def test_two_real_gpu_passes_preserve_orientation_and_use_prior_pass(self):
        rgba = np.array([[[10, 20, 30, 255], [80, 100, 120, 255]],
                         [[160, 180, 200, 255], [220, 230, 240, 255]]], np.uint8)
        original = rgba.copy()
        with tempfile.TemporaryDirectory() as temporary:
            result, receipt = render(rgba=rgba, passes=self.passes(), runtime=Path(temporary))
            np.testing.assert_array_equal(result, rgba)
            moved, _ = render(rgba=rgba, passes=self.passes(shift=.5), runtime=Path(temporary))
            np.testing.assert_array_equal(moved, rgba[:, [1, 1]])
        np.testing.assert_array_equal(rgba, original)
        self.assertEqual(receipt['private_native_images'], [])
        self.assertEqual(receipt['passes'], ['LinkedOrgans', 'LocalWarp'])

    def test_invalid_mesh_and_pass_order_fail_before_compilation(self):
        rgba = np.full((2, 2, 4), 255, np.uint8)
        invalid = [[], self.passes()[::-1], self.passes(), self.passes(), self.passes(), self.passes()]
        invalid[2][0]['vertices'][0, 0] = np.nan
        invalid[3][1]['triangles'][0, 0] = 2270
        invalid[4][0]['vertices'] = invalid[4][0]['vertices'].astype(np.float64)
        invalid[5][0]['vertices'] = np.zeros((314, 5), np.float32)
        with patch('face_metal.build_host') as compile_host:
            for passes in invalid:
                with self.assertRaises(ValueError):
                    render(rgba=rgba, passes=passes, runtime=Path('missing'))
            compile_host.assert_not_called()

    def test_transparent_and_oversized_input_fail_before_compilation(self):
        with patch('face_metal.build_host') as compile_host:
            for rgba in (np.zeros((2, 2, 4), np.uint8), np.full((1, 1281, 4), 255, np.uint8)):
                with self.assertRaises(ValueError):
                    render(rgba=rgba, passes=self.passes(), runtime=Path('missing'))
            compile_host.assert_not_called()


if __name__ == '__main__':
    unittest.main()
