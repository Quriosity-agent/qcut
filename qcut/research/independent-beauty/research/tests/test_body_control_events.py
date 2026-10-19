"""Ordered RESET_PARAMS and slider events keep native event semantics explicit."""
import copy
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import body_control_events as module
from body_composition.controls import RULES, validate_controls


RESET = {'type': 'reset_params'}


def set_control(*, name='SmallHead', value=25):
    return {'type': 'set_control', 'name': name, 'value': value}


class BodyControlEvents(unittest.TestCase):
    def assert_targets_equal(self, actual, expected):
        self.assertEqual(actual.keys(), expected.keys())
        for name in actual:
            self.assertIsInstance(actual[name], np.float32)
            self.assertEqual(actual[name].tobytes(), expected[name].tobytes())

    def test_no_events_preserve_existing_percent_conversion_and_omitted_zero_targets(self):
        controls = {'SmallHead': 25, 'SlimHip': -20, 'SlimBreast': -0.0}
        values, targets = validate_controls(controls=controls)
        for events in ((), []):
            with self.subTest(events=events):
                result = module.resolve_control_events(controls=controls, control_events=events)
                self.assertEqual(result.values, values)
                self.assert_targets_equal(result.targets, targets)
                self.assertFalse(result.force_reapply)
                self.assertFalse(result.reset_clock)

    def test_reset_overrides_every_nonzero_baseline_control(self):
        baseline = {name.removeprefix('body_adjust_'): 25 for name in RULES}
        result = module.resolve_control_events(controls=baseline, control_events=[RESET])
        self.assertEqual(result.values, {})
        self.assertEqual(len(result.targets), 10)
        self.assertTrue(all(value == 0 for value in result.targets.values()))
        self.assertTrue(result.force_reapply)
        self.assertTrue(result.reset_clock)

    def test_reset_then_set_and_set_then_reset_have_distinct_targets(self):
        after = module.resolve_control_events(controls={'SlimBody': 40},
                                              control_events=[RESET, set_control(value=30)])
        before = module.resolve_control_events(controls={'SlimBody': 40},
                                               control_events=[set_control(value=30), RESET])
        self.assertEqual(after.values, {'SmallHead': 30.0})
        self.assertEqual(before.values, {})
        self.assertGreater(after.targets['SmallHead'], 0)
        self.assertEqual(after.targets['SlimBody'], 0)
        self.assertEqual(before.targets['SmallHead'], 0)
        self.assertTrue(after.reset_clock and before.reset_clock)

    def test_set_changes_only_its_control_and_same_value_still_reapplies(self):
        controls = {'SmallHead': 25, 'SlimBody': 40}
        result = module.resolve_control_events(controls=controls, control_events=[set_control()])
        self.assertEqual(result.values, controls)
        self.assertTrue(result.force_reapply)
        self.assertFalse(result.reset_clock)

    def test_restore_prior_values_does_not_erase_the_reset_clock_event(self):
        result = module.resolve_control_events(controls={'SmallHead': 25},
                                               control_events=[RESET, set_control()])
        self.assertEqual(result.values, {'SmallHead': 25.0})
        self.assertTrue(result.force_reapply)
        self.assertTrue(result.reset_clock)

    def test_zero_negative_and_multiple_assignments_use_public_slider_units(self):
        events = [set_control(name='SlimHip', value=-50), set_control(value=80),
                  set_control(value=-0.0), set_control(name='SlimBreast', value=-25)]
        result = module.resolve_control_events(controls={'SlimBody': 20}, control_events=events)
        expected = {'SlimBody': 20.0, 'SlimHip': -50.0, 'SmallHead': 0.0, 'SlimBreast': -25.0}
        self.assertEqual(result.values, expected)
        self.assertFalse(np.signbit(result.values['SmallHead']))
        self.assert_targets_equal(result.targets, validate_controls(controls=expected)[1])

    def test_repeated_resets_preserve_only_assignments_after_the_last_reset(self):
        result = module.resolve_control_events(controls={'SlimBody': 20}, control_events=[
            RESET, set_control(value=40), RESET, RESET, set_control(name='SlimHip', value=-25)])
        self.assertEqual(result.values, {'SlimHip': -25.0})
        self.assertTrue(result.reset_clock)
        self.assertTrue(result.force_reapply)

    def test_next_frame_uses_its_caller_baseline_again(self):
        controls = {'SmallHead': 25}
        cleared = module.resolve_control_events(controls=controls, control_events=[RESET])
        restored = module.resolve_control_events(controls=controls)
        kept_zero = module.resolve_control_events(controls={})
        self.assertEqual(cleared.values, {})
        self.assertEqual(restored.values, {'SmallHead': 25.0})
        self.assertEqual(kept_zero.values, {})
        self.assertFalse(restored.force_reapply or kept_zero.reset_clock)

    def test_input_mappings_are_unchanged_and_result_is_owned(self):
        controls = {'SmallHead': 25, 'SlimBody': 40}
        events = [RESET.copy(), set_control(value=30)]
        originals = copy.deepcopy((controls, events))
        result = module.resolve_control_events(controls=controls, control_events=events)
        self.assertEqual((controls, events), originals)
        result.values['SmallHead'] = 99
        self.assertEqual((controls, events), originals)
        self.assertIsNot(module.resolve_control_events(controls=controls).values, controls)

    def test_invalid_event_shapes_names_and_values_are_refused(self):
        invalid = [None, True, 'reset_params', [], {}, {'type': 'other'},
                   {'type': 'reset_params', 'value': 0}, {'type': 'set_control'},
                   set_control(name=[]), set_control(name='body_adjust_SmallHead'),
                   set_control(name='LongLeg'), set_control(value=True), set_control(value=np.bool_(True)),
                   set_control(value=float('nan')), set_control(value=float('inf')),
                   set_control(value=-1), set_control(value=101), set_control(name='SlimHip', value=-51),
                   {**set_control(), 'extra': 1}]
        for event in invalid:
            with self.subTest(event=event), self.assertRaises(ValueError):
                module.resolve_control_events(controls={}, control_events=[event])
        for events in (None, True, 'reset_params', {}, {1}, iter(())):
            with self.subTest(events=events), self.assertRaises(ValueError):
                module.resolve_control_events(controls={}, control_events=events)

    def test_late_invalid_event_cannot_partially_apply_or_mutate_inputs(self):
        controls = {'SmallHead': 25}
        events = [RESET.copy(), set_control(value=30), set_control(value=101)]
        originals = copy.deepcopy((controls, events))
        with patch.object(module, 'ResolvedBodyControls') as construct:
            with self.assertRaises(ValueError):
                module.resolve_control_events(controls=controls, control_events=events)
            construct.assert_not_called()
        self.assertEqual((controls, events), originals)
        self.assertEqual(module.resolve_control_events(controls=controls).values, controls)

    def test_reset_does_not_hide_an_invalid_baseline(self):
        with self.assertRaises(ValueError):
            module.resolve_control_events(controls={'SmallHead': 101}, control_events=[RESET])


if __name__ == '__main__':
    unittest.main()
