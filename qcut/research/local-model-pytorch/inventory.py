"""Enumerate the five audited runtime manifests, checking payload hashes first."""
import json
import pathlib

from espresso_archive import sha256

RUNTIMES = ("JianyingFilter", "JianyingShotSplit", "JianyingTracking", "JianyingMatting", "JianyingBasicVideo")


def manifest_sources(*, root):
    sources = []
    for runtime in RUNTIMES:
        current = root / runtime / "current"
        manifest = json.loads((current / "manifest.json").read_text())
        for entry in manifest["files"]:
            relative = pathlib.PurePosixPath(entry.get("path", entry.get("relativePath", "")))
            if relative.suffix not in {".model", ".bytenn", ".dat"}:
                continue
            if runtime == "JianyingFilter" and relative.parts[0] != "Models":
                continue
            if relative.is_absolute() or ".." in relative.parts:
                raise ValueError("unsafe manifest path")
            base = current / "Models" if runtime == "JianyingBasicVideo" else current
            path = base / relative
            if not path.resolve().is_relative_to(base.resolve()):
                raise ValueError("manifest path escapes runtime")
            if path.stat().st_size != entry["bytes"] or sha256(path=path) != entry["sha256"]:
                raise ValueError(f"runtime manifest mismatch: {runtime}/{relative}")
            sources.append(path)
    return sources
