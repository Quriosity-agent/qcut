"""CPU-only live Extra dispatch tests; synthetic heads, no native processes."""
import copy
import unittest

import numpy as np

from face_live_candidate_test import FakeHeads
from face_live_extra_refinement import ExtraRefinement
from face_live_extra_refinement_test import fake_models, geometry_fixture
from face_live_worker import LiveWorker
from face_live_worker_test import TOKEN, begin, dependencies, detection, inference, message


class ExtraWorkerTests(unittest.TestCase):
    def make_worker(self, *, enabled=True):
        self.extra_models = fake_models()
        return LiveWorker(models=FakeHeads(), token=TOKEN, source_key="synthetic-worker-source",
                          extra_refinement=ExtraRefinement(models=self.extra_models) if enabled else None)

    def prepare(self, *, worker, prediction=0, mode="reset-120", extra=True):
        _, rgba, data, call = dependencies(prediction=prediction, mode=mode)
        data["runtime_state"]["base_output_mode_bit"] = extra
        begin(worker=worker, prediction=prediction)
        if call is not None:
            detection(worker=worker, call=call, prediction=prediction)
        inference(worker=worker, size=120, prediction=prediction)
        return message(op="predict", prediction=prediction, data=data), rgba.tobytes()

    def assert_poisoned(self, *, worker, index=-1):
        self.assertEqual(worker.index, index)
        self.assertIsNotNone(worker.error)
        with self.assertRaisesRegex(RuntimeError, "session poisoned"):
            begin(worker=worker, prediction=index + 1)

    def test_explicit_pair_reaches_refiner_and_persists_across_predictions(self):
        worker = self.make_worker()
        versions = []
        for prediction, mode in enumerate(("seed-160", "reset-120", "update")):
            request, pixels = self.prepare(worker=worker, prediction=prediction, mode=mode)
            request["data"]["extra_geometry"] = geometry_fixture()
            before = copy.deepcopy(request)
            reply = worker.dispatch(message=request, pixels=pixels)
            self.assertTrue(reply["ok"])
            self.assertEqual(reply["prediction"], prediction)
            self.assertEqual(request, before)
            self.assertIsNone(worker.pending)
            self.assertIsNone(worker.error)
            self.assertIs(type(worker.core.identity), tuple)
            receipt = reply["result"]["extra_refinement"]
            self.assertEqual(receipt["algorithm_rgba_sha256"], reply["result"]["algorithm_rgba_sha256"])
            self.assertIs(reply["stage_ownership"]["product_backend_registered"], False)
            versions.append(reply["result"]["backend_version"])
        self.assertEqual(len(set(versions)), 1)
        self.assertEqual(self.extra_models.infer.call_count, 3)

    def test_default_worker_rejects_even_null_extra_geometry(self):
        for geometry in (None, {}, geometry_fixture()):
            worker = self.make_worker(enabled=False)
            request, pixels = self.prepare(worker=worker)
            request["data"]["extra_geometry"] = geometry
            with self.subTest(geometry=geometry), self.assertRaisesRegex(ValueError, "exact dependency fields"):
                worker.dispatch(message=request, pixels=pixels)
            self.assertEqual(worker.core.models.calls, [])
            self.extra_models.infer.assert_not_called()
            self.assert_poisoned(worker=worker)

    def test_enabled_worker_requires_geometry_and_extra_route(self):
        for case in ("missing", "null", "base-route"):
            worker = self.make_worker()
            request, pixels = self.prepare(worker=worker, extra=case != "base-route")
            if case != "missing":
                request["data"]["extra_geometry"] = None if case == "null" else geometry_fixture()
            with self.subTest(case=case), self.assertRaises(ValueError):
                worker.dispatch(message=request, pixels=pixels)
            self.assertEqual(worker.core.models.calls, [])
            self.extra_models.infer.assert_not_called()
            self.assertIsNone(worker.core.sequence)
            self.assert_poisoned(worker=worker)

    def test_every_geometry_field_is_required_and_failure_poisons(self):
        for missing in geometry_fixture():
            worker = self.make_worker()
            request, pixels = self.prepare(worker=worker)
            request["data"]["extra_geometry"] = {
                key: value for key, value in geometry_fixture().items() if key != missing}
            with self.subTest(missing=missing), self.assertRaisesRegex(ValueError, "exact dependency fields"):
                worker.dispatch(message=request, pixels=pixels)
            self.extra_models.infer.assert_not_called()
            self.assertIsNone(worker.core.state)
            self.assert_poisoned(worker=worker)

    def test_malformed_geometry_and_native_payloads_poison_before_extra_inference(self):
        for case in ("list", "typed-profile", "singular", "nan", "points", "cropblob"):
            worker = self.make_worker()
            request, pixels = self.prepare(worker=worker)
            geometry = geometry_fixture()
            if case == "list":
                geometry = []
            elif case == "typed-profile":
                geometry["profile"]["optimized"] = 0
            elif case == "singular":
                geometry["inverse"] = [[0, 0, 0], [0, 0, 0]]
            elif case == "nan":
                geometry["primary_mean"][0] = float("nan")
            else:
                geometry[case] = []
            request["data"]["extra_geometry"] = geometry
            with self.subTest(case=case), self.assertRaises(ValueError):
                worker.dispatch(message=request, pixels=pixels)
            self.extra_models.infer.assert_not_called()
            self.assertIsNone(worker.core.sequence)
            self.assert_poisoned(worker=worker)

    def test_late_extra_verification_failure_preserves_history_and_poisons(self):
        worker = self.make_worker()
        request, pixels = self.prepare(worker=worker)
        request["data"]["extra_geometry"] = geometry_fixture()
        worker.dispatch(message=request, pixels=pixels)
        state, identity, sequence = worker.core.state, worker.core.identity, worker.core.sequence
        first, last = state.first33.current.copy(), state.last73.current.copy()
        request, pixels = self.prepare(worker=worker, prediction=1, mode="update")
        request["data"]["extra_geometry"] = geometry_fixture()
        self.extra_models.verify.side_effect = ValueError("Extra model changed")
        with self.assertRaisesRegex(ValueError, "Extra model changed"):
            worker.dispatch(message=request, pixels=pixels)
        self.assertIs(worker.core.state, state)
        self.assertEqual(worker.core.identity, identity)
        self.assertEqual(worker.core.sequence, sequence)
        np.testing.assert_array_equal(state.first33.current, first)
        np.testing.assert_array_equal(state.last73.current, last)
        self.assert_poisoned(worker=worker, index=0)


if __name__ == "__main__":
    unittest.main()
