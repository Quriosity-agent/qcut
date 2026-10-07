from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from face_features_controls import BY_NAME, combined_degrees, controls_active, normalize_controls
from face_shape_controls import DEFINITIONS as FACE_DEFINITIONS, mesh_degrees
from features_controls import DEFINITIONS as FEATURE_DEFINITIONS, feature_degrees


class FaceFeaturesControlsTests(unittest.TestCase):
    def test_single_groups_retain_their_existing_degree_vectors(self):
        for definitions, legacy in ((FACE_DEFINITIONS, mesh_degrees), (FEATURE_DEFINITIONS, feature_degrees)):
            cases = [{entry['name']: value} for entry in definitions
                     for value in (entry['min'], 0, 25, entry['max'])]
            cases.extend([{entry['name']: entry['max'] for entry in definitions},
                          {entry['name']: entry['min'] for entry in definitions}])
            for controls in cases:
                with self.subTest(controls=controls):
                    np.testing.assert_array_equal(combined_degrees(values=controls), legacy(values=controls))

    def test_shared_eye_spacing_and_short_face_accumulate_before_float32_rounding(self):
        values = {'TotalFace': 99.5, 'SmallFace': 12.125, 'EyeSpacing': -23.25}
        degrees = combined_degrees(values=values)
        self.assertEqual(degrees.dtype, np.float32)
        self.assertEqual(degrees.shape, (23,))
        self.assertEqual(degrees[0], np.float32(.08 * .995 - .18 * .2325 * 4))
        self.assertEqual(degrees[12], np.float32(-.01 * .995 - .07 * .12125))
        self.assertEqual(degrees[20], np.float32(2))
        np.testing.assert_array_equal(degrees, combined_degrees(values=dict(reversed(list(values.items())))))
        self.assertEqual(values, {'TotalFace': 99.5, 'SmallFace': 12.125, 'EyeSpacing': -23.25})

    def test_all_control_ranges_reject_invalid_values(self):
        for name, definition in BY_NAME.items():
            for value in (definition['min'], 0, definition['max']):
                with self.subTest(name=name, value=value):
                    self.assertEqual(normalize_controls(values={name: value}), {name: float(value)})
            for value in (definition['min'] - .01, definition['max'] + .01, True, np.bool_(False),
                          '50', None, np.nan, np.inf, -np.inf):
                with self.subTest(name=name, value=value), self.assertRaises(ValueError):
                    combined_degrees(values={name: value})

    def test_non_objects_unknown_controls_and_non_string_keys_rejected(self):
        for values in (None, [], 1, {'Lips': 50}, {'face_adjust_Nose': 50}, {1: 50}):
            with self.subTest(values=values), self.assertRaises(ValueError):
                normalize_controls(values=values)

    def test_subthreshold_values_bypass_both_groups(self):
        self.assertFalse(controls_active(values={'TotalFace': .1, 'Forehead': .025, 'MoveEye': -.03}))
        self.assertTrue(controls_active(values={'TotalFace': .1, 'MoveEye': -.04}))
        self.assertTrue(controls_active(values={'EyeSpacing': -.03}))


if __name__ == '__main__':
    unittest.main()
