"""Native package initialization and mesh bounds, without private inference assets."""

import sys
import unittest

import numpy as np

from test_body_composition import synthetic_inputs


@unittest.skipUnless(sys.platform == 'darwin', 'native geometry uses macOS float32 libm')
class NativeVideoProfile(unittest.TestCase):
    def setUp(self):
        from body_composition.native_video import NativeVideoBody
        self.engine = NativeVideoBody()

    def test_hard_reset_leg_sentinels_survive_initial_empty_frames(self):
        supplied = synthetic_inputs()
        supplied.update(coords=np.zeros((18, 2), np.float32), visibility=np.zeros(18, np.uint8),
                        faces=None, rectangles=None, rolls=None, body_present=False)
        for _ in range(3):
            result = self.engine.update(**supplied, targets=.35)
            np.testing.assert_array_equal(self.engine.public.base, [-1, -1])
            np.testing.assert_array_equal(self.engine.public.endpivot, [-1, -1])
            np.testing.assert_array_equal(result['positions'], result['base'])
        first = self.engine.update(**synthetic_inputs(), targets=.35)
        self.assertEqual(first['states']['LongLeg'].end, self.engine.public.endpivot[0])
        self.assertEqual(first['states']['LongLeg'].pivot, self.engine.public.endpivot[1])

    def test_package_grid_is_fixed_across_portrait_and_landscape_sizes(self):
        for width, height in ((1080, 1920), (720, 1280), (1280, 720)):
            with self.subTest(width=width, height=height):
                self.engine.reset()
                result = self.engine.update(**{**synthetic_inputs(), 'width': width, 'height': height}, targets={})
                self.assertEqual(result['base'].shape, (76, 61, 2))
                self.assertEqual(result['tri'].shape, (9000, 3))
                np.testing.assert_array_equal(result['base'][0, 0], [0, 0])
                np.testing.assert_array_equal(result['base'][-1, -1], [width, height])
                np.testing.assert_array_equal(result['uv'][-1, -1], [1, 1])
                np.testing.assert_array_equal(result['positions'], result['base'])

    def test_reset_restores_the_package_profile_and_first_frame(self):
        first = self.engine.update(**synthetic_inputs(), targets=.35)
        for _ in range(3):
            self.engine.update(**synthetic_inputs(), targets=.35)
        self.engine.reset()
        self.assertEqual(self.engine.mode, 0)
        actual = self.engine.update(**synthetic_inputs(), targets=.35)
        np.testing.assert_array_equal(actual['positions'], first['positions'])
        self.assertEqual(self.engine.frame, 1)

    def test_body_grid_remains_bounded_above_the_package_size(self):
        from body_mesh_grid import make_grid
        for rows, cols in ((0, 60), (75, -1), (100, 100), (1000000, 1)):
            with self.subTest(rows=rows, cols=cols), self.assertRaises(ValueError):
                make_grid(1080, 1920, rows, cols)

    def test_same_value_assignment_restarts_strength_but_unchanged_frames_do_not(self):
        from body_composition.controls import validate_controls
        from body_composition.native_video import NativeVideoBody
        controls, targets = validate_controls(controls={'SmallHead': 25, 'StretchLeg': 25})
        engines = [NativeVideoBody(), NativeVideoBody()]
        absent = {**synthetic_inputs(), 'body_present': False, 'faces': None, 'rectangles': None, 'rolls': None}
        for engine in engines:
            engine.configure_controls(controls=controls)
            engine.update(**synthetic_inputs(), targets=targets)
            for _ in range(3):
                engine.configure_controls(controls=controls)
                engine.update(**absent, targets=targets)
        untouched, reassigned = engines
        untouched.configure_controls(controls=controls)
        reassigned.configure_controls(controls=controls, reapply=True)
        ordinary = untouched.update(**synthetic_inputs(), targets=targets)
        assigned = reassigned.update(**synthetic_inputs(), targets=targets)
        for name, amount in (('SmallHead', targets['SmallHead']), ('LongLeg', targets['LongLeg'])):
            with self.subTest(part=name):
                old = ordinary['states'][name]
                new = assigned['states'][name]
                old_strength = old['intensity'] if isinstance(old, dict) else old.intensity
                new_strength = new['intensity'] if isinstance(new, dict) else new.intensity
                self.assertLess(old_strength, amount)
                self.assertEqual(new_strength, amount)

    def test_changing_one_slider_also_reassigns_unchanged_parts(self):
        from body_composition.controls import validate_controls
        controls, targets = validate_controls(controls={'SmallHead': 25, 'StretchLeg': 25})
        self.engine.configure_controls(controls=controls)
        self.engine.update(**synthetic_inputs(), targets=targets)
        absent = {**synthetic_inputs(), 'body_present': False, 'faces': None, 'rectangles': None, 'rolls': None}
        self.engine.update(**absent, targets=targets)
        self.assertLess(self.engine.states['LongLeg'].intensity, targets['LongLeg'])
        controls, targets = validate_controls(controls={'SmallHead': 75, 'StretchLeg': 25})
        self.engine.configure_controls(controls=controls)
        result = self.engine.update(**synthetic_inputs(), targets=targets)
        self.assertEqual(result['states']['LongLeg'].intensity, targets['LongLeg'])
        self.assertEqual(result['states']['SmallHead']['intensity'], targets['SmallHead'])

    def test_input_type_uses_the_exact_native_time_boundary(self):
        for elapsed, mode in ((None, 1), (1 / 30, 0), (.01, 2),
                              (np.nextafter(.01, np.inf), 0), (1 / 120, 2), (1 / 240, 2),
                              (.1, 0), (np.nextafter(.1, np.inf), 1), (.25, 1)):
            with self.subTest(elapsed=elapsed):
                self.engine.reset()
                self.engine.configure_frame(timestamp=0)
                if elapsed is not None:
                    self.engine.configure_frame(timestamp=elapsed)
                self.assertEqual(self.engine.mode, mode)

    def test_inactive_mode2_leaf_does_not_reset_history_on_a_later_mode0_frame(self):
        self.engine.update(**synthetic_inputs(), targets=0)
        history = self.engine.vertex_history['SmallHead']
        history.values = np.full((76, 61, 2), 1000, np.float32)
        history.initialized = True
        self.engine.configure_frame(timestamp=0)
        self.engine.configure_frame(timestamp=1 / 120)
        self.engine.update(**synthetic_inputs(), targets=0)
        self.assertFalse(history.dirty)
        np.testing.assert_array_equal(history.values, np.full((76, 61, 2), 1000, np.float32))
        self.engine.configure_frame(timestamp=1 / 120 + 1 / 30)
        self.engine.update(**synthetic_inputs(), targets={'SmallHead': .35})
        self.assertGreater(float(np.max(history.values)), 900)


if __name__ == '__main__':
    unittest.main()
