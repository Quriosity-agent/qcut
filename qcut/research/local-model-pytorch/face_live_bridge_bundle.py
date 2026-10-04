"""CPU-only build/input preparation and immutable live-probe dependencies."""
from __future__ import annotations

import hashlib
import io
import json
import math
import os
from pathlib import Path

from face_alignment_replay import LockedFiles, strict_json
from face_alignment_warp_native import BYTENN_SHA256
from face_geometry_native import LIBRARY_SHA256 as LENS_SHA256
from face_render_injection_inventory import LIBRARY_SHA256 as CORE_SHA256
import face_render_consumer_probe as consumer
import face_render_sequence_probe as sequence
from face_temporal_campaign import TreeGuard, file_fingerprint

HERE = Path(__file__).resolve().parent
WARMUPS = 6
SYSTEM_KEYS = {"HOME", "PATH", "TMPDIR", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE"}


def system_environment():
    return {key: value for key, value in os.environ.items() if key in SYSTEM_KEYS}


def write_json(*, path, value):
    with path.open("x") as stream:
        json.dump(value, stream, indent=2, allow_nan=False)
        stream.write("\n")


class DependencyGuard:
    def __init__(self):
        self.locked, self.trees, self.libraries = LockedFiles(), [], {}

    def tree(self, *, directory, source=False):
        self.trees.append(TreeGuard(root=directory, source=source))

    def verify(self):
        for tree in self.trees:
            tree.verify()
        self.locked.verify()
        for name, fingerprint in self.libraries.items():
            if file_fingerprint(path=Path(name)) != fingerprint:
                raise RuntimeError("pinned native library identity changed")

    def library(self, *, path, expected):
        fingerprint = file_fingerprint(path=path)
        if fingerprint["sha256"] != expected:
            raise ValueError("pinned native library SHA256 mismatch")
        self.libraries[str(path)] = fingerprint

    def evidence(self):
        return dict(files=dict(self.locked.files), libraries=self.libraries,
                    trees=[dict(directory=str(tree.root), source=tree.source, files=tree.files) for tree in self.trees])


def lock_dependencies(*, runtime, package, models, guard):
    guard.tree(directory=HERE, source=True)
    guard.tree(directory=HERE.parent / "jianying-runtime-probe", source=True)
    guard.tree(directory=runtime / "Models")
    guard.tree(directory=package)
    guard.tree(directory=models)
    for name, expected in (("libcccreator.dylib", CORE_SHA256), ("libAGFX.dylib", consumer.GRAPHICS_SHA256),
                           ("liblens.dylib", LENS_SHA256), ("libbytenn.dylib", BYTENN_SHA256)):
        guard.library(path=runtime / "Frameworks" / name, expected=expected)


def prepare_inputs(*, manifest, out, guard, single_frame=False):
    from PIL import Image

    frames = sequence.validate_manifest(value=strict_json(data=guard.locked.read(
        path=manifest, maximum=sequence.MANIFEST_LIMIT)), base=manifest.parent, expect_change=True)
    if single_frame and len(frames) != 1:
        raise ValueError("single-frame audit requires exactly one input frame")
    if frames[0]["timestamp"] != 0:
        raise ValueError("the verified bootstrap profile starts at timestamp zero")
    if any(right["timestamp"] < left["timestamp"] for left, right in zip(frames, frames[1:])):
        raise ValueError("backward seek requires a new campaign/host/worker")
    size = None
    for index, frame in enumerate(frames):
        encoded = guard.locked.read(path=Path(frame["image"]), maximum=sequence.IMAGE_LIMIT)
        with Image.open(io.BytesIO(encoded)) as image:
            sequence.validate_dimensions(width=image.width, height=image.height, expected=size)
            size = image.size
            if image.width * image.height * 4 > 16 * 1024**2:
                raise ValueError("live profile limits full-frame RGBA to 16 MiB")
            pixels = image.convert("RGBA").tobytes()
        path = out / f"input-{index:02d}.rgba"
        path.write_bytes(pixels)
        guard.locked.read(path=path, maximum=16 * 1024**2)
        frame.update(input=str(path), input_sha256=hashlib.sha256(pixels).hexdigest())
    if not single_frame and len({frame["input_sha256"] for frame in frames}) < 2:
        raise ValueError("live acceptance requires at least two distinct input frames")
    return frames, size


def requests(*, frames, directory):
    rows = []
    for index in range(WARMUPS + len(frames)):
        warmup = index < WARMUPS
        frame_index = 0 if warmup else index - WARMUPS
        frame = frames[frame_index]
        name = f"warmup-{index}" if warmup else f"frame-{frame_index:02d}"
        output = consumer.protocol_path(path=directory / f"{name}.rgba")
        rows.append(dict(id=name, frame=frame_index, warmup=warmup, timestamp=frame["timestamp"],
                         timestamp_us=math.floor(frame["timestamp"] * 1e6 + 0.5), output=str(output)))
    text = "\n".join("\t".join(("render", row["id"], str(row["timestamp"]),
        str(consumer.protocol_path(path=Path(frames[row["frame"]]["input"]))), row["output"],
        consumer.parameters_json(text=json.dumps(frames[row["frame"]]["parameters"])))) for row in rows)
    return rows, text + "\nexit\n"


def compile_commands(*, runtime, out):
    common = ["xcrun", "clang++", "-std=c++20", "-fobjc-arc", "-g", "-O1", "-Wall", "-Wextra", "-Werror",
              "-Wno-deprecated-declarations"]
    frameworks = ["-framework", "AppKit", "-framework", "CoreVideo", "-framework", "IOSurface", "-framework", "OpenGL"]
    sources = consumer.source_files(original=True)
    live = [HERE / "face_live_bridge_host.mm", *(path for path in sources if path.name not in
                                               ("filter-host-main.mm", "filter-probe.mm"))]
    libraries = runtime / "Frameworks"
    return dict(baseline=[*common, *map(str, sources), *frameworks, "-o", str(out / "baseline-host")],
        live=[*common, "-Wl,-export_dynamic", *map(str, live), *frameworks, "-o", str(out / "live-host")],
        capture=["xcrun", "clang++", "-std=c++17", "-O1", "-Wall", "-Wextra", "-Werror",
            "-Wno-unused-function", "-dynamiclib", "-fobjc-arc", "-framework", "Foundation",
            f"-L{libraries}", "-llens", f"-Wl,-rpath,{libraries}", str(HERE / "face_live_bridge_capture.mm"),
            "-o", str(out / "live-capture.dylib")])


def host_environment(*, runtime, directory, width, height, live=False, socket=None, token=None, capture=None):
    env = system_environment()
    env.update(QCUT_FRAME_WIDTH=str(width), QCUT_FRAME_HEIGHT=str(height),
               DYLD_LIBRARY_PATH=str(runtime / "Frameworks"), QCUT_CONSUMER_RECORD=str(directory / "records.jsonl"))
    if live:
        if not all((socket, token, capture)):
            raise ValueError("live environment requires current session dependencies")
        env.update(QCUT_TRACE_UPDATES="1", QCUT_FACE_POINT_SHIFT="0", QCUT_FACE_LIVE_SOCKET=str(socket),
                   QCUT_FACE_LIVE_TOKEN=token, DYLD_INSERT_LIBRARIES=str(capture))
    return env
