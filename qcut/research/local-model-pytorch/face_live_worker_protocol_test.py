"""Bounded socket and worker-service tests; no native processes or GPU use."""
from __future__ import annotations

import io
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

import face_live_candidate_test as fixtures
import face_live_worker_protocol as protocol
import face_live_worker_test as packets
from face_live_worker import LiveWorker, serve


class FramingTests(unittest.TestCase):
    def test_debugger_import_works_without_site_packages(self):
        result = subprocess.run([sys.executable, "-S", "-c",
            "import sys; import face_live_bridge_lldb; "
            "assert 'numpy' not in sys.modules; "
            "assert 'face_alignment_replay' not in sys.modules"],
            cwd=Path(__file__).resolve().parent, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_real_socket_roundtrip_preserves_binary_pixels(self):
        sender, receiver = socket.socketpair()
        with sender, receiver:
            message = dict(op="predict", text="frame", value=42)
            pixels = bytes(range(256)) * 3
            protocol.send(connection=sender, message=message, pixels=pixels)
            self.assertEqual(protocol.receive(connection=receiver, timeout=1), (message, pixels))

    def test_short_reads_reassemble_header_json_and_pixels(self):
        data = json.dumps(dict(ok=True)).encode()
        stream = io.BytesIO(protocol.HEADER.pack(len(data), 4) + data + b"RGBA")
        connection = mock.Mock()
        connection.recv.side_effect = lambda size: stream.read(min(size, 2))
        self.assertEqual(protocol.receive(connection=connection, timeout=1), (dict(ok=True), b"RGBA"))

    def test_eof_at_each_frame_segment_rejected(self):
        complete = protocol.HEADER.pack(2, 4) + b"{}RGBA"
        for length in (0, 1, 7, 8, 9, 10, 12, 13):
            with self.subTest(length=length):
                sender, receiver = socket.socketpair()
                with sender, receiver:
                    sender.sendall(complete[:length])
                    sender.shutdown(socket.SHUT_WR)
                    with self.assertRaises(EOFError):
                        protocol.receive(connection=receiver, timeout=1)

    def test_oversize_lengths_rejected_before_payload_read(self):
        for json_size, pixels_size in ((0, 0), (protocol.JSON_LIMIT + 1, 0), (2, protocol.PIXEL_LIMIT + 1)):
            with self.subTest(json_size=json_size, pixels_size=pixels_size):
                connection = mock.Mock()
                connection.recv.return_value = protocol.HEADER.pack(json_size, pixels_size)
                with self.assertRaises(ValueError):
                    protocol.receive(connection=connection, timeout=1)
                connection.recv.assert_called_once_with(protocol.HEADER.size)

    def test_json_duplicates_nan_scalar_and_truncated_json_rejected(self):
        for data in (b'{"a":1,"a":2}', b'{"x":NaN}', b'{"x":[1e999]}', b'{"x":-Infinity}',
                     b'{"nested":{"a":1,"a":2}}', b"[]", b"1", b"null", b"{", b"\xff",
                     '{"x":1}'.encode("utf-16")):
            with self.subTest(data=data):
                sender, receiver = socket.socketpair()
                with sender, receiver:
                    sender.sendall(protocol.HEADER.pack(len(data), 0) + data)
                    with self.assertRaises(ValueError):
                        protocol.receive(connection=receiver, timeout=1)

    def test_real_socket_timeout_is_bounded(self):
        sender, receiver = socket.socketpair()
        with sender, receiver:
            start = time.monotonic()
            with self.assertRaises(TimeoutError):
                protocol.receive(connection=receiver, timeout=0.03)
            self.assertLess(time.monotonic() - start, 1)

    def test_single_receive_deadline_not_reset_by_partial_data(self):
        connection = mock.Mock()
        connection.recv.return_value = b"x"
        with mock.patch.object(protocol.time, "monotonic", side_effect=[0.1, 0.3, 1.1]):
            with self.assertRaises(TimeoutError):
                protocol.receive_exact(connection=connection, count=3, deadline=1)
        self.assertEqual(connection.recv.call_count, 2)

    def test_send_rejects_invalid_payload_before_writing(self):
        for message, pixels in ((dict(value=float("nan")), b""),
                                (dict(value="x" * protocol.JSON_LIMIT), b""),
                                ({}, b"x" * (protocol.PIXEL_LIMIT + 1))):
            with self.subTest(size=len(pixels)):
                connection = mock.Mock()
                with self.assertRaises(ValueError):
                    protocol.send(connection=connection, message=message, pixels=pixels)
                connection.sendall.assert_not_called()


class WorkerServiceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="qcut-live-test-", dir="/tmp")
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "worker.sock"
        self.worker = LiveWorker(models=fixtures.FakeHeads(), token=packets.TOKEN,
                                 source_key="synthetic-worker-source")
        self.log, self.errors = io.StringIO(), []
        self.ready = threading.Event()

    def start(self, *, timeout=2):
        def run():
            try:
                serve(worker=self.worker, path=self.path, log=self.log, timeout=timeout)
            except Exception as error:
                self.errors.append(error)

        patch = mock.patch("face_live_worker.print", side_effect=lambda *args, **kwargs: self.ready.set(), create=True)
        patch.start()
        self.addCleanup(patch.stop)
        self.thread = threading.Thread(target=run, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop)
        self.assertTrue(self.ready.wait(2), self.errors)
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)

    def stop(self):
        if self.thread.is_alive() and self.path.exists():
            try:
                protocol.exchange(path=self.path, message=packets.message(op="cancel", data={}), timeout=0.2)
            except (OSError, RuntimeError, ValueError):
                pass
        self.thread.join(timeout=3)
        self.assertFalse(self.thread.is_alive(), "worker service did not stop")

    def exchange(self, *, op, data, pixels=b"", prediction=0):
        return protocol.exchange(path=self.path, message=packets.message(op=op, data=data, prediction=prediction),
                                 pixels=pixels, timeout=1)

    def test_service_persistent_predictions_and_cancel(self):
        self.start()
        for index in range(2):
            _, rgba, data, _ = packets.dependencies(prediction=index, mode="reset-120", value=100 + index)
            self.exchange(op="begin", data=dict(owner=packets.OWNER), prediction=index)
            self.exchange(op="infer", prediction=index,
                          data=dict(size=120, network=packets.NETWORKS[120], detection_inverse=None))
            reply = self.exchange(op="predict", prediction=index, data=data, pixels=rgba.tobytes())
            self.assertTrue(reply["ok"])
            self.assertEqual(reply["prediction"], index)
            self.assertEqual(len(reply["result"]["faces"][0]["points"]), 106)
        self.stop()
        self.assertEqual(self.errors, [])
        self.assertFalse(self.path.exists())
        rows = [json.loads(line) for line in self.log.getvalue().splitlines()]
        self.assertEqual([row["prediction"] for row in rows], [0, 1])
        self.assertNotIn("pixels", self.log.getvalue())
        self.assertIsNotNone(self.worker.error)

    def test_service_malformed_request_poison_and_socket_cleanup(self):
        self.start()
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.connect(str(self.path))
            data = b'{"op":"begin","op":"cancel"}'
            client.sendall(protocol.HEADER.pack(len(data), 0) + data)
            reply, pixels = protocol.receive(connection=client, timeout=1)
            self.assertFalse(reply["ok"])
            self.assertEqual(pixels, b"")
        self.thread.join(timeout=2)
        self.assertFalse(self.thread.is_alive())
        self.assertIsNotNone(self.worker.error)
        self.assertIsNone(self.worker.core.sequence)
        self.assertFalse(self.path.exists())

    def test_idle_deadline_closes_socket(self):
        self.start(timeout=0.03)
        self.thread.join(timeout=1)
        self.assertFalse(self.thread.is_alive())
        self.assertTrue(any(isinstance(error, TimeoutError) for error in self.errors))
        self.assertFalse(self.path.exists())

    def test_existing_socket_path_is_not_removed(self):
        self.path.write_text("existing user file")
        with self.assertRaises(ValueError):
            serve(worker=self.worker, path=self.path, log=self.log, timeout=1)
        self.assertEqual(self.path.read_text(), "existing user file")

    def test_exchange_rejects_non_boolean_ok_and_reply_pixels(self):
        for response, pixels in ((dict(ok=1), b""), (dict(ok=True), b"x"), (dict(ok=False, error="cancelled"), b"")):
            with self.subTest(response=response, pixels=pixels):
                with mock.patch.object(protocol.socket, "socket"), mock.patch.object(protocol, "send"), \
                        mock.patch.object(protocol, "receive", return_value=(response, pixels)):
                    with self.assertRaises(RuntimeError):
                        protocol.exchange(path=self.path, message={})


if __name__ == "__main__":
    unittest.main()
