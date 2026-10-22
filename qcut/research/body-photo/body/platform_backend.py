"""Explicit backend selection; the existing Mac default remains Metal."""
import os
import sys


def select_backend(*, backend="auto", platform=None):
    platform = sys.platform if platform is None else platform
    if backend not in ("auto", "metal", "cpu"):
        raise ValueError("body backend must be auto, metal or cpu")
    if platform not in ("darwin", "win32", "linux"):
        raise ValueError("body photos support macOS, Windows and Linux")
    if backend == "auto" and os.environ.get("QCUT_BODY_PHOTO_CPU") == "1":
        backend = "cpu"
    selected = ("metal" if platform == "darwin" else "cpu") if backend == "auto" else backend
    if selected == "metal" and platform != "darwin":
        raise ValueError("Metal body rendering requires macOS")
    return selected


def backend_label(*, backend):
    return {"metal": "macOS-Metal", "cpu": "portable-CPU"}[backend]
