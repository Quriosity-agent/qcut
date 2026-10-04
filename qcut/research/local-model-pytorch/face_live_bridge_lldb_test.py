"""Bounded read-only stop diagnostics; no debugger or native launch required."""
import unittest
from unittest import mock

from face_live_bridge_lldb import process_diagnostics


class StopDiagnosticsTests(unittest.TestCase):
    def process(self, *, reason=5):
        frame = mock.Mock()
        frame.GetPC.return_value = 4096
        frame.GetFunctionName.return_value = "native_function"
        thread = mock.Mock()
        thread.GetStopReason.return_value = reason
        thread.GetThreadID.return_value = 7
        thread.GetStopDescription.return_value = "EXC_BAD_ACCESS"
        thread.GetNumFrames.return_value = 2
        thread.GetFrameAtIndex.return_value = frame
        process = mock.Mock()
        process.GetProcessID.return_value = 123
        process.GetState.return_value = 5
        process.GetExitStatus.return_value = -1
        process.GetNumThreads.return_value = 1
        process.GetThreadAtIndex.return_value = thread
        return process, thread, frame

    def test_preserves_original_stop_before_cleanup_kill(self):
        process, thread, frame = self.process()
        result = process_diagnostics(process=process)
        self.assertEqual(result["state"], 5)
        self.assertEqual(result["exit_status"], -1)
        self.assertEqual(result["unexpected_stops"], [dict(thread=7, reason=5,
            description="EXC_BAD_ACCESS", frames=[dict(pc=4096, symbol="native_function")] * 2)])
        thread.GetStopDescription.assert_called_once_with(1024)
        process.Kill.assert_not_called()
        process.Continue.assert_not_called()
        frame.EvaluateExpression.assert_not_called()

    def test_bounded_threads_frames_and_symbol(self):
        process, thread, frame = self.process()
        process.GetNumThreads.return_value = 10000
        thread.GetNumFrames.return_value = 10000
        frame.GetFunctionName.return_value = "x" * 2000
        result = process_diagnostics(process=process)
        self.assertEqual(len(result["unexpected_stops"]), 8)
        self.assertEqual(process.GetThreadAtIndex.call_count, 8)
        for row in result["unexpected_stops"]:
            self.assertEqual(len(row["frames"]), 8)
            self.assertEqual(len(row["frames"][0]["symbol"]), 512)

    def test_no_stop_does_not_read_stack_and_missing_symbol_is_safe(self):
        process, thread, frame = self.process(reason=0)
        self.assertEqual(process_diagnostics(process=process)["unexpected_stops"], [])
        thread.GetFrameAtIndex.assert_not_called()
        thread.GetStopReason.return_value = 5
        frame.GetFunctionName.return_value = None
        self.assertEqual(process_diagnostics(process=process)["unexpected_stops"][0]["frames"][0]["symbol"], "")


if __name__ == "__main__":
    unittest.main()
