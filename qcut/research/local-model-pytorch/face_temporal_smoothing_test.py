"""Synthetic point-filter controls, not a vendor or dynamic parity oracle."""
import ctypes
from dataclasses import FrozenInstanceError, replace
import math
import unittest
from unittest.mock import patch

import numpy as np

from face_temporal_smoothing import (
    BaseState, FilterState, STATE_ABI, initialize, initialize_base, update, update_base,
)


def xy(*, values=((0, 0),)):
    return np.array(values, dtype=np.float32)


def initial(*, points=None, escale=4, alpha=0.5):
    return initialize(points=xy() if points is None else points,
                      width=720, height=720, escale=escale, alpha=alpha)


def expected_weight(*, delta, scale, optimized):
    ratio = np.float32(abs(float(delta))) / np.float32(scale)
    if not optimized:
        return np.float32(math.exp(-math.pow(float(ratio), 0.5)))
    function = ctypes.CDLL(None).expf
    function.argtypes, function.restype = [ctypes.c_float], ctypes.c_float
    return np.float32(function(float(-np.float32(math.sqrt(float(ratio))))))


def scalar_output(*, old, new, delta, scale, optimized):
    weight = expected_weight(delta=delta, scale=scale, optimized=optimized)
    if optimized:
        return np.float32(new - np.float32(np.float32(new - old) * weight))
    return np.float32(np.float32(old * weight) +
                      np.float32(new * np.float32(np.float32(1) - weight)))


