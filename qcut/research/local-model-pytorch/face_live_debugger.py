"""Explicit debugger selection and file provenance; never launch or discover tools."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import stat

BINARY_LIMIT = 128 * 1024**2


def validated_binary(*, executable):
    if not isinstance(executable, (str, Path)):
        raise ValueError("explicit debugger path must be an absolute string or Path")
    text = str(executable)
    if not text or any(ord(character) < 32 or ord(character) == 127 for character in text):
        raise ValueError("explicit debugger path must not be empty or contain control characters")
    requested = Path(text)
    if not requested.is_absolute():
        raise ValueError("explicit debugger path must be absolute")
    try:
        resolved = requested.resolve(strict=True)
        status = resolved.stat()
    except (OSError, RuntimeError) as error:
        raise ValueError("explicit debugger path must resolve to an existing executable") from error
    if not stat.S_ISREG(status.st_mode) or not 0 < status.st_size <= BINARY_LIMIT:
        raise ValueError("explicit debugger requires a nonempty regular file of at most 128 MiB")
    if not status.st_mode & 0o111 or not os.access(resolved, os.X_OK):
        raise ValueError("explicit debugger file must be executable")
    return requested, resolved, status


def binary_identity(*, resolved, status):
    return [str(resolved), status.st_dev, status.st_ino, status.st_size, status.st_mtime_ns]


def lock_binary(*, executable, guard):
    requested, resolved, before = validated_binary(executable=executable)
    identity = binary_identity(resolved=resolved, status=before)
    digest = hashlib.sha256(guard.locked.read(path=requested, maximum=BINARY_LIMIT)).hexdigest()
    # Keep the alias locked too: a Homebrew upgrade must not silently retarget it.
    if requested != resolved:
        guard.locked.read(path=resolved, maximum=BINARY_LIMIT, expected=digest)
    _, current, after = validated_binary(executable=requested)
    if binary_identity(resolved=current, status=after) != identity or after.st_mode != before.st_mode:
        raise ValueError("debugger binary changed while locking selection")
    return dict(requested_path=str(requested), resolved_path=str(resolved), sha256=digest,
                size_bytes=before.st_size, identity=identity)


def resolve_debugger(*, executable=None, debugserver=None, guard):
    frontend = lock_binary(executable=executable, guard=guard) if executable is not None else None
    server = lock_binary(executable=debugserver, guard=guard) if debugserver is not None else None
    overrides = {"LLDB_DEBUGSERVER_PATH": server["resolved_path"]} if server is not None else {}
    return dict(executable=frontend["resolved_path"] if frontend is not None else None,
                environment_overrides=overrides,
                evidence=dict(selection="explicit" if frontend is not None else "default-xcrun",
                    executable=frontend, debugserver=server,
                    debugserver_selection="explicit" if server is not None else "lldb-default-unverified",
                    version_check_performed=False))


def command_prefix(*, executable=None):
    if executable is None:
        return ["xcrun", "lldb"]
    _, resolved, _ = validated_binary(executable=executable)
    return [str(resolved)]
