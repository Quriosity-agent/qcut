"""CPU-only optional stage-observer tests with synthetic heads, never native/GPU."""
from __future__ import annotations

import copy
import json
import unittest
from unittest import mock

import numpy as np

import face_live_candidate as candidate
from face_live_candidate import CandidateCore
from face_live_candidate_extra_test import StateAssertions, routed_fixture
from face_live_candidate_test import FakeHeads
from face_live_candidate_trace import SCHEMA


class DistinctHeads(FakeHeads):
    def infer(self, *, size, values):
        heads = super().infer(size=size, values=values)
        offsets = np.arange(212, dtype=np.float32).reshape(1, 1, 1, 212) / np.float32(64)
        heads["fc_landmark_s1"] += offsets
        return heads


def trace_fixture(*, extra=False, **kwargs):
    packet, rgba = routed_fixture(extra=extra, **kwargs)
    face = packet["face"]
    if face is not None:
        face["tables"]["order"] = list(reversed(range(106)))
        face["tables"]["base"] = (np.arange(212, dtype=np.float32) / np.float32(64)).tolist()
        face["inverse"] = [[0.75, 0.125, 5], [-0.125, 0.875, 8]]
        if face["initialization"] is not None:
            face["initialization"]["detection_inverse"] = [[1, 0, 3], [0, 1, 6]]
    return packet, rgba


def stable_result(*, result):
    return {key: value for key, value in result.items() if key not in ("stage_timings_ms", "total_ms")}