class TemporalSmoothingTests(unittest.TestCase):
    def assert_bits(self, actual, expected):
        self.assertEqual(actual.dtype, np.float32)
        self.assertEqual(actual.shape, expected.shape)
        np.testing.assert_array_equal(actual.view(np.uint32), expected.view(np.uint32))

    def test_abi_offsets_are_explicit_without_constructor_defaults(self):
        self.assertEqual(STATE_ABI, {"current": 0, "previous": 0x18, "delta_x": 0x30,
                                   "delta_y": 0x48, "alpha": 0x60, "count": 0x70,
                                   "first": 0x74, "scale": 0x78, "escale": 0x7C,
                                   "width": 0x98, "height": 0x9C})
        with self.assertRaises(TypeError):
            initialize(points=xy(), width=720, height=720, escale=4)

    def test_initialization_truncates_float32_before_double_scale_arithmetic(self):
        state = initialize(points=xy(), width=640, height=480, escale=3.999, alpha=0.3)
        self.assertEqual(state.scale, np.float32(2))
        self.assertTrue(state.first)
        self.assertEqual(state.alpha, np.float32(0.3))
        self.assertEqual(state.previous.shape, (0, 2))
        self.assertEqual(state.delta.shape, (0, 2))
        # This value rounds up before FCVTZS, unlike truncating the Python double.
        state = initial(escale=3.99999999)
        self.assertEqual(state.scale, np.float32(4))

    def test_init_scale_uses_minimum_dimension_and_720(self):
        for width, height in ((640, 480), (480, 640), (4096, 1)):
            with self.subTest(width=width, height=height):
                state = initialize(points=xy(), width=width, height=height, escale=7, alpha=1)
                self.assertEqual(state.scale, np.float32((7.0 / 720.0) * min(width, height)))

    def test_unchanged_points_are_exact_in_both_branches(self):
        points = xy(values=((10, 20), (-2, 17)))
        for optimized in (False, True):
            output, state = update(state=initial(points=points), points=points, optimized=optimized)
            self.assert_bits(output, points)
            self.assert_bits(state.current, points)
            self.assert_bits(state.previous, points)
            self.assert_bits(state.delta, np.zeros_like(points))
            self.assertFalse(state.first)

    def test_first_update_seeds_raw_delta_without_reading_old_history(self):
        points = xy(values=((4, 9),))
        state = replace(initial(alpha=1), delta=xy(values=((100, -100),)))
        for optimized in (False, True):
            output, next_state = update(state=state, points=points, optimized=optimized)
            expected = xy(values=((scalar_output(old=np.float32(0), new=np.float32(4),
                                                 delta=4, scale=4, optimized=optimized),
                                   scalar_output(old=np.float32(0), new=np.float32(9),
                                                 delta=9, scale=4, optimized=optimized)),))
            self.assert_bits(output, expected)
            self.assert_bits(next_state.delta, points)
            self.assertFalse(next_state.first)

    def test_x_and_y_weights_are_separate_not_euclidean_norm(self):
        output, state = update(state=initial(), points=xy(values=((4, 0),)), optimized=True)
        self.assertEqual(output[0, 1], 0)
        self.assertEqual(state.delta[0, 1], 0)
        weight = np.float32(0.36787944117144233)
        self.assertEqual(output[0, 0], np.float32(4 - np.float32(4 * weight)))

    def test_ordinary_sum_cannot_be_rewritten_as_optimized_subtraction(self):
        old = xy(values=((-69.44245147705078, 0),))
        points = xy(values=((154.46192932128906, 0),))
        with patch('face_temporal_smoothing._weights', return_value=xy(values=((0.3, 0.3),))):
            ordinary, _ = update(state=initial(points=old), points=points, optimized=False)
            optimized, _ = update(state=initial(points=old), points=points, optimized=True)
        self.assertEqual(int(ordinary[0, 0].view(np.uint32)), 0x42AE94CC)
        self.assertEqual(int(optimized[0, 0].view(np.uint32)), 0x42AE94CB)

    def test_temporal_delta_uses_previous_published_output_not_previous_input(self):
        state = initial(alpha=0.75)
        first_input = xy(values=((4, 9),))
        first, state = update(state=state, points=first_input, optimized=True)
        second_input = xy(values=((5, 8),))
        expected_delta = first_input * np.float32(0.75) + (
            second_input - first) * np.float32(0.25)
        _, next_state = update(state=state, points=second_input, optimized=True)
        self.assert_bits(next_state.delta, expected_delta)
        self.assert_bits(next_state.previous, first)
        self.assertFalse(np.array_equal(next_state.delta,
                                       first_input * np.float32(0.75) +
                                       (second_input - first_input) * np.float32(0.25)))

    def test_alpha_endpoints_have_distinct_history_behavior(self):
        points = xy(values=((4, -9),))
        for alpha in (0, 1):
            state = replace(initial(alpha=alpha), first=False, delta=xy(values=((2, 3),)))
            _, after = update(state=state, points=points, optimized=True)
            self.assert_bits(after.delta, points if alpha == 0 else state.delta)

    def test_multiple_updates_match_scalar_instruction_order(self):
        random = np.random.default_rng(483)
        seed = random.uniform(-20, 20, (5, 2)).astype(np.float32)
        inputs = random.uniform(-20, 20, (8, 5, 2)).astype(np.float32)
        for optimized in (False, True):
            state = initial(points=seed, alpha=0.625)
            current, delta = seed.copy(), None
            for points in inputs:
                displacement = points - current
                expected_delta = displacement if delta is None else (
                    delta * np.float32(0.625) + displacement * np.float32(0.375))
                expected = np.empty_like(points)
                for index in np.ndindex(points.shape):
                    expected[index] = scalar_output(old=current[index], new=points[index],
                                                     delta=expected_delta[index], scale=4,
                                                     optimized=optimized)
                output, state = update(state=state, points=points, optimized=optimized)
                self.assert_bits(output, expected)
                self.assert_bits(state.previous, current)
                self.assert_bits(state.delta, expected_delta)
                current, delta = expected, expected_delta

    def test_small_scale_bypasses_math_but_updates_current_and_previous(self):
        state = initial(escale=0.99)
        points = xy(values=((30, 17),))
        for optimized in (False, True):
            with patch('face_temporal_smoothing._weights', side_effect=AssertionError):
                output, next_state = update(state=state, points=points, optimized=optimized)
            self.assert_bits(output, points)
            self.assert_bits(next_state.previous, state.current)
            self.assertTrue(next_state.first)
            self.assertEqual(next_state.delta.shape, (0, 2))

    def test_small_scale_preserves_existing_delta_and_first_flag(self):
        state = replace(initial(escale=0), first=False, delta=xy(values=((2, 3),)))
        _, after = update(state=state, points=xy(values=((30, 17),)), optimized=True)
        self.assert_bits(after.delta, state.delta)
        self.assertFalse(after.first)

    def test_epsilon_comparison_promotes_scale_to_double(self):
        below = np.float32(1e-5)
        above = np.nextafter(below, np.float32(np.inf))
        self.assertLess(float(below), 1e-5)
        for scale, called in ((below, False), (above, True)):
            state = replace(initial(), scale=scale)
            with patch('face_temporal_smoothing._weights', return_value=xy(values=((0.5, 0.5),))) as weights:
                update(state=state, points=xy(values=((1, 1),)), optimized=True)
            self.assertEqual(weights.called, called)

    def test_empty_input_leaves_all_history_unchanged(self):
        state = initial()
        output, after = update(state=state, points=np.empty((0, 2), np.float32), optimized=True)
        self.assertEqual(output.shape, (0, 2))
        self.assertIs(after, state)

    def test_empty_initial_state_passes_input_without_initializing_history(self):
        state = initial(points=np.empty((0, 2), np.float32))
        points = xy(values=((10, 20),))
        output, after = update(state=state, points=points, optimized=False)
        self.assert_bits(output, points)
        self.assertIs(after, state)

    def test_outputs_and_state_do_not_alias_input_or_each_other(self):
        seed = xy(values=((10, 20),))
        state = initial(points=seed)
        seed[:] = 100
        self.assert_bits(state.current, xy(values=((10, 20),)))
        points = xy(values=((15, 25),))
        output, after = update(state=state, points=points, optimized=True)
        snapshot = after.current.copy()
        output[:] = 200
        points[:] = 300
        self.assert_bits(after.current, snapshot)
        with self.assertRaises(ValueError):
            after.current[0, 0] = 1
        with self.assertRaises(FrozenInstanceError):
            after.first = True

    def test_invalid_points_and_size_changes_fail_closed(self):
        for points in (xy().astype(np.float64), np.ones((1, 3), np.float32),
                       np.ones((107, 2), np.float32), np.full((1, 2), np.nan, np.float32),
                       np.full((1, 2), np.inf, np.float32), xy(values=((32769, 0),)),
                       np.zeros((2, 2), np.float32)):
            with self.subTest(shape=points.shape), self.assertRaises(ValueError):
                update(state=initial(), points=points, optimized=True)

    def test_invalid_parameters_and_unproven_profiles_are_rejected(self):
        for parameter, values in (("alpha", (-1, 1.01, True, np.nan, "0.5")),
                                  ("escale", (-1, 32769, True, np.inf, "4"))):
            for value in values:
                arguments = dict(points=xy(), width=720, height=720, escale=4, alpha=0.5)
                arguments[parameter] = value
                with self.subTest(parameter=parameter, value=value), self.assertRaises(ValueError):
                    initialize(**arguments)
        for side in (0, 4097, True, 720.0):
            with self.subTest(side=side), self.assertRaises(ValueError):
                initialize(points=xy(), width=side, height=720, escale=4, alpha=0.5)
        for mode in (0, 1, None, np.bool_(True)):
            with self.subTest(mode=mode), self.assertRaises(ValueError):
                update(state=initial(), points=xy(), optimized=mode)

    def test_malformed_history_is_rejected_before_math(self):
        for fields in (dict(first=1), dict(first=False),
                       dict(previous=np.zeros((2, 2), np.float32)),
                       dict(delta=np.zeros((2, 2), np.float32)), dict(scale=-1)):
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                replace(initial(), **fields)

    def test_base_partitions_have_independent_scale_and_coefficient(self):
        points = np.zeros((106, 2), np.float32)
        state = initialize_base(points=points, width=720, height=720,
                                escales=(4, 16), alphas=(0.25, 0.75))
        points[:] = (4, 9)
        output, after = update_base(state=state, points=points, optimized=True)
        first, first_state = update(state=state.first33, points=points[:33], optimized=True)
        last, last_state = update(state=state.last73, points=points[33:], optimized=True)
        self.assert_bits(output, np.concatenate((first, last)))
        self.assert_bits(after.first33.current, first_state.current)
        self.assert_bits(after.last73.current, last_state.current)
        self.assertNotEqual(output[32, 0], output[33, 0])
        self.assertEqual(after.first33.alpha, 0.25)
        self.assertEqual(after.last73.alpha, 0.75)

    def test_base_validation_does_not_guess_partitions_or_missing_parameters(self):
        points = np.zeros((106, 2), np.float32)
        for pair in ((4,), (4, 4, 4), [4, 4], None):
            with self.subTest(pair=pair), self.assertRaises(ValueError):
                initialize_base(points=points, width=720, height=720, escales=pair, alphas=(0.5, 0.5))
        with self.assertRaises(ValueError):
            BaseState(first33=initial(), last73=initial())
        state = initialize_base(points=points, width=720, height=720,
                                escales=(4, 4), alphas=(0.5, 0.5))
        with self.assertRaises(ValueError):
            update_base(state=state, points=points[:105], optimized=True)


if __name__ == '__main__':
    unittest.main()
