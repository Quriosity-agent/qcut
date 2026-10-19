"""Visibility alone cannot admit boundary or off-image Public descriptor joints."""
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from body_composition.joint_groups import frame_joint_groups
from test_body_composition import synthetic_inputs


class PublicJointGroups(unittest.TestCase):
    def test_boundaries_and_hidden_joints_are_excluded_without_changing_input_visibility(self):
        coords = np.full((18, 2), .5, np.float32)
        visibility = np.ones(18, np.uint8)
        for outside in ([0, .5], [1, .5], [.5, 0], [.5, 1], [-.1, .5], [.5, 1.1]):
            coords[[8, 11]] = outside
            with self.subTest(outside=outside):
                _, (shoulders, hips, knees) = frame_joint_groups(
                    coords=coords, visibility=visibility, width=720, height=1280)
                self.assertEqual((len(shoulders), len(hips), len(knees)), (2, 0, 2))
                np.testing.assert_array_equal(visibility, np.ones(18, np.uint8))
        coords[[8, 11]] = .5
        visibility[8] = 0
        _, groups = frame_joint_groups(coords=coords, visibility=visibility, width=720, height=1280)
        np.testing.assert_array_equal(groups[1], [[360, 640]])


@unittest.skipUnless(sys.platform == 'darwin', 'native geometry uses macOS float32 libm')
class NativePublicJointGroups(unittest.TestCase):
    def test_visible_hips_outside_frame_do_not_activate_hip_after_a_reset(self):
        from body_composition.native_video import NativeVideoBody

        for y in (0, -.03, 1, 1.03):
            supplied = synthetic_inputs()
            supplied['coords'] = supplied['coords'].copy()
            supplied['coords'][[8, 11], 1] = y
            supplied['visibility'][[8, 11]] = 1
            engine = NativeVideoBody()
            engine.configure_frame(timestamp=1)
            engine.update(**supplied, targets=.35)
            with self.subTest(y=y):
                self.assertFalse(engine.states['SlimHip'].active)
                self.assertEqual(engine.states['SlimHip'].intensity, 0)
                np.testing.assert_array_equal(engine.hip.radii, [-1, -1, -1, -1])

    def test_one_in_frame_hip_is_eligible_even_when_smoothed_center_is_uninitialized(self):
        from body_composition.native_video import NativeVideoBody

        supplied = synthetic_inputs()
        supplied['coords'] = supplied['coords'].copy()
        supplied['coords'][8, 1] = 0
        engine = NativeVideoBody()
        engine.configure_frame(timestamp=1)
        with np.errstate(invalid='ignore', divide='ignore'):
            engine.update(**supplied, targets=.35)
        np.testing.assert_array_equal(engine.public.hip_smooth, [-1, -1])
        self.assertTrue(engine.states['SlimHip'].active)
        self.assertGreater(engine.states['SlimHip'].intensity, 0)


if __name__ == '__main__':
    unittest.main()
