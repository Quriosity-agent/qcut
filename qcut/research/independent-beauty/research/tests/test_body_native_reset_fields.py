"""Warm resets preserve native state that a cold stream would discard."""

import copy
import sys
import unittest

import numpy as np

from test_body_composition import synthetic_inputs


@unittest.skipUnless(sys.platform == 'darwin', 'native geometry uses macOS float32 libm')
class WarmResetFields(unittest.TestCase):
    def setUp(self):
        from body_composition.native_video import NativeVideoBody
        self.body = NativeVideoBody()
        self.body.configure_frame(timestamp=0)
        self.body.update(**synthetic_inputs(), targets=.35)

    def test_descriptor_reset_preserves_face_roi_arm_radius_and_present_flag(self):
        from body_composition.native_reset import reset_descriptors
        body = self.body
        head = body.head
        for offset in (*range(88, 104), *range(204, 248), *range(260, 264)):
            head.data[offset] = offset % 251
        retained = bytes(head.data)
        radius = body.arm.radius
        body.status.present = True
        reset_descriptors(body=body)
        self.assertIs(body.head, head)
        for start, end in ((88, 104), (204, 248), (260, 264)):
            self.assertEqual(bytes(head.data[start:end]), retained[start:end])
        for offset in (*range(64, 88, 4), *range(108, 164, 4), *range(168, 204, 4)):
            self.assertEqual(head.get(offset), -1)
        self.assertEqual(body.arm.radius, radius)
        self.assertTrue(body.status.present)
        self.assertFalse(body.status.initialized)
        for points in (body.arm.points, body.shoulder.points, body.public.base, body.public.endpivot):
            np.testing.assert_array_equal(points, np.full_like(points, -1))

    def test_parts_keep_strengths_anchors_filter_storage_and_counter_phase(self):
        from body_composition.native_reset import (
            ORTHO_RESET_BOUNDS, STRENGTH_PARTS, WIDEN_RESET_BOUNDS, reset_parts,
        )
        body = self.body
        states = copy.deepcopy(body.states)
        head = copy.deepcopy(body.head_history.state)
        arm = copy.deepcopy(body.arm_history.state)
        body.ortho_geometry.counter = 14
        body.widen_history.history.counter.value = 29
        body.vertex_history['SmallHead'].mark_dirty()
        histories = {name: (history.values, history.dirty)
                     for name, history in body.vertex_history.items()}
        reset_parts(body=body)
        for name in STRENGTH_PARTS:
            expected = states[name]
            expected.active = False
            expected.step = np.float32(2)
            self.assertEqual(body.states[name], expected)
        head['valid'] = arm['valid'] = False
        self.assertEqual(body.head_history.state, head)
        self.assertEqual(body.arm_history.state, arm)
        for name, (values, dirty) in histories.items():
            history = body.vertex_history[name]
            self.assertIs(history.values, values)
            self.assertEqual(history.dirty, dirty)
            self.assertFalse(history.initialized)
        self.assertEqual(body.ortho_history.state['intensity'], states['OrthoShoulder']['intensity'])
        self.assertEqual(body.widen_history.state['intensity'], states['WidenShoulder']['intensity'])
        self.assertEqual(body.ortho_geometry.counter, 14)
        self.assertEqual(body.widen_history.history.counter.value, 29)
        self.assertIsNone(body.ortho_geometry.cache)
        self.assertIsNone(body.widen_history.history.raw)
        self.assertEqual(body.ortho_geometry.bounds, ORTHO_RESET_BOUNDS)
        self.assertEqual(body.widen_history.history.bounds, WIDEN_RESET_BOUNDS)
        self.assertEqual(body.ortho_history.state['points'], [[-1, -1]] * 5)
        self.assertEqual(body.widen_history.state['visibility'], [0] * 5)

    def test_invalid_update_does_not_consume_a_pending_warm_reset(self):
        body = self.body
        body.configure_frame(timestamp=1)
        old = body.public.scale
        with self.assertRaises(ValueError):
            body.update(**{**synthetic_inputs(), 'coords': np.zeros((1, 2))}, targets=.35)
        self.assertTrue(body._reset_frame)
        self.assertEqual(body.public.scale, old)
        body.update(**synthetic_inputs(), targets=.35)
        self.assertFalse(body._reset_frame)
        self.assertEqual(body.frame, 2)

    def test_resize_resets_geometry_and_retains_mask_and_counter_phase(self):
        body = self.body
        mask = np.ones((7, 11), np.uint8)
        body.update(**synthetic_inputs(), targets=.35, segmentation_mask=mask)
        body.ortho_geometry.counter = 14
        body.widen_history.history.counter.value = 29
        body.configure_frame(timestamp=1 / 30)
        result = body.update(**{**synthetic_inputs(), 'width': 1080, 'height': 1920}, targets=.35)
        self.assertEqual(body.mode, 1)
        self.assertEqual(body.frame, 3)
        self.assertEqual(body._image_size, (1080, 1920))
        self.assertEqual(body.ortho_geometry.counter, 14)
        self.assertEqual(body.widen_history.history.counter.value, 29)
        np.testing.assert_array_equal(body.widen_history.history.segmentation_mask, mask)
        np.testing.assert_array_equal(result['base'][-1, -1], [1080, 1920])

    def test_jump_and_explicit_clock_reset_have_the_same_warm_transition(self):
        original = self.body
        explicit = copy.deepcopy(original)
        original.configure_frame(timestamp=1)
        explicit.configure_frame(timestamp=0, reset_clock=True)
        absent = {**synthetic_inputs(), 'body_present': False, 'faces': None,
                  'rectangles': None, 'rolls': None}
        results = [body.update(**absent, targets={}) for body in (original, explicit)]
        np.testing.assert_array_equal(results[0]['positions'], results[1]['positions'])
        self.assertEqual(original.frame, 2)
        self.assertEqual(explicit.frame, 2)
        self.assertEqual(original.mode, 1)
        self.assertEqual(explicit.mode, 1)
        self.assertTrue(original._effect_time != explicit._effect_time)


if __name__ == '__main__':
    unittest.main()
