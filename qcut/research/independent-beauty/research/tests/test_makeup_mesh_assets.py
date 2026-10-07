from pathlib import Path
import struct
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from makeup_mesh_assets import mesh_arrays


class MakeupMeshAssetsTests(unittest.TestCase):
    def fixture(self):
        vertices = np.zeros((40, 6), np.float32)
        vertices[:, 3:6] = [0.125, 0.25, 0.75]
        data = bytes.fromhex('6e587acf18000000')+struct.pack('<I', vertices.size)+vertices.tobytes()
        for slot in range(10):
            data += bytes.fromhex('5f2c286b16000000')+struct.pack('<I', 3)+np.array([0, 1, 2], np.uint16).__add__(slot*4).tobytes()
        return data

    def test_brow_uv_offset_does_not_change_pupil_default(self):
        parameters = {'data': self.fixture(), 'floats': 240, 'vertices': 4, 'stride': 6, 'indices': 3}
        pupil, _ = mesh_arrays(**parameters)
        brow, triangles = mesh_arrays(**parameters, uv_offset=4)
        np.testing.assert_array_equal(pupil, np.tile([.125, .25], (4, 1)))
        np.testing.assert_array_equal(brow, np.tile([.25, .75], (4, 1)))
        np.testing.assert_array_equal(triangles, [[0, 1, 2]])

    def test_invalid_component_offsets_are_rejected(self):
        for offset in (True, -1, 5, '4'):
            with self.assertRaises(ValueError):
                mesh_arrays(data=self.fixture(), floats=240, vertices=4, stride=6, indices=3, uv_offset=offset)


if __name__ == '__main__':
    unittest.main()
