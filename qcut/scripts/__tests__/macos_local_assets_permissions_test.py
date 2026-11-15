"""Real ACL fixtures only; no disk images, mount calls or user assets."""
import os
from pathlib import Path
import pwd
import stat
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import macos_local_assets_permissions as P


@unittest.skipUnless(sys.platform == "darwin", "Requires real macOS ACLs")
class NativeAclTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.touched = []

    def tearDown(self):
        for path in reversed(self.touched):
            subprocess.run(["/bin/chmod", "-N", str(path)], check=True)
            path.chmod(0o700 if path.is_dir() else 0o600)
        self.temporary.cleanup()

    def grant(self, path, entry):
        subprocess.run(["/bin/chmod", "+a", entry, str(path)], check=True)
        self.touched.append(path)

    def test_real_allow_acl_on_private_file_is_rejected_without_changing_acl(self):
        file = self.root / "control.json"
        file.write_text("{}")
        file.chmod(0o600)
        self.grant(file, "everyone allow write,append")
        before = P.read_acl_tags(file)
        self.assertIn(1, before)
        with self.assertRaisesRegex(PermissionError, "ACL entry"):
            P.trusted_path(file)
        self.assertEqual(P.read_acl_tags(file), before)
        self.assertEqual(stat.S_IMODE(file.stat().st_mode), 0o600)

    def test_real_common_deny_delete_acl_is_accepted(self):
        directory = self.root / "private"
        directory.mkdir(mode=0o700)
        self.grant(directory, "everyone deny delete")
        self.assertEqual(P.read_acl_tags(directory), [2])
        P.trusted_path(directory)

    def test_real_root_owned_sticky_ancestor_protects_private_child(self):
        parent = Path("/private/tmp")
        self.assertEqual(parent.stat().st_uid, 0)
        self.assertTrue(parent.stat().st_mode & stat.S_ISVTX)
        with tempfile.TemporaryDirectory(dir=parent) as name:
            child = Path(name).resolve()
            self.assertEqual(child.stat().st_uid, os.getuid())
            P.trusted_path(child)

    def test_real_ancestor_delete_child_grant_is_rejected(self):
        directory = self.root / "ancestor"
        directory.mkdir(mode=0o700)
        leaf = directory / "private"
        leaf.mkdir(mode=0o700)
        self.grant(directory, "everyone allow delete_child,add_file,add_subdirectory")
        with self.assertRaisesRegex(PermissionError, "ACL entry"):
            P.trusted_path(leaf)

    def test_real_owner_allow_acl_bypasses_zero_mode_but_guard_refuses_it(self):
        directory = self.root / "offline-mountpoint"
        directory.mkdir(mode=0o700)
        owner = pwd.getpwuid(os.getuid()).pw_name
        self.grant(directory, f"user:{owner} allow list,search,add_file,add_subdirectory,readattr,writeattr,readsecurity")
        directory.chmod(0)
        (directory / "synthetic-write").write_bytes(b"demonstrates why ACLs must be checked")
        self.assertEqual(stat.S_IMODE(directory.stat().st_mode), 0)
        with self.assertRaisesRegex(PermissionError, "ACL entry"):
            P.trusted_path(directory)


if __name__ == "__main__":
    unittest.main()
