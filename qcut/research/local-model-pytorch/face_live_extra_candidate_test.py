"""Optional Extra-refiner integration tests using synthetic existing fixtures."""
from __future__ import annotations

import copy
import hashlib
import unittest
from unittest import mock

import numpy as np

import face_live_candidate as candidate
from face_host_geometry_replay import normalized
from face_live_candidate_extra_test import routed_fixture
from face_live_candidate_test import FakeHeads
from face_live_candidate_trace_test import stable_result


def refiner_fixture():
    refiner = mock.Mock()
    points = np.tile(np.array([70.25, 91.125], np.float32), (106, 1))
    receipt = dict(backend_version="synthetic-extra-v1", native_final_point_input_used=False)
    refiner.refine.return_value = points, receipt
    return refiner


class ExtraCandidateTests(unittest.TestCase):
    def snapshot(self, *, core):
        return copy.deepcopy(dict(state=core.state, identity=core.identity, profile=core.profile,
                                  sequence=core.sequence, seen_ids=core.seen_ids))

    def assert_unchanged(self, *, core, snapshot):
        for key in ("identity", "profile", "sequence", "seen_ids"):
            self.assertEqual(getattr(core, key), snapshot[key])
        self.assertFalse(core.busy.locked())
        if snapshot["state"] is None:
            self.assertIsNone(core.state)
            return
        for name in ("first33", "last73"):
            actual, expected = getattr(core.state, name), getattr(snapshot["state"], name)
            for key in ("current", "previous", "delta"):
                np.testing.assert_array_equal(getattr(actual, key), getattr(expected, key))
            for key in ("first", "alpha", "scale"):
                self.assertEqual(getattr(actual, key), getattr(expected, key))

    def test_refiner_and_geometry_must_be_paired_before_inference(self):
        for with_refiner in (False, True):
            refiner = refiner_fixture()
            core = candidate.CandidateCore(models=FakeHeads(), extra_refinement=refiner if with_refiner else None)
            packet, rgba = routed_fixture(extra=True, mode="reset-120")
            before = self.snapshot(core=core)
            with self.subTest(with_refiner=with_refiner), self.assertRaisesRegex(ValueError, "must be paired"):
                core.process(packet=packet, rgba=rgba, extra_geometry=None if with_refiner else {})
            self.assertEqual(core.models.calls, [])
            refiner.refine.assert_not_called()
            self.assert_unchanged(core=core, snapshot=before)

    def test_refinement_rejects_base_route_and_no_face(self):
        for extra, mode in ((False, "reset-120"), (True, None)):
            refiner = refiner_fixture()
            core = candidate.CandidateCore(models=FakeHeads(), extra_refinement=refiner)
            packet, rgba = routed_fixture(extra=extra, mode=mode)
            before = self.snapshot(core=core)
            with self.subTest(extra=extra, mode=mode), self.assertRaisesRegex(ValueError, "one face on the Extra route"):
                core.process(packet=packet, rgba=rgba, extra_geometry={})
            refiner.refine.assert_not_called()
            self.assertEqual(core.models.calls, [])
            self.assert_unchanged(core=core, snapshot=before)

    def test_reset120_initializes_from_refined_not_tracking_points(self):
        refiner = refiner_fixture()
        core = candidate.CandidateCore(models=FakeHeads(), extra_refinement=refiner)
        packet, rgba = routed_fixture(extra=True, mode="reset-120")
        with mock.patch.object(candidate, "update_primary", side_effect=AssertionError("reset must not update")):
            result = core.process(packet=packet, rgba=rgba, extra_geometry={"test_geometry": 1})
        refined, receipt = refiner.refine.return_value
        wanted = normalized(points=refined, request=[0, 200, 200, 800, 0])
        np.testing.assert_array_equal(result["faces"][0]["points"], wanted)
        np.testing.assert_array_equal(core.state.first33.current, refined[:33])
        np.testing.assert_array_equal(core.state.last73.current, refined[33:])
        self.assertTrue(core.state.first33.first)
        self.assertTrue(core.state.last73.first)
        self.assertEqual([size for size, _ in core.models.calls], [120])
        self.assertEqual(result["extra_refinement"], receipt)

    def test_contiguous_seed_reset_and_update_preserve_face_and_backend_identity(self):
        sequences = (("seed-160", "reset-120", "update"), ("seed-160", "update", "reset-120"),
                     ("reset-120", "update", "reset-120", "update"))
        for modes in sequences:
            with self.subTest(modes=modes):
                refiner = refiner_fixture()
                core = candidate.CandidateCore(models=FakeHeads(), extra_refinement=refiner)
                versions = []
                for prediction, mode in enumerate(modes):
                    packet, rgba = routed_fixture(extra=True, prediction=prediction, mode=mode)
                    result = core.process(packet=packet, rgba=rgba, extra_geometry={})
                    self.assertIs(type(core.identity), tuple)
                    self.assertEqual(core.identity, tuple(packet["face"][key] for key in ("slot", "alignment", "id")))
                    self.assertEqual(core.sequence[3], prediction)
                    self.assertEqual(result["prediction"], prediction)
                    versions.append(result["backend_version"])
                self.assertEqual(len(set(versions)), 1)
                self.assertNotEqual(versions[0], core.models.version)
                self.assertEqual(refiner.refine.call_count, len(modes))

    def test_extra_backend_identity_and_native_dependency_are_declared(self):
        refiner = refiner_fixture()
        core = candidate.CandidateCore(models=FakeHeads(), extra_refinement=refiner)
        packet, rgba = routed_fixture(extra=True, mode="reset-120")
        result = core.process(packet=packet, rgba=rgba, extra_geometry={})
        identity = core.models.version + ":" + refiner.refine.return_value[1]["backend_version"]
        self.assertEqual(result["backend_version"], "dependency-core-v1:" + hashlib.sha256(identity.encode()).hexdigest())
        elapsed = result["extra_refinement"]["elapsed_ms"]
        self.assertIs(type(elapsed), float)
        self.assertTrue(np.isfinite(elapsed))
        self.assertGreaterEqual(elapsed, 0)
        self.assertIn("extra-inner-filter-crop-transforms-and-mean", result["native_dependencies"])
        for key in ("native_final_point_input_used", "captured_tensor_input_used", "product_parity_verified",
                    "candidate_parity_verified", "native_analysis_bypassed"):
            self.assertIs(result[key], False)

    def test_extra_elapsed_is_not_counted_as_temporal_smoothing(self):
        clock = 0
        refiner = refiner_fixture()
        refined, receipt = refiner.refine.return_value

        def now():
            nonlocal clock
            clock += 1000
            return clock

        def slow_refine(*, rgba, geometry):
            nonlocal clock
            clock += 1_000_000_000
            return refined, receipt

        refiner.refine.side_effect = slow_refine
        core = candidate.CandidateCore(models=FakeHeads(), extra_refinement=refiner)
        packet, rgba = routed_fixture(extra=True, mode="reset-120")
        with mock.patch.object(candidate.time, "perf_counter_ns", side_effect=now):
            result = core.process(packet=packet, rgba=rgba, extra_geometry={})
        self.assertGreaterEqual(result["extra_refinement"]["elapsed_ms"], 1000)
        self.assertLess(result["stage_timings_ms"]["temporal-smoothing"], 1)
        self.assertGreaterEqual(result["total_ms"], result["extra_refinement"]["elapsed_ms"])

    def test_failures_do_not_commit_and_same_prediction_can_retry(self):
        for existing in (False, True):
            for phase in ("refine", "normalization", "checker", "verify", "observer"):
                with self.subTest(existing=existing, phase=phase):
                    refiner = refiner_fixture()
                    observer = mock.Mock(return_value=None)
                    core = candidate.CandidateCore(models=FakeHeads(), extra_refinement=refiner, stage_observer=observer)
                    if existing:
                        packet, rgba = routed_fixture(extra=True, mode="reset-120")
                        core.process(packet=packet, rgba=rgba, extra_geometry={})
                    before, prior_state = self.snapshot(core=core), core.state
                    packet, rgba = routed_fixture(extra=True, mode="update" if existing else "reset-120",
                                                  prediction=int(existing))
                    checker = None
                    if phase == "refine":
                        refiner.refine.side_effect = RuntimeError("refine failed")
                    elif phase == "normalization":
                        refiner.refine.return_value[0][:] = 500
                    elif phase == "checker":
                        checker = mock.Mock(side_effect=RuntimeError("checker failed"))
                    elif phase == "verify":
                        core.models.fail_verify_at = core.models.verify_calls + 2
                    elif phase == "observer":
                        observer.side_effect = RuntimeError("observer failed")
                    error = ValueError if phase in ("normalization", "verify") else RuntimeError
                    message = {"normalization": "normalized frame", "verify": "provenance changed"}.get(phase, phase + " failed")
                    with self.assertRaisesRegex(error, message):
                        core.process(packet=packet, rgba=rgba, extra_geometry={}, check_output=checker)
                    self.assertIs(core.state, prior_state)
                    self.assert_unchanged(core=core, snapshot=before)
                    refiner.refine.side_effect = None
                    refiner.refine.return_value = refiner_fixture().refine.return_value
                    core.models.fail_verify_at = None
                    observer.side_effect = None
                    core.process(packet=packet, rgba=rgba, extra_geometry={})
                    self.assertEqual(core.sequence[3], int(existing))

    def test_caller_pixels_are_owned_before_refinement_and_packet_is_unchanged(self):
        refiner = refiner_fixture()
        original_points = refiner.refine.return_value[0].copy()
        packet, rgba = routed_fixture(extra=True, mode="reset-120")
        packet_before, rgba_before = copy.deepcopy(packet), rgba.copy()

        def mutate_owned_pixels(*, rgba, geometry):
            rgba[:] = 0
            return refiner_fixture().refine.return_value

        refiner.refine.side_effect = mutate_owned_pixels
        core = candidate.CandidateCore(models=FakeHeads(), extra_refinement=refiner)
        core.process(packet=packet, rgba=rgba, extra_geometry={})
        self.assertEqual(packet, packet_before)
        np.testing.assert_array_equal(rgba, rgba_before)
        np.testing.assert_array_equal(core.state.first33.current, original_points[:33])

    def test_default_path_is_identical_when_extra_options_are_omitted_or_none(self):
        for extra in (False, True):
            implicit = candidate.CandidateCore(models=FakeHeads())
            explicit = candidate.CandidateCore(models=FakeHeads(), extra_refinement=None)
            for prediction, mode in enumerate(("seed-160", "update", "reset-120", None)):
                packet, rgba = routed_fixture(extra=extra, prediction=prediction, mode=mode)
                actual = explicit.process(packet=packet, rgba=rgba, extra_geometry=None)
                expected = implicit.process(packet=packet, rgba=rgba)
                self.assertEqual(stable_result(result=actual), stable_result(result=expected))
                self.assertNotIn("extra_refinement", actual)
                self.assert_unchanged(core=explicit, snapshot=self.snapshot(core=implicit))
            for left, right in zip(explicit.models.calls, implicit.models.calls, strict=True):
                self.assertEqual(left[0], right[0])
                np.testing.assert_array_equal(left[1], right[1])


if __name__ == "__main__":
    unittest.main()
