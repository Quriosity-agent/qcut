"""Owned subprocess cleanup, including a detached live child; no native GPU work."""
import os
import select
import signal
import subprocess
import sys
import time
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
        reused = identity(pid=20, started="different start", executable="/unrelated/process")
        with patch.object(native, "snapshot", side_effect=[{10: self.root, 20: reused},
                {20: reused}, {}, {}]), patch.object(native.os, "getpgid", return_value=999), \
                patch.object(native.os, "killpg") as group, patch.object(native.os, "kill") as kill:
            tree.terminate()
        group.assert_not_called()
        kill.assert_not_called()
        self.process.kill.assert_called_once()
        self.process.wait.assert_called_once_with(timeout=10)

    def test_descendant_exec_fails_cleanup_without_individual_or_group_signal(self):
        with patch.object(native, "snapshot", return_value={10: self.root, 20: self.child, 30: self.grandchild}):
            tree = native.ProcessTree(process=self.process)
        replacement = identity(pid=20, parent=10, executable="/owned/exec-child")
        current = {10: self.root, 20: replacement, 30: self.grandchild}
        self.process.kill.side_effect = lambda: current.pop(10, None)
        with patch.object(native, "snapshot", side_effect=lambda: dict(current)), \
                patch.object(native.os, "getpgid", return_value=10), \
                patch.object(native.os, "killpg") as group, \
                patch.object(native.os, "kill", side_effect=lambda pid, sig: current.pop(pid)) as kill:
            with self.assertRaisesRegex(RuntimeError, r"ambiguous descendant identities during cleanup: \[20\]"):
                tree.terminate()
        group.assert_not_called()
        kill.assert_called_once_with(30, signal.SIGKILL)
        self.assertEqual(current, {20: replacement})
        self.assertEqual(tree.owned[20], self.child)
        self.process.kill.assert_called_once()
        self.process.wait.assert_called_once_with(timeout=10)

    def test_descendant_exec_before_individual_signal_is_not_silently_lost(self):
        initial = {10: self.root, 20: self.child}
        with patch.object(native, "snapshot", return_value=initial):
            tree = native.ProcessTree(process=self.process)
        replacement = identity(pid=20, executable="/owned/exec-child")
        with patch.object(native, "snapshot", side_effect=[initial, {20: replacement}, {}, {}]), \
                patch.object(native.os, "getpgid", return_value=999), \
                patch.object(native.os, "killpg") as group, patch.object(native.os, "kill") as kill:
            with self.assertRaisesRegex(RuntimeError, r"ambiguous descendant identities during cleanup: \[20\]"):
                tree.terminate()
        group.assert_not_called()
        kill.assert_not_called()
        self.process.wait.assert_called_once_with(timeout=10)

    def test_descendant_exec_during_final_verification_fails_cleanup(self):
        initial = {10: self.root, 20: self.child}
        with patch.object(native, "snapshot", return_value=initial):
            tree = native.ProcessTree(process=self.process)
        replacement = identity(pid=20, executable="/owned/exec-child")
        with patch.object(native, "snapshot", side_effect=[initial, {20: self.child}, {}, {20: replacement}]), \
                patch.object(native.os, "getpgid", return_value=999), \
                patch.object(native.os, "killpg") as group, patch.object(native.os, "kill") as kill:
            with self.assertRaisesRegex(RuntimeError, r"ambiguous descendant identities during cleanup: \[20\]"):
                tree.terminate()
        group.assert_not_called()
        kill.assert_called_once_with(20, signal.SIGKILL)
        self.process.wait.assert_called_once_with(timeout=10)

    def test_zombie_descendant_with_changed_executable_is_not_a_live_survivor(self):
        with patch.object(native, "snapshot", return_value={10: self.root, 20: self.child}):
            tree = native.ProcessTree(process=self.process)
        zombie = identity(pid=20, executable="<defunct>", state="Z")
        with patch.object(native, "snapshot", side_effect=[{10: self.root, 20: zombie}, {20: zombie}, {}, {20: zombie}]), \
                patch.object(native.os, "getpgid", return_value=999), \
                patch.object(native.os, "killpg") as group, patch.object(native.os, "kill") as kill:
            tree.terminate()
        group.assert_not_called()
        kill.assert_not_called()
        self.process.wait.assert_called_once_with(timeout=10)

    def test_live_root_exec_discovers_and_cleans_detached_descendants(self):
        with patch.object(native, "snapshot", return_value={10: self.root}):
            tree = native.ProcessTree(process=self.process)
        replacement = identity(pid=10, executable="/owned/lldb")
        current = {10: replacement, 20: self.child, 30: self.grandchild, 40: identity(pid=40)}
        self.process.kill.side_effect = lambda: current.pop(10, None)
        with patch.object(native, "snapshot", side_effect=lambda: dict(current)), \
                patch.object(native.os, "getpgid", return_value=10), \
                patch.object(native.os, "killpg") as group, \
                patch.object(native.os, "kill", side_effect=lambda pid, sig: current.pop(pid)) as kill:
            tree.terminate()
        self.assertEqual(tree.owned[10], replacement)
        self.assertEqual(set(tree.owned), {10, 20, 30})
        group.assert_called_once_with(10, signal.SIGKILL)
        self.assertEqual([call.args for call in kill.call_args_list], [(30, signal.SIGKILL), (20, signal.SIGKILL)])
        self.assertEqual(set(current), {40})

    def test_reaped_root_cannot_adopt_new_executable_or_children(self):
        with patch.object(native, "snapshot", return_value={10: self.root}):
            tree = native.ProcessTree(process=self.process)
        self.process.poll.return_value = 0
        replacement = identity(pid=10, executable="/unrelated/process")
        with patch.object(native, "snapshot", return_value={10: replacement, 20: self.child}), \
                patch.object(native.os, "killpg") as group, patch.object(native.os, "kill") as kill:
            tree.terminate()
        self.assertEqual(tree.owned, {10: self.root})
        group.assert_not_called()
        kill.assert_not_called()

    def test_changed_root_start_time_is_not_an_exec_transition(self):
        with patch.object(native, "snapshot", return_value={10: self.root}):
            tree = native.ProcessTree(process=self.process)
        replacement = identity(pid=10, started="different birth", executable="/owned/lldb")
        with patch.object(native, "snapshot", return_value={10: replacement, 20: self.child}), \
                patch.object(native.os, "killpg") as group, patch.object(native.os, "kill") as kill:
            tree.terminate()
        self.assertEqual(tree.owned, {10: self.root})
        group.assert_not_called()
        kill.assert_not_called()

    def test_root_exec_does_not_relax_descendant_identity_guards(self):
        for replacement in (identity(pid=20, parent=10, executable="/unrelated/process"),
                            identity(pid=20, parent=10, started="different birth")):
            with self.subTest(replacement=replacement):
                with patch.object(native, "snapshot", return_value={10: self.root, 20: self.child}):
                    tree = native.ProcessTree(process=self.process)
                current = {10: identity(pid=10, executable="/owned/lldb"), 20: replacement, 30: self.grandchild}
                with patch.object(native, "snapshot", return_value=current):
                    tree.refresh()
                self.assertEqual(tree.owned[20], self.child)
                self.assertNotIn(30, tree.owned)

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
    def test_root_exec_keeps_detached_child_cleanup_owned(self):
        script = ("import subprocess,sys; "
                  "child=subprocess.Popen([sys.executable,'-B','-c','import time; time.sleep(30)'],"
                  "start_new_session=True,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL); "
                  "print(child.pid,flush=True); sys.stdin.readline()")
        process = subprocess.Popen(["/bin/sh", "-c", 'read -r ready; exec "$@"', "exec-root-test",
                                    sys.executable, "-B", "-c", script],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, start_new_session=True)
        tree, child_identity = None, None
        try:
            tree = native.ProcessTree(process=process)
            before = tree.owned[process.pid]
            process.stdin.write("go\n")
            process.stdin.flush()
            self.assertTrue(select.select([process.stdout], [], [], 5)[0], "exec child did not become ready")
            child_pid = int(process.stdout.readline())
            current = native.snapshot()
            child_identity = current[child_pid]
            self.assertEqual(child_identity.parent, process.pid)
            self.assertNotEqual(before.executable, current[process.pid].executable)
            self.assertEqual(before.started, current[process.pid].started)
            tree.refresh()
            self.assertEqual(tree.owned[process.pid].executable, current[process.pid].executable)
            self.assertIn(child_pid, tree.owned)
            self.assertEqual(os.getpgid(child_pid), child_pid)
            tree.terminate()
            self.assertIsNotNone(process.returncode)
            remaining = native.snapshot().get(child_pid)
            self.assertTrue(remaining is None or remaining.state.startswith("Z"))
        finally:
            try:
                if tree is not None:
                    tree.terminate()
            finally:
                if child_identity is not None:
                    current = native.snapshot().get(child_identity.pid)
                    if current is not None and child_identity.matches(other=current):
                        try:
                            os.kill(child_identity.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                        deadline = time.monotonic() + 3
                        while time.monotonic() < deadline:
                            current = native.snapshot().get(child_identity.pid)
                            if current is None or current.state.startswith("Z"):
                                break
                            time.sleep(0.05)
                process.kill()
                process.wait(timeout=5)
                process.stdin.close()
                process.stdout.close()

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
