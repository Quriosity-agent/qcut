"""Stable signer/cache/lease tests; optional real codesign rebuild test on macOS."""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

import face_live_bridge_bundle as bundle
import face_live_host_identity as host

IDENTITY = "A" * 40
IDENTITIES = f'  1) {IDENTITY} "Apple Development: Test (NAME123456)"\n'
REQUIREMENT = f'identifier "{host.IDENTIFIER}" and anchor apple generic and certificate leaf[subject.OU] = TEAM123456'
SIGNATURE = (f'Identifier={host.IDENTIFIER}\nTeamIdentifier=TEAM123456\nCDHash={"b" * 40}\n'
             f'Authority=Apple Development: Test\ndesignated => {REQUIREMENT}\n')


class FakeScope:
    def __init__(self):
        self.commands = []
        self.compiler = "clang fixture 1"
        self.signature = SIGNATURE

    def spawn(self, *, command, environment, stdout):
        self.commands.append(command)
        output = ""
        if command[:2] == ["xcrun", "clang++"]:
            if "--version" in command:
                output = self.compiler
            else:
                Path(command[-1]).write_bytes(f"host build {len(self.commands)}".encode())
        elif command[0] == "/usr/bin/security":
            output = IDENTITIES
        elif command[:2] == ["/usr/bin/codesign", "-d"]:
            output = self.signature
        elif command == ["xcrun", "--show-sdk-path"]:
            output = "/fixture/sdk"
        stdout.write_text(output)
        return mock.Mock()

    def wait(self, **kwargs):
        pass

    def finish(self, **kwargs):
        pass


class IdentityTests(unittest.TestCase):
    def test_selects_only_apple_development_not_distribution(self):
        text = IDENTITIES + f'  2) {"B" * 40} "Developer ID Application: Test"\n'
        self.assertEqual(host.select_identity(text=text), IDENTITY)
        self.assertEqual(host.select_identity(text=text, requested=IDENTITY.lower()), IDENTITY)
        with self.assertRaisesRegex(ValueError, "available Apple Development"):
            host.select_identity(text=text, requested="B" * 40)

    def test_missing_ambiguous_and_unknown_signer_have_no_adhoc_fallback(self):
        for text in ("", IDENTITIES + f'  2) {"B" * 40} "Apple Development: Other"\n'):
            with self.assertRaisesRegex(ValueError, "no ad-hoc fallback"):
                host.select_identity(text=text)
        with self.assertRaises(ValueError):
            host.select_identity(text=IDENTITIES, requested="-")

    def test_requires_stable_cert_requirement_and_actual_team_not_display_suffix(self):
        self.assertEqual(host.signature_record(text=SIGNATURE)["team"], "TEAM123456")
        for text in (SIGNATURE + "Signature=adhoc", SIGNATURE.replace("TEAM123456", "not set"),
                     SIGNATURE.replace(REQUIREMENT, f'cdhash H"{"b" * 40}"'),
                     SIGNATURE.replace(host.IDENTIFIER, "other"),
                     SIGNATURE.replace("Apple Development:", "Developer ID Application:")):
            with self.assertRaises(ValueError):
                host.signature_record(text=text)


