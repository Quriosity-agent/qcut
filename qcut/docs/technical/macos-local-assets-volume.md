# Mount a private `.local` runtime on macOS

`scripts/macos-local-assets-volume.py` mounts an **already prepared and verified**
APFS runtime image at a checkout's original `.local` path. The source checkout
stays on the internal disk. Unlike a `.local` symlink, a real mount preserves the
canonical path used by existing research guards and absolute virtualenv shebangs.
The tool does not change those guards.

This is a mount controller, not a data migration or backup tool. It does not
create images, copy or delete asset payloads, install login jobs, change QCut's
configuration, or close applications. A successful `check` proves the mount
association, not model compatibility, complete backup coverage or migration
acceptance. Stop relevant consumers before any separately managed data migration.

## Prepare a private configuration

Use a separate working image, preserving the immutable backups. Its APFS volume
must have a unique UUID; cloning a sparse image also clones its volume UUID.
Only a plain `.sparseimage` file or `.sparsebundle` directory containing one
filesystem volume is supported. The backing disk must be an attached writable
external disk, and the runtime volume must be writable APFS.
The backing filesystem must also honor stored ownership. Shared external-volume
roots writable by other users, or ownership-ignored backing disks, are refused;
placing an image inside a private subdirectory alone does not fix an ancestor
that lets other users replace that subdirectory. Plan permissions separately;
the controller never changes an existing disk's settings or ACLs. A sparsebundle
root must be private (`0700`) so its internal bands cannot be reached by others.
Nested disk-image backing and an unknown backing bus protocol are refused.
Do not wrap an image on an untrusted shared disk in another image to bypass these
requirements; the outer image would still be replaceable. This controller targets
a trusted physical external disk and does not audit chains of backing images.
Mounting explicitly honors stored ownership; `check` rejects an ownership-ignored
mount so the existing user/permission guards retain their meaning. This sets the
runtime mount options, not ownership preferences on the backing external disk.

Keep the JSON outside the image and `.local`, in a directory owned by the current
user and not writable by other users, on the same internal, ownership-enabled
filesystem as the source checkout. Give the file mode `0600`. All paths must
be absolute, canonical and free of symlinks or `.` / `..` components. Example
values below are placeholders, not a runnable migration plan:

```json
{
  "sourceRoot": "/Users/you/code/qcut/qcut",
  "image": "/Volumes/Assets/QCutRuntime/QCutLocal.sparseimage",
  "externalVolumeUUID": "11111111-1111-1111-1111-111111111111",
  "apfsVolumeUUID": "22222222-2222-2222-2222-222222222222",
  "imageFileId": 123456
}
```

Use the backing and runtime UUIDs from the independently verified preparation
receipt. `imageFileId` is the image file/directory inode, obtainable with
`stat -f '%i' /absolute/image/path`. The backing UUID, canonical image path,
inode and owner bind the image; size, mtime and payload hash are deliberately not
frozen because a runtime image grows and changes. Copying/replacing that image
requires a separately verified new configuration, not just ignoring a mismatch.

Run as the ordinary asset owner. Root/sudo is refused because root bypasses the
offline directory permissions.

Trusted files, directories and their ancestors are inspected using native macOS
ACL APIs. The conservative policy accepts no ACL or deny-only entries (including
the common `everyone deny delete` entry) and rejects **all allow entries**, even
read-only or owner-specific grants. An owner allow grant can bypass mode `000`.
Ancestors must belong to root or the current user and not permit other users to
write, except a trusted sticky ancestor protecting an already existing trusted
child. Shared leaf directories are still refused. ACLs are never removed or
rewritten to make a check pass.

```sh
python3 -B scripts/macos-local-assets-volume.py check --config /absolute/private/volume.json
python3 -B scripts/macos-local-assets-volume.py mount --config /absolute/private/volume.json
python3 -B scripts/macos-local-assets-volume.py unmount --config /absolute/private/volume.json
```

