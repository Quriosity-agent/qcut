"""CPU-only tests of pinned Extra primary106 scheduling, not native parity."""
from __future__ import annotations

import copy
import unittest
from unittest import mock

import numpy as np

from face_live_candidate import CandidateCore, update_primary
from face_live_candidate_contract import ROUTE, validate
from face_live_candidate_test import FakeHeads, fixture
from face_temporal_smoothing import BaseState, LENS_SHA256, initialize_base, update


def routed_fixture(*, extra, **kwargs):
    packet, rgba = fixture(**kwargs)
    packet["runtime_state"]["base_output_mode_bit"] = extra
    return packet, rgba


def reference_primary(*, state, points, extra):
    first, last = state.first33, state.last73
    if extra:
        _, last = update(state=last, points=points[33:], optimized=False)
    first_points, first = update(state=first, points=points[:33], optimized=False)
    last_points, last = update(state=last, points=points[33:], optimized=False)
    return np.concatenate((first_points, last_points)), BaseState(first33=first, last73=last)


class StateAssertions(unittest.TestCase):
    def assert_state_equal(self, actual, expected):
        for name in ("first33", "last73"):
            left, right = getattr(actual, name), getattr(expected, name)
            for field in ("current", "previous", "delta"):
                np.testing.assert_array_equal(getattr(left, field), getattr(right, field))
            for field in ("first", "alpha", "scale"):
                self.assertEqual(getattr(left, field), getattr(right, field))


class ExtraRouteContractTests(unittest.TestCase):
    def test_both_exact_boolean_profiles_accepted_and_copied(self):
        for extra in (False, True):
            with self.subTest(extra=extra):
                packet, rgba = routed_fixture(extra=extra)
                checked, _ = validate(packet=packet, rgba=rgba)
                packet["runtime_state"]["base_output_mode_bit"] = not extra
                self.assertIs(checked["runtime_state"]["base_output_mode_bit"], extra)
                self.assertEqual({key: value for key, value in checked["runtime_state"].items()
                                  if key != "base_output_mode_bit"},
                                 {key: value for key, value in ROUTE.items() if key != "base_output_mode_bit"})

    def test_other_route_guards_remain_exact_on_both_profiles(self):
        cases = dict(config_cache_mode=(1, -1, False, 0.0),
                     optimized_output_bit=(True, 0, None),
                     cache_counter=(1, -1, False, 0.0), cache_skip_bit=(False, 1, None))
        for extra in (False, True):
            for key, values in cases.items():
                for value in values:
                    with self.subTest(extra=extra, key=key, value=value):
                        packet, rgba = routed_fixture(extra=extra)
                        packet["runtime_state"][key] = value
                        with self.assertRaisesRegex(ValueError, f"{key}: expected"):
                            validate(packet=packet, rgba=rgba)

    def test_output_bit_must_be_actual_boolean(self):
        for invalid in (0, 1, None, "true", [], {}, np.bool_(True)):
            with self.subTest(invalid=invalid):
                packet, rgba = routed_fixture(extra=invalid)
                with self.assertRaisesRegex(ValueError, "base_output_mode_bit: expected"):
                    validate(packet=packet, rgba=rgba)

    def test_no_added_route_or_native_point_channels(self):
        for extra in (False, True):
            for location, field in (("runtime_state", "extra_skip"), ("face", "native_points")):
                with self.subTest(extra=extra, location=location):
                    packet, rgba = routed_fixture(extra=extra)
                    packet[location][field] = []
                    with self.assertRaisesRegex(ValueError, "exact dependency fields"):
                        validate(packet=packet, rgba=rgba)

    def test_mismatch_diagnostics_remain_bounded_and_complete(self):
        packet, rgba = routed_fixture(extra=True)
        packet["runtime_state"].update(optimized_output_bit=True, cache_counter="x" * 1000)
        with self.assertRaises(ValueError) as caught:
            validate(packet=packet, rgba=rgba)
        message = str(caught.exception)
        self.assertIn("optimized_output_bit: expected False, got True", message)
        self.assertIn("cache_counter: expected 0", message)
        self.assertNotIn("base_output_mode_bit:", message)
        self.assertLess(len(message), 400)


