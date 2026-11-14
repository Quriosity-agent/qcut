"""No disk images, user assets or native mount commands are used by these tests."""
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "macos-local-assets-volume.py"
sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location("local_volume", SCRIPT)
V = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(V)
import macos_local_assets_permissions as P
EXTERNAL_UUID = "11111111-1111-1111-1111-111111111111"
RUNTIME_UUID = "22222222-2222-2222-2222-222222222222"
SOURCE_UUID = "33333333-3333-3333-3333-333333333333"


class ControllerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.source = self.root / "source"
        self.source.mkdir(mode=0o700)
        self.image = self.root / "runtime.sparseimage"
        self.image.write_bytes(b"synthetic image; never attached")
        self.config = self.root / "volume.json"
        self.settings = dict(sourceRoot=str(self.source), image=str(self.image),
                             externalVolumeUUID=EXTERNAL_UUID, apfsVolumeUUID=RUNTIME_UUID,
                             imageFileId=self.image.stat().st_ino)
        self.write_config()
        self.controller = V.Controller(self.config)
        self.mountpoint = self.source / ".local"
        self.mounted = False
        self.attached = []
        self.commands = []
        self.runtime_uuid = RUNTIME_UUID
        self.busy = False
        self.mount_failure = False
        self.detach_failure = False
        self.owners_enabled = True
        self.existing_devices = []
        self.entities = [
            {"dev-entry": "/dev/disk24", "content-hint": "GUID_partition_scheme"},
            {"dev-entry": "/dev/disk25s1", "volume-kind": "apfs", "potentially-mountable": True},
        ]
        self.controller.disk = self.disk
        self.controller.images = lambda: self.existing_devices + self.attached
        self.controller.command = self.command
        self.controller.validate_image = lambda: V.identity(self.image)
        self.mount_patch = patch.object(V.os.path, "ismount", side_effect=lambda p: self.mounted and Path(p) == self.mountpoint)
        self.mount_patch.start()

    def tearDown(self):
        self.mount_patch.stop()
        if self.mountpoint.is_dir():
            self.mountpoint.chmod(0o700)
        self.temporary.cleanup()

    def write_config(self):
        self.config.write_text(json.dumps(self.settings))
        self.config.chmod(0o600)

    def disk(self, target):
        if str(target) == "/dev/disk24s2":
            return {"FilesystemType": "hfs", "VolumeUUID": EXTERNAL_UUID}
        if str(target) in ("/dev/disk25s1", str(self.mountpoint)):
            return {"FilesystemType": "apfs", "VolumeUUID": self.runtime_uuid,
                    "Writable": True,
                    "GlobalPermissionsEnabled": self.owners_enabled,
                    "Mounted": self.mounted, "MountPoint": str(self.mountpoint) if self.mounted else "",
                    "DeviceNode": "/dev/disk25s1"}
        return {"Internal": True, "GlobalPermissionsEnabled": True, "VolumeUUID": SOURCE_UUID}

    def command(self, args):
        self.commands.append(args)
        if args[1] == "attach":
            row = {"image-path": str(self.image), "system-entities": self.entities}
            self.attached = [row]
            return plistlib.dumps(row)
        if args[1] == "mount":
            if self.mount_failure:
                raise V.Refused("synthetic mount failure")
            self.mounted = True
        if args[1] == "unmount":
            if self.busy:
                raise V.Refused("volume busy")
            self.mounted = False
        if args[1] == "detach":
            if self.detach_failure:
                raise V.Refused("synthetic detach failure")
            self.attached = []
            self.mounted = False
        return b""

    def test_mount_unmount_and_restore_created_empty_directory(self):
        self.assertTrue(self.controller.mount()["mounted"])
        self.assertEqual(stat.S_IMODE(self.mountpoint.stat().st_mode), 0)
        count = len(self.commands)
        self.assertTrue(self.controller.mount()["mounted"])
        self.assertEqual(len(self.commands), count)
        self.assertFalse(self.controller.unmount()["mounted"])
        self.assertTrue(self.controller.restore_empty()["removedNewEmptyDirectory"])
        self.assertFalse(self.mountpoint.exists())
        self.assertTrue(self.image.exists())

    def test_preserves_preexisting_empty_directory_and_mode(self):
        self.mountpoint.mkdir(mode=0o750)
        before = self.mountpoint.stat().st_ino
        self.controller.mount()
        self.controller.unmount()
        self.assertFalse(self.controller.restore_empty()["removedNewEmptyDirectory"])
        self.assertEqual(self.mountpoint.stat().st_ino, before)
        self.assertEqual(stat.S_IMODE(self.mountpoint.stat().st_mode), 0o750)

    def test_setgid_empty_directory_survives_full_mount_restore_cycle(self):
        self.mountpoint.mkdir(mode=0o700)
        self.mountpoint.chmod(0o2700)
        self.assertEqual(stat.S_IMODE(self.mountpoint.stat().st_mode), 0o2700)
        original_inode = self.mountpoint.stat().st_ino
        self.controller.mount()
        self.controller.unmount()
        self.assertFalse(self.controller.restore_empty()["removedNewEmptyDirectory"])
        self.assertEqual(self.mountpoint.stat().st_ino, original_inode)
        self.assertEqual(stat.S_IMODE(self.mountpoint.stat().st_mode), 0o2700)

    def test_nonempty_local_is_never_covered_or_chmodded(self):
        self.mountpoint.mkdir(mode=0o700)
        (self.mountpoint / "model").write_bytes(b"important")
        before = self.mountpoint.stat()
        with self.assertRaisesRegex(V.Refused, "Nonempty"):
            self.controller.mount()
        self.assertFalse(self.commands)
        self.assertEqual(self.mountpoint.stat().st_mode, before.st_mode)
        self.assertEqual((self.mountpoint / "model").read_bytes(), b"important")

    def test_mountpoint_symlink_refused(self):
        self.mountpoint.symlink_to(self.root)
        with self.assertRaisesRegex(V.Refused, "symlink"):
            self.controller.mount()
        self.mountpoint.unlink()

    def test_wrong_apfs_uuid_never_mounted_and_new_attachment_detached(self):
        self.runtime_uuid = EXTERNAL_UUID
        with self.assertRaisesRegex(V.Refused, "UUID mismatch"):
            self.controller.mount()
        self.assertFalse(any(x[1] == "mount" for x in self.commands))
        self.assertEqual(self.commands[-1], ["/usr/bin/hdiutil", "detach", "/dev/disk24"])
        self.assertEqual(stat.S_IMODE(self.mountpoint.stat().st_mode), 0)

    def test_failed_mount_leaves_guarded_recoverable_mountpoint(self):
        self.mount_failure = True
        with self.assertRaisesRegex(V.Refused, "mount failure"):
            self.controller.mount()
        self.assertFalse(self.attached)
        self.assertEqual(stat.S_IMODE(self.mountpoint.stat().st_mode), 0)
        self.assertTrue(self.controller.restore_empty()["removedNewEmptyDirectory"])

    def test_busy_unmount_never_detaches_or_forces(self):
        self.controller.mount()
        self.commands.clear()
        self.busy = True
        with self.assertRaisesRegex(V.Refused, "busy"):
            self.controller.unmount()
        self.assertTrue(self.mounted)
        self.assertEqual(self.commands, [["/usr/sbin/diskutil", "unmount", "/dev/disk25s1"]])

    def test_existing_device_is_not_detached_after_attach_race(self):
        self.existing_devices = [{"image-path": "/unrelated.sparseimage", "system-entities": [self.entities[0]]}]
        with self.assertRaisesRegex(V.Refused, "pre-existing device"):
            self.controller.mount()
        self.assertFalse(any(x[1] == "detach" for x in self.commands))

    def test_already_attached_image_is_left_alone(self):
        self.attached = [{"image-path": str(self.image), "system-entities": self.entities}]
        with self.assertRaisesRegex(V.Refused, "already attached"):
            self.controller.mount()
        self.assertFalse(self.commands)
        self.assertFalse(self.mountpoint.exists())

    def test_duplicate_uuid_from_another_image_refused(self):
        self.attached = [{"image-path": "/backup.sparseimage", "system-entities": self.entities}]
        with self.assertRaisesRegex(V.Refused, "already attached"):
            self.controller.mount()
        self.assertFalse(self.commands)

    def test_extra_volume_refused(self):
        self.entities.append({"dev-entry": "/dev/disk24s2", "volume-kind": "hfs", "potentially-mountable": True})
        with self.assertRaisesRegex(V.Refused, "exactly one filesystem"):
            self.controller.mount()
        self.assertFalse(any(x[1] == "mount" for x in self.commands))

    def test_check_is_read_only(self):
        before = sorted(str(p) for p in self.root.rglob("*"))
        self.assertFalse(self.controller.check()["mounted"])
        self.assertEqual(before, sorted(str(p) for p in self.root.rglob("*")))
        self.assertFalse(self.commands)

    def test_check_rejects_unassociated_mount(self):
        self.mounted = True
        with self.assertRaisesRegex(V.Refused, "no matching"):
            self.controller.check()

    def test_changed_underlying_directory_refused(self):
        self.controller.prepare_mountpoint()
        self.mountpoint.rename(self.source / "old-empty")
        self.mountpoint.mkdir(mode=0o700)
        with self.assertRaisesRegex(V.Refused, "identity changed"):
            self.controller.restore_empty()
        (self.source / "old-empty").chmod(0o700)

    def test_unmounted_inspection_never_enables_write(self):
        state = self.controller.prepare_mountpoint()
        observed = []
        original = Path.iterdir
        def inspect(path):
            if path == self.mountpoint:
                observed.append(stat.S_IMODE(path.stat().st_mode))
            return original(path)
        with patch.object(Path, "iterdir", inspect):
            self.controller.empty_guarded(state)
        self.assertEqual(observed, [0o500])
        self.assertEqual(stat.S_IMODE(self.mountpoint.stat().st_mode), 0)

    def test_unknown_config_key_and_unsafe_config_mode_refused(self):
        self.settings["extra"] = "ignored?"
        self.write_config()
        with self.assertRaisesRegex(V.Refused, "config keys"):
            V.Controller(self.config)
        del self.settings["extra"]
        self.write_config()
        self.config.chmod(0o644)
        with self.assertRaisesRegex(V.Refused, "0600"):
            V.Controller(self.config)

    def test_image_path_cannot_traverse_symlinks_or_overlap_local(self):
        alias = self.root / "alias.sparseimage"
        alias.symlink_to(self.image)
        self.settings["image"] = str(alias)
        self.write_config()
        with self.assertRaisesRegex(V.Refused, "Symlinked"):
            V.Controller(self.config)
        self.settings["image"] = str(self.mountpoint / "runtime.sparseimage")
        self.write_config()
        with self.assertRaisesRegex(V.Refused, "overlap"):
            V.Controller(self.config)

    def test_image_inode_mismatch_fails_before_backing_or_mount(self):
        self.controller.settings["imageFileId"] += 1
        with self.assertRaisesRegex(V.Refused, "inode changed"):
            V.Controller.validate_image(self.controller)
        self.assertFalse(self.commands)

    def test_wrong_backing_uuid_refused(self):
        self.controller.disk = lambda target: {"Internal": True, "GlobalPermissionsEnabled": True} if Path(target) == self.source else {"VolumeUUID": SOURCE_UUID, "Writable": True, "Internal": False}
        with patch.object(V.os.path, "ismount", return_value=True):
            with self.assertRaisesRegex(V.Refused, "external volume"):
                V.Controller.validate_image(self.controller)

    def test_source_lock_is_shared_across_config_filenames(self):
        other = self.root / "second.json"
        other.write_text(self.config.read_text())
        other.chmod(0o600)
        second = V.Controller(other)
        second.disk = self.disk
        with self.controller.locked(image_required=False):
            with self.assertRaises(BlockingIOError):
                with second.locked(image_required=False):
                    self.fail("Second controller acquired same source directory lock")

    def test_partial_unmount_stays_guarded_and_refuses_automatic_recovery(self):
        self.controller.mount()
        self.detach_failure = True
        with self.assertRaisesRegex(V.Refused, "detach failure"):
            self.controller.unmount()
        self.assertFalse(self.mounted)
        self.assertTrue(self.attached)
        self.assertEqual(stat.S_IMODE(self.mountpoint.stat().st_mode), 0)
        for method in (self.controller.check, self.controller.mount, self.controller.restore_empty):
            with self.assertRaisesRegex(V.Refused, "attached"):
                method()

    def test_restore_empty_never_touches_actual_mount(self):
        self.controller.prepare_mountpoint()
        self.mounted = True
        with self.assertRaisesRegex(V.Refused, "still mounted"):
            self.controller.restore_empty()
        self.assertTrue(self.mountpoint.exists())

    def test_hdiutil_info_without_volume_kind_is_supported(self):
        self.entities[1] = {"dev-entry": "/dev/disk25s1", "content-hint": "41504653-0000-11AA-AA11-00306543ECAC"}
        self.assertTrue(self.controller.mount()["mounted"])
        self.assertFalse(self.controller.unmount()["mounted"])

    def test_df_resolves_internal_subdirectory_to_device(self):
        commands = []
        def run(args):
            commands.append(args)
            if args[0] == "/bin/df":
                return b"Filesystem 512-blocks Used Available Capacity Mounted on\n/dev/disk3s5 10 1 9 10% /System/Volumes/Data\n"
            return plistlib.dumps({"Internal": True, "VolumeUUID": SOURCE_UUID})
        self.controller.command = run
        self.assertTrue(V.Controller.disk(self.controller, self.source)["Internal"])
        self.assertEqual(commands[1][-1], "/dev/disk3s5")

    def test_df_rejects_nonlocal_and_ambiguous_output(self):
        for output in (b"header\nserver:/share 1 1 1 10% /network\n", b"header\none\ntwo\n"):
            with self.subTest(output=output):
                self.controller.command = lambda args: output
                with self.assertRaises(V.Refused):
                    V.Controller.disk(self.controller, self.source)

    def test_image_lock_is_shared_across_source_roots(self):
        other_source = self.root / "other-source"
        other_source.mkdir(mode=0o700)
        config = self.root / "other.json"
        config.write_text(json.dumps({**self.settings, "sourceRoot": str(other_source)}))
        config.chmod(0o600)
        second = V.Controller(config)
        second.disk = self.disk
        second.validate_image = lambda: V.identity(self.image)
        with self.controller.locked():
            with self.assertRaises(BlockingIOError):
                with second.locked():
                    self.fail("Second controller acquired same image lock")

    def test_main_refuses_root_before_mutation(self):
        with patch.object(V.sys, "argv", [str(SCRIPT), "mount", "--config", str(self.config)]), \
                patch.object(V.sys, "platform", "darwin"), patch.object(V.os, "geteuid", return_value=0):
            with self.assertRaisesRegex(V.Refused, "never root"):
                V.main()
        self.assertFalse(self.mountpoint.exists())

    def test_readonly_runtime_rejected_before_mount(self):
        original = self.disk
        self.controller.disk = lambda target: {**original(target), "Writable": False}
        with self.assertRaisesRegex(V.Refused, "must be writable"):
            self.controller.mount()
        self.assertFalse(any(x[1] == "mount" for x in self.commands))

    def test_ownership_ignored_mount_is_rejected_and_detached(self):
        self.owners_enabled = False
        with self.assertRaisesRegex(V.Refused, "stored file ownership"):
            self.controller.mount()
        self.assertTrue(any(x[1] == "detach" for x in self.commands))
        mount_command = next(x for x in self.commands if x[1] == "mount")
        self.assertEqual(mount_command[mount_command.index("-mountOptions") + 1], "owners")

    def test_allow_acl_on_config_file_or_parent_is_refused(self):
        for target in (self.config, self.config.parent):
            with self.subTest(target=target), patch.object(P, "read_acl_tags", side_effect=lambda p: [1] if p == target else []):
                with self.assertRaisesRegex(PermissionError, "ACL entry"):
                    V.Controller(self.config)

    def test_allow_acl_on_source_image_and_lock_is_refused(self):
        with patch.object(P, "read_acl_tags", side_effect=lambda p: [1] if p == self.source else []):
            with self.assertRaisesRegex(PermissionError, "ACL entry"):
                self.controller.validate_source()
        with patch.object(P, "read_acl_tags", side_effect=lambda p: [1] if p == self.image else []):
            with self.assertRaisesRegex(PermissionError, "ACL entry"):
                V.Controller.validate_image(self.controller)
        with patch.object(P, "read_acl_tags", side_effect=lambda p: [1] if p == self.controller.lock_path else []):
            with self.assertRaisesRegex(PermissionError, "ACL entry"):
                with self.controller.locked():
                    self.fail("ACL-granted lock was trusted")

    def test_allow_acl_cannot_bypass_guarded_zero_mode_mountpoint(self):
        state = self.controller.prepare_mountpoint()
        self.assertEqual(stat.S_IMODE(self.mountpoint.stat().st_mode), 0)
        with patch.object(P, "read_acl_tags", side_effect=lambda p: [1] if p == self.mountpoint else []):
            with self.assertRaisesRegex(PermissionError, "ACL entry"):
                self.controller.empty_guarded(state)
        self.assertEqual(stat.S_IMODE(self.mountpoint.stat().st_mode), 0)

    def test_new_mountpoint_acl_is_checked_before_state_or_mode_changes(self):
        with patch.object(P, "read_acl_tags", side_effect=lambda p: [1] if p == self.mountpoint else []):
            with self.assertRaisesRegex(PermissionError, "ACL entry"):
                self.controller.prepare_mountpoint()
        self.assertFalse(self.controller.state_path.exists())
        self.assertEqual(stat.S_IMODE(self.mountpoint.stat().st_mode), 0o500)
        self.assertEqual(self.commands, [])

    def test_deny_only_acl_is_allowed_and_unknown_tags_are_refused(self):
        with patch.object(P, "read_acl_tags", return_value=[2]):
            P.trusted_path(self.config)
        with patch.object(P, "read_acl_tags", return_value=[999]):
            with self.assertRaisesRegex(PermissionError, "ACL entry"):
                P.trusted_path(self.config)

    def test_writable_ancestor_is_refused_but_trusted_sticky_ancestor_is_allowed(self):
        shared = self.root / "shared"
        shared.mkdir()
        child = shared / "private"
        child.mkdir(mode=0o700)
        shared.chmod(0o777)
        with self.assertRaisesRegex(PermissionError, "ancestor"):
            P.trusted_path(child)
        shared.chmod(0o1777)
        P.trusted_path(child)
        with self.assertRaisesRegex(PermissionError, "Writable trusted"):
            P.trusted_path(shared)

    def test_allow_acl_on_ancestor_rejected_even_if_leaf_is_private(self):
        child = self.source / "private"
        child.mkdir(mode=0o700)
        with patch.object(P, "read_acl_tags", side_effect=lambda p: [1] if p == self.source else []):
            with self.assertRaisesRegex(PermissionError, "ACL entry"):
                P.trusted_path(child)

    def test_acl_read_error_and_permission_change_fail_closed(self):
        with patch.object(P, "read_acl_tags", side_effect=PermissionError("ACL unreadable")):
            with self.assertRaisesRegex(PermissionError, "ACL unreadable"):
                P.trusted_path(self.config)
        def changed(path):
            if path == self.config:
                path.chmod(0o640)
            return []
        with patch.object(P, "read_acl_tags", side_effect=changed):
            with self.assertRaisesRegex(PermissionError, "changed during"):
                P.trusted_path(self.config)

    def test_sparsebundle_root_must_be_private(self):
        bundle = self.root / "runtime.sparsebundle"
        bundle.mkdir(mode=0o755)
        self.settings.update(image=str(bundle), imageFileId=bundle.stat().st_ino)
        self.write_config()
        controller = V.Controller(self.config)
        controller.disk = self.disk
        with self.assertRaisesRegex(V.Refused, "Sparsebundle root must be private"):
            controller.validate_image()

    def test_backing_volume_ownership_must_be_honored(self):
        self.controller.disk = lambda target: {"Internal": True, "GlobalPermissionsEnabled": True} if Path(target) == self.source else {
            "VolumeUUID": EXTERNAL_UUID, "Writable": True, "Internal": False,
            "GlobalPermissionsEnabled": False}
        with self.assertRaisesRegex(V.Refused, "Backing volume must honor"):
            V.Controller.validate_image(self.controller)

    def test_source_and_control_ownership_rejected_before_any_mutation(self):
        self.controller.disk = lambda target: {"Internal": True, "GlobalPermissionsEnabled": False}
        with self.assertRaisesRegex(V.Refused, "control filesystem must honor"):
            self.controller.mount()
        self.assertFalse(self.mountpoint.exists())
        self.assertFalse(self.controller.lock_path.exists())

    def test_nested_or_unknown_backing_protocol_refused(self):
        for protocol in ("Disk Image", None):
            with self.subTest(protocol=protocol):
                self.controller.disk = lambda target: {"Internal": True, "GlobalPermissionsEnabled": True} if Path(target) == self.source else {
                    "VolumeUUID": EXTERNAL_UUID, "Writable": True, "Internal": False,
                    "GlobalPermissionsEnabled": True, "BusProtocol": protocol}
                with self.assertRaisesRegex(V.Refused, "physical external disk"):
                    V.Controller.validate_image(self.controller)

    def test_silently_dropped_setgid_bit_reguards_and_retains_state(self):
        self.mountpoint.mkdir(mode=0o700)
        self.mountpoint.chmod(0o2700)
        self.controller.prepare_mountpoint()
        original = os.chmod
        def drop_special_bits(path, mode, **kwargs):
            return original(path, mode & 0o777, **kwargs)
        with patch.object(V.os, "chmod", side_effect=drop_special_bits):
            with self.assertRaisesRegex(V.Refused, "not restored"):
                self.controller.restore_empty()
        self.assertTrue(self.controller.state_path.exists())
        self.assertEqual(stat.S_IMODE(self.mountpoint.stat().st_mode), 0)




if __name__ == "__main__":
    unittest.main()
