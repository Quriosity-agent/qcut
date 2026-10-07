from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mouth_state import mouth_texture
from softpink_assets import SPEC
from softpink_render import resolve_spec


def mesh(*, ratio):
    positions = np.zeros((248, 2), np.float32)
    positions[225] = [0, -ratio]
    positions[192] = [1, 0]
    positions[240] = [1, -ratio]
    return positions


class MouthStateTests(unittest.TestCase):
    def test_strict_thresholds_and_hysteresis(self):
        self.assertFalse(mouth_texture(positions=mesh(ratio=.25), previous_open=False)['open'])
        self.assertTrue(mouth_texture(positions=mesh(ratio=np.nextafter(np.float32(.25), np.float32(1))), previous_open=False)['open'])
        self.assertFalse(mouth_texture(positions=mesh(ratio=.15), previous_open=True)['open'])
        self.assertTrue(mouth_texture(positions=mesh(ratio=np.nextafter(np.float32(.15), np.float32(1))), previous_open=True)['open'])
        self.assertTrue(mouth_texture(positions=mesh(ratio=.2), previous_open=True)['open'])
        self.assertFalse(mouth_texture(positions=mesh(ratio=.2), previous_open=False)['open'])

    def test_hysteresis_changes_only_when_crossing_the_other_threshold(self):
        previous = False
        observed = []
        for ratio in (.1, .3, .2, .14, .2, .26):
            previous = mouth_texture(positions=mesh(ratio=ratio), previous_open=previous)['open']
            observed.append(previous)
        self.assertEqual(observed, [False, True, True, False, False, True])

    def test_ratio_does_not_depend_on_image_translation_or_scale(self):
        positions = mesh(ratio=.2)
        expected = mouth_texture(positions=positions)
        actual = mouth_texture(positions=positions*8+np.array([120, 240], np.float32))
        self.assertAlmostEqual(actual['ratio'], expected['ratio'], places=5)
        self.assertEqual(actual['textureState'], expected['textureState'])

    def test_bad_mesh_and_untyped_history_are_rejected(self):
        for positions in (np.zeros((248, 2), np.float32), mesh(ratio=.2).astype(np.float64),
                          mesh(ratio=.2)[:247], mesh(ratio=.2)*np.nan, mesh(ratio=.2)+40000):
            with self.assertRaises(ValueError):
                mouth_texture(positions=positions)
        for state in (1, 'Open', np.bool_(True)):
            with self.assertRaises(ValueError):
                mouth_texture(positions=mesh(ratio=.2), previous_open=state)

    def test_material_selection_keeps_pinned_spec_immutable(self):
        original = dict(SPEC['layers'][0])
        opened, selection = resolve_spec(positions=mesh(ratio=.3), spec=SPEC)
        self.assertEqual(opened['layers'][0]['path'], SPEC['mouthTextures']['Open']['path'])
        self.assertEqual(opened['layers'][0]['sha256'], SPEC['mouthTextures']['Open']['sha256'])
        self.assertEqual(selection['textureState'], 'Open')
        self.assertEqual(SPEC['layers'][0], original)


if __name__ == '__main__':
    unittest.main()
