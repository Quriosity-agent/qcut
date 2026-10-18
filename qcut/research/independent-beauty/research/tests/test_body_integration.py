"""Keep the explicit research path compatible with the established photo contract."""
import hashlib
import json
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from body_composition.controls import validate_controls
from body_smart_controls import internal_targets


class Controls(unittest.TestCase):
    def test_research_and_editor_agree_on_all_signed_control_boundaries(self):
        from body_smart_controls import CONTROLS

        for name, (_, minimum, maximum, _, _) in CONTROLS.items():
            for value in (minimum, 0, maximum):
                with self.subTest(name=name, value=value):
                    values, actual = validate_controls(controls={name: value})
                    expected = internal_targets(values=values)
                    self.assertEqual(tuple(actual), tuple(expected))
                    for part in expected:
                        self.assertEqual(actual[part].tobytes(), expected[part].tobytes())


@unittest.skipUnless(sys.platform == 'darwin', 'accepted geometry uses macOS float32 libm')
class Geometry(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = json.loads(Path(__file__).with_name('body_smart_fixture.json').read_text())

    def frame(self, *, row):
        width, height = self.fixture['size']
        named = {'coords': np.asarray(row['joints'], np.float32),
                 'visibility': np.asarray(row['visibility'], np.uint8),
                 'width': width, 'height': height,
                 'faces': np.asarray(row['faces'], np.float32),
                 'rectangles': np.asarray(row['rectangles'], np.float32),
                 'rolls': np.asarray(row['rolls'], np.float32)}
        return named

    def test_cold_geometry_preserves_existing_accepted_meshes(self):
        from body_composition import CombinedBody

        named = self.frame(row=self.fixture['still'])
        for name, controls in self.fixture['controls'].items():
            _, targets = validate_controls(controls=controls)
            actual = CombinedBody().update(**named, targets=targets)
            expected = self.fixture['expected']['still' + name.title()]
            self.assertEqual(hashlib.sha256(actual['positions'].tobytes()).hexdigest(), expected)

    def test_persistent_modes_preserve_existing_sequence_meshes(self):
        from body_composition import PersistentCombinedBody

        _, targets = validate_controls(controls=self.fixture['controls']['example'])
        for mode in (1, 2):
            candidate = PersistentCombinedBody(mode=mode)
            for index, row in enumerate(self.fixture['sequence']):
                with self.subTest(mode=mode, frame=index):
                    named = self.frame(row=row)
                    actual = candidate.update(**named, targets=targets)
                    expected = self.fixture['expected'][f'sequenceMode{mode}'][index]
                    self.assertEqual(hashlib.sha256(actual['positions'].tobytes()).hexdigest(), expected)


if __name__ == '__main__':
    unittest.main()