`check` performs no writes. `mount` refuses an existing nonempty `.local`, a
symlink, an unexpected mount, a previously attached image, a duplicated APFS
UUID or a mismatched image/volume. It attaches without mounting first, verifies
the APFS UUID, and only then mounts at `.local`. Repeating `mount` on the correct
already mounted volume is harmless.

## Offline behavior and recovery

For an absent `.local`, the controller creates only an empty mountpoint. For an
existing empty directory, it records its inode, original mode and source volume.
State is stored beside the config as `volume.json.state.json`. The underlying
empty directory is guarded with mode `000` before mounting and after unmounting.
Ordinary consumers therefore fail rather than silently write fresh data onto the
internal disk while the image is unavailable. Do not remove this guard or edit
the state file to bypass an error.
The original complete permission mode, including special bits such as directory
setgid (`2700`), is retained for empty-directory restoration.

Controllers serialize on the source directory and an image-specific private
`.qcut-mount.lock` file beside the image, including when different configuration
filenames are used. This empty lock file is not asset payload.

`unmount` verifies the current mount/image/UUID association and uses normal
Disk Arbitration unmounting. A busy volume is left mounted; there is no force
option. If unmount succeeds but image detach fails, the image may remain attached
without a mounted filesystem. Subsequent operations refuse that ambiguous state.
Inspect `hdiutil info -plist`, the device association and the saved state before
manually detaching only the identified idle runtime image. Likewise, an attach
timeout or process termination may require inspection; this tool does not claim
automatic recovery from every interrupted native operation.

Once the image is detached, this command restores **only the empty mountpoint**:

```sh
python3 -B scripts/macos-local-assets-volume.py restore-empty --config /absolute/private/volume.json
```

It removes a directory only if this controller created it and it is still the
same empty, unmounted directory. Otherwise it restores the recorded mode of the
pre-existing empty directory. It never restores, removes or moves actual assets.
It refuses mounted, replaced or nonempty paths. Retained original assets need
their own verified restoration procedure.

## Migration boundaries that remain

- Preserve ordinary files, permissions, xattrs, ACLs, internal hardlinks, symlinks
  and any supported special files when preparing the runtime image; do not
  dereference existing external archives into another giant duplicate.
- Moving to another volume changes device/inode identities. Quiesce consumers
  and initialize fresh runtime leases/snapshots after switching. Historic
  identity evidence is not automatically an acceptance record for the new copy.
- Hardlinks crossing the `.local` boundary cannot retain a shared inode across
  volumes. Byte-equivalent copies lose shared-write behavior, and a historical
  producer using `os.link` can fail with `EXDEV` when recreating missing files.
  Classify these links explicitly; this controller does not rewrite old research
  scripts or silently change their semantics.
- Absolute paths can remain valid while dependencies still reside elsewhere:
  Homebrew Python, private native runtimes, other external volumes and source
  trees need separate coverage. A successful small venv/shebang test does not
  prove every environment or native model works after relocation.
- Validate actual model loading, old reports/projects, new output, save/reopen,
  export, startup and performance using the chosen runtime copy. Keep the local
  originals until those checks and the separate cleanup authorization are met.

## Tests

The test suites require macOS. Disk commands are mocked; additional native ACL
tests use fresh temporary fixtures and modify only those fixtures' ACLs. Coverage includes path/identity/UUID failures,
nonempty and replaced roots, wrong mounts, duplicate attachments, offline
permissions, shared locks, busy unmounts, partial detach failures and narrow
empty-directory restoration:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -B -m unittest discover \
  -s scripts/__tests__ -p 'macos_local_assets_*_test.py' -v
```

Real disk tests must use a new small image and an isolated synthetic source root.
Check the current TypeScript/Python guards, absolute shebang behavior, offline
write refusal, wrong-UUID cleanup and busy-unmount refusal. Never run fixture
setup or destructive cleanup against a user's real `.local`.
