"""CPU-only historical byte-oracle comparison, not a full-chain acceptance probe.

Require the original capture report's SHA explicitly. Validate only its source
RGBA and captured algorithm RGBA subset. Never repair historical source hashes,
load a native runtime, supply captured pixels to the sampler, or connect a backend.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

import numpy as np

from face_alignment_replay import LockedFiles, valid_hash
from face_full_frame_quantization import hypotheses, resize_rgba

SOURCE_SIZE = (1448, 1086)
TARGET_SIZE = (640, 480)
TARGET_BYTES = 640 * 480 * 4


def prediction_frame(*, index):
    if type(index) is not int or not 0 <= index < 26:
        raise ValueError("ordered 26-observation profile required")
    return 0 if index < 12 else (index - 12) // 2


def expected_hash(*, fixtures, path):
    expected = fixtures.get(str(path))
    if not valid_hash(value=expected):
        raise ValueError(f"historical byte identity missing: {path.name}")
    return expected


def regular_path(*, path):
    path = path.absolute()
    if path.resolve(strict=True) != path or not path.is_file():
        raise ValueError("regular non-symlink input required")
    return path


def read_rgba(*, path, size, expected, locked):
    count = size[0] * size[1] * 4
    raw = locked.read(path=regular_path(path=path), maximum=count, expected=expected)
    if len(raw) != count:
        raise ValueError("packed RGBA byte count differs")
    return np.frombuffer(raw, np.uint8).reshape(size[1], size[0], 4)


def load_oracles(*, root, report_sha256, locked):
    if not valid_hash(value=report_sha256):
        raise ValueError("explicit historical report SHA-256 required")
    root = root.absolute()
    report = locked.json(path=regular_path(path=root / "report.json"), expected=report_sha256)
    if (report.get("passed") is not True or report.get("diagnostic_only") is not True or
            report.get("observer_pixel_parity_verified") is not True):
        raise ValueError("historically passed neutral capture required")
    fixtures = report.get("fixture_sha256")
    if not isinstance(fixtures, dict) or not 1 <= len(fixtures) <= 4096:
        raise ValueError("bounded historical identity map required")
    original = Path(report["capture"])
    if not original.is_absolute() or original.parent != root.parent or original == root:
        raise ValueError("original source capture must be a sibling directory")
    previous_path = regular_path(path=original / "report.json")
    previous = locked.json(path=previous_path,
                           expected=expected_hash(fixtures=fixtures, path=previous_path))
    source_rows, descriptors, snapshots = (previous.get("frames"), report.get("algorithm_frames"),
                                          report.get("geometry_snapshots"))
    if (not isinstance(source_rows, list) or len(source_rows) != 7 or
            not isinstance(descriptors, list) or len(descriptors) != 26 or
            not isinstance(snapshots, list) or len(snapshots) != 26):
        raise ValueError("all seven source slots and 26 observations required")
    sources = []
    for index, row in enumerate(source_rows):
        path = regular_path(path=original / f"input-{index:02d}.rgba")
        expected = expected_hash(fixtures=fixtures, path=path)
        if row.get("input_rgba_sha256") != expected:
            raise ValueError("source identity disagrees with original capture")
        sources.append(dict(path=path, sha256=expected))
    observations = []
    for index, (descriptor, snapshot) in enumerate(zip(descriptors, snapshots, strict=True)):
        request = snapshot.get("request")
        if (type(descriptor.get("prediction")) is not int or descriptor["prediction"] != index or
                type(snapshot.get("index")) is not int or snapshot["index"] != index or
                type(request) is not list or any(type(n) is not int for n in request) or
                request != [0, 640, 480, 2560, 0] or
                descriptor.get("file") != f"frame-{index}.rgba" or
                snapshot.get("frame_file") != descriptor["file"] or
                type(descriptor.get("bytes")) is not int or descriptor["bytes"] != TARGET_BYTES or
                type(snapshot.get("frame_bytes")) is not int or snapshot["frame_bytes"] != TARGET_BYTES):
            raise ValueError("typed packed unrotated observation contract differs")
        path = regular_path(path=root / "geometry" / descriptor["file"])
        expected = expected_hash(fixtures=fixtures, path=path)
        if descriptor.get("sha256") != expected:
            raise ValueError("algorithm identity disagrees with historical capture")
        pixels = read_rgba(path=path, size=TARGET_SIZE, expected=expected, locked=locked)
        observations.append(dict(prediction=index, frame_index=prediction_frame(index=index),
                                 sha256=expected, pixels=pixels))
    return sources, observations


def metrics(*, candidate, reference):
    if candidate.shape != reference.shape or candidate.dtype != np.uint8 or reference.dtype != np.uint8:
        raise ValueError("matching uint8 arrays required")
    delta = candidate.astype(np.int16) - reference.astype(np.int16)
    changed = int(np.count_nonzero(delta))
    return dict(equal=changed == 0, changed_channels=changed,
                changed_pixels=int(np.count_nonzero(np.any(delta, axis=2))),
                max_abs=int(np.abs(delta).max()),
                candidate_lower=int(np.count_nonzero(delta < 0)),
                candidate_higher=int(np.count_nonzero(delta > 0)),
                per_channel_changed=np.count_nonzero(delta, axis=(0, 1)).tolist())


def compare(*, sources, observations, modes, locked, out):
    if len(sources) != 7 or len(observations) != 26 or not modes:
        raise ValueError("nonempty full profile required")
    rows = [dict(prediction=row["prediction"], frame_index=row["frame_index"],
                 reference_sha256=row["sha256"], checks={}) for row in observations]
    for frame_index, source in enumerate(sources):
        pixels = read_rgba(path=source["path"], size=SOURCE_SIZE,
                           expected=source["sha256"], locked=locked)
        for name, options in modes.items():
            candidate = resize_rgba(frame=pixels, size=TARGET_SIZE, **options)
            candidate_sha256 = hashlib.sha256(candidate.tobytes()).hexdigest()
            if name == "staged-q11":
                with (out / f"candidate-{frame_index:02d}.rgba").open("xb") as stream:
                    stream.write(candidate.tobytes())
                locked.read(path=out / f"candidate-{frame_index:02d}.rgba",
                            maximum=TARGET_BYTES, expected=candidate_sha256)
            for index, observation in enumerate(observations):
                if observation["frame_index"] == frame_index:
                    rows[index]["checks"][name] = dict(
                        **metrics(candidate=candidate, reference=observation["pixels"]),
                        candidate_sha256=candidate_sha256)
    return rows


def run(*, capture, capture_sha256, out):
    out = out.absolute()
    if out.parent.resolve(strict=True) != out.parent:
        raise ValueError("non-symlink output parent required")
    out.mkdir(exist_ok=False)
    locked = LockedFiles()
    report = dict(profile="historical-full-frame-quantization-v1", completed=False,
                  diagnostic_only=True, cpu_only=True, sampling_parity=False,
                  current_full_chain_provenance_revalidated=False, native_caller_route_proven=False,
                  arbitrary_frame_backend_connected=False, product_parity_verified=False,
                  oracle_pixels_used_by_sampler=False, fitted_correction=False,
                  versions=dict(python=sys.version.split()[0], numpy=np.__version__),
                  algorithm="11-bit nearest-even weights; half-pixel float32 coordinates; "
                            "h=a0*p0+a1*p1; (((b0*(h0>>4))>>16)+((b1*(h1>>4))>>16)+2)>>2",
                  algorithm_reference="https://github.com/opencv/opencv/blob/4.11.0/modules/imgproc/src/resize.cpp",
                  scope="historical 1448x1086 RGBA -> 640x480; seven slots / 26 observations",
                  capture=str(capture.absolute()), capture_sha256=capture_sha256,
                  exact_modes=[], cases=[], failures=[])
    try:
        for name in ("face_full_frame_quantization.py", "face_full_frame_quantization_probe.py",
                     "face_alignment_replay.py"):
            locked.read(path=Path(__file__).with_name(name), maximum=128 * 1024)
        report["diagnostic_source_sha256"] = dict(locked.files)
        sources, observations = load_oracles(root=capture, report_sha256=capture_sha256, locked=locked)
        report["source_frames"] = [dict(path=str(row["path"]), sha256=row["sha256"]) for row in sources]
        report["unique_source_hashes"] = len({row["sha256"] for row in sources})
        report["unique_oracle_hashes"] = len({row["sha256"] for row in observations})
        report["compared_rgba_bytes_per_mode"] = len(observations) * TARGET_BYTES
        modes = hypotheses()
        report["hypotheses"] = modes
        report["cases"] = compare(sources=sources, observations=observations, modes=modes, locked=locked, out=out)
        report["exact_modes"] = [name for name in modes if all(row["checks"][name]["equal"] for row in report["cases"])]
        report["sampling_parity"] = bool(report["exact_modes"])
        locked.verify()
        report["completed"] = True
    except Exception as error:
        report.update(completed=False, sampling_parity=False, exact_modes=[])
        report["failures"].append(f"{type(error).__name__}: {error}")
        raise
    finally:
        report["fixture_sha256"] = dict(locked.files)
        with (out / "report.json").open("x") as stream:
            stream.write(json.dumps(report, indent=2, allow_nan=False) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", required=True, type=Path)
    parser.add_argument("--capture-sha256", required=True)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    report = run(capture=args.capture, capture_sha256=args.capture_sha256, out=args.out)
    print(json.dumps({name: report[name] for name in ("completed", "sampling_parity", "exact_modes")}))


if __name__ == "__main__":
    main()
