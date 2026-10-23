"""Resolve externally installed private data without relocating model bytes."""
import os
from pathlib import Path


RUNTIME_ENV = "QCUT_BODY_PHOTO_RUNTIME_ROOT"


def runtime_root(*, body_root):
    supplied = os.environ.get(RUNTIME_ENV)
    if supplied is None:
        return Path(body_root).parent / "runtime"
    root = Path(supplied)
    if not root.is_absolute() or not root.is_dir():
        raise ValueError("external body photo runtime must be an existing absolute directory")
    if any(parent.is_symlink() for parent in (root, *root.parents)):
        raise ValueError("external body photo runtime cannot use symlink directories")
    return root
