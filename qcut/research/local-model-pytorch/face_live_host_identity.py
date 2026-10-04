"""Stable development helper identity; never grants or resets macOS permissions.

The helper stays under the same repository's .local directory. Only executable
code is reused; every audit still owns fresh pixels, baseline and worker state.
"""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile

import face_live_bridge_bundle as bundle
from face_alignment_replay import strict_json
from face_temporal_campaign import file_fingerprint

IDENTIFIER = "com.qcut.beauty-lab.live-host"
SIGNING_ENV = "QCUT_BEAUTY_LAB_SIGNING_IDENTITY"
DIRECTORY = bundle.HERE.parents[1] / ".local/jianying-model-pytorch/beauty-live-host"


def select_identity(*, text, requested=None):
    identities = dict(re.findall(r'^\s*\d+\) ([A-Fa-f0-9]{40}) "(Apple Development:[^"\n]+)"$',
                                text, re.MULTILINE))
    identities = {key.upper(): value for key, value in identities.items()}
    if requested:
        if requested.upper() not in identities:
            raise ValueError(f"{SIGNING_ENV} must name an available Apple Development certificate SHA-1")
        return requested.upper()
    if len(identities) != 1:
        raise ValueError(f"Stable live host requires one Apple Development signing identity; "
                         f"select its certificate SHA-1 using {SIGNING_ENV} (no ad-hoc fallback)")
    return next(iter(identities))


def command_output(*, command, name, scope, out):
    log = out / f"host-identity-{name}.log"
    process = scope.spawn(command=command, environment=bundle.system_environment(), stdout=log)
    scope.wait(process=process, timeout=30)
    scope.finish(process=process)
    if log.stat().st_size > 128 * 1024:
        raise ValueError("helper identity output exceeds budget")
    return log.read_text()


def signature_record(*, text):
    fields = dict(line.split("=", 1) for line in text.splitlines() if "=" in line and not line.startswith("#"))
    requirement = re.findall(r'^designated => (.+)$', text, re.MULTILINE)
    team, cdhash = fields.get("TeamIdentifier", ""), fields.get("CDHash", "")
    if (fields.get("Identifier") != IDENTIFIER or not re.fullmatch(r"[A-Z0-9]{10}", team)
            or not re.fullmatch(r"[a-f0-9]{40}", cdhash) or "adhoc" in text
            or len(requirement) != 1 or "cdhash" in requirement[0]
            or f'identifier "{IDENTIFIER}"' not in requirement[0]
            or "anchor apple" not in requirement[0] or "certificate leaf" not in requirement[0]
            or "Authority=Apple Development:" not in text):
        raise ValueError("live host lacks a stable Apple Development designated requirement")
    return dict(identifier=IDENTIFIER, team=team, cdhash=cdhash, requirement=requirement[0])


def inspect_signature(*, host, scope, out, name):
    command_output(command=["/usr/bin/codesign", "--verify", "--strict", str(host)],
                   name=f"{name}-verify", scope=scope, out=out)
    return signature_record(text=command_output(
        command=["/usr/bin/codesign", "-d", "-r-", "--verbose=4", str(host)],
        name=f"{name}-display", scope=scope, out=out))


def private_directory(*, directory):
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.resolve(strict=True) != directory.absolute():
        raise ValueError("stable helper path cannot contain symlinks")
    info = directory.stat()
    if info.st_uid != os.getuid() or info.st_mode & 0o022:
        raise ValueError("stable helper directory must be owned by this user and not writable by others")


