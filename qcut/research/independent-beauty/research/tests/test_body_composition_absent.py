"""Empty-body results retain joint history while native part state keeps advancing."""

import struct
import sys
import unittest

import numpy as np

from test_body_composition import synthetic_inputs


@unittest.skipUnless(sys.platform == 'darwin', 'accepted geometry uses macOS float32 libm')
class AbsentBodyComposition(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from body_composition import PersistentCombinedBody
        cls.engine = PersistentCombinedBody

    def absent_inputs(self):
        return {**synthetic_inputs(), 'coords': np.zeros((18, 2), np.float32),
                'visibility': np.zeros(18, np.uint8), 'faces': None,
                'rectangles': None, 'rolls': None, 'body_present': False}

    def test_empty_body_keeps_joint_records_but_decays_part_intensity(self):
        engine = self.engine(mode=2)
        for _ in range(3):
            before = engine.update(**synthetic_inputs(), targets=0.35)
        bones = before['status']['bone_records'].copy()
        leg_intensity = before['states']['LongLeg'].intensity
        result = engine.update(**self.absent_inputs(), targets=0.35)
        self.assertFalse(result['status']['present'])
        np.testing.assert_array_equal(result['status']['bone_records'], bones)
        self.assertLess(result['states']['LongLeg'].intensity, leg_intensity)
        self.assertEqual(engine.frame, 4)
        self.assertFalse(np.array_equal(result['positions'], result['base']))

    def test_absent_body_is_distinct_from_present_body_with_all_joints_missing(self):
        absent, missing_joints = self.engine(), self.engine()
        for engine in (absent, missing_joints):
            engine.update(**synthetic_inputs(), targets=0.35)
        inputs = self.absent_inputs()
        kept = absent.update(**inputs, targets=0.35)
        lost = missing_joints.update(**{**inputs, 'body_present': True}, targets=0.35)
        self.assertFalse(np.array_equal(kept['status']['bone_records'], lost['status']['bone_records']))
        self.assertFalse(kept['status']['present'])
        self.assertTrue(lost['status']['present'])

    def test_initial_empty_result_uses_native_unpopulated_cache_bounds(self):
        engine = self.engine()
        result = engine.update(**self.absent_inputs(), targets=0.35)
        np.testing.assert_array_equal(result['positions'], result['base'])
        self.assertEqual(engine.widen_history.history.bounds,
                         (99999998, 99999998, -99999998, -99999998))
        self.assertFalse(result['status']['initialized'])

    def test_absent_body_selects_first_face_without_a_skeleton_match(self):
        engine = self.engine()
        supplied = synthetic_inputs()
        inputs = self.absent_inputs()
        inputs.update(faces=np.concatenate((supplied['faces'], supplied['faces'] + np.float32(.1))),
                      rectangles=np.tile(supplied['rectangles'], (2, 1)),
                      rolls=np.tile(supplied['rolls'], 2))
        result = engine.update(**inputs, targets={'SmallHead': .2})
        self.assertEqual(struct.unpack_from('<i', engine.head.data, 56)[0], 0)
        self.assertTrue(result['states']['SmallHead']['valid'])
        self.assertGreater(result['states']['SmallHead']['intensity'], 0)
        self.assertFalse(result['status']['present'])

    def test_invalid_presence_is_rejected_before_history_changes(self):
        engine = self.engine()
        engine.update(**synthetic_inputs(), targets=.35)
        before = engine.status.bones.copy()
        for invalid in (None, 0, 1, 'false'):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                engine.update(**synthetic_inputs(), targets=.35, body_present=invalid)
        self.assertEqual(engine.frame, 1)
        np.testing.assert_array_equal(engine.status.bones, before)

    def test_absent_body_with_empty_face_array_keeps_selected_face_history(self):
        engine = self.engine()
        supplied = synthetic_inputs()
        inputs = {**self.absent_inputs(), **{
            key: supplied[key] for key in ('faces', 'rectangles', 'rolls')
        }}
        engine.update(**inputs, targets={'SmallHead': .2})
        old_face_history = bytes(engine.head.data[64:104])
        empty = {**self.absent_inputs(), 'faces': np.empty((0, 106, 2), np.float32),
                 'rectangles': np.empty((0, 4), np.float32), 'rolls': np.empty(0, np.float32)}
        engine.update(**empty, targets={'SmallHead': .2})
        self.assertEqual(struct.unpack_from('<i', engine.head.data, 56)[0], 0)
        self.assertEqual(engine.head.data[60], 0)
        self.assertEqual(bytes(engine.head.data[64:104]), old_face_history)

    def test_no_faces_resets_an_old_second_face_for_both_empty_representations(self):
        supplied = synthetic_inputs()
        supplied.update(faces=np.concatenate((supplied['faces'] - np.float32(.25), supplied['faces'])),
                        rectangles=np.tile(supplied['rectangles'], (2, 1)),
                        rolls=np.tile(supplied['rolls'], 2))
        for empty in ({}, {'faces': np.empty((0, 106, 2), np.float32),
                          'rectangles': np.empty((0, 4), np.float32), 'rolls': np.empty(0, np.float32)}):
            with self.subTest(explicit_array=bool(empty)):
                engine = self.engine()
                engine.update(**supplied, targets=.2)
                self.assertEqual(struct.unpack_from('<i', engine.head.data, 56)[0], 1)
                engine.update(**{**self.absent_inputs(), **empty}, targets=.2)
                self.assertEqual(struct.unpack_from('<i', engine.head.data, 56)[0], -1)
                self.assertEqual(struct.unpack_from('<6f', engine.head.data, 64), (-1,) * 6)


if __name__ == '__main__':
    unittest.main()
