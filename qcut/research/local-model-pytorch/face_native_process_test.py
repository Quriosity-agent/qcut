"""Owned subprocess cleanup, including a detached live child; no native GPU work."""
import subprocess
import sys
import unittest
from unittest.mock import Mock, patch

import face_native_process as native


def identity(*, pid, parent=1, started="Sun Oct 4 10:00:00 2026", executable="/owned/host", state="S"):
    return native.ProcessIdentity(pid, parent, state, started, executable)


class SnapshotTests(unittest.TestCase):
    def test_spaces_in_executable_and_process_state(self):
        result = native.parse_snapshot(text=" 12 1 Ss Sun Oct  4 10:00:00 2026 /owned/path with spaces/host\n")
        self.assertEqual(result[12], identity(pid=12, executable="/owned/path with spaces/host", state="Ss"))

    def test_malformed_duplicate_and_oversized_rejected(self):
        row = "12 1 S Sun Oct 4 10:00:00 2026 /owned/host\n"
        for text in ("bad", row + row, row.replace("12 1", "0 1"), "x" * (8 * 1024**2 + 1)):
            with self.subTest(text=text[:30]), self.assertRaises(ValueError):
                native.parse_snapshot(text=text)


class TreeTests(unittest.TestCase):
    def setUp(self):
        self.process = Mock(pid=10, args=["owned"])
        self.process.poll.return_value = None
        self.root = identity(pid=10)
        self.child = identity(pid=20, parent=10)
        self.grandchild = identity(pid=30, parent=20)

    def test_tracks_detached_reparented_children_but_not_pid_reuse(self):
        current = {10: self.root, 20: self.child, 30: self.grandchild, 40: identity(pid=40)}
        with patch.object(native, "snapshot", return_value=current):
            tree = native.ProcessTree(process=self.process)
        self.assertEqual(set(tree.owned), {10, 20, 30})
        current = {20: identity(pid=20), 30: identity(pid=30, started="new birth"),
                   31: identity(pid=31, parent=30), 21: identity(pid=21, parent=20)}
        with patch.object(native, "snapshot", return_value=current):
            tree.refresh()
        self.assertIn(21, tree.owned)
        self.assertNotIn(31, tree.owned)

    def test_cleanup_does_not_signal_reused_pid_or_unrelated_group(self):
        with patch.object(native, "snapshot", return_value={10: self.root, 20: self.child}):
            tree = native.ProcessTree(process=self.process)
        reused = identity(pid=20, started="different start")
        with patch.object(native, "snapshot", side_effect=[{10: self.root, 20: reused},
                {20: reused}, {}, {}]), patch.object(native.os, "getpgid", return_value=999), \
                patch.object(native.os, "killpg") as group, patch.object(native.os, "kill") as kill:
            tree.terminate()
        group.assert_not_called()
        kill.assert_not_called()
        self.process.kill.assert_called_once()
        self.process.wait.assert_called_once_with(timeout=10)

    def test_wait_timeout_keeps_observed_descendants_for_cleanup(self):
        with patch.object(native, "snapshot", return_value={10: self.root, 20: self.child}):
            tree = native.ProcessTree(process=self.process)
            with self.assertRaises(subprocess.TimeoutExpired):
                tree.wait(timeout=0)
        self.assertIn(20, tree.owned)

    def test_normal_exit(self):
        with patch.object(native, "snapshot", return_value={10: self.root}):
            tree = native.ProcessTree(process=self.process)
            self.process.poll.return_value = 7
            self.assertEqual(tree.wait(timeout=1), 7)

    def test_initial_snapshot_failure_reaps_owned_root(self):
        with patch.object(native, "snapshot", side_effect=OSError("ps unavailable")):
            with self.assertRaises(OSError):
                native.ProcessTree(process=self.process)
        self.process.kill.assert_called_once()
        self.process.wait.assert_called_once_with(timeout=10)

    def test_cleanup_snapshot_failure_still_reaps_root_and_reports_failure(self):
        with patch.object(native, "snapshot", return_value={10: self.root}):
            tree = native.ProcessTree(process=self.process)
        with patch.object(native, "snapshot", side_effect=OSError("ps unavailable")):
            with self.assertRaises(OSError):
                tree.terminate()
        self.process.kill.assert_called_once()
        self.process.wait.assert_called_once_with(timeout=10)


class RealProcessTests(unittest.TestCase):
    def test_detached_child_is_reaped_after_debugger_like_parent_exits(self):
        child = "import time; time.sleep(30)"
        script = ("import subprocess,sys,time; "
                  f"p=subprocess.Popen([sys.executable,'-c',{child!r}],start_new_session=True); "
                  "print(p.pid,flush=True); time.sleep(0.8)")
        process = subprocess.Popen([sys.executable, "-c", script], stdout=subprocess.PIPE,
                                   text=True, start_new_session=True)
        tree = native.ProcessTree(process=process)
        try:
            child_pid = int(process.stdout.readline())
            self.assertEqual(tree.wait(timeout=5), 0)
            self.assertIn(child_pid, tree.owned)
            tree.terminate()
            remaining = native.snapshot().get(child_pid)
            self.assertTrue(remaining is None or remaining.state.startswith("Z"))
        finally:
            tree.terminate()
            process.stdout.close()


if __name__ == "__main__":
    unittest.main()