class PrimaryScheduleTests(StateAssertions):
    def setUp(self):
        self.seed = np.arange(212, dtype=np.float32).reshape(106, 2) / np.float32(4)

    def state(self, *, alpha=0.2, escale=10):
        return initialize_base(points=self.seed, width=200, height=200,
                               escales=(escale, escale), alphas=(alpha, alpha))

    def test_native_call_order_and_unchanged_raw73_input(self):
        points = self.seed + np.float32(3.25)
        for extra, order in ((False, [33, 73]), (True, [73, 33, 73])):
            calls = []

            def record(**kwargs):
                calls.append((kwargs["points"].copy(), kwargs["optimized"]))
                return update(**kwargs)

            with self.subTest(extra=extra), mock.patch("face_live_candidate.update", side_effect=record), \
                    mock.patch("face_temporal_smoothing.update", side_effect=record):
                update_primary(state=self.state(), points=points, extra=extra)
            self.assertEqual([len(values) for values, _ in calls], order)
            self.assertTrue(all(optimized is False for _, optimized in calls))
            if extra:
                np.testing.assert_array_equal(calls[0][0], points[33:])
                np.testing.assert_array_equal(calls[2][0], points[33:])

    def test_double_update_changes_only_last73_and_retains_first_pass_history(self):
        state = self.state()
        points = self.seed + np.float32(3.25)
        base, _ = update_primary(state=state, points=points, extra=False)
        extra, actual = update_primary(state=state, points=points, extra=True)
        once, first_state = update(state=state.last73, points=points[33:], optimized=False)
        twice, second_state = update(state=first_state, points=points[33:], optimized=False)
        np.testing.assert_array_equal(base[:33], extra[:33])
        self.assertFalse(np.array_equal(base[33:], extra[33:]))
        np.testing.assert_array_equal(extra[33:], twice)
        np.testing.assert_array_equal(actual.last73.previous, once)
        np.testing.assert_array_equal(actual.last73.delta, second_state.delta)
        wrong, _ = update(state=first_state, points=once, optimized=False)
        self.assertFalse(np.array_equal(extra[33:], wrong))
        np.testing.assert_array_equal(state.last73.current, self.seed[33:])
        self.assertTrue(state.last73.first)

    def test_multi_prediction_state_and_extreme_coefficients(self):
        for extra in (False, True):
            for alpha in (0, 0.2, 1):
                for escale in (0, 10):
                    with self.subTest(extra=extra, alpha=alpha, escale=escale):
                        actual = expected = self.state(alpha=alpha, escale=escale)
                        for offset in (3.25, -1.75, 2.5, 0):
                            points = self.seed + np.float32(offset)
                            values, actual = update_primary(state=actual, points=points, extra=extra)
                            wanted, expected = reference_primary(state=expected, points=points, extra=extra)
                            np.testing.assert_array_equal(values, wanted)
                            self.assert_state_equal(actual, expected)

    def test_output_and_history_do_not_alias_input(self):
        points = self.seed + np.float32(3.25)
        output, state = update_primary(state=self.state(), points=points, extra=True)
        wanted = state.last73.current.copy()
        points[:] = 999
        output[:] = 888
        np.testing.assert_array_equal(state.last73.current, wanted)
        self.assertFalse(state.last73.current.flags.writeable)


