"""CPU worker tests. Synthetic dependencies do not attest native live parity."""
from __future__ import annotations

import copy
import hashlib
import os
from pathlib import Path
import unittest
from unittest import mock

import numpy as np

import face_live_candidate_test as fixtures
from face_live_candidate import CandidateCore, STAGES
from face_live_candidate_onnx import OnnxHeads
from face_live_worker import LiveWorker

TOKEN = "synthetic-worker-test-token"
OWNER, ALIGNMENT = 0x10000, 0x20000
NETWORKS = {120: 0x30000, 160: 0x40000}


def message(*, op, data, prediction=0, pid=123):
    return dict(op=op, data=data, prediction=prediction, pid=pid, token=TOKEN)


def dependencies(*, prediction=0, mode="seed-160", value=150, face_id=0):
    packet, rgba = fixtures.fixture(prediction=prediction, mode=mode, value=value, face_id=face_id)
    packet.update(source_key="synthetic-worker-source", frame_number=prediction)
    face, call = None, None
    if packet["face"] is not None:
        packet["face"]["alignment"] = ALIGNMENT
        face = {key: copy.deepcopy(packet["face"][key]) for key in
                ("id", "slot", "alignment", "forward", "inverse", "tables", "smoothing")}
        face["first"] = mode == "reset-120"
        initialization = packet["face"]["initialization"]
        if initialization is not None:
            call = dict(alignment=ALIGNMENT, call=copy.deepcopy(initialization["call"]),
                        source=dict(width=rgba.shape[1], height=rgba.shape[0],
                            sha256=hashlib.sha256(rgba[:, :, :3][:, :, ::-1].tobytes()).hexdigest()))
    data = {key: packet[key] for key in ("width", "height", "stride", "format", "orientation",
                                       "runtime_state", "timestamp_us")}
    data.update(owner=OWNER, face=face, predictors=[dict(network=NETWORKS[size]) for size in (120, 160)])
    return packet, rgba, data, call


def begin(*, worker, prediction=0, owner=OWNER):
    return worker.dispatch(message=message(op="begin", prediction=prediction, data=dict(owner=owner)))


def inference(*, worker, size, prediction=0, inverse=None, network=None):
    return worker.dispatch(message=message(op="infer", prediction=prediction,
        data=dict(size=size, network=NETWORKS[size] if network is None else network,
                  detection_inverse=inverse)))


def detection(*, worker, call, prediction=0, inverse=None):
    worker.dispatch(message=message(op="call", prediction=prediction, data=call))
    return inference(worker=worker, prediction=prediction, size=160,
                     inverse=[[1, 0, 0], [0, 1, 0]] if inverse is None else inverse)