@unittest.skipIf(sys.platform == "win32", "the development helper uses POSIX leases, never the Windows backend")
class CacheTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.directory = self.root / "stable"
        host.private_directory(directory=self.directory)
        self.sources = self.root / "source"
        self.sources.mkdir()
        (self.sources / "bridge.h").write_text("initial header")
        self.scope = FakeScope()
        self.index = 0
        self.env = mock.patch.dict(os.environ, {host.SIGNING_ENV: IDENTITY})
        self.env.start()
        self.addCleanup(self.env.stop)

    def prepare(self):
        self.index += 1
        out = self.root / f"job-{self.index}"
        out.mkdir()
        guard = bundle.DependencyGuard()
        guard.tree(directory=self.sources, source=True)
        result = host.prepare_host(directory=self.directory, runtime=self.root,
                                   scope=self.scope, out=out, guard=guard)
        return result, guard

    def test_reuses_code_not_job_data_and_binds_signed_bytes_and_receipt(self):
        first, guard = self.prepare()
        second, _ = self.prepare()
        self.assertFalse(first["reused"])
        self.assertTrue(second["reused"])
        self.assertEqual(first["path"], second["path"])
        self.assertEqual(first["sha256"], second["sha256"])
        self.assertFalse(second["permission_granted_by_launcher"])
        self.assertIn(str(self.directory / "receipt.json"), guard.locked.files)
        self.assertIn(second["path"], guard.locked.files)
        self.assertEqual((self.root / "job-1/live-host.snapshot").read_bytes(),
                         (self.directory / "live-host").read_bytes())
        self.assertEqual((self.root / "job-1/live-host-receipt.json").read_bytes(),
                         (self.directory / "receipt.json").read_bytes())
        builds = [cmd for cmd in self.scope.commands if cmd[:2] == ["xcrun", "clang++"] and "--version" not in cmd]
        self.assertEqual(len(builds), 1)
        self.assertNotEqual(builds[0][-1], second["path"])
        self.assertNotIn("--entitlements", str(self.scope.commands))
        self.assertNotIn("tccutil", str(self.scope.commands))

    def test_header_and_toolchain_changes_rebuild_with_same_requirement(self):
        first, _ = self.prepare()
        (self.sources / "bridge.h").write_text("updated header")
        second, _ = self.prepare()
        self.scope.compiler = "clang fixture 2"
        third, _ = self.prepare()
        for result in (second, third):
            self.assertFalse(result["reused"])
            self.assertEqual(result["signature"]["requirement"], first["signature"]["requirement"])
        self.assertNotEqual(first["recipe"], second["recipe"])
        self.assertNotEqual(second["recipe"], third["recipe"])
        self.assertNotEqual((self.root / "job-1/live-host.snapshot").read_bytes(),
                            (self.directory / "live-host").read_bytes())

    def test_tampered_binary_is_not_silently_rebuilt(self):
        self.prepare()
        (self.directory / "live-host").write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError, "differ from receipt"):
            self.prepare()

    def test_signature_change_is_not_silently_accepted(self):
        self.prepare()
        self.scope.signature = SIGNATURE.replace("TEAM123456", "OTHER12345")
        with self.assertRaisesRegex(ValueError, "signature differs"):
            self.prepare()

    def test_incomplete_publication_fails_closed(self):
        (self.directory / "live-host").write_bytes(b"interrupted")
        with self.assertRaisesRegex(ValueError, "without provenance"):
            self.prepare()

    def test_symlinked_host_rejected(self):
        (self.root / "foreign").write_bytes(b"foreign")
        (self.directory / "live-host").symlink_to(self.root / "foreign")
        with self.assertRaisesRegex(ValueError, "symlinks"):
            self.prepare()

    def test_lease_serializes_and_preserves_uncertain_cleanup_after_exit(self):
        cleanup = dict(completed=False)
        args = dict(directory=self.directory, audit=self.root / "audit", cleanup=cleanup)
        with host.helper_lease(**args):
            with self.assertRaisesRegex(RuntimeError, "in use"):
                with host.helper_lease(**args):
                    self.fail("second lease acquired")
        with self.assertRaisesRegex(RuntimeError, "did not confirm cleanup"):
            with host.helper_lease(**args):
                self.fail("uncertain previous run reused")

    def test_completed_cleanup_releases_marker_and_preserves_lock_inode(self):
        args = dict(directory=self.directory, audit=self.root / "audit", cleanup=dict(completed=True))
        with host.helper_lease(**args):
            inode = (self.directory / "host.lock").stat().st_ino
        self.assertFalse((self.directory / "active-audit.json").exists())
        with host.helper_lease(**args):
            self.assertEqual(inode, (self.directory / "host.lock").stat().st_ino)

    def test_symlinked_lock_and_directory_are_rejected(self):
        (self.root / "foreign").write_bytes(b"foreign")
        (self.directory / "host.lock").symlink_to(self.root / "foreign")
        with self.assertRaises(OSError):
            with host.helper_lease(directory=self.directory, audit=self.root, cleanup={}):
                self.fail("symlink lock accepted")
        link = self.root / "linked"
        link.symlink_to(self.directory)
        with self.assertRaisesRegex(ValueError, "symlinks"):
            host.private_directory(directory=link)


@unittest.skipUnless(sys.platform == "darwin" and os.environ.get("QCUT_TEST_DEVELOPMENT_SIGNING") == "1",
                     "explicit local Apple Development signing opt-in required")
class RealSigningTests(unittest.TestCase):
    def test_different_rebuild_satisfies_previous_designated_requirement(self):
        def run(command):
            return subprocess.check_output(command, stderr=subprocess.STDOUT, text=True, timeout=30)

        identity = host.select_identity(text=run(["/usr/bin/security", "find-identity", "-v", "-p", "codesigning"]),
                                        requested=os.environ.get(host.SIGNING_ENV))
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            binary, source = root / "host", root / "host.cpp"
            records = []
            for value in (0, 1):
                source.write_text(f"int main() {{ return {value}; }}\n")
                run(["xcrun", "clang++", str(source), "-o", str(binary)])
                run(["/usr/bin/codesign", "--force", "--sign", identity, "--identifier", host.IDENTIFIER,
                     "--timestamp=none", str(binary)])
                run(["/usr/bin/codesign", "--verify", "--strict", str(binary)])
                records.append(host.signature_record(text=run(["/usr/bin/codesign", "-d", "-r-", "--verbose=4", str(binary)])))
            self.assertNotEqual(records[0]["cdhash"], records[1]["cdhash"])
            self.assertEqual(records[0]["requirement"], records[1]["requirement"])
            run(["/usr/bin/codesign", "--verify", "--strict", "-R=" + records[0]["requirement"], str(binary)])


if __name__ == "__main__":
    unittest.main()
