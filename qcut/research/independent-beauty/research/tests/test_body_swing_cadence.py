"""Control timing and microsecond boundaries observed in the original host."""

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from body_swing_cadence import swing_timestamp, swing_updates


class SwingCadenceTests(unittest.TestCase):
    def test_initial_controls_arrive_between_two_equal_time_updates(self):
        first, second = swing_updates(previous_controls={}, controls={'SlimBody': 40}, timestamp=0)
        self.assertEqual(first.controls.values, {})
        self.assertEqual(second.controls.values, {'SlimBody': 40})
        self.assertEqual((first.timestamp, second.timestamp), (0, 0))

    def test_changed_controls_leave_first_update_on_previous_values(self):
        previous = {'SlimBody': 40, 'StretchLeg': 30}
        requested = {'SlimBody': 70, 'StretchLeg': 0}
        first, second = swing_updates(previous_controls=previous, controls=requested, timestamp=1 / 30)
        self.assertEqual(first.controls.values, previous)
        self.assertEqual(second.controls.values, requested)
        self.assertEqual(first.timestamp, .033333)
        self.assertEqual(second.timestamp, .033333)
        self.assertEqual(previous, {'SlimBody': 40, 'StretchLeg': 30})
        self.assertEqual(requested, {'SlimBody': 70, 'StretchLeg': 0})

    def test_reset_params_reaches_only_the_post_parameter_update(self):
        first, second = swing_updates(previous_controls={'SlimBody': 40},
                                     controls={'SlimBody': 70}, timestamp=1,
                                     control_events=[{'type': 'reset_params'}])
        self.assertEqual(first.controls.values, {'SlimBody': 40})
        self.assertFalse(first.controls.reset_clock)
        self.assertEqual(second.controls.values, {})
        self.assertTrue(second.controls.reset_clock)
        self.assertTrue(second.reapply)

    def test_equal_value_event_still_reapplies_only_second_update(self):
        first, second = swing_updates(previous_controls={'SlimBody': 40},
                                     controls={'SlimBody': 40}, timestamp=0,
                                     control_events=[{'type': 'set_control', 'name': 'SlimBody', 'value': 40}])
        self.assertFalse(first.reapply)
        self.assertTrue(second.reapply)

    def test_positive_half_microsecond_is_not_bankers_rounding(self):
        self.assertEqual(swing_timestamp(timestamp=.0000005), .000001)
        self.assertEqual(swing_timestamp(timestamp=.0000025), .000003)
        self.assertEqual(swing_timestamp(timestamp=.00000049), 0)

    def test_invalid_plan_rejected_before_any_update(self):
        for timestamp in (-1, float('nan'), float('inf'), True, 1e15):
            with self.subTest(timestamp=timestamp), self.assertRaises(ValueError):
                swing_updates(previous_controls={}, controls={}, timestamp=timestamp)
        with self.assertRaises(ValueError):
            swing_updates(previous_controls={}, controls={'missing': 1}, timestamp=0)


if __name__ == '__main__':
    unittest.main()