def feed(*, worker, prediction=0, mode="seed-160", value=150, face_id=0, after=False):
    packet, rgba, data, call = dependencies(prediction=prediction, mode=mode, value=value, face_id=face_id)
    begin(worker=worker, prediction=prediction)
    if call is not None:
        detection(worker=worker, call=call, prediction=prediction)
    if mode is not None:
        inference(worker=worker, size=120, prediction=prediction)
    if after:
        _, _, _, post = dependencies(prediction=prediction, value=value)
        post["call"]["rect"]["values"][0] += 10
        detection(worker=worker, call=post, prediction=prediction, inverse=[[2, 0, 10], [0, 2, 20]])
    reply = worker.dispatch(message=message(op="predict", prediction=prediction, data=data), pixels=rgba.tobytes())
    return reply, packet, rgba


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.models = fixtures.FakeHeads()
        self.worker = LiveWorker(models=self.models, token=TOKEN, source_key="synthetic-worker-source")

    def assert_poisoned(self):
        self.assertIsNotNone(self.worker.error)
        with self.assertRaisesRegex(RuntimeError, "poisoned"):
            begin(worker=self.worker)

    def test_causal_seed_ignores_later_160_and_matches_direct_pipeline(self):
        reply, packet, rgba = feed(worker=self.worker, after=True)
        expected = CandidateCore(models=fixtures.FakeHeads()).process(packet=packet, rgba=rgba)
        self.assertEqual(reply["result"]["faces"], expected["faces"])
        self.assertEqual(reply["result"]["heads"], expected["heads"])
        self.assertEqual(reply["result"]["input_tensor_sha256"], expected["input_tensor_sha256"])
        self.assertEqual([size for size, _ in self.models.calls], [160, 120])
        proof = reply["initialization_proof"]
        self.assertEqual(proof["seed_record_index"], 0)
        self.assertEqual(proof["tracking_record_index"], 1)
        self.assertEqual(proof["excluded_160_inferences"], [1])
        self.assertEqual(proof["inverse_source"], "same-call-160-predictor-entry")
        self.assertFalse(reply["stage_ownership"]["live_parity_verified"])
        self.assertFalse(reply["result"]["native_final_point_input_used"])
        self.assertEqual(set(reply["result"]["stage_timings_ms"]), set(STAGES))
        self.assertTrue(all(value >= 0 for value in reply["result"]["stage_timings_ms"].values()))

    def test_posttracking_160_does_not_reseed_existing_identity(self):
        first, _, _ = feed(worker=self.worker)
        second, _, _ = feed(worker=self.worker, prediction=1, mode="update", value=200, after=True)
        self.assertIsNone(second["initialization_proof"])
        self.assertEqual([size for size, _ in self.models.calls], [160, 120, 120])
        self.assertNotEqual(first["result"]["input_tensor_sha256"]["120"],
                            second["result"]["input_tensor_sha256"]["120"])
        self.assertEqual(second["result"]["stage_timings_ms"]["inference-160"], 0)

    def test_more_than_26_predictions_without_replay_lookup(self):
        feed(worker=self.worker)
        for index in range(1, 29):
            feed(worker=self.worker, prediction=index, mode="update", value=100 + index)
        self.assertEqual(self.worker.index, 28)
        self.assertEqual(len(self.models.calls), 30)

    def test_reset_120_does_not_require_160(self):
        reply, _, _ = feed(worker=self.worker, mode="reset-120")
        self.assertEqual([size for size, _ in self.models.calls], [120])
        self.assertIsNone(reply["initialization_proof"])
        self.assertTrue(self.worker.core.state.first33.first)

    def test_no_face_then_new_identity_reacquires_with_owned_seed(self):
        feed(worker=self.worker)
        empty, _, _ = feed(worker=self.worker, prediction=1, mode=None)
        self.assertEqual(empty["result"]["faces"], [])
        self.assertIsNone(self.worker.core.state)
        feed(worker=self.worker, prediction=2, face_id=1)
        self.assertEqual(self.worker.core.identity[-1], 1)

    def test_ambiguous_pretracking_160_rejects_before_inference(self):
        _, rgba, data, call = dependencies()
        begin(worker=self.worker)
        detection(worker=self.worker, call=call)
        detection(worker=self.worker, call=call)
        inference(worker=self.worker, size=120)
        with self.assertRaisesRegex(ValueError, "ambiguous seeds"):
            self.worker.dispatch(message=message(op="predict", data=data), pixels=rgba.tobytes())
        self.assertEqual(self.models.calls, [])
        self.assert_poisoned()

    def test_only_posttracking_160_cannot_initialize(self):
        with self.assertRaisesRegex(ValueError, "before tracking"):
            feed(worker=self.worker, mode="update", after=True)
        self.assertIsNone(self.worker.core.sequence)
        self.assert_poisoned()

    def test_missing_160_caller_or_inverse_rejected(self):
        begin(worker=self.worker)
        with self.assertRaisesRegex(ValueError, "preceding caller"):
            inference(worker=self.worker, size=160)
        self.assert_poisoned()

    def test_seed_inverse_is_copied_at_inference_event(self):
        packet, rgba, data, call = dependencies()
        begin(worker=self.worker)
        inverse = [[1, 0, 5], [0, 1, 6]]
        detection(worker=self.worker, call=call, inverse=inverse)
        inverse[0][2] = 30000
        packet["face"]["initialization"]["detection_inverse"] = [[1, 0, 5], [0, 1, 6]]
        inference(worker=self.worker, size=120)
        reply = self.worker.dispatch(message=message(op="predict", data=data), pixels=rgba.tobytes())
        expected = CandidateCore(models=fixtures.FakeHeads()).process(packet=packet, rgba=rgba)
        self.assertEqual(reply["result"]["faces"], expected["faces"])

    def test_crop_source_mismatch_or_alignment_mismatch_rejected(self):
        for key in ("source", "alignment"):
            with self.subTest(key=key):
                self.setUp()
                _, rgba, data, call = dependencies()
                call[key] = dict(call["source"], sha256="0" * 64) if key == "source" else ALIGNMENT + 1
                begin(worker=self.worker)
                detection(worker=self.worker, call=call)
                inference(worker=self.worker, size=120)
                with self.assertRaises(ValueError):
                    self.worker.dispatch(message=message(op="predict", data=data), pixels=rgba.tobytes())
                self.assertEqual(self.models.calls, [])
                self.assert_poisoned()

    def test_rejects_native_point_tensor_and_old_inverse_input_channels(self):
        for key in ("points", "previous_xy", "tensor", "replay", "detection_inverse"):
            with self.subTest(key=key):
                self.setUp()
                _, rgba, data, _ = dependencies(mode="reset-120")
                data["face"][key] = []
                begin(worker=self.worker)
                inference(worker=self.worker, size=120)
                with self.assertRaises(ValueError):
                    self.worker.dispatch(message=message(op="predict", data=data), pixels=rgba.tobytes())
                self.assertEqual(self.models.calls, [])

    def test_invalid_metadata_is_rejected_before_reshape(self):
        for key, value in (("width", True), ("height", 0), ("stride", 801), ("orientation", 1)):
            with self.subTest(key=key):
                self.setUp()
                _, rgba, data, _ = dependencies(mode="reset-120")
                data[key] = value
                begin(worker=self.worker)
                inference(worker=self.worker, size=120)
                with mock.patch("face_live_worker.np.frombuffer") as reshape:
                    with self.assertRaises(ValueError):
                        self.worker.dispatch(message=message(op="predict", data=data), pixels=rgba.tobytes())
                    reshape.assert_not_called()

    def test_wrong_pixels_owner_predictor_or_tracking_count_rejected(self):
        for case in ("pixels", "owner", "predictor", "missing", "duplicate"):
            with self.subTest(case=case):
                self.setUp()
                _, rgba, data, _ = dependencies(mode="reset-120")
                begin(worker=self.worker)
                if case != "missing":
                    inference(worker=self.worker, size=120)
                if case == "duplicate":
                    inference(worker=self.worker, size=120)
                if case == "owner":
                    data["owner"] += 1
                if case == "predictor":
                    data["predictors"][0]["network"] += 1
                pixels = rgba.tobytes()[:-1] if case == "pixels" else rgba.tobytes()
                with self.assertRaises(ValueError):
                    self.worker.dispatch(message=message(op="predict", data=data), pixels=pixels)
                self.assertIsNone(self.worker.core.sequence)

    def test_envelope_rejection_poison_and_cancel(self):
        for key, value in (("token", "wrong"), ("pid", True), ("prediction", 1), ("op", "cancel")):
            with self.subTest(key=key):
                self.setUp()
                row = message(op="begin", data=dict(owner=OWNER))
                row[key] = value
                with self.assertRaises((ValueError, RuntimeError)):
                    self.worker.dispatch(message=row)
                self.assert_poisoned()

    def test_duplicate_begin_foreign_pid_and_source_reset_rejected(self):
        for case in ("duplicate", "pid", "reset"):
            with self.subTest(case=case):
                self.setUp()
                begin(worker=self.worker)
                row = message(op="begin", data=dict(owner=OWNER))
                if case == "pid":
                    row["pid"] += 1
                if case == "reset":
                    row.update(op="reset", data={})
                with self.assertRaises(ValueError):
                    self.worker.dispatch(message=row)
                self.assert_poisoned()
        fresh = LiveWorker(models=fixtures.FakeHeads(), token=TOKEN, source_key="new-source")
        self.assertTrue(feed(worker=fresh)[0]["ok"])

    def test_all_five_failed_heads_roll_back_and_poison(self):
        for head in fixtures.HEADS:
            with self.subTest(head=head):
                self.setUp()
                feed(worker=self.worker)
                before = self.worker.core.state
                infer = self.models.infer

                def invalid(*, size, values):
                    result = infer(size=size, values=values)
                    result[head].fill(np.nan)
                    return result

                with mock.patch.object(self.models, "infer", side_effect=invalid):
                    with self.assertRaises(ValueError):
                        feed(worker=self.worker, prediction=1, mode="update")
                self.assertIs(self.worker.core.state, before)
                self.assertEqual(self.worker.index, 0)
                self.assertEqual(self.worker.core.sequence[3], 0)
                self.assert_poisoned()

    def test_model_guards_before_and_after_inference_do_not_advance(self):
        for phase in (1, 2):
            with self.subTest(phase=phase):
                self.setUp()
                feed(worker=self.worker)
                before = self.worker.core.state
                self.models.fail_verify_at = self.models.verify_calls + phase
                with self.assertRaisesRegex(ValueError, "provenance changed"):
                    feed(worker=self.worker, prediction=1, mode="update")
                self.assertIs(self.worker.core.state, before)
                self.assertEqual(self.worker.index, 0)
                self.assert_poisoned()


