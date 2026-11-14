#!/usr/bin/env python3
"""Explicitly mount a preverified APFS runtime image at a checkout's .local.

This tool never creates images, copies assets, clears data, or installs launch jobs.
The configuration and controller state must live outside the mountpoint.
"""
from __future__ import annotations

import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import stat
import subprocess
import sys
import tempfile

from macos_local_assets_permissions import trusted_path


class Refused(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise Refused(message)


def canonical(value):
    require(isinstance(value, str) and value.startswith("/"), "Absolute path required")
    require(not any(p in ("", ".", "..") for p in value.split("/")[1:]), "Non-normal path rejected")
    p = Path(value)
    require(p.resolve() == p, "Symlinked path rejected")
    return p


def owned(info):
    require(info.st_uid == os.getuid() and not info.st_mode & 0o022,
            "Path must be user-owned and not writable by others")


def identity(path):
    info = path.lstat()
    return [info.st_dev, info.st_ino, stat.S_IFMT(info.st_mode)]


def private_json(path):
    trusted_path(path)
    require(path.resolve() == path, "Symlinked control file rejected")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        owned(before)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
                stat.S_IMODE(before.st_mode) == 0o600 and before.st_size < 64 * 1024,
                "Control file must be a private bounded regular file (0600)")
        with os.fdopen(fd, closefd=False) as stream:
            data = json.load(stream)
        after = path.lstat()
        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns),
                "Control file changed while reading")
        return data
    finally:
        os.close(fd)


