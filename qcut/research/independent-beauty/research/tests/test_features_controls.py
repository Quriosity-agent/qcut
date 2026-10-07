from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from features_controls import DEFINITIONS, feature_degrees, features_active, normalize_controls


class FeaturesControlTests(unittest.TestCase):
    def test_all_seven_bindings_have_distinct_organ_degrees(self):
        expected = {'EnlargeEye': (1, .14), 'EyeSpacing': (0, .36), 'MoveEye': (3, -.3),
                    'Nose': (4, -.14), 'MoveNose': (5, -.14),
                    'ZoomMouth': (7, -.42), 'MoveMouth': (6, -.36)}
        self.assertEqual({entry['name'] for entry in DEFINITIONS}, set(expected))
        for definition in DEFINITIONS:
            index, value = expected[definition['name']]
            degrees = feature_degrees(values={definition['name']: definition['max']})
            self.assertEqual(degrees.dtype, np.float32)
            self.assertEqual(degrees[index], np.float32(value))
            self.assertEqual(degrees[20], 2)
            self.assertEqual(np.count_nonzero(degrees), 2)
            np.testing.assert_array_equal(degrees[8:20], np.zeros(12, np.float32))

    def test_signed_controls_reverse_the_transform_without_face_degrees(self):
        expected = {'EyeSpacing': (0, -.36), 'MoveEye': (3, .3), 'MoveNose': (5, .14),
                    'ZoomMouth': (7, .42), 'MoveMouth': (6, .36)}
        for name, (index, value) in expected.items():
            self.assertEqual(feature_degrees(values={name: -50})[index], np.float32(value))

    def test_combination_preserves_each_independent_degree_and_input_mapping(self):
        controls = {'EnlargeEye': 70, 'Nose': 60, 'ZoomMouth': -20}
        original = controls.copy()
        degrees = feature_degrees(values=controls)
        np.testing.assert_array_equal(degrees[[1, 4, 7, 20]],
                                      np.array([.098, -.084, .168, 2], np.float32))
        self.assertEqual(np.count_nonzero(degrees), 4)
        self.assertEqual(controls, original)

    def test_bad_names_types_nonfinite_and_ranges_rejected(self):
        invalid = [[], None, {'MouthSize': 50}, {'EnlargeEye': True}, {'EnlargeEye': '50'},
                   {'Nose': -1}, {'EnlargeEye': 101}, {'MoveEye': 51}, {'ZoomMouth': -51},
                   {'EyeSpacing': np.nan}, {'MoveNose': np.inf}, {'MoveMouth': np.bool_(False)}]
        for values in invalid:
            with self.subTest(values=values), self.assertRaises(ValueError):
                normalize_controls(values=values)

    def test_visibility_boundary_uses_scaled_event_and_strict_threshold(self):
        self.assertFalse(features_active(values={}))
        self.assertFalse(features_active(values={'EyeSpacing': .025}))
        self.assertTrue(features_active(values={'EyeSpacing': .026}))
        self.assertFalse(features_active(values={'EnlargeEye': .1}))
        self.assertTrue(features_active(values={'EnlargeEye': .101}))


if __name__ == '__main__':
    unittest.main()
