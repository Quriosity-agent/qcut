"""Authored ONNX and cross-process contracts, never private model/native parity."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "research/local-model-pytorch"), str(ROOT / "scripts")]

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper
import onnxruntime as ort

from face_live_candidate import CandidateCore
from face_live_candidate_onnx import OnnxHeads, head_shapes
import face_live_candidate_test as fixtures
from face_live_worker import LiveWorker
import face_live_worker_protocol as wire
import face_live_worker_test as packets

EVIDENCE = []
ATOL, RTOL = 1e-5, 1e-6


def authored_graph(*, size):
    nodes = [helper.make_node("Cast", ["data"], ["float_pixels"], to=TensorProto.FLOAT),
             helper.make_node("ReduceMean", ["float_pixels"], ["mean"], keepdims=1),
             helper.make_node("Div", ["mean", "divisor"], ["offset"])]
    constants = [numpy_helper.from_array(np.array(128, np.float32), "divisor")]
    outputs = []
    for name, count in head_shapes(size=size).items():
        base = 60 if size == 160 else 80
        value = np.full((1, 1, 1, count), base if name == "fc_landmark_s1" else 0, np.float32)
        constants.append(numpy_helper.from_array(value, f"{name}_base"))
        nodes.append(helper.make_node("Add", [f"{name}_base", "offset"], [name]))
        outputs.append(helper.make_tensor_value_info(name, TensorProto.FLOAT, list(value.shape)))
    graph = helper.make_graph(nodes, f"qcut-authored-contract-{size}",
        [helper.make_tensor_value_info("data", TensorProto.INT64, [1, size, size, 3])], outputs, constants)
    model = helper.make_model(graph, producer_name="qcut-synthetic-contract-only",
                              opset_imports=[helper.make_opsetid("", 13)], ir_version=10)
    onnx.checker.check_model(model)
    return model.SerializeToString()


class AuthoredHeads(OnnxHeads):
    """Exercise production infer/validation, not the private export-manifest loader."""

    def __init__(self):
        ort.disable_telemetry_events()
        options = ort.SessionOptions()
        options.intra_op_num_threads = options.inter_op_num_threads = 1
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
        self.graphs = {size: authored_graph(size=size) for size in (120, 160)}
        self.hashes = {size: hashlib.sha256(data).hexdigest() for size, data in self.graphs.items()}
        self.sessions = {size: ort.InferenceSession(data, sess_options=options,
                          providers=["CPUExecutionProvider"]) for size, data in self.graphs.items()}
        self.names = {size: list(head_shapes(size=size)) for size in self.sessions}
        self.version = "authored-contract-not-private-parity"
        self.calls = []

    def verify(self):
        if any(hashlib.sha256(data).hexdigest() != self.hashes[size] for size, data in self.graphs.items()):
            raise ValueError("authored graph identity changed")
        if any(session.get_providers() != ["CPUExecutionProvider"] for session in self.sessions.values()):
            raise ValueError("CPU-only contract required")

    def infer(self, *, size, values):
        result = super().infer(size=size, values=values)
        self.calls.append(dict(size=size, input_sha256=hashlib.sha256(values.tobytes()).hexdigest()))
        return result

    def observations(self):
        return dict(pid=os.getpid(), sessions={str(size): id(value) for size, value in self.sessions.items()},
                    calls=list(self.calls), graph_sha256={str(size): value for size, value in self.hashes.items()},
                    providers={str(size): value.get_providers() for size, value in self.sessions.items()})


def worker_child(*, port):
    models = AuthoredHeads()
    worker = LiveWorker(models=models, token=packets.TOKEN, source_key="synthetic-worker-source")
    # Test-only TCP carrier; production Unix socket startup is qualified separately.
    with socket.create_connection(("127.0.0.1", port), timeout=15) as connection:
        for _ in range(256):
            try:
                message, pixels = wire.receive(connection=connection, timeout=15)
            except EOFError:
                return
            except (ValueError, TimeoutError) as error:
                wire.send(connection=connection, message=dict(ok=False, error=str(error), index=worker.index))
                return
            try:
                reply = worker.dispatch(message=message, pixels=pixels)
            except (ValueError, RuntimeError) as error:
                reply = dict(ok=False, error=str(error))
            wire.send(connection=connection, message=dict(reply=reply, index=worker.index,
                                                          observations=models.observations()))
    raise RuntimeError("synthetic worker request budget exhausted")


class AuthoredOnnxTests(unittest.TestCase):
    def setUp(self):
        self.models = AuthoredHeads()

    def test_both_profiles_all_five_heads_match_independent_arithmetic(self):
        cases = []
        for size in (120, 160):
            dtype = np.int16 if size == 120 else np.int8
            for value in (-128, -1, 0, 127, None):
                shape = (1, size, size, 3)
                tensor = (np.random.default_rng(17).integers(-128, 128, size=shape, dtype=dtype)
                          if value is None else np.full(shape, value, dtype))
                actual = self.models.infer(size=size, values=tensor)
                offset = np.float32(float(tensor.astype(np.int64).sum()) / tensor.size) / np.float32(128)
                for name, output in actual.items():
                    base = (60 if size == 160 else 80) if name == "fc_landmark_s1" else 0
                    expected = np.full_like(output, np.float32(base) + offset)
                    if value is not None:
                        np.testing.assert_array_equal(output, expected)
                    else:
                        np.testing.assert_allclose(output, expected, atol=ATOL, rtol=RTOL)
                cases.append(dict(size=size, input_sha256=hashlib.sha256(tensor.tobytes()).hexdigest(),
                                  heads=len(actual), exact_constant=value is not None))
        self.models.verify()
        EVIDENCE.append(dict(kind="authored-onnx-arithmetic", cases=cases,
                             graph_sha256={str(size): value for size, value in self.models.hashes.items()}))

    def test_production_input_validation_rejects_wrong_dtype_shape_and_range(self):
        for size in (120, 160):
            dtype = np.int16 if size == 120 else np.int8
            for tensor in (np.zeros((1, size, size, 3), np.float32),
                           np.zeros((size, size, 3), dtype), np.zeros((1, 119, 119, 3), dtype)):
                with self.subTest(size=size, shape=tensor.shape), self.assertRaises(ValueError):
                    self.models.infer(size=size, values=tensor)
        for value in (-129, 128):
            with self.assertRaises(ValueError):
                self.models.infer(size=120, values=np.full((1, 120, 120, 3), value, np.int16))
        self.assertEqual(self.models.calls, [])

    def test_changed_graph_fails_before_owned_state_advances(self):
        core = CandidateCore(models=self.models)
        packet, rgba = fixtures.fixture()
        self.models.graphs[160] += b"changed"
        with self.assertRaisesRegex(ValueError, "identity changed"):
            core.process(packet=packet, rgba=rgba)
        self.assertEqual(self.models.calls, [])
        self.assertIsNone(core.sequence)


class PersistentProtocolTests(unittest.TestCase):
    def setUp(self):
        self.server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.addCleanup(self.server.close)
        self.server.bind(("127.0.0.1", 0))
        self.server.listen(1)
        self.server.settimeout(20)
        self.child = subprocess.Popen([sys.executable, "-B", str(Path(__file__).resolve()),
            "--worker-port", str(self.server.getsockname()[1])], stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1"))
        self.connection = None
        self.addCleanup(self.stop)
        self.connection, _ = self.server.accept()

    def stop(self):
        if self.connection is not None:
            self.connection.close()
        try:
            output, error = self.child.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            self.child.kill()
            output, error = self.child.communicate(timeout=5)
            self.fail(f"synthetic worker exceeded shutdown deadline: {error.decode(errors='replace')}")
        self.assertEqual(self.child.returncode, 0, error.decode(errors="replace"))
        self.assertEqual(output, b"")

    def exchange(self, *, op, data, prediction=0, pixels=b"", token=packets.TOKEN, fragmented=False):
        message = packets.message(op=op, data=data, prediction=prediction)
        message["token"] = token
        if fragmented:
            payload = json.dumps(message, ensure_ascii=False).encode("utf-8")
            raw = wire.HEADER.pack(len(payload), len(pixels)) + payload + pixels
            self.connection.settimeout(5)
            for offset in range(0, len(raw), 997):
                self.connection.sendall(raw[offset:offset + 997])
        else:
            wire.send(connection=self.connection, message=message, pixels=pixels, timeout=5)
        reply, response_pixels = wire.receive(connection=self.connection, timeout=5)
        self.assertEqual(response_pixels, b"")
        return reply

    def predict(self, *, prediction=0, mode="seed-160", value=150, face_id=0, post_detection=False):
        packet, rgba, data, call = packets.dependencies(prediction=prediction, mode=mode,
                                                       value=value, face_id=face_id)
        replies = [self.exchange(op="begin", prediction=prediction, data=dict(owner=packets.OWNER))]
        if call is not None:
            replies.append(self.exchange(op="call", prediction=prediction, data=call))
            replies.append(self.exchange(op="infer", prediction=prediction, data=dict(size=160,
                network=packets.NETWORKS[160], detection_inverse=[[1, 0, 0], [0, 1, 0]])))
        if mode is not None:
            replies.append(self.exchange(op="infer", prediction=prediction, data=dict(size=120,
                network=packets.NETWORKS[120], detection_inverse=None)))
        if post_detection:
            _, _, _, later_call = packets.dependencies(prediction=prediction, value=value)
            replies.append(self.exchange(op="call", prediction=prediction, data=later_call))
            replies.append(self.exchange(op="infer", prediction=prediction, data=dict(size=160,
                network=packets.NETWORKS[160], detection_inverse=[[2, 0, 10], [0, 2, 20]])))
        for reply in replies:
            self.assertIs(reply["reply"]["ok"], True)
        result = self.exchange(op="predict", prediction=prediction, data=data, pixels=rgba.tobytes(), fragmented=True)
        self.assertIs(result["reply"]["ok"], True, result)
        return result, packet, rgba

    def test_persistent_owned_pipeline_32_predictions_and_causal_seed(self):
        reference = CandidateCore(models=fixtures.FakeHeads())
        first_sessions, hashes, counts, cases = None, set(), [], []
        for index in range(32):
            mode = "seed-160" if index == 0 else "update"
            row, packet, rgba = self.predict(prediction=index, mode=mode, value=100 + index,
                                             post_detection=index == 0)
            actual = row["reply"]["result"]
            expected = reference.process(packet=packet, rgba=rgba)
            self.assertEqual(actual["input_tensor_sha256"], expected["input_tensor_sha256"])
            np.testing.assert_array_equal(actual["faces"][0]["points"], expected["faces"][0]["points"])
            self.assertFalse(actual["candidate_parity_verified"])
            self.assertFalse(row["reply"]["stage_ownership"]["live_parity_verified"])
            observation = row["observations"]
            self.assertEqual(observation["pid"], self.child.pid)
            self.assertEqual(observation["providers"], {"120": ["CPUExecutionProvider"], "160": ["CPUExecutionProvider"]})
            if first_sessions is None:
                first_sessions = observation["sessions"]
                self.assertEqual(row["reply"]["initialization_proof"]["excluded_160_inferences"], [1])
            self.assertEqual(first_sessions, observation["sessions"])
            self.assertEqual(row["index"], index)
            hashes.add(actual["input_tensor_sha256"]["120"])
            counts.append(sum(len(heads) for heads in actual["heads"].values()))
            cases.append(dict(prediction=index, tensor_sha256=actual["input_tensor_sha256"],
                normalized_points_sha256=hashlib.sha256(
                    np.asarray(actual["faces"][0]["points"], dtype="<f8").tobytes()).hexdigest()))
        self.assertEqual(len(hashes), 32)
        self.assertEqual([call["size"] for call in observation["calls"]], [160] + [120] * 32)
        EVIDENCE.append(dict(kind="persistent-authored-onnx-worker", predictions=32, heads=sum(counts),
                             unique_120_tensors=len(hashes), sessions_reused=True, causal_extra_160_excluded=True,
                             cases=cases,
                             carrier="test-only-loopback-TCP; production framing and dispatch"))

    def test_no_face_reset_and_reacquisition_preserve_session_but_clear_history(self):
        first, _, _ = self.predict()
        empty, _, _ = self.predict(prediction=1, mode=None)
        self.assertEqual(empty["reply"]["result"]["faces"], [])
        self.assertEqual(empty["observations"]["calls"], first["observations"]["calls"])
        acquired, _, _ = self.predict(prediction=2, face_id=1)
        reset, _, _ = self.predict(prediction=3, mode="reset-120", face_id=1)
        self.assertIsNone(reset["reply"]["initialization_proof"])
        self.assertEqual(first["observations"]["sessions"], reset["observations"]["sessions"])
        self.assertEqual([call["size"] for call in acquired["observations"]["calls"]], [160, 120, 160, 120])
        self.assertEqual(len(reset["observations"]["calls"]), 5)

    def test_bad_token_poison_is_persistent_and_does_not_infer(self):
        rejected = self.exchange(op="begin", data=dict(owner=packets.OWNER), token="wrong-\u4eba")
        self.assertFalse(rejected["reply"]["ok"])
        self.assertEqual(rejected["observations"]["calls"], [])
        retry = self.exchange(op="begin", data=dict(owner=packets.OWNER))
        self.assertIn("poisoned", retry["reply"]["error"])
        self.assertEqual(retry["index"], -1)

    def test_truncated_pixels_do_not_publish_or_advance(self):
        first, _, _ = self.predict()
        _, rgba, data, _ = packets.dependencies(prediction=1, mode="update")
        self.exchange(op="begin", prediction=1, data=dict(owner=packets.OWNER))
        self.exchange(op="infer", prediction=1, data=dict(size=120, network=packets.NETWORKS[120], detection_inverse=None))
        failed = self.exchange(op="predict", prediction=1, data=data, pixels=rgba.tobytes()[:-1])
        self.assertFalse(failed["reply"]["ok"])
        self.assertNotIn("result", failed["reply"])
        self.assertEqual(failed["index"], 0)
        self.assertEqual(failed["observations"]["calls"], first["observations"]["calls"])

    def test_malformed_wire_is_rejected_before_dispatch(self):
        payload = b'{"op":"begin","op":"cancel"}'
        self.connection.sendall(wire.HEADER.pack(len(payload), 0) + payload)
        reply, pixels = wire.receive(connection=self.connection, timeout=5)
        self.assertFalse(reply["ok"])
        self.assertEqual(reply["index"], -1)
        self.assertEqual(pixels, b"")


class RunnerTests(unittest.TestCase):
    def test_zero_missing_skipped_and_expected_failure_tests_cannot_pass(self):
        from check_face_cpu_platform import accepted
        result = unittest.TestResult()
        self.assertFalse(accepted(result=result, expected=0))
        result.testsRun = 1
        self.assertTrue(accepted(result=result, expected=1))
        self.assertFalse(accepted(result=result, expected=2))
        result.skipped.append((self, "unsupported"))
        self.assertFalse(accepted(result=result, expected=1))
        result.skipped.clear()
        result.expectedFailures.append((self, "known failure"))
        self.assertFalse(accepted(result=result, expected=1))

    def test_source_mutation_addition_removal_and_empty_guard_fail_closed(self):
        from check_face_cpu_platform import check_sources
        before = {"source.py": "a" * 64}
        check_sources(before=before, after=dict(before))
        for after in ({}, {"source.py": "b" * 64}, dict(before, added="c" * 64)):
            with self.subTest(after=after), self.assertRaises(ValueError):
                check_sources(before=before, after=after)
        with self.assertRaises(ValueError):
            check_sources(before={}, after={})

    def test_platform_aliases_and_wrong_target_rejection(self):
        from check_face_cpu_platform import check_environment, normalized_machine
        for value, expected in (("AMD64", "x86_64"), ("x64", "x86_64"), ("aarch64", "arm64")):
            self.assertEqual(normalized_machine(value=value), expected)
        with mock.patch("platform.system", return_value="Windows"), self.assertRaisesRegex(ValueError, "system"):
            check_environment(expected_system="Linux")
        with mock.patch("platform.machine", return_value="AMD64"), self.assertRaisesRegex(ValueError, "architecture"):
            check_environment(expected_machine="arm64")

    def test_private_model_configuration_is_rejected_not_silently_skipped(self):
        from check_face_cpu_platform import check_environment
        with mock.patch.dict(os.environ, QCUT_FACE_LIVE_MODEL_ROOT="never-opened"), \
                self.assertRaisesRegex(ValueError, "private model"):
            check_environment()

    def test_existing_reports_are_never_reused_or_rewritten(self):
        from check_face_cpu_platform import run_suite
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "report.json"
            path.write_text("preserved", encoding="utf-8")
            with self.assertRaises(FileExistsError):
                run_suite(out=Path(directory))
            self.assertEqual(path.read_text(encoding="utf-8"), "preserved")

    def test_no_optional_private_test_classes_in_allowlist(self):
        from check_face_cpu_platform import GROUPS, POSIX_GROUPS
        names = [name for group in [*GROUPS.values(), *POSIX_GROUPS.values()] for name in group]
        self.assertEqual(len(names), len(set(names)))
        self.assertFalse(any("RealOnnxTests" in name or "RealWorkerTests" in name for name in names))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker-port", type=int)
    args, remaining = parser.parse_known_args()
    if args.worker_port is not None:
        worker_child(port=args.worker_port)
    else:
        unittest.main(argv=[sys.argv[0], *remaining])
