"""Strict per-frame comparisons and host protocol failure handling."""

from __future__ import annotations

import io
import queue
import unittest
from unittest.mock import Mock

import face_render_stability_probe as probe


class FrameMetricsTest(unittest.TestCase):
    def test_identical_frame(self):
        pixels = bytes([10, 20, 30, 255] * 6)
        result = probe.frame_metrics(actual=pixels, reference=pixels, width=3, height=2)
        self.assertTrue(result["equal"])
        self.assertEqual(result["changed_pixels"], 0)
        self.assertEqual(result["max_delta"], 0)
        self.assertIsNone(result["bbox"])

    def test_signed_difference_does_not_wrap(self):
        result = probe.frame_metrics(actual=bytes([0, 1, 2, 255]),
                                     reference=bytes([255, 1, 2, 255]), width=1, height=1)
        self.assertFalse(result["equal"])
        self.assertEqual(result["max_delta"], 255)

    def test_alpha_only_failure(self):
        result = probe.frame_metrics(actual=bytes([0, 0, 0, 0]),
                                     reference=bytes([0, 0, 0, 255]), width=1, height=1)
        self.assertEqual(result["changed_pixels"], 1)
        self.assertEqual(result["bbox"], [0, 0, 1, 1])

    def test_partial_row_failure(self):
        reference = bytes([0, 0, 0, 255] * 6)
        actual = bytearray(reference)
        actual[16] = 42
        actual[20] = 42
        result = probe.frame_metrics(actual=bytes(actual), reference=reference, width=3, height=2)
        self.assertEqual(result["changed_pixels"], 2)
        self.assertEqual(result["bbox"], [1, 1, 3, 2])

    def test_wrong_length(self):
        for actual, reference in ((b"123", b"1234"), (b"1234", b"123")):
            with self.subTest(actual=actual), self.assertRaisesRegex(ValueError, "byte count"):
                probe.frame_metrics(actual=actual, reference=reference, width=1, height=1)

    def test_changed_hash(self):
        self.assertNotEqual(probe.digest(data=b"a"), probe.digest(data=b"b"))


class CountsTest(unittest.TestCase):
    def test_cold_start_and_upper_bounds(self):
        probe.validate_counts(frames=1, warmup=0)
        probe.validate_counts(frames=1024, warmup=100)

    def test_invalid_frame_counts(self):
        for count in (0, -1, 1025, True, 1.0, "1"):
            with self.subTest(count=count), self.assertRaisesRegex(ValueError, "frame count"):
                probe.validate_counts(frames=count, warmup=0)

    def test_invalid_warmup_counts(self):
        for count in (-1, 101, True, 1.0, "1"):
            with self.subTest(count=count), self.assertRaisesRegex(ValueError, "warmup"):
                probe.validate_counts(frames=1, warmup=count)


class ProtocolTest(unittest.TestCase):
    def test_ready(self):
        probe.protocol_row(row="QCUT\tREADY\t1", request_id=None)

    def test_success(self):
        probe.protocol_row(row="QCUT\tRESULT\tframe-7\t0", request_id="frame-7")

    def test_rejects_wrong_id_errors_extra_fields_and_unexpected_ready(self):
        for row in (
            "QCUT\tRESULT\tframe-6\t0", "QCUT\tRESULT\tframe-7\t1\tfailed",
            "QCUT\tRESULT\tframe-7\t0\textra", "QCUT\tREADY\t1", "QCUT\tRESULT",
        ):
            with self.subTest(row=row), self.assertRaises(RuntimeError):
                probe.protocol_row(row=row, request_id="frame-7")

    def test_eof_is_not_success(self):
        host = probe.NativeHost.__new__(probe.NativeHost)
        host.rows = queue.Queue()
        host.rows.put(None)
        with self.assertRaisesRegex(RuntimeError, "stopped"):
            host.receive(request_id="frame-0")

    def test_reader_error_is_not_success(self):
        host = probe.NativeHost.__new__(probe.NativeHost)
        host.rows = queue.Queue()
        error = OSError("log write failed")
        host.rows.put(error)
        with self.assertRaises(RuntimeError) as failure:
            host.receive(request_id="frame-0")
        self.assertIs(failure.exception.__cause__, error)

    def test_timeout_is_not_success(self):
        host = probe.NativeHost.__new__(probe.NativeHost)
        host.rows = Mock()
        host.rows.get.side_effect = queue.Empty
        with self.assertRaisesRegex(RuntimeError, "timed out"):
            host.receive(request_id="frame-0")
        host.rows.get.assert_called_once_with(timeout=60)

    def test_extra_response_at_exit_is_rejected(self):
        host = probe.NativeHost.__new__(probe.NativeHost)
        host.process = Mock(stdin=io.StringIO())
        host.process.wait.return_value = 0
        host.thread = Mock()
        host.thread.is_alive.return_value = False
        host.rows = queue.Queue()
        host.rows.put("QCUT\tRESULT\textra\t0")
        with self.assertRaisesRegex(RuntimeError, "exit cleanly"):
            host.finish()

    def test_abnormal_native_exit_is_rejected(self):
        host = probe.NativeHost.__new__(probe.NativeHost)
        host.process = Mock(stdin=io.StringIO())
        host.process.wait.return_value = -6
        host.thread = Mock()
        host.thread.is_alive.return_value = False
        host.rows = queue.Queue()
        host.rows.put(None)
        with self.assertRaisesRegex(RuntimeError, "exit cleanly"):
            host.finish()


if __name__ == "__main__":
    unittest.main()