@contextmanager
def helper_lease(*, audit, cleanup, directory=DIRECTORY):
    import fcntl

    private_directory(directory=directory)
    descriptor = os.open(directory / "host.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    marker = directory / "active-audit.json"
    started = False
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1 or info.st_mode & 0o077:
            raise ValueError("stable helper lease must be a private regular file")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError("Stable live host is in use; finish the other audit before retrying") from error
        if marker.exists() or marker.is_symlink():
            raise RuntimeError("Previous stable-host audit did not confirm cleanup; inspect active-audit.json "
                               "and its process report before manually clearing that marker")
        bundle.write_json(path=marker, value=dict(pid=os.getpid(), audit=str(audit)))
        started = True
        yield directory
    finally:
        try:
            if started and cleanup.get("completed") is True:
                marker.unlink()
        finally:
            os.close(descriptor)


def recipe_digest(*, command, identity, toolchain, dependencies):
    sources = {path: value["sha256"] for tree in dependencies["trees"] if tree["source"]
               for path, value in tree["files"].items()}
    libraries = {path: value["sha256"] for path, value in dependencies["libraries"].items()}
    value = dict(schema=1, command=command, identity=identity, identifier=IDENTIFIER,
                 toolchain=toolchain, sources=sources, libraries=libraries)
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def read_receipt(*, path, host):
    for file in (path, host):
        if file.is_symlink():
            raise ValueError("stable helper artifacts cannot be symlinks")
    if not path.exists():
        if host.exists():
            raise ValueError("stable helper without provenance receipt; inspect the interrupted build")
        return None
    if not path.is_file() or path.stat().st_size > 16 * 1024:
        raise ValueError("invalid stable helper receipt")
    value = strict_json(data=path.read_bytes())
    if (type(value) is not dict or set(value) != {"recipe", "sha256", "identity", "signature"}
            or value["sha256"] != file_fingerprint(path=host)["sha256"]):
        raise ValueError("stable helper bytes differ from receipt; refusing reuse or silent replacement")
    return value


def prepare_host(*, directory, runtime, scope, out, guard):
    identity = select_identity(text=command_output(
        command=["/usr/bin/security", "find-identity", "-v", "-p", "codesigning"],
        name="identities", scope=scope, out=out), requested=os.environ.get(SIGNING_ENV))
    toolchain = command_output(command=["xcrun", "clang++", "--version"], name="compiler", scope=scope, out=out)
    toolchain += command_output(command=["xcrun", "--find", "clang++"], name="compiler-path", scope=scope, out=out)
    toolchain += command_output(command=["xcrun", "--show-sdk-path"], name="sdk", scope=scope, out=out)
    toolchain += command_output(command=["xcrun", "--show-sdk-build-version"], name="sdk-build", scope=scope, out=out)
    host, receipt_path = directory / "live-host", directory / "receipt.json"
    command = bundle.compile_commands(runtime=runtime, out=directory)["live"]
    recipe = recipe_digest(command=command, identity=identity, toolchain=toolchain, dependencies=guard.evidence())
    previous = read_receipt(path=receipt_path, host=host)
    if previous:
        actual = inspect_signature(host=host, scope=scope, out=out, name="previous")
        if actual != previous["signature"]:
            raise ValueError("stable helper signature differs from receipt")
        if previous["identity"] != identity:
            raise ValueError("stable helper signer changed; explicitly review the local helper before rebuilding")
    reused = previous is not None and previous["recipe"] == recipe
    if not reused:
        # Rename after signing; never overwrite a running mapped Mach-O in place.
        with tempfile.TemporaryDirectory(prefix=".build-", dir=directory) as temporary:
            staging = Path(temporary)
            binary = staging / "live-host"
            build = [*command[:-1], str(binary)]
            process = scope.spawn(command=build, environment=bundle.system_environment(), stdout=out / "compile-live.log")
            scope.wait(process=process, timeout=180)
            scope.finish(process=process)
            command_output(command=["/usr/bin/codesign", "--force", "--sign", identity,
                "--identifier", IDENTIFIER, "--timestamp=none", str(binary)], name="sign", scope=scope, out=out)
            signature = inspect_signature(host=binary, scope=scope, out=out, name="built")
            if previous and signature["requirement"] != previous["signature"]["requirement"]:
                raise ValueError("rebuild changed the live host designated requirement")
            guard.verify()
            receipt = dict(recipe=recipe, sha256=file_fingerprint(path=binary)["sha256"],
                           identity=identity, signature=signature)
            bundle.write_json(path=staging / "receipt.json", value=receipt)
            os.replace(binary, host)
            os.replace(staging / "receipt.json", receipt_path)
    else:
        receipt = previous
    for source, name, maximum, expected in (
        (host, "live-host.snapshot", 128 * 1024**2, receipt["sha256"]),
        (receipt_path, "live-host-receipt.json", 16 * 1024, None),
    ):
        data = guard.locked.read(path=source, maximum=maximum, expected=expected)
        # Electron consumes immutable job evidence after this lease is released.
        with (out / name).open("xb") as stream:
            stream.write(data)
        guard.locked.read(path=out / name, maximum=maximum,
                          expected=hashlib.sha256(data).hexdigest())
    return dict(path=str(host), reused=reused, **receipt, permission_granted_by_launcher=False,
                desktop_authorization="macOS user decision; stable identity does not grant access")
