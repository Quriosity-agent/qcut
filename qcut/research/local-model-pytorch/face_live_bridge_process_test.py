"""CPU subprocess-only lifecycle tests; no native host or debugger launches."""
from __future__ import annotations

from pathlib import Path
import signal
import sys
import tempfile
import unittest
from unittest import mock

from face_live_bridge_process import ProcessScope, cancellation_signals, output_budget


class ProcessScopeTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="qcut-live-process-", dir="/tmp")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def spawn(self, *, scope, code="print('cpu-only')", name="child.log"):
        return scope.spawn(command=[sys.executable, "-B", "-c", code], environment={}, stdout=self.root / name)

    def test_real_cpu_child_finishes_and_shared_cleanup_reaps(self):
        with ProcessScope(directory=self.root) as scope:
            child = self.spawn(scope=scope)
            self.assertEqual(scope.wait(process=child, timeout=3)["returncode"], 0)
        self.assertTrue(scope.cleanup["completed"])
        self.assertIsNotNone(child.poll())
        self.assertIn("cpu-only", (self.root / "child.log").read_text())

    def test_timeout_kills_and_reaps_actual_cpu_child(self):
        scope = ProcessScope(directory=self.root)
        with self.assertRaises(TimeoutError), scope:
            child = self.spawn(scope=scope, code="import time; time.sleep(30)")
            scope.wait(process=child, timeout=0.1)
        self.assertTrue(scope.cleanup["completed"])
        self.assertIsNotNone(child.poll())

    def test_failed_child_never_passes_and_is_reaped(self):
        with self.assertRaisesRegex(RuntimeError, "code 7"), ProcessScope(directory=self.root) as scope:
            child = self.spawn(scope=scope, code="raise SystemExit(7)")
            scope.wait(process=child, timeout=3)
        self.assertTrue(scope.cleanup["completed"])

    def test_uses_shared_tree_during_poll_readiness_and_finally(self):
        tree = mock.Mock()
        with mock.patch("face_live_bridge_process.ProcessTree", return_value=tree) as factory:
            scope = ProcessScope(directory=self.root)
            with scope:
                child = self.spawn(scope=scope)
                tree.process = child
                scope.until(predicate=lambda: True, process=child, timeout=1)
                scope.wait(process=child, timeout=3)
            factory.assert_called_once_with(process=child)
            self.assertGreater(tree.refresh.call_count, 0)
            tree.terminate.assert_called_once()

    def test_cleanup_failure_preserved_and_other_roots_still_cleaned(self):
        scope = ProcessScope(directory=self.root)
        bad, good = mock.Mock(), mock.Mock()
        bad.process.pid, good.process.pid = 101, 102
        bad.terminate.side_effect = RuntimeError("identity inventory unavailable")
        scope.trees = [good, bad]
        result = scope.close()
        self.assertFalse(result["completed"])
        good.terminate.assert_called_once()
        self.assertIn("identity inventory unavailable", result["failures"][0])

    def test_companion_exit_aborts_readiness(self):
        scope = ProcessScope(directory=self.root)
        process = mock.Mock()
        process.poll.return_value = 1
        with self.assertRaisesRegex(RuntimeError, "companion exited"):
            scope.until(predicate=lambda: False, process=process, timeout=1)

    def test_readiness_deadline_and_invalid_process_deadline(self):
        scope = ProcessScope(directory=self.root)
        process = mock.Mock()
        process.poll.return_value = None
        with self.assertRaises(TimeoutError):
            scope.until(predicate=lambda: False, process=process, timeout=0.01)
        for timeout in (0, -1, 301):
            with self.subTest(timeout=timeout), self.assertRaises(ValueError):
                scope.wait(process=process, timeout=timeout)

    def test_sigterm_becomes_cancellation_and_handler_restored(self):
        previous = signal.getsignal(signal.SIGTERM)
        with self.assertRaises(KeyboardInterrupt), cancellation_signals():
            signal.getsignal(signal.SIGTERM)(signal.SIGTERM, None)
        self.assertIs(signal.getsignal(signal.SIGTERM), previous)

    def test_output_limit_and_symlink_rejected(self):
        path = self.root / "large.log"
        with path.open("wb") as stream:
            stream.truncate(4 * 1024**2 + 1)
        with self.assertRaisesRegex(RuntimeError, "4 MiB"):
            output_budget(directory=self.root)
        path.unlink()
        (self.root / "link").symlink_to(self.root)
        with self.assertRaisesRegex(RuntimeError, "symlinks"):
            output_budget(directory=self.root)


if __name__ == "__main__":
    unittest.main()