class ExtraCoreTests(StateAssertions):
    def run_packet(self, *, core, extra, **kwargs):
        packet, rgba = routed_fixture(extra=extra, **kwargs)
        return core.process(packet=packet, rgba=rgba)

    def test_seed_update_reset_and_provenance_for_both_routes(self):
        for extra in (False, True):
            with self.subTest(extra=extra):
                models = FakeHeads()
                core = CandidateCore(models=models)
                offset = np.float32(22 / 128)
                seed = np.full((106, 2), np.float32(60) + offset, np.float32)
                expected = initialize_base(points=seed, width=200, height=200,
                                           escales=(10, 10), alphas=(0.2, 0.2))
                for prediction, mode in ((0, "seed-160"), (1, "update"), (2, "reset-120"), (3, "update")):
                    value = 150 + prediction * 20
                    tracked = np.full((106, 2), np.float32(80 + (value - 128) / 128), np.float32)
                    if mode == "reset-120":
                        expected = initialize_base(points=tracked, width=200, height=200,
                                                   escales=(10, 10), alphas=(0.2, 0.2))
                        wanted = tracked
                    else:
                        wanted, expected = reference_primary(state=expected, points=tracked, extra=extra)
                    result = self.run_packet(core=core, extra=extra, prediction=prediction, mode=mode, value=value)
                    self.assert_state_equal(core.state, expected)
                    normalized = wanted.copy()
                    normalized[:, 0] *= np.float32(1) / np.float32(200)
                    normalized[:, 1] = (np.float32(200) - wanted[:, 1]) * (np.float32(1) / np.float32(200))
                    np.testing.assert_array_equal(result["faces"][0]["points"], normalized)
                    provenance = result["primary_smoothing"]
                    self.assertEqual(provenance["update_order"], [73, 33, 73] if extra else [33, 73])
                    self.assertEqual(provenance["native_library_sha256"], LENS_SHA256)
                    self.assertEqual(provenance["native_output_entrypoint"], "0x37b880" if extra else "0x37cc58")
                    self.assertFalse(provenance["extra_stage2_geometry_parity_verified"])
                    self.assertFalse(result["candidate_parity_verified"])
                    self.assertFalse(result["native_final_point_input_used"])
                self.assertEqual([size for size, _ in models.calls], [160, 120, 120, 120, 120])

    def test_route_transition_rejected_even_on_reset_without_advancing(self):
        for extra in (False, True):
            for mode in ("update", "reset-120"):
                with self.subTest(extra=extra, mode=mode):
                    core = CandidateCore(models=FakeHeads())
                    self.run_packet(core=core, extra=extra)
                    before, profile = core.state, core.profile
                    with self.assertRaisesRegex(ValueError, "route transition"):
                        self.run_packet(core=core, extra=not extra, prediction=1, mode=mode)
                    self.assertIs(core.state, before)
                    self.assertEqual(core.profile, profile)
                    self.assertEqual(core.sequence[3], 0)
                    self.assertEqual(len(core.models.calls), 2)
                    self.run_packet(core=core, extra=extra, prediction=1, mode=mode)

    def test_route_change_after_explicit_no_face_accepts_new_identity(self):
        for extra in (False, True):
            core = CandidateCore(models=FakeHeads())
            self.run_packet(core=core, extra=extra)
            result = self.run_packet(core=core, extra=not extra, prediction=1, mode=None)
            self.assertEqual(result["faces"], [])
            self.assertIsNone(core.state)
            self.assertIsNone(core.profile)
            self.run_packet(core=core, extra=not extra, prediction=2, face_id=1)

    def test_failed_second_partition_pass_does_not_commit_intermediate_history(self):
        core = CandidateCore(models=FakeHeads())
        self.run_packet(core=core, extra=True)
        before = core.state
        snapshot = copy.deepcopy(before)
        with mock.patch("face_live_candidate.update_base", side_effect=ValueError("late partition failure")):
            with self.assertRaisesRegex(ValueError, "late partition failure"):
                self.run_packet(core=core, extra=True, prediction=1, mode="update", value=200)
        self.assertIs(core.state, before)
        self.assert_state_equal(core.state, snapshot)
        self.assertEqual(core.sequence[3], 0)
        self.run_packet(core=core, extra=True, prediction=1, mode="update", value=200)

    def test_late_provenance_failure_rolls_back_extra_history(self):
        core = CandidateCore(models=FakeHeads())
        self.run_packet(core=core, extra=True)
        before = core.state
        core.models.fail_verify_at = core.models.verify_calls + 2
        with self.assertRaisesRegex(ValueError, "provenance changed"):
            self.run_packet(core=core, extra=True, prediction=1, mode="update")
        self.assertIs(core.state, before)
        self.assertEqual(core.sequence[3], 0)
        core.models.fail_verify_at = None
        self.run_packet(core=core, extra=True, prediction=1, mode="update")

    def test_optimized_bit_rejected_before_inference_for_both_routes(self):
        for extra in (False, True):
            with self.subTest(extra=extra):
                core = CandidateCore(models=FakeHeads())
                packet, rgba = routed_fixture(extra=extra)
                packet["runtime_state"]["optimized_output_bit"] = True
                with self.assertRaisesRegex(ValueError, "optimized_output_bit: expected False, got True"):
                    core.process(packet=packet, rgba=rgba)
                self.assertEqual(core.models.calls, [])
                self.assertIsNone(core.sequence)
                self.assertIsNone(core.state)


if __name__ == "__main__":
    unittest.main()
