"""Failure receipts for disconnected local callers, without native inference."""
from __future__ import annotations

import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from face_live_candidate_test import FakeHeads
from face_live_worker import LiveWorker, serve


class ServerFailureTests(unittest.TestCase):
    def run_failure(self, *, receive_error=None, dispatch_error=None, send_error=None):
        worker = LiveWorker(models=FakeHeads(), token="synthetic-test-token", source_key="test")
        connection = mock.MagicMock()
        connection.__enter__.return_value = connection
        server = mock.MagicMock()
        server.__enter__.return_value = server
        server.accept.return_value = (connection, None)
        log = io.StringIO()
        with tempfile.TemporaryDirectory(prefix="fw-") as root:
            path = Path(root) / "socket"
            with mock.patch("face_live_worker.socket.socket", return_value=server), \
                    mock.patch("face_live_worker.os.chmod"), \
                    mock.patch("face_live_worker.receive", return_value=({"op": "predict"}, b""),
                               side_effect=receive_error), \
                    mock.patch.object(worker, "dispatch", side_effect=dispatch_error), \
                    mock.patch("face_live_worker.send", side_effect=send_error) as send:
                serve(worker=worker, path=path, log=log, timeout=1)
                self.assertFalse(path.exists())
        server.accept.assert_called_once()
        return worker, [json.loads(line) for line in log.getvalue().splitlines()], send

    def test_truncated_frame_preserves_original_error_when_reply_is_closed(self):
        worker, rows, send = self.run_failure(receive_error=EOFError("truncated live worker frame"),
                                             send_error=BrokenPipeError("disconnected"))
        self.assertEqual(worker.error, "EOFError: truncated live worker frame")
        self.assertEqual(rows, [dict(ok=False, error=worker.error)])
        send.assert_called_once()

    def test_dispatch_failure_is_logged_and_sent_without_raw_request(self):
        worker, rows, send = self.run_failure(dispatch_error=ValueError("unsupported live route"))
        self.assertEqual(rows, [dict(ok=False, error="ValueError: unsupported live route")])
        self.assertEqual(send.call_args.kwargs["message"], rows[0])
        self.assertEqual(send.call_args.kwargs["timeout"], 1)
        self.assertIsNotNone(worker.error)

    def test_reply_timeout_keeps_failure_receipt_and_poisoned_state(self):
        worker, rows, _ = self.run_failure(receive_error=ValueError("invalid frame"),
                                           send_error=TimeoutError("reply deadline"))
        self.assertEqual(worker.error, "ValueError: invalid frame")
        self.assertEqual(len(rows), 1)
        with self.assertRaisesRegex(RuntimeError, "poisoned"):
            worker.dispatch(message={})


if __name__ == "__main__":
    unittest.main()