class TraceTests(StateAssertions):
    def assert_core_equal(self, *, actual, expected):
        for field in ("identity", "profile", "sequence", "seen_ids"):
            self.assertEqual(getattr(actual, field), getattr(expected, field))
        if expected.state is None:
            self.assertIsNone(actual.state)
            return
        self.assert_state_equal(actual.state, expected.state)

    def assert_json_safe(self, *, value):
        if type(value) is dict:
            for key, child in value.items():
                self.assertIs(type(key), str)
                self.assert_json_safe(value=child)
            return
        if type(value) is list:
            for child in value:
                self.assert_json_safe(value=child)
            return
        self.assertIn(type(value), (str, int, float, bool, type(None)))

    def assert_filter_values(self, *, actual, state):
        self.assertEqual(set(actual), {"current_xy", "previous_xy", "delta_x", "delta_y",
                                       "first", "alpha", "scale"})
        self.assertEqual(actual["current_xy"], state.current.reshape(-1).tolist())
        self.assertEqual(actual["previous_xy"], state.previous.reshape(-1).tolist())
        self.assertEqual(actual["delta_x"], state.delta[:, 0].tolist())
        self.assertEqual(actual["delta_y"], state.delta[:, 1].tolist())
        self.assertIs(actual["first"], state.first)
        for field in ("alpha", "scale"):
            self.assertIs(type(actual[field]), float)
            self.assertEqual(actual[field], float(getattr(state, field)))

    def test_opt_in_preserves_results_state_and_model_provenance(self):
        for extra in (False, True):
            with self.subTest(extra=extra):
                snapshots = []

                def observe(*, snapshot):
                    snapshots.append(snapshot)

                traced = CandidateCore(models=DistinctHeads(), stage_observer=observe)
                plain = CandidateCore(models=DistinctHeads())
                for prediction, mode in enumerate(("seed-160", "update", "reset-120", "update")):
                    packet, rgba = trace_fixture(extra=extra, prediction=prediction, mode=mode,
                                                 value=150 + prediction * 20)
                    actual = traced.process(packet=packet, rgba=rgba)
                    expected = plain.process(packet=packet, rgba=rgba)
                    self.assertEqual(stable_result(result=actual), stable_result(result=expected))
                    self.assert_core_equal(actual=traced, expected=plain)
                    self.assertEqual(traced.models.verify_calls, plain.models.verify_calls)
                    self.assertEqual(traced.models.verify_calls, 2 * (prediction + 1))
                    for left, right in zip(traced.models.calls, plain.models.calls, strict=True):
                        self.assertEqual(left[0], right[0])
                        np.testing.assert_array_equal(left[1], right[1])
                self.assertEqual([item["prediction"] for item in snapshots], [0, 1, 2, 3])
                reset = snapshots[2]["stages"]
                self.assertIsNone(reset["seed_160"])
                self.assertEqual(reset["smoothed"], reset["mapped_120"])
                for part in reset["filters"]:
                    self.assertIs(part["first"], True)
                    for field in ("previous_xy", "delta_x", "delta_y"):
                        self.assertEqual(part[field], [])

    def test_two_predictions_capture_actual_stages_in_order_before_commit(self):
        for extra in (False, True):
            with self.subTest(extra=extra):
                snapshots, seed_values, decoded_values, smoothed_values, normalized_values = [], [], [], [], []
                map_double, decode_actual = candidate.map_double, candidate.decode_actual
                update_primary, normalized = candidate.update_primary, candidate.normalized

                def record_seed(**kwargs):
                    value = map_double(**kwargs)
                    seed_values.append(value.copy())
                    return value

                def record_decode(**kwargs):
                    value = decode_actual(**kwargs)
                    decoded_values.append(tuple(part.copy() for part in value))
                    return value

                def record_smoothing(**kwargs):
                    value = update_primary(**kwargs)
                    smoothed_values.append((value[0].copy(), copy.deepcopy(value[1])))
                    return value

                def record_normalized(**kwargs):
                    value = normalized(**kwargs)
                    normalized_values.append(value.copy())
                    return value

                def observe(*, snapshot):
                    prediction = snapshot["prediction"]
                    self.assertEqual(core.sequence[3] if core.sequence else None,
                                     prediction - 1 if prediction else None)
                    self.assertEqual(core.models.verify_calls, (prediction + 1) * 2)
                    self.assertEqual(core.seen_ids, {0} if prediction else set())
                    snapshots.append(snapshot)

                core = CandidateCore(models=DistinctHeads(), stage_observer=observe)
                with mock.patch.object(candidate, "map_double", side_effect=record_seed) as seed_call, \
                        mock.patch.object(candidate, "decode_actual", side_effect=record_decode) as decode_call, \
                        mock.patch.object(candidate, "update_primary", side_effect=record_smoothing) as smooth_call, \
                        mock.patch.object(candidate, "normalized", side_effect=record_normalized) as norm_call:
                    for prediction, mode in enumerate(("seed-160", "update")):
                        packet, rgba = trace_fixture(extra=extra, prediction=prediction, mode=mode,
                                                     value=150 + prediction * 50)
                        packet["timestamp_us"] = 100 + prediction
                        result = core.process(packet=packet, rgba=rgba)
                        snapshot = snapshots[prediction]
                        self.assertEqual(set(snapshot), {"schema", "prediction", "timestamp_us", "source_key",
                            "algorithm_rgba_sha256", "backend_version", "width", "height", "face_id",
                            "alignment", "route", "source", "native_final_point_input_used",
                            "product_parity_verified", "stages"})
                        self.assertEqual(snapshot["schema"], SCHEMA)
                        for field in ("prediction", "timestamp_us", "source_key", "width", "height"):
                            self.assertEqual(snapshot[field], packet[field])
                        self.assertEqual(snapshot["face_id"], packet["face"]["id"])
                        self.assertEqual(snapshot["alignment"], packet["face"]["alignment"])
                        self.assertEqual(snapshot["route"], result["primary_smoothing"]["route"])
                        for field in ("algorithm_rgba_sha256", "backend_version", "source"):
                            self.assertEqual(snapshot[field], result[field])
                        self.assertIs(snapshot["native_final_point_input_used"], False)
                        self.assertIs(snapshot["product_parity_verified"], False)
                        stages = snapshot["stages"]
                        self.assertEqual(set(stages), {"seed_160", "decoded_120", "mapped_120",
                                                       "smoothed", "normalized", "filters"})
                        if prediction == 0:
                            np.testing.assert_array_equal(stages["seed_160"], seed_values[0])
                            self.assertEqual(np.asarray(stages["seed_160"]).shape, (106, 2))
                        else:
                            self.assertIsNone(stages["seed_160"])
                        values = dict(decoded_120=decoded_values[prediction][0],
                                      mapped_120=decoded_values[prediction][1],
                                      smoothed=smoothed_values[prediction][0],
                                      normalized=normalized_values[prediction])
                        for name, value in values.items():
                            self.assertEqual(np.asarray(stages[name]).shape, (106, 2))
                            np.testing.assert_array_equal(stages[name], value)
                        self.assertNotEqual(stages["decoded_120"], stages["mapped_120"])
                        self.assertNotEqual(stages["mapped_120"], stages["smoothed"])
                        self.assertEqual(stages["normalized"], result["faces"][0]["points"])
                        state = smoothed_values[prediction][1]
                        self.assertEqual(len(stages["filters"]), 2)
                        for part, expected, count in zip(stages["filters"], (state.first33, state.last73),
                                                         (33, 73), strict=True):
                            self.assert_filter_values(actual=part, state=expected)
                            for field in ("current_xy", "previous_xy"):
                                self.assertEqual(len(part[field]), 2 * count)
                            for field in ("delta_x", "delta_y"):
                                self.assertEqual(len(part[field]), count)
                        self.assert_json_safe(value=snapshot)
                        self.assertEqual(json.loads(json.dumps(snapshot, allow_nan=False)), snapshot)
                self.assertEqual([item["prediction"] for item in snapshots], [0, 1])
                self.assertNotEqual(snapshots[0]["stages"]["mapped_120"], snapshots[1]["stages"]["mapped_120"])
                self.assertEqual([seed_call.call_count, decode_call.call_count,
                                  smooth_call.call_count, norm_call.call_count], [1, 2, 2, 2])

    def test_callback_and_retained_snapshot_mutations_cannot_change_results_or_history(self):
        for extra in (False, True):
            with self.subTest(extra=extra):
                retained = []

                def mutate(*, snapshot):
                    retained.append(snapshot)
                    for name, values in snapshot["stages"].items():
                        if name != "filters" and values is not None:
                            values[0][:] = [999, 999]
                    for part in snapshot["stages"]["filters"]:
                        for field in ("current_xy", "previous_xy", "delta_x", "delta_y"):
                            part[field][:] = [999]
                        part.update(first=True, alpha=999, scale=999)
                    snapshot.update(prediction=999, source="changed", product_parity_verified=True)

                core = CandidateCore(models=DistinctHeads(), stage_observer=mutate)
                plain = CandidateCore(models=DistinctHeads())
                for prediction, mode in enumerate(("seed-160", "update")):
                    packet, rgba = trace_fixture(extra=extra, prediction=prediction, mode=mode,
                                                 value=150 + prediction * 50)
                    actual = core.process(packet=packet, rgba=rgba)
                    expected = plain.process(packet=packet, rgba=rgba)
                    for snapshot in retained:
                        snapshot.clear()
                    self.assertEqual(actual["faces"], expected["faces"])
                    self.assertEqual(stable_result(result=actual), stable_result(result=expected))
                    self.assert_core_equal(actual=core, expected=plain)

    def test_callback_rejection_or_error_never_advances_and_allows_same_prediction_retry(self):
        for extra in (False, True):
            for existing in (False, True):
                for failure in (False, True, 0, [], {}, RuntimeError("observer failed")):
                    with self.subTest(extra=extra, existing=existing, failure=failure):
                        reject = False

                        def observe(*, snapshot):
                            snapshot.clear()
                            if reject:
                                if isinstance(failure, Exception):
                                    raise failure
                                return failure

                        core = CandidateCore(models=DistinctHeads(), stage_observer=observe)
                        plain = CandidateCore(models=DistinctHeads())
                        if existing:
                            packet, rgba = trace_fixture(extra=extra)
                            core.process(packet=packet, rgba=rgba)
                            plain.process(packet=packet, rgba=rgba)
                        before = core.state
                        packet, rgba = trace_fixture(extra=extra, prediction=int(existing),
                            mode="update" if existing else "seed-160", value=200)
                        reject = True
                        error = RuntimeError if isinstance(failure, Exception) else ValueError
                        message = "observer failed" if isinstance(failure, Exception) else "stage observer must return None"
                        with self.assertRaisesRegex(error, message):
                            core.process(packet=packet, rgba=rgba)
                        self.assertIs(core.state, before)
                        self.assert_core_equal(actual=core, expected=plain)
                        self.assertFalse(core.busy.locked())
                        reject = False
                        actual = core.process(packet=packet, rgba=rgba)
                        expected = plain.process(packet=packet, rgba=rgba)
                        self.assertEqual(stable_result(result=actual), stable_result(result=expected))
                        self.assert_core_equal(actual=core, expected=plain)

    def test_no_face_is_explicitly_rejected_only_when_observing(self):
        for existing in (False, True):
            with self.subTest(existing=existing):
                observer = mock.Mock(return_value=None)
                core = CandidateCore(models=FakeHeads(), stage_observer=observer)
                plain = CandidateCore(models=FakeHeads())
                if existing:
                    packet, rgba = trace_fixture()
                    core.process(packet=packet, rgba=rgba)
                    plain.process(packet=packet, rgba=rgba)
                observer.reset_mock()
                before, verifications = core.state, core.models.verify_calls
                packet, rgba = trace_fixture(prediction=int(existing), mode=None)
                with self.assertRaisesRegex(ValueError, "stage diagnostics require exactly one face"):
                    core.process(packet=packet, rgba=rgba)
                observer.assert_not_called()
                self.assertIs(core.state, before)
                self.assert_core_equal(actual=core, expected=plain)
                self.assertEqual(core.models.verify_calls, verifications)
                self.assertEqual(plain.process(packet=packet, rgba=rgba)["faces"], [])
                self.assertIsNone(plain.state)

    def test_prior_guards_reject_without_observing_or_committing(self):
        for guard in ("head", "normalization", "checker", "provenance"):
            with self.subTest(guard=guard):
                observer = mock.Mock(return_value=None)
                core = CandidateCore(models=FakeHeads(), stage_observer=observer)
                plain = CandidateCore(models=FakeHeads())
                packet, rgba = trace_fixture()
                core.process(packet=packet, rgba=rgba)
                plain.process(packet=packet, rgba=rgba)
                observer.reset_mock()
                packet, rgba = trace_fixture(prediction=1, mode="reset-120")
                checker = None
                if guard == "head":
                    core.models.bad_head = True
                if guard == "normalization":
                    packet["face"]["inverse"][0][2] = 500
                if guard == "checker":
                    checker = mock.Mock(return_value=False)
                if guard == "provenance":
                    core.models.fail_verify_at = core.models.verify_calls + 2
                before = core.state
                with self.assertRaises(ValueError):
                    core.process(packet=packet, rgba=rgba, check_output=checker)
                observer.assert_not_called()
                self.assertIs(core.state, before)
                self.assert_core_equal(actual=core, expected=plain)

    def test_default_never_builds_diagnostics(self):
        with mock.patch.object(candidate, "stage_snapshot", side_effect=AssertionError("opt-in only")):
            core = CandidateCore(models=FakeHeads())
            for prediction, mode in enumerate(("seed-160", "update", None)):
                packet, rgba = trace_fixture(prediction=prediction, mode=mode)
                core.process(packet=packet, rgba=rgba)

    def test_zero_scale_records_actual_empty_delta(self):
        snapshots = []

        def observe(*, snapshot):
            snapshots.append(snapshot)

        core = CandidateCore(models=FakeHeads(), stage_observer=observe)
        packet, rgba = trace_fixture()
        for row in packet["face"]["smoothing"]:
            row.update(escale=0, scale=0)
        core.process(packet=packet, rgba=rgba)
        for part, expected in zip(snapshots[0]["stages"]["filters"],
                                  (core.state.first33, core.state.last73), strict=True):
            self.assert_filter_values(actual=part, state=expected)
            self.assertIs(part["first"], True)
            self.assertEqual(part["delta_x"], [])
            self.assertEqual(part["delta_y"], [])

    def test_noncallable_observer_rejected(self):
        for observer in (False, 0, {}, []):
            with self.subTest(observer=observer), self.assertRaisesRegex(TypeError, "stage observer must be callable"):
                CandidateCore(models=FakeHeads(), stage_observer=observer)


if __name__ == "__main__":
    unittest.main()