def write_private(path, value):
    trusted_path(path.parent)
    fd, name = tempfile.mkstemp(prefix=".local-volume-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(value, stream, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        trusted_path(Path(name))
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


class Controller:
    def __init__(self, config):
        self.config = canonical(str(config))
        trusted_path(self.config.parent)
        owned(self.config.parent.stat())
        self.settings = private_json(self.config)
        require(set(self.settings) == {"sourceRoot", "image", "externalVolumeUUID",
                                     "apfsVolumeUUID", "imageFileId"}, "Unknown or missing config keys")
        for key in ("externalVolumeUUID", "apfsVolumeUUID"):
            require(isinstance(self.settings[key], str) and
                    re.fullmatch(r"[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}", self.settings[key]),
                    "Invalid volume UUID")
            self.settings[key] = self.settings[key].upper()
        require(type(self.settings["imageFileId"]) is int and self.settings["imageFileId"] > 0,
                "Positive image inode required")
        self.source = canonical(self.settings["sourceRoot"])
        require(self.source.is_dir(), "Source root must exist")
        trusted_path(self.source)
        owned(self.source.stat())
        self.source_identity = identity(self.source)
        self.mountpoint = self.source / ".local"
        self.image = canonical(self.settings["image"])
        require(not self.image.is_relative_to(self.mountpoint) and
                not self.mountpoint.is_relative_to(self.image), "Image and mountpoint overlap")
        require(not self.config.is_relative_to(self.mountpoint) and
                not self.config.is_relative_to(self.image), "Control files must be outside image and mountpoint")
        self.state_path = self.config.with_name(self.config.name + ".state.json")
        self.lock_path = self.image.with_name(self.image.name + ".qcut-mount.lock")
        self.binding = hashlib.sha256(json.dumps(self.settings, sort_keys=True).encode()).hexdigest()

    def command(self, args):
        result = subprocess.run(args, capture_output=True, timeout=90)
        require(result.returncode == 0, f"{Path(args[0]).name} failed: " +
                (result.stderr or result.stdout).decode(errors="replace")[:1500])
        return result.stdout

    def disk(self, target):
        device = str(target)
        if not device.startswith("/dev/"):
            # diskutil does not accept arbitrary subdirectories; df also resolves
            # the writable Data volume beneath macOS firmlinks.
            rows = self.command(["/bin/df", "-P", device]).decode().splitlines()
            require(len(rows) == 2 and rows[1].split(), "Cannot resolve filesystem device")
            device = rows[1].split()[0]
        require(re.fullmatch(r"/dev/disk\d+(?:s\d+)*", device), "Nonlocal filesystem device rejected")
        return plistlib.loads(self.command(["/usr/sbin/diskutil", "info", "-plist", device]))

    def images(self):
        return plistlib.loads(self.command(["/usr/bin/hdiutil", "info", "-plist"])).get("images", [])

    def validate_source(self):
        trusted_path(self.source)
        require(self.source.resolve() == self.source and identity(self.source) == self.source_identity,
                "Source root changed")
        require(not self.mountpoint.is_symlink(), "Mountpoint symlink rejected")
        if os.path.lexists(self.mountpoint):
            trusted_path(self.mountpoint)
        source_disk = self.disk(self.source)
        require(source_disk.get("Internal") is True, "Source checkout must remain on an internal volume")
        require(source_disk.get("GlobalPermissionsEnabled") is True,
                "Source and control filesystem must honor stored file ownership")
        require(self.config.stat().st_dev == self.source.stat().st_dev,
                "Configuration and state must share the source's internal filesystem")

    def validate_image(self):
        self.validate_source()
        require(self.image.resolve() == self.image, "Image path changed")
        info = self.image.lstat()
        owned(info)
        trusted_path(self.image)
        require((self.image.suffix == ".sparseimage" and stat.S_ISREG(info.st_mode) and info.st_nlink == 1) or
                (self.image.suffix == ".sparsebundle" and stat.S_ISDIR(info.st_mode)),
                "Only plain sparseimage files or sparsebundle directories are supported")
        require(not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) == 0o700,
                "Sparsebundle root must be private (0700)")
        require(info.st_ino == self.settings["imageFileId"], "Image inode changed")
        disk = self.disk(self.image)
        require(disk.get("VolumeUUID", "").upper() == self.settings["externalVolumeUUID"] and
                disk.get("Writable") is True and disk.get("Internal") is False,
                "Expected writable external volume is unavailable")
        require(disk.get("GlobalPermissionsEnabled") is True, "Backing volume must honor stored file ownership")
        require(disk.get("BusProtocol") and disk["BusProtocol"] != "Disk Image",
                "Backing must be a physical external disk, not a nested disk image")
        require(self.source.stat().st_dev != info.st_dev, "Source root must remain on a different volume")
        return identity(self.image)

    def matching_image(self):
        rows = [i for i in self.images() if i.get("image-path") == str(self.image)]
        require(len(rows) <= 1, "Image attached more than once")
        return rows[0] if rows else None

    def reject_duplicate_uuid(self, allowed_image=None):
        for row in self.images():
            if row.get("image-path") == allowed_image:
                continue
            for entity in row.get("system-entities", []):
                info = self.disk(entity["dev-entry"])
                if info.get("FilesystemType") == "apfs":
                    require(info.get("VolumeUUID", "").upper() != self.settings["apfsVolumeUUID"],
                            "Expected APFS UUID is already attached; cloned backups must not be reused")

    def volume(self, row):
        entities = row.get("system-entities", [])
        # hdiutil info omits volume-kind/potentially-mountable, unlike attach.
        volumes = [(entity, self.disk(entity.get("dev-entry", ""))) for entity in entities]
        volumes = [(entity, info) for entity, info in volumes if info.get("FilesystemType")]
        require(len(volumes) == 1, "Runtime image must contain exactly one filesystem volume")
        volume, info = volumes[0]
        device = volume.get("dev-entry", "")
        require(re.fullmatch(r"/dev/disk\d+s\d+", device), "Invalid APFS device")
        require(info.get("FilesystemType") == "apfs" and
                info.get("VolumeUUID", "").upper() == self.settings["apfsVolumeUUID"],
                "APFS runtime UUID mismatch")
        require(info.get("Writable") is True, "Runtime volume must be writable")
        roots = [e.get("dev-entry", "") for e in entities if e.get("content-hint") == "GUID_partition_scheme"]
        require(len(roots) == 1 and re.fullmatch(r"/dev/disk\d+", roots[0]), "Image device identity is ambiguous")
        return device, roots[0], info

    def state(self):
        if not os.path.lexists(self.state_path):
            return None
        state = private_json(self.state_path)
        require(state.get("binding") == self.binding and state.get("version") == 1,
                "State belongs to a different configuration")
        require(type(state.get("created")) is bool and type(state.get("originalMode")) is int,
                "Invalid mountpoint state")
        require(0 <= state["originalMode"] <= 0o7777 and not state["originalMode"] & 0o022,
                "Unsafe original mountpoint mode")
        return state

    def verify_underlying(self, state):
        self.validate_source()
        require(not os.path.ismount(self.mountpoint), "Runtime is still mounted")
        info = self.mountpoint.lstat()
        owned(info)
        require(stat.S_ISDIR(info.st_mode) and info.st_ino == state["mountpointInode"],
                "Underlying mountpoint identity changed")
        source_disk = self.disk(self.source)
        require(source_disk.get("VolumeUUID") == state["sourceVolumeUUID"], "Source volume changed")

    def prepare_mountpoint(self):
        self.validate_source()
        require(not os.path.ismount(self.mountpoint), "Refusing to cover a mounted directory")
        state = self.state()
        if state:
            self.verify_underlying(state)
            require(stat.S_IMODE(self.mountpoint.stat().st_mode) == 0, "Unmounted mountpoint must be guarded (000)")
            self.empty_guarded(state)
            return state
        created = not os.path.lexists(self.mountpoint)
        source_uuid = self.disk(self.source).get("VolumeUUID")
        require(source_uuid, "Source volume UUID missing")
        if created:
            self.mountpoint.mkdir(mode=0o500)
        info = self.mountpoint.lstat()
        owned(info)
        trusted_path(self.mountpoint)
        require(stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) & 0o500 == 0o500,
                "An existing empty mountpoint must be readable; refusing unknown guarded directory")
        require(not list(self.mountpoint.iterdir()), "Nonempty .local is never moved or covered")
        state = {"version": 1, "binding": self.binding, "created": created,
                 "originalMode": stat.S_IMODE(info.st_mode), "mountpointInode": info.st_ino,
                 "sourceVolumeUUID": source_uuid}
        try:
            write_private(self.state_path, state)
        except BaseException:
            if created and identity(self.mountpoint)[:2] == [info.st_dev, info.st_ino]:
                os.rmdir(self.mountpoint)
            raise
        os.chmod(self.mountpoint, 0o500, follow_symlinks=False)
        require(not list(self.mountpoint.iterdir()), "Mountpoint changed before guarding; inspect state manually")
        os.chmod(self.mountpoint, 0, follow_symlinks=False)
        return state

    def empty_guarded(self, state):
        self.verify_underlying(state)
        os.chmod(self.mountpoint, 0o500, follow_symlinks=False)
        try:
            require(not list(self.mountpoint.iterdir()), "Unexpected files under unmounted runtime; inspect manually")
        finally:
            os.chmod(self.mountpoint, 0, follow_symlinks=False)

    def check(self):
        self.validate_image()
        state = self.state()
        row = self.matching_image()
        if os.path.ismount(self.mountpoint):
            require(row is not None and state is not None, "Mounted root has no matching image/controller state")
            device, _, info = self.volume(row)
            require(info.get("MountPoint") == str(self.mountpoint) and
                    self.disk(self.mountpoint).get("DeviceNode") == device, "Wrong mountpoint or image association")
            require(info.get("GlobalPermissionsEnabled") is True, "Runtime must honor stored file ownership")
            self.reject_duplicate_uuid(allowed_image=str(self.image))
            return {"mounted": True, "mountpoint": str(self.mountpoint), "device": device,
                    "volumeUUID": self.settings["apfsVolumeUUID"]}
        require(row is None, "Image is attached elsewhere; leave it alone and inspect manually")
        if state:
            self.verify_underlying(state)
            require(stat.S_IMODE(self.mountpoint.stat().st_mode) == 0, "Unmounted mountpoint is not guarded")
        return {"mounted": False, "mountpoint": str(self.mountpoint), "guarded": bool(state)}

    def mount(self):
        image_identity = self.validate_image()
        if os.path.ismount(self.mountpoint):
            return self.check()
        require(self.matching_image() is None, "Image already attached; refusing another attachment")
        self.reject_duplicate_uuid()
        self.prepare_mountpoint()
        require(identity(self.image) == image_identity, "Image changed before attach")
        previous_devices = {entity.get("dev-entry") for row in self.images()
                            for entity in row.get("system-entities", [])}
        row = plistlib.loads(self.command(["/usr/bin/hdiutil", "attach", str(self.image),
                                          "-nomount", "-nobrowse", "-noautoopen", "-owners", "on", "-plist"]))
        roots = [e.get("dev-entry", "") for e in row.get("system-entities", [])
                 if e.get("content-hint") == "GUID_partition_scheme"]
        try:
            require(all(e.get("dev-entry") not in previous_devices for e in row.get("system-entities", [])),
                    "Attach returned a pre-existing device; refusing to take ownership")
            device, _, info = self.volume(row)
            require(not info.get("Mounted") and not info.get("MountPoint"), "Attached volume unexpectedly mounted")
            require(identity(self.image) == image_identity, "Image changed during attach")
            self.validate_source()
            self.verify_underlying(self.state())
            self.command(["/usr/sbin/diskutil", "mount", "nobrowse", "-mountOptions", "owners",
                          "-mountPoint", str(self.mountpoint), device])
            return self.check()
        except BaseException:
            current = self.matching_image()
            if (len(roots) == 1 and re.fullmatch(r"/dev/disk\d+", roots[0]) and
                    roots[0] not in previous_devices and current and identity(self.image) == image_identity and
                    any(e.get("dev-entry") == roots[0] for e in current.get("system-entities", []))):
                self.command(["/usr/bin/hdiutil", "detach", roots[0]])
            raise

    def unmount(self):
        result = self.check()
        if not result["mounted"]:
            return result
        row = self.matching_image()
        device, image_device, _ = self.volume(row)
        # Disk Arbitration's busy-volume refusal is authoritative; never force it.
        self.command(["/usr/sbin/diskutil", "unmount", device])
        self.verify_underlying(self.state())
        require(stat.S_IMODE(self.mountpoint.stat().st_mode) == 0, "Underlying mountpoint lost its guard")
        self.command(["/usr/bin/hdiutil", "detach", image_device])
        return self.check()

    def restore_empty(self):
        self.validate_source()
        state = self.state()
        require(state is not None, "No controller-owned mountpoint state")
        require(self.matching_image() is None, "Image is attached; unmount it first")
        self.empty_guarded(state)
        if state["created"]:
            os.rmdir(self.mountpoint)
        else:
            os.chmod(self.mountpoint, state["originalMode"], follow_symlinks=False)
            if stat.S_IMODE(self.mountpoint.stat().st_mode) != state["originalMode"]:
                os.chmod(self.mountpoint, 0, follow_symlinks=False)
                raise Refused("Original directory mode was not restored; mountpoint re-guarded and state retained")
        self.state_path.unlink()
        return {"restoredEmptyMountpoint": True, "removedNewEmptyDirectory": state["created"]}

    @contextlib.contextmanager
    def locked(self, image_required=True):
        source_fd = os.open(self.source, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        fd = None
        try:
            fcntl.flock(source_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.validate_source()
            if image_required:
                self.validate_image()
                fd = os.open(self.lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
                trusted_path(self.lock_path)
                info = os.fstat(fd)
                owned(info)
                require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and
                        stat.S_IMODE(info.st_mode) == 0o600, "Unsafe controller lock")
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            yield
        finally:
            if fd is not None:
                os.close(fd)
            os.close(source_fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["check", "mount", "unmount", "restore-empty"])
    parser.add_argument("--config", required=True, type=Path)
    args = parser.parse_args()
    require(sys.platform == "darwin", "This controller is macOS-only")
    require(os.geteuid() != 0, "Run as the regular asset owner, never root or sudo")
    controller = Controller(args.config)
    method = getattr(controller, args.command.replace("-", "_"))
    if args.command == "check":
        result = method()
    else:
        with controller.locked(image_required=args.command != "restore-empty"):
            result = method()
    print(json.dumps({"ok": True, **result}))


if __name__ == "__main__":
    try:
        main()
    except (Refused, OSError, ValueError, subprocess.SubprocessError) as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=sys.stderr)
        raise SystemExit(1)
