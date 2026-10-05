"""Offline debugger-selection contracts; never execute fixture binaries."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

import face_live_bridge_bundle as bundle
import face_live_debugger as debugger


class DebuggerFixture(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="qcut-debugger-", dir="/tmp")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.guard = bundle.DependencyGuard()
        self.executable = self.binary(name="lldb", data=b"frontend fixture")
        self.server = self.binary(name="debugserver", data=b"server fixture")
        self.no_process = self.enterContext(mock.patch.object(
            subprocess, "Popen", side_effect=AssertionError("debugger selection launched a process")))
        self.no_shell = self.enterContext(mock.patch.object(
            os, "system", side_effect=AssertionError("debugger selection invoked a shell")))

    def binary(self, *, name, data=b"executable fixture"):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        path.chmod(0o755)
        return path

    def link(self, *, name, target):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.symlink_to(target)
        return path

    def resolve(self, **kwargs):
        return debugger.resolve_debugger(guard=self.guard, **kwargs)

    def assert_binary_evidence(self, *, row, requested, resolved):
        status = resolved.stat()
        self.assertEqual(row["requested_path"], str(requested))
        self.assertEqual(row["resolved_path"], str(resolved))
        self.assertEqual(row["sha256"], hashlib.sha256(resolved.read_bytes()).hexdigest())
        self.assertEqual(row["size_bytes"], status.st_size)
        self.assertEqual(row["identity"], [str(resolved), status.st_dev, status.st_ino,
                                           status.st_size, status.st_mtime_ns])


class DebuggerSelectionTests(DebuggerFixture):
    def test_default_preserves_xcrun_without_resolving_or_launching(self):
        with mock.patch.object(self.guard.locked, "read", side_effect=AssertionError("default read")):
            result = self.resolve()
            self.assertEqual(debugger.command_prefix(), ["xcrun", "lldb"])
            self.assertEqual(debugger.command_prefix(executable=None), ["xcrun", "lldb"])
        self.assertIsNone(result["executable"])
        self.assertEqual(result["environment_overrides"], {})
        self.assertEqual(result["evidence"], dict(selection="default-xcrun", executable=None,
            debugserver=None, debugserver_selection="lldb-default-unverified", version_check_performed=False))
        self.assertEqual(self.guard.locked.files, {})
        self.no_process.assert_not_called()
        self.no_shell.assert_not_called()

    def test_explicit_frontend_records_and_locks_actual_binary(self):
        result = self.resolve(executable=self.executable)
        self.assertEqual(result["executable"], str(self.executable))
        self.assertEqual(result["environment_overrides"], {})
        self.assertEqual(result["evidence"]["selection"], "explicit")
        self.assertEqual(result["evidence"]["debugserver_selection"], "lldb-default-unverified")
        self.assertIsNone(result["evidence"]["debugserver"])
        self.assertFalse(result["evidence"]["version_check_performed"])
        self.assert_binary_evidence(row=result["evidence"]["executable"],
                                    requested=self.executable, resolved=self.executable)
        self.assertEqual(debugger.command_prefix(executable=result["executable"]), [str(self.executable)])
        self.assertIn(str(self.executable), self.guard.locked.files)
        self.guard.verify()

    def test_explicit_server_sets_only_exact_debugserver_path(self):
        result = self.resolve(executable=str(self.executable), debugserver=str(self.server))
        self.assertEqual(result["environment_overrides"], {"LLDB_DEBUGSERVER_PATH": str(self.server)})
        self.assertEqual(result["evidence"]["debugserver_selection"], "explicit")
        self.assert_binary_evidence(row=result["evidence"]["debugserver"],
                                    requested=self.server, resolved=self.server)
        self.assertEqual(set(self.guard.locked.files), {str(self.executable), str(self.server)})
        self.assertEqual(json.loads(json.dumps(result, allow_nan=False)), result)
        self.guard.verify()

    def test_server_only_selection_preserves_default_frontend(self):
        result = self.resolve(debugserver=self.server)
        self.assertIsNone(result["executable"])
        self.assertEqual(debugger.command_prefix(executable=result["executable"]), ["xcrun", "lldb"])
        self.assertEqual(result["environment_overrides"], {"LLDB_DEBUGSERVER_PATH": str(self.server)})
        self.assertEqual(result["evidence"]["selection"], "default-xcrun")
        self.assertEqual(result["evidence"]["debugserver_selection"], "explicit")
        self.assertEqual(set(self.guard.locked.files), {str(self.server)})

    def test_homebrew_style_parent_symlink_resolves_and_locks_alias_and_target(self):
        canonical = self.binary(name="Cellar/llvm/22.1.5/bin/lldb")
        alias_root = self.link(name="opt/llvm", target=self.root / "Cellar/llvm/22.1.5")
        alias = alias_root / "bin/lldb"
        result = self.resolve(executable=alias)
        self.assertEqual(result["executable"], str(canonical))
        self.assertEqual(debugger.command_prefix(executable=alias), [str(canonical)])
        self.assert_binary_evidence(row=result["evidence"]["executable"], requested=alias, resolved=canonical)
        self.assertTrue({str(alias), str(canonical)}.issubset(self.guard.locked.files))
        self.guard.verify()

    def test_relative_symlink_target_is_allowed_under_absolute_requested_path(self):
        alias = self.link(name="lldb-alias", target=Path("lldb"))
        result = self.resolve(executable=alias)
        self.assertEqual(result["executable"], str(self.executable))
        self.assert_binary_evidence(row=result["evidence"]["executable"],
                                    requested=alias, resolved=self.executable)

    def test_debugserver_symlink_environment_uses_canonical_target(self):
        alias = self.link(name="server-alias", target=self.server)
        result = self.resolve(debugserver=alias)
        self.assertEqual(result["environment_overrides"], {"LLDB_DEBUGSERVER_PATH": str(self.server)})
        self.assert_binary_evidence(row=result["evidence"]["debugserver"], requested=alias, resolved=self.server)
        self.assertTrue({str(alias), str(self.server)}.issubset(self.guard.locked.files))

    def test_paths_with_spaces_and_shell_metacharacters_remain_single_arguments(self):
        binary = self.binary(name="tool chain/lldb ; $(false)")
        result = self.resolve(executable=binary)
        self.assertEqual(debugger.command_prefix(executable=result["executable"]), [str(binary)])
        self.no_process.assert_not_called()
        self.no_shell.assert_not_called()

    def test_selection_does_not_inherit_or_mutate_process_environment(self):
        inherited = {"LLDB_DEBUGSERVER_PATH": "/foreign/server", "PYTHONPATH": "/foreign/python",
                     "DEVELOPER_DIR": "/foreign/developer", "DYLD_INSERT_LIBRARIES": "/foreign/library"}
        with mock.patch.dict(os.environ, inherited):
            before = dict(os.environ)
            self.assertEqual(self.resolve(executable=self.executable)["environment_overrides"], {})
            explicit = self.resolve(executable=self.executable, debugserver=self.server)
            self.assertEqual(explicit["environment_overrides"], {"LLDB_DEBUGSERVER_PATH": str(self.server)})
            self.assertEqual(dict(os.environ), before)

    def test_selection_and_prefix_never_launch_or_probe_versions(self):
        for arguments in ({}, {"executable": self.executable}, {"debugserver": self.server},
                          {"executable": self.executable, "debugserver": self.server}):
            with self.subTest(arguments=arguments):
                result = self.resolve(**arguments)
                debugger.command_prefix(executable=result["executable"])
                self.assertFalse(result["evidence"]["version_check_performed"])
        self.no_process.assert_not_called()
        self.no_shell.assert_not_called()


class DebuggerValidationTests(DebuggerFixture):
    def test_relative_empty_control_and_wrong_typed_paths_rejected_for_both_roles(self):
        values = ("", "lldb", "./lldb", "~/lldb", " /absolute", "/bad\x00path", "/bad\npath",
                  "/bad\rpath", True, 1, b"/usr/bin/lldb", [str(self.executable)])
        for role in ("executable", "debugserver"):
            for value in values:
                with self.subTest(role=role, value=repr(value)), self.assertRaises(ValueError):
                    self.resolve(**{role: value})

    def test_command_prefix_does_not_treat_empty_or_invalid_override_as_default(self):
        for value in ("", "lldb", True, b"/usr/bin/lldb", str(self.root / "missing")):
            with self.subTest(value=value), self.assertRaises(ValueError):
                debugger.command_prefix(executable=value)

    def test_missing_directory_nonexecutable_empty_and_fifo_rejected_before_read(self):
        empty = self.binary(name="empty", data=b"")
        no_execute = self.binary(name="no-execute")
        no_execute.chmod(0o644)
        fifo = self.root / "fifo"
        os.mkfifo(fifo, 0o755)
        for role in ("executable", "debugserver"):
            for path in (self.root / "missing", self.root, no_execute, empty, fifo):
                with self.subTest(role=role, path=path), mock.patch.object(
                        self.guard.locked, "read", side_effect=AssertionError("invalid binary read")):
                    with self.assertRaises(ValueError):
                        self.resolve(**{role: path})

    def test_dangling_and_looping_symlinks_fail_closed(self):
        dangling = self.link(name="dangling", target=self.root / "absent")
        loop = self.link(name="loop", target=Path("loop"))
        for role in ("executable", "debugserver"):
            for path in (dangling, loop):
                with self.subTest(role=role, path=path), self.assertRaises(ValueError):
                    self.resolve(**{role: path})

    def test_execute_access_denial_rejected_even_with_mode_bits(self):
        with mock.patch.object(os, "access", return_value=False):
            for role in ("executable", "debugserver"):
                with self.subTest(role=role), self.assertRaises(ValueError):
                    self.resolve(**{role: self.executable})

    def test_size_limit_is_bounded_and_exact_boundary_is_accepted(self):
        self.assertEqual(debugger.BINARY_LIMIT, 128 * 1024**2)
        exact = self.binary(name="exact", data=b"12345678")
        oversized = self.binary(name="oversized", data=b"123456789")
        with mock.patch.object(debugger, "BINARY_LIMIT", 8):
            self.resolve(executable=exact)
            for role in ("executable", "debugserver"):
                with self.subTest(role=role), self.assertRaises(ValueError):
                    self.resolve(**{role: oversized})

    def test_read_failure_is_not_downgraded_to_default_selection(self):
        with mock.patch.object(self.guard.locked, "read", side_effect=PermissionError("locked read denied")):
            with self.assertRaisesRegex(PermissionError, "locked read denied"):
                self.resolve(executable=self.executable)

    def test_command_prefix_rechecks_executable_permission(self):
        selected = self.resolve(executable=self.executable)
        self.executable.chmod(0o644)
        with self.assertRaises(ValueError):
            debugger.command_prefix(executable=selected["executable"])


class DebuggerGuardTests(DebuggerFixture):
    def test_content_mutation_is_rejected_by_existing_guard(self):
        for path in (self.executable, self.server):
            with self.subTest(path=path):
                self.guard = bundle.DependencyGuard()
                self.resolve(executable=self.executable, debugserver=self.server)
                path.write_bytes(b"changed binary")
                with self.assertRaises(ValueError):
                    self.guard.verify()

    def test_same_size_content_change_with_restored_mtime_is_rejected(self):
        original = self.executable.read_bytes()
        status = self.executable.stat()
        self.resolve(executable=self.executable)
        self.executable.write_bytes(b"x" * len(original))
        os.utime(self.executable, ns=(status.st_atime_ns, status.st_mtime_ns))
        with self.assertRaises(ValueError):
            self.guard.verify()

    def test_identical_bytes_replacement_is_rejected_by_file_identity(self):
        self.resolve(executable=self.executable)
        replacement = self.binary(name="replacement", data=self.executable.read_bytes())
        status = self.executable.stat()
        os.utime(replacement, ns=(status.st_atime_ns, status.st_mtime_ns))
        replacement.replace(self.executable)
        with self.assertRaises(ValueError):
            self.guard.verify()

    def test_symlink_retarget_is_rejected_even_if_bytes_match(self):
        for role in ("executable", "debugserver"):
            with self.subTest(role=role):
                self.guard = bundle.DependencyGuard()
                alias = self.link(name=f"{role}-alias", target=self.executable)
                replacement = self.binary(name=f"{role}-replacement", data=self.executable.read_bytes())
                self.resolve(**{role: alias})
                alias.unlink()
                alias.symlink_to(replacement)
                with self.assertRaises(ValueError):
                    self.guard.verify()

    def test_parent_directory_symlink_retarget_is_rejected(self):
        first = self.binary(name="Cellar/llvm/v1/bin/lldb")
        second = self.binary(name="Cellar/llvm/v2/bin/lldb")
        alias_root = self.link(name="opt/llvm", target=first.parent.parent)
        self.resolve(executable=alias_root / "bin/lldb")
        alias_root.unlink()
        alias_root.symlink_to(second.parent.parent)
        with self.assertRaises(ValueError):
            self.guard.verify()

    def test_deletion_is_rejected_by_existing_guard(self):
        self.resolve(debugserver=self.server)
        self.server.unlink()
        with self.assertRaises(FileNotFoundError):
            self.guard.verify()

    def test_changed_binary_cannot_be_silently_reselected_with_same_guard(self):
        self.resolve(executable=self.executable)
        self.executable.write_bytes(b"replacement")
        with self.assertRaises(ValueError):
            self.resolve(executable=self.executable)

    def test_retarget_during_locked_read_rejected_before_returning_selection(self):
        alias = self.link(name="racing-alias", target=self.executable)
        replacement = self.binary(name="replacement", data=self.executable.read_bytes())
        read = self.guard.locked.read

        def retarget_after_read(**kwargs):
            data = read(**kwargs)
            if kwargs["path"] == alias:
                alias.unlink()
                alias.symlink_to(replacement)
            return data

        with mock.patch.object(self.guard.locked, "read", side_effect=retarget_after_read):
            with self.assertRaises(ValueError):
                self.resolve(executable=alias)

    def test_content_change_during_locked_read_rejected_before_returning_selection(self):
        read = self.guard.locked.read

        def mutate_after_read(**kwargs):
            data = read(**kwargs)
            self.executable.write_bytes(b"changed after read")
            return data

        with mock.patch.object(self.guard.locked, "read", side_effect=mutate_after_read):
            with self.assertRaises(ValueError):
                self.resolve(executable=self.executable)

    def test_prior_guard_entries_are_preserved(self):
        prior = self.root / "fixture.json"
        prior.write_text("{}")
        self.guard.locked.read(path=prior)
        prior_hash = self.guard.locked.files[str(prior)]
        self.resolve(executable=self.executable, debugserver=self.server)
        self.assertEqual(self.guard.locked.files[str(prior)], prior_hash)
        self.assertTrue({str(prior), str(self.executable), str(self.server)}.issubset(self.guard.locked.files))
        self.guard.verify()


if __name__ == "__main__":
    unittest.main()
