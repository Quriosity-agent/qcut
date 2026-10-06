"""Independent scalar fixtures for static branches; not native parity claims."""
import copy
import math
import struct
import unittest

import numpy as np

from face_extra_inner_math import branch_for, initialize_inner_filter, replay_inner_filter, validate_state


def rounded(*, value):
    return struct.unpack("<f", struct.pack("<f", value))[0]


def scalar_update(*, old, new, scale):
    difference = rounded(value=new - old)
    ratio = rounded(value=abs(difference) / scale)
    weight = rounded(value=math.exp(-math.pow(ratio, 3)))
    return rounded(value=rounded(value=old * weight) +
                   rounded(value=new * rounded(value=1 - weight)))


def state_fixture(*, empty=False, scale=4.0, first=False):
    return dict(count=0 if empty else 106, width=0 if empty else 720,
        height=0 if empty else 1280, scale=scale, escale=4.0, alpha=0.2, first=first,
        current_xy=[] if empty else [i / 8 for i in range(212)],
        previous_xy=[] if empty else [-i / 8 for i in range(212)],
        delta_x=[] if empty else [i / 16 for i in range(106)],
        delta_y=[] if empty else [-i / 16 for i in range(106)])


def point_fixture(*, count=280):
    return (np.arange(count * 2, dtype=np.float32).reshape(count, 2) / np.float32(8) +
            np.asarray([-0.375, 0.75], np.float32))


class BitsAssertions:
    def assert_bits(self, *, actual, expected):
        left, right = np.asarray(actual, np.float32), np.asarray(expected, np.float32)
        self.assertEqual(left.shape, right.shape)
        self.assertEqual(left.tobytes(), right.tobytes())