@unittest.skipUnless(os.environ.get("QCUT_FACE_LIVE_MODEL_ROOT"), "local CPU models not requested")
class RealWorkerTests(unittest.TestCase):
    def test_persistent_real_onnx_new_pixels_both_profiles(self):
        models = OnnxHeads(root=Path(os.environ["QCUT_FACE_LIVE_MODEL_ROOT"]))
        sessions = {size: id(value) for size, value in models.sessions.items()}
        worker = LiveWorker(models=models, token=TOKEN, source_key="synthetic-worker-source")
        replies = []
        for index, mode in ((0, "seed-160"), (1, "update"), (2, "reset-120")):
            _, rgba, data, call = dependencies(prediction=index, mode=mode, value=40 + 60 * index)
            inverse = [[0.25, 0, 90], [0, 0.25, 90]]
            data["face"]["inverse"] = inverse
            begin(worker=worker, prediction=index)
            if call:
                detection(worker=worker, call=call, prediction=index, inverse=inverse)
            inference(worker=worker, size=120, prediction=index)
            replies.append(worker.dispatch(message=message(op="predict", prediction=index, data=data),
                                           pixels=rgba.tobytes()))
        self.assertEqual(sessions, {size: id(value) for size, value in models.sessions.items()})
        self.assertEqual(len({row["result"]["input_tensor_sha256"]["120"] for row in replies}), 3)
        self.assertEqual(len({row["result"]["heads"]["120"]["fc_landmark_s1"]["sha256"] for row in replies}), 3)
        self.assertEqual(sum(len(heads) for row in replies for heads in row["result"]["heads"].values()), 20)
        self.assertTrue(all(len(row["result"]["faces"][0]["points"]) == 106 for row in replies))
        self.assertTrue(all(row["stage_ownership"]["live_parity_verified"] is False for row in replies))


if __name__ == "__main__":
    unittest.main()
