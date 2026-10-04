"""CPU contract/state tests; optional real ORT tests never start native capture.

QCUT_FACE_LIVE_MODEL_ROOT enables local model smoke tests, not native parity.
"""
from __future__ import annotations

import copy
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import numpy as np

from face_alignment_replay import HEADS
from face_alignment_sampling import signed_input
from face_live_candidate import CandidateCore, STAGES, serve
from face_live_candidate_audit import CandidateAudit
from face_live_candidate_contract import ROUTE, SCHEMA, validate
from face_live_candidate_onnx import OnnxHeads, head_shapes, validate_heads
from face_preprocess_replay import prepare
from face_temporal_smoothing import initialize_base, update_base


def fixture(*, prediction=0, mode="seed-160", face_id=0, value=150):
    rgba = np.full((200, 200, 4), value, np.uint8)
    packet = dict(schema=SCHEMA, source_key="synthetic-not-live", frame_number=prediction // 2,
        timestamp_us=(prediction // 2) * 33333, prediction=prediction, width=200, height=200,
        stride=800, format=0, orientation=0, rgba_sha256=hashlib.sha256(rgba.tobytes()).hexdigest(),
        runtime_state=copy.deepcopy(ROUTE), face=None)
    if mode is None:
        return packet, rgba
    affine = [[1, 0, 0], [0, 1, 0]]
    params = dict(alpha=float(np.float32(0.2)), escale=10,
                  scale=float(np.float32(10 / 720 * 200)), width=200, height=200)
    packet["face"] = dict(id=face_id, slot=0, alignment=1, mode=mode,
        forward=copy.deepcopy(affine), inverse=copy.deepcopy(affine),
        tables=dict(base=[0] * 212, order=list(range(106))),
        smoothing=[copy.deepcopy(params), copy.deepcopy(params)], initialization=None)
    if mode == "seed-160":
        packet["face"]["initialization"] = dict(detection_inverse=copy.deepcopy(affine),
            call=dict(format=0, orientation=0, target=[160, 160], flags=[0, 0, 0],
                      rect=dict(values=[40, 40, 100, 100]), expansion=1))
    return packet, rgba


class FakeHeads:
    version = "synthetic-test-only"

    def __init__(self):
        self.calls = []
        self.verify_calls = 0
        self.fail_verify_at = None
        self.bad_head = False

    def verify(self):
        self.verify_calls += 1
        if self.verify_calls == self.fail_verify_at:
            raise ValueError("model provenance changed")

    def infer(self, *, size, values):
        self.calls.append((size, values.copy()))
        result = {name: np.zeros((1, 1, 1, count), np.float32)
                  for name, count in head_shapes(size=size).items()}
        result["fc_landmark_s1"].fill((60 if size == 160 else 80) + float(values.mean()) / 128)
        if self.bad_head:
            result["fc_pitch"].fill(np.nan)
        return result


class ContractTests(unittest.TestCase):
    def test_accepts_and_copies_dependencies(self):
        packet, rgba = fixture()
        copied, pixels = validate(packet=packet, rgba=rgba)
        packet["face"]["tables"]["base"][0] = 99
        rgba[:] = 1
        self.assertEqual(copied["face"]["tables"]["base"][0], 0)
        self.assertEqual(int(pixels[0, 0, 0]), 150)

    def test_rejects_point_or_tensor_channels(self):
        for location in ("packet", "face", "smoothing", "initialization", "tables"):
            for name in ("points", "previous_xy", "current_xy", "tracked", "raw", "replay", "tensor"):
                with self.subTest(location=location, name=name):
                    packet, rgba = fixture()
                    target = packet if location == "packet" else packet["face"]
                    if location == "smoothing":
                        target = target["smoothing"][0]
                    elif location in ("initialization", "tables"):
                        target = target[location]
                    target[name] = []
                    with self.assertRaises(ValueError):
                        validate(packet=packet, rgba=rgba)

    def test_rejects_malformed_envelopes(self):
        cases = dict(schema="replay", source_key="", prediction=True, frame_number=-1,
                     timestamp_us=1.5, width=True, height=0, stride=801, format=True,
                     orientation=1, rgba_sha256="0" * 64, runtime_state={}, face=[])
        for key, value in cases.items():
            with self.subTest(key=key):
                packet, rgba = fixture()
                packet[key] = value
                with self.assertRaises(ValueError):
                    validate(packet=packet, rgba=rgba)

    def test_all_unsupported_routes_rejected(self):
        for key, value in ROUTE.items():
            for invalid in (int(value) if type(value) is bool else bool(value), 1 if value == 0 else 0):
                with self.subTest(key=key, invalid=invalid):
                    packet, rgba = fixture()
                    packet["runtime_state"][key] = invalid
                    with self.assertRaises(ValueError):
                        validate(packet=packet, rgba=rgba)

    def test_invalid_geometry_and_parameters(self):
        for field, invalid in (("order", [True] + list(range(1, 106))),
                               ("order", [0] * 106), ("base", [float("nan")] * 212),
                               ("base", [True] * 212)):
            with self.subTest(field=field):
                packet, rgba = fixture()
                packet["face"]["tables"][field] = invalid
                with self.assertRaises(ValueError):
                    validate(packet=packet, rgba=rgba)
        for key, invalid in (("alpha", True), ("alpha", 1.1), ("scale", 0), ("width", 100)):
            with self.subTest(key=key):
                packet, rgba = fixture()
                packet["face"]["smoothing"][0][key] = invalid
                with self.assertRaises(ValueError):
                    validate(packet=packet, rgba=rgba)
        for key in ("forward", "inverse"):
            packet, rgba = fixture()
            packet["face"][key] = [[0, 0, 0], [0, 0, 0]]
            with self.assertRaises(ValueError):
                validate(packet=packet, rgba=rgba)

    def test_invalid_pixel_storage(self):
        packet, rgba = fixture()
        for bad in (rgba.astype(np.float32), rgba[:, :, :3], rgba[1:]):
            with self.assertRaises(ValueError):
                validate(packet=packet, rgba=bad)


class CoreTests(unittest.TestCase):
    def setUp(self):
        self.models = FakeHeads()
        self.core = CandidateCore(models=self.models)

    def run_packet(self, **kwargs):
        packet, rgba = fixture(**kwargs)
        return self.core.process(packet=packet, rgba=rgba)

    def test_owned_seed_math_and_explicit_boundaries(self):
        result = self.run_packet()
        offset = np.float32(22 / 128)
        seed = np.full((106, 2), np.float32(60) + offset, np.float32)
        tracked = np.full((106, 2), np.float32(80) + offset, np.float32)
        state = initialize_base(points=seed, width=200, height=200, escales=(10, 10), alphas=(0.2, 0.2))
        expected, _ = update_base(state=state, points=tracked, optimized=False)
        np.testing.assert_array_equal(self.core.state.first33.current, expected[:33])
        self.assertEqual([size for size, _ in self.models.calls], [160, 120])
        self.assertEqual(result["source"], "dependency-fed-research-inference")
        for key in ("arbitrary_frame_backend_connected", "renderer_connected", "candidate_parity_verified",
                    "native_final_point_input_used", "captured_tensor_input_used", "native_analysis_bypassed"):
            self.assertIs(result[key], False)
        self.assertEqual(set(result["stage_timings_ms"]), set(STAGES))
        self.assertTrue(all(value >= 0 for value in result["stage_timings_ms"].values()))
        self.assertEqual(len(result["heads"]["120"]), 5)

    def test_persistent_history_fresh_pixels_and_no_alias(self):
        first = self.run_packet()
        first["faces"][0]["points"][0][0] = 99
        second = self.run_packet(prediction=1, mode="update", value=200)
        self.assertNotEqual(first["input_tensor_sha256"]["120"], second["input_tensor_sha256"]["120"])
        self.assertEqual([size for size, _ in self.models.calls], [160, 120, 120])
        self.assertLess(second["faces"][0]["points"][0][0], 1)
        self.assertEqual(second["stage_timings_ms"]["inference-160"], 0)
        self.assertNotIn("inference-160", second["stages_run"])

    def test_reset_uses_owned_120_and_does_not_update(self):
        self.run_packet()
        result = self.run_packet(prediction=1, mode="reset-120")
        self.assertTrue(self.core.state.first33.first)
        self.assertEqual(float(self.core.state.first33.current[0, 0]), 80 + 22 / 128)
        self.assertNotIn("160", result["heads"])

    def test_no_face_clears_history_and_reacquires_new_identity(self):
        self.run_packet()
        empty = self.run_packet(prediction=1, mode=None)
        self.assertEqual(empty["faces"], [])
        self.assertEqual(empty["stages_run"], [])
        self.assertIsNone(self.core.state)
        with self.assertRaises(ValueError):
            self.run_packet(prediction=2, face_id=0)
        self.run_packet(prediction=2, face_id=1)
        self.assertEqual(self.core.identity[-1], 1)

    def test_first_prediction_must_initialize(self):
        with self.assertRaises(ValueError):
            self.run_packet(mode="update")
        self.assertIsNone(self.core.sequence)
        self.assertEqual(self.models.calls, [])

    def test_lifecycle_and_temporal_changes_rejected(self):
        self.run_packet()
        for key, value in (("prediction", 2), ("source_key", "other"), ("timestamp_us", -1)):
            packet, rgba = fixture(prediction=1, mode="update")
            packet[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.core.process(packet=packet, rgba=rgba)
        for key, value in (("id", 1), ("alignment", 2), ("mode", "seed-160")):
            packet, rgba = fixture(prediction=1)
            packet["face"][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.core.process(packet=packet, rgba=rgba)
        self.assertEqual(self.core.sequence[3], 0)

    def test_bad_auxiliary_head_does_not_advance(self):
        self.models.bad_head = True
        with self.assertRaises(ValueError):
            self.run_packet()
        self.assertIsNone(self.core.state)
        self.assertIsNone(self.core.sequence)
        self.models.bad_head = False
        self.run_packet()

    def test_late_guard_failure_rolls_back_existing_history(self):
        self.run_packet()
        before = self.core.state
        self.models.fail_verify_at = self.models.verify_calls + 2
        with self.assertRaises(ValueError):
            self.run_packet(prediction=1, mode="update")
        self.assertIs(self.core.state, before)
        self.assertEqual(self.core.sequence[3], 0)
        self.models.fail_verify_at = None
        self.run_packet(prediction=1, mode="update")

    def test_normalization_failure_rolls_back(self):
        self.run_packet()
        packet, rgba = fixture(prediction=1, mode="reset-120")
        packet["face"]["inverse"][0][2] = 500
        with self.assertRaises(ValueError):
            self.core.process(packet=packet, rgba=rgba)
        self.assertEqual(self.core.sequence[3], 0)

    def test_busy_rejects_without_state_change(self):
        self.core.busy.acquire()
        try:
            with self.assertRaises(RuntimeError):
                self.run_packet()
        finally:
            self.core.busy.release()
        self.assertIsNone(self.core.sequence)

    def test_unsupported_crop_does_not_infer(self):
        packet, rgba = fixture()
        packet["face"]["initialization"]["call"]["flags"] = [0, 0, 1]
        with self.assertRaises(ValueError):
            self.core.process(packet=packet, rgba=rgba)
        self.assertEqual(self.models.calls, [])

    def test_more_than_fixed_26_predictions(self):
        self.run_packet()
        for prediction in range(1, 30):
            self.run_packet(prediction=prediction, mode="update")
        self.assertEqual(self.core.sequence[3], 29)
        self.assertEqual(len(self.models.calls), 31)

    def test_ndjson_errors_and_two_persistent_requests(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "algorithm.rgba"
            lines = [b'{"duplicate":1,"duplicate":2}\n']
            for prediction, mode in ((0, "seed-160"), (1, "update")):
                packet, rgba = fixture(prediction=prediction, mode=mode)
                path.write_bytes(rgba.tobytes())
                lines.append((json.dumps(dict(rgba_path=str(path), packet=packet)) + "\n").encode())
            output = io.StringIO()
            serve(core=self.core, stream=io.BytesIO(b"".join(lines)), output=output)
            replies = [json.loads(line) for line in output.getvalue().splitlines()]
            self.assertEqual([reply["ok"] for reply in replies], [False, True, True])
            self.assertNotIn("result", replies[0])
            self.assertEqual(self.core.sequence[3], 1)

    def test_oversized_protocol_line_terminates(self):
        with self.assertRaises(ValueError):
            serve(core=self.core, stream=io.BytesIO(b" " * (128 * 1024 + 1)), output=io.StringIO())

    def test_invalid_metadata_rejected_before_file_open(self):
        packet, _ = fixture()
        packet["width"] = True
        line = json.dumps(dict(rgba_path="/not-opened.rgba", packet=packet)).encode() + b"\n"
        output = io.StringIO()
        with mock.patch("face_live_candidate.LockedFiles.read") as read:
            serve(core=self.core, stream=io.BytesIO(line), output=output)
            read.assert_not_called()
        self.assertFalse(json.loads(output.getvalue())["ok"])
        self.assertIsNone(self.core.sequence)

    def test_eof_truncated_and_unterminated_requests(self):
        for data in (b"", b"{", b"{}", b'{"packet":\n'):
            with self.subTest(data=data):
                output = io.StringIO()
                serve(core=self.core, stream=io.BytesIO(data), output=output)
                if data:
                    self.assertFalse(json.loads(output.getvalue())["ok"])
                else:
                    self.assertEqual(output.getvalue(), "")
                self.assertIsNone(self.core.sequence)

    def test_wrong_file_size_rejected_without_state_change(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "short.rgba"
            path.write_bytes(b"1234")
            packet, _ = fixture()
            packet["rgba_sha256"] = hashlib.sha256(b"1234").hexdigest()
            line = json.dumps(dict(rgba_path=str(path), packet=packet)).encode() + b"\n"
            output = io.StringIO()
            serve(core=self.core, stream=io.BytesIO(line), output=output)
            self.assertFalse(json.loads(output.getvalue())["ok"])
            self.assertIsNone(self.core.sequence)


class HeadTests(unittest.TestCase):
    def test_all_heads_shape_dtype_finiteness_and_no_alias(self):
        heads = FakeHeads().infer(size=120, values=np.zeros((1, 120, 120, 3), np.int16))
        copied = validate_heads(outputs=heads, size=120)
        heads["prob"][:] = 1
        self.assertFalse(copied["prob"].any())
        for name in HEADS:
            for invalid in (np.zeros((1,), np.float32), heads[name].astype(np.float64),
                            np.full(heads[name].shape, np.nan, np.float32)):
                with self.subTest(name=name), self.assertRaises(ValueError):
                    validate_heads(outputs=dict(heads, **{name: invalid}), size=120)
        with self.assertRaises(ValueError):
            validate_heads(outputs={}, size=120)


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.packet, self.rgba = fixture()
        models = FakeHeads()
        self.graph_bytes = b"synthetic graph used only with mocked graph parser"
        graph_sha = hashlib.sha256(self.graph_bytes).hexdigest()
        models.provenance = dict(models={str(size): dict(graph_sha256=graph_sha) for size in (120, 160)})
        self.audit = CandidateAudit(models=models)
        self.graph = dict(layers=[dict(op="InnerProduct", outputs=[name]) for name in HEADS],
                          descriptors={name: dict(type=4, fraction=0) for name in HEADS})
        inputs = {120: signed_input(frame=self.rgba, forward=np.eye(2, 3, dtype=np.float32)),
                  160: prepare(frame=self.rgba, call=self.packet["face"]["initialization"]["call"])["tensor"]}
        self.references = {size: dict(tensor=value, heads=FakeHeads().infer(size=size, values=value),
                                     graph_bytes=self.graph_bytes) for size, value in inputs.items()}
        self.expected = CandidateCore(models=FakeHeads()).process(packet=self.packet, rgba=self.rgba)["faces"]

    def process(self):
        with mock.patch("face_live_candidate_audit.analyze", return_value=self.graph):
            return self.audit.process(packet=self.packet, rgba=self.rgba,
                                      references=self.references, owned_faces=self.expected)

    def test_all_tensors_heads_and_owned_points_report_tolerances(self):
        _, report = self.process()
        self.assertTrue(report["passed"])
        self.assertFalse(report["reference_origin_verified"])
        self.assertEqual(report["owned_point_tolerance"], 0)
        self.assertEqual(report["tensor_tolerance"], 0)
        self.assertEqual(sum(len(row["heads"]) for row in report["models"].values()), 10)
        self.assertTrue(all(row["exact"] for row in report["points"]))

    def test_bad_tensor_does_not_publish_or_advance(self):
        self.references[120]["tensor"][0, 0, 0, 0] += 1
        with self.assertRaises(ValueError):
            self.process()
        self.assertFalse(self.audit.last_report["passed"])
        self.assertIsNone(self.audit.core.state)
        self.assertIsNone(self.audit.core.sequence)

    def test_bad_auxiliary_head_fails_at_existing_threshold(self):
        self.references[160]["heads"]["fc_pitch"].fill(0.01)
        with self.assertRaises(ValueError):
            self.process()
        check = self.audit.last_report["models"]["160"]["heads"]["fc_pitch"]
        self.assertEqual(check["atol"], 0.0001)
        self.assertEqual(check["rtol"], 0.00001)
        self.assertFalse(check["passed"])
        self.assertIsNone(self.audit.core.sequence)

    def test_bad_owned_point_rejected_without_correction(self):
        self.expected[0]["points"][0][0] += 0.001
        with self.assertRaises(ValueError):
            self.process()
        self.assertFalse(self.audit.last_report["points"][0]["exact"])
        self.assertIsNone(self.audit.core.sequence)

    def test_graph_hash_mismatch_rejected(self):
        self.references[160]["graph_bytes"] = b"different graph"
        with self.assertRaises(ValueError):
            self.process()
        self.assertIsNone(self.audit.core.sequence)

    def test_late_guard_failure_revokes_audit(self):
        self.audit.models.models.fail_verify_at = 2
        with self.assertRaises(ValueError):
            self.process()
        self.assertFalse(self.audit.last_report["passed"])
        self.assertIsNone(self.audit.core.sequence)

    def test_checker_cannot_mutate_result_or_return_native_points(self):
        core = CandidateCore(models=FakeHeads())

        def mutate(*, result):
            result["faces"][0]["points"][0][0] = 99

        actual = core.process(packet=self.packet, rgba=self.rgba, check_output=mutate)
        self.assertNotEqual(actual["faces"][0]["points"][0][0], 99)
        core = CandidateCore(models=FakeHeads())
        with self.assertRaises(ValueError):
            core.process(packet=self.packet, rgba=self.rgba, check_output=lambda **_: self.expected)
        self.assertIsNone(core.sequence)


@unittest.skipUnless(os.environ.get("QCUT_FACE_LIVE_MODEL_ROOT"), "local model root not requested")
class RealOnnxTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.models = OnnxHeads(root=Path(os.environ["QCUT_FACE_LIVE_MODEL_ROOT"]))

    def test_persistent_sessions_infer_both_fresh_sample_profiles(self):
        identities = {size: id(runner) for size, runner in self.models.sessions.items()}
        packet, rgba = fixture()
        self.models.verify()
        for size in (120, 160):
            results = []
            for value in (20, 200):
                rgba[:] = value
                values = (signed_input(frame=rgba, forward=np.asarray(packet["face"]["forward"], np.float32))
                          if size == 120 else prepare(frame=rgba, call=packet["face"]["initialization"]["call"])["tensor"])
                result = self.models.infer(size=size, values=values)
                self.assertEqual(set(result), set(HEADS))
                results.append(result["fc_landmark_s1"])
            self.assertFalse(np.array_equal(*results))
        self.models.verify()
        self.assertEqual(identities, {size: id(runner) for size, runner in self.models.sessions.items()})

    def test_wrong_storage_rejected_before_session_run(self):
        for size in (120, 160):
            with self.assertRaises(ValueError):
                self.models.infer(size=size, values=np.zeros((1, size, size, 3), np.float32))

    def test_real_core_fresh_synthetic_predictions(self):
        core = CandidateCore(models=self.models)
        results = []
        for prediction, mode in ((0, "seed-160"), (1, "update"), (2, "reset-120")):
            packet, rgba = fixture(prediction=prediction, mode=mode, value=40 + 60 * prediction)
            packet["face"]["inverse"] = [[0.25, 0, 90], [0, 0.25, 90]]
            if mode == "seed-160":
                packet["face"]["initialization"]["detection_inverse"] = [[0.25, 0, 90], [0, 0.25, 90]]
            results.append(core.process(packet=packet, rgba=rgba))
        self.assertEqual(len({item["heads"]["120"]["fc_landmark_s1"]["sha256"] for item in results}), 3)
        self.assertTrue(all(len(item["faces"][0]["points"]) == 106 for item in results))
        self.assertTrue(all(item["candidate_parity_verified"] is False for item in results))


if __name__ == "__main__":
    unittest.main()
