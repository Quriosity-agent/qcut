"""Two graph updates form one atomic, recoverable source-frame operation."""
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest
from unittest.mock import Mock, patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import body_smart_sequence as module


class SwingRenderTests(unittest.TestCase):
    def setUp(self):
        self.rgba = np.full((32, 32, 4), 255, np.uint8)
        self.base = np.asarray([[[0, 0], [32, 0]], [[0, 32], [32, 32]]], np.float32)
        self.mesh = {'base': self.base, 'positions': self.base + 1,
                     'uv': self.base / 32, 'tri': np.asarray([[0, 1, 2], [1, 2, 3]], np.int32)}
        self.engine = module.BodySmartSequence(runtime='/unused-runtime')
        self.execution = SimpleNamespace(previous_controls={}, networks=SimpleNamespace(routes=[], cancelled=None),
                                         identity={'profile': 'swing-coreml-v1', 'generation': 'test'})
        self.engine._execution = self.execution
        self.engine.skeleton = Mock()
        self.engine.skeleton.update.return_value = None
        self.engine.skeleton.last_debug = {'network': 'coarse', 'plan': {}, 'state': {}}
        self.engine.face = Mock()
        self.engine.face.update.return_value = (None, {})
        self.engine.composition = Mock()
        self.engine.composition.update.return_value = self.mesh
        self.addCleanup(patch.stopall)
        patch.object(module, 'algorithm_image', return_value=(self.rgba, {})).start()
        patch.object(module, 'process_images', return_value={'loaded_images': [], 'private_native_images': []}).start()
        self.draw = patch.object(module, 'draw_mesh', return_value=(self.rgba.copy(), {})).start()

    def render(self, *, index=0, **kwargs):
        return self.engine.process(rgba=self.rgba, stream='clip', frame=index, timestamp=index / 30,
                                   controls={'SlimBody': 40}, **kwargs)

    def test_both_graph_updates_advance_but_only_final_mesh_is_drawn(self):
        _, receipt = self.render()
        self.assertEqual(self.engine.skeleton.update.call_count, 2)
        self.assertEqual(self.engine.face.update.call_count, 2)
        self.assertEqual(self.engine.composition.update.call_count, 2)
        self.draw.assert_called_once()
        self.assertEqual(self.engine.next_frame, 1)
        calls = self.engine.composition.configure_controls.call_args_list
        self.assertEqual([call.kwargs['controls'] for call in calls], [{}, {'SlimBody': 40}])
        self.assertEqual(len(receipt['graphUpdates']), 2)
        self.assertEqual(self.execution.previous_controls, {'SlimBody': 40})

    def test_reset_event_does_not_reset_perception_or_the_pre_parameter_update(self):
        self.execution.previous_controls = {'StretchLeg': 30}
        self.render(control_events=[{'type': 'reset_params'}])
        controls = self.engine.composition.configure_controls.call_args_list
        self.assertEqual([call.kwargs['controls'] for call in controls], [{'StretchLeg': 30}, {}])
        clocks = self.engine.composition.configure_frame.call_args_list
        self.assertEqual([call.kwargs['reset_clock'] for call in clocks], [False, True])
        self.engine.skeleton.reset.assert_not_called()
        self.engine.face.reset.assert_not_called()
        self.assertEqual(self.execution.previous_controls, {})

    def test_cancel_between_updates_does_not_commit_a_partial_frame(self):
        cancelled = lambda: self.engine.composition.update.call_count == 1
        with self.assertRaises(module.BodySequenceCancelled):
            self.render(cancelled=cancelled)
        self.assertEqual(self.engine.skeleton.update.call_count, 1)
        self.assertTrue(self.engine.invalid)
        self.assertEqual(self.engine.next_frame, 0)
        self.assertEqual(self.execution.previous_controls, {})
        self.draw.assert_not_called()
        with self.assertRaisesRegex(ValueError, 'reset and replay'):
            self.render()

    def test_second_update_failure_preserves_last_completed_controls(self):
        self.execution.previous_controls = {'StretchLeg': 30}
        self.engine.composition.update.side_effect = [self.mesh, RuntimeError('graph failed')]
        with self.assertRaisesRegex(RuntimeError, 'graph failed'):
            self.render()
        self.assertEqual(self.execution.previous_controls, {'StretchLeg': 30})
        self.assertEqual(self.engine.next_frame, 0)
        self.assertTrue(self.engine.invalid)
        self.draw.assert_not_called()

    def test_jump_timestamp_uses_same_rounded_time_for_both_updates(self):
        self.render()
        self.engine.process(rgba=self.rgba, stream='clip', frame=1, timestamp=3.1415925, controls={})
        clocks = self.engine.composition.configure_frame.call_args_list[-2:]
        self.assertEqual([call.kwargs['timestamp'] for call in clocks], [3.141593, 3.141593])
        self.assertEqual(self.engine.next_frame, 2)

    def test_dimension_change_is_rejected_before_any_extra_updates(self):
        self.render()
        with self.assertRaisesRegex(ValueError, 'new execution generation'):
            self.engine.process(rgba=np.full((32, 48, 4), 255, np.uint8), stream='clip',
                                frame=1, timestamp=1, controls={})
        self.assertEqual(self.engine.skeleton.update.call_count, 2)
        self.assertFalse(self.engine.invalid)


if __name__ == '__main__':
    unittest.main()