class InnerBranchTests(BitsAssertions, unittest.TestCase):
    def test_empty_history_copies_all280_and_does_not_initialize(self):
        state, points = state_fixture(empty=True), point_fixture()
        original = copy.deepcopy(state)
        output, updated = replay_inner_filter(state=state, points=points)
        self.assertEqual(branch_for(state=state, points=points), "empty-copy")
        self.assert_bits(actual=output, expected=points)
        self.assertEqual(state, original)
        self.assertEqual(updated, original)
        self.assertIsNot(updated, state)
        self.assertFalse(np.shares_memory(output, points))
        output[0] = 999
        self.assertNotEqual(float(points[0, 0]), 999)

    def test_empty_input_preserves_populated_history_even_with_zero_scale(self):
        points = point_fixture(count=0)
        for scale in (0.0, 4.0):
            state = state_fixture(scale=scale)
            output, updated = replay_inner_filter(state=state, points=points)
            self.assertEqual(output.shape, (0, 2))
            self.assertEqual(updated, state)
            updated["current_xy"][0] = 999
            self.assertEqual(state["current_xy"][0], 0)

    def test_empty_current_not_count_field_decides_early_return(self):
        state = state_fixture()
        state["current_xy"] = []
        output, updated = replay_inner_filter(state=state, points=point_fixture())
        self.assertEqual(len(output), 280)
        self.assertEqual(updated, state)

    def test_near_zero_copy_preserves_delta_first_count_and_metadata(self):
        points = point_fixture()
        for scale in (0.0, -0.0, np.nextafter(np.float32(0), np.float32(1)).item(), 1e-6):
            for first in (True, False):
                with self.subTest(scale=scale, first=first):
                    state = state_fixture(scale=scale, first=first)
                    original = copy.deepcopy(state)
                    output, updated = replay_inner_filter(state=state, points=points)
                    self.assertEqual(branch_for(state=state, points=points), "near-zero-copy")
                    self.assert_bits(actual=output, expected=points)
                    self.assertEqual(updated["previous_xy"], state["current_xy"])
                    self.assertEqual(updated["current_xy"], points.reshape(-1).tolist())
                    for key in ("count", "first", "delta_x", "delta_y", "width", "height", "escale", "scale", "alpha"):
                        self.assertEqual(updated[key], state[key])
                    self.assertEqual(len(updated["current_xy"]), 560)
                    self.assertEqual(updated["count"], 106)
                    self.assertEqual(state, original)

    def test_threshold_compares_promoted_float_against_double_not_float_constant(self):
        below = np.float32(1e-5)
        above = np.nextafter(below, np.float32(np.inf))
        self.assertLess(float(below), 1e-5)
        self.assertGreater(float(above), 1e-5)
        self.assertEqual(branch_for(state=state_fixture(scale=float(below)), points=point_fixture()), "near-zero-copy")
        self.assertEqual(branch_for(state=state_fixture(scale=float(above)), points=point_fixture()), "cubic-primary106")

    def test_near_zero_copy_preserves_signed_zero_and_subnormal_tail_bits(self):
        points = point_fixture()
        points.view(np.uint32)[0] = [0x80000000, 1]
        points.view(np.uint32)[-1] = [0x80000001, 0x80000000]
        output, updated = replay_inner_filter(state=state_fixture(scale=0), points=points)
        self.assert_bits(actual=output, expected=points)
        self.assert_bits(actual=updated["current_xy"], expected=points.reshape(-1))

    def test_near_zero_second_call_preserves_full280_previous(self):
        _, state = replay_inner_filter(state=state_fixture(scale=0), points=point_fixture())
        output, updated = replay_inner_filter(state=state, points=point_fixture() + np.float32(10))
        self.assertEqual(updated["previous_xy"], state["current_xy"])
        self.assertEqual(len(updated["previous_xy"]), 560)
        self.assertEqual(len(output), 280)

    def test_normal_after_near_zero_uses_prefix_but_preserves_full_previous(self):
        _, state = replay_inner_filter(state=state_fixture(scale=0), points=point_fixture())
        state["scale"] = 4.0
        points = point_fixture() + np.float32(0.5)
        expected = [scalar_update(old=old, new=float(new), scale=4.0)
                    for old, new in zip(state["current_xy"][:212], points[:106].flat, strict=True)]
        output, updated = replay_inner_filter(state=state, points=points)
        self.assert_bits(actual=output.reshape(-1), expected=expected)
        self.assertEqual((len(output), len(updated["current_xy"]), len(updated["previous_xy"])), (106, 212, 560))
        self.assertEqual(updated["previous_xy"], state["current_xy"])

    def test_normal_first_and_nonfirst_match_independent_scalar_and_replace_delta(self):
        for first in (False, True):
            state = state_fixture(first=first)
            points = point_fixture()
            original = copy.deepcopy(state)
            expected = [scalar_update(old=old, new=float(new), scale=state["scale"])
                        for old, new in zip(state["current_xy"], points[:106].flat, strict=True)]
            output, updated = replay_inner_filter(state=state, points=points)
            self.assert_bits(actual=output.reshape(-1), expected=expected)
            delta = [rounded(value=float(new) - old)
                     for old, new in zip(state["current_xy"], points[:106].flat, strict=True)]
            self.assert_bits(actual=updated["delta_x"], expected=delta[::2])
            self.assert_bits(actual=updated["delta_y"], expected=delta[1::2])
            self.assertFalse(updated["first"])
            self.assertEqual(updated["previous_xy"], original["current_xy"])
            self.assertEqual(state, original)

    def test_normal_tail_neither_updates_nor_corrects_primary(self):
        state, points = state_fixture(), point_fixture()
        expected, expected_state = replay_inner_filter(state=state, points=points)
        points[106:] *= -1
        actual, actual_state = replay_inner_filter(state=state, points=points)
        self.assert_bits(actual=actual, expected=expected)
        self.assertEqual(actual_state, expected_state)

    def test_normal106_and280_are_same_arithmetic(self):
        points, state = point_fixture(), state_fixture()
        left, left_state = replay_inner_filter(state=state, points=points[:106])
        right, right_state = replay_inner_filter(state=state, points=points)
        self.assert_bits(actual=left, expected=right)
        self.assertEqual(left_state, right_state)

    def test_normal_seeded_inputs_match_scalar_instruction_order(self):
        rng = np.random.default_rng(7)
        for scale in (np.nextafter(np.float32(1e-5), np.float32(np.inf)).item(), 0.75, 4.0, 4096.0):
            state = state_fixture(scale=scale)
            current = rng.uniform(-200, 200, (106, 2)).astype(np.float32)
            state["current_xy"] = current.reshape(-1).tolist()
            points = (current + rng.uniform(-2, 2, current.shape).astype(np.float32)).astype(np.float32)
            expected = [scalar_update(old=float(old), new=float(new), scale=scale)
                        for old, new in zip(current.flat, points.flat, strict=True)]
            output, _ = replay_inner_filter(state=state, points=points)
            self.assert_bits(actual=output.reshape(-1), expected=expected)

    def test_invalid_inputs_rejected_without_coercion_even_on_early_return(self):
        for points in ([], np.zeros((105, 2), np.float32), np.zeros((281, 2), np.float32),
                       np.zeros((106, 2), np.float64), np.zeros((2, 106), np.float32),
                       np.full((106, 2), np.nan, np.float32), np.full((106, 2), 32769, np.float32)):
            with self.subTest(shape=getattr(points, "shape", None)), self.assertRaises(ValueError):
                replay_inner_filter(state=state_fixture(empty=True), points=points)

    def test_invalid_states_fail_before_arithmetic(self):
        for key, value in (("count", True), ("count", 280), ("count", 1), ("first", 1),
                ("scale", -1), ("scale", float("nan")), ("scale", float("inf")), ("scale", True),
                ("alpha", 2), ("width", 0), ("height", 4097), ("escale", -1),
                ("current_xy", [0] * 210), ("previous_xy", [0] * 562),
                ("delta_x", []), ("delta_y", [float("nan")] * 106)):
            state = state_fixture()
            state[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                replay_inner_filter(state=state, points=point_fixture())

    def test_zero_count_cannot_smuggle_populated_current(self):
        state = state_fixture(empty=True)
        state["current_xy"] = [0.0] * 212
        with self.assertRaises(ValueError):
            validate_state(state=state)


class InnerInitializationTests(BitsAssertions, unittest.TestCase):
    def init(self, *, state=None, **changes):
        arguments = dict(state=state_fixture(empty=True) if state is None else state,
            points=point_fixture(), begin=0, end=106, width=1280, height=720, escale=4, count=106)
        arguments.update(changes)
        return initialize_inner_filter(**arguments)

    def test_fresh_initialization_copies_range_and_leaves_empty_histories(self):
        points = point_fixture()
        state = self.init(points=points, begin=10, end=116)
        self.assertEqual(state["current_xy"], points[10:116].reshape(-1).tolist())
        self.assertEqual((state["count"], state["width"], state["height"], state["escale"], state["scale"]),
                         (106, 1280, 720, 4.0, 4.0))
        self.assertTrue(state["first"])
        self.assertTrue(all(state[key] == [] for key in ("previous_xy", "delta_x", "delta_y")))
        points[:] = 999
        self.assertNotEqual(state["current_xy"][0], 999)

    def test_reinitialization_does_not_clear_previous_delta_or_alpha(self):
        old = state_fixture()
        old["previous_xy"] = point_fixture().reshape(-1).tolist()
        original = copy.deepcopy(old)
        state = self.init(state=old, escale=0)
        for key in ("previous_xy", "delta_x", "delta_y", "alpha"):
            self.assertEqual(state[key], original[key])
        self.assertEqual(state["scale"], 0)
        self.assertTrue(state["first"])
        state["previous_xy"][0] = 999
        self.assertEqual(old, original)

    def test_scale_is_double_divide_multiply_then_float32(self):
        for width, height, escale in ((721, 1279, 7), (1279, 721, 7), (1, 4096, 32768), (4096, 4096, 32768)):
            expected = rounded(value=(escale / 720.0) * min(width, height))
            state = self.init(width=width, height=height, escale=escale)
            self.assert_bits(actual=[state["scale"]], expected=[expected])
            self.assertEqual((state["width"], state["height"]), (width, height))

    def test_initializer_rejects_fractional_escale_instead_of_guessing_caller_conversion(self):
        for escale in (4.5, 4.0, True, -1, 32769, float("inf")):
            with self.subTest(escale=escale), self.assertRaises(ValueError):
                self.init(escale=escale)

    def test_initializer_rejects_invalid_range_count_dimensions(self):
        for changes in (dict(begin=-1), dict(end=281), dict(end=105), dict(begin=200, end=306),
                        dict(count=280), dict(count=True), dict(width=0), dict(height=4097), dict(width=True)):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.init(**changes)

    def test_init_then_normal_and_zero_scale_branches_have_distinct_outputs(self):
        points = point_fixture() + np.float32(0.5)
        for escale, expected_count, first in ((0, 280, True), (4, 106, False)):
            output, state = replay_inner_filter(state=self.init(escale=escale), points=points)
            self.assertEqual(len(output), expected_count)
            self.assertEqual(state["first"], first)
            self.assertEqual(state["count"], 106)


if __name__ == "__main__":
    unittest.main()
