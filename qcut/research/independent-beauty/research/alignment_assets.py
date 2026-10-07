"""Export initialized private alignment tables from a hash-bound native capture."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

from alignment_transform import target_points

LENS_SHA256 = "fdf576dd066a11db7b54d815621893ed62a8ed223e22834d5753738dc66df161"
CONTENT_SHA256 = "3582fc2bd84b0ee1b03c4c516684951491bb43c04374d472397afce03dfafac1"


def validate(*, values):
    if set(values) != {"order", "mean", "lens_sha256"} or str(values["lens_sha256"]) != LENS_SHA256:
        raise ValueError("pinned alignment table provenance required")
    order, mean = values["order"], values["mean"]
    if order.dtype != np.int32 or order.shape != (106,) or set(order.tolist()) != set(range(106)):
        raise ValueError("alignment order must be a 106-index permutation")
    target_points(mean=mean)
    return hashlib.sha256(order.tobytes() + mean.tobytes()).hexdigest()


def extract(*, capture, capture_sha256):
    if capture.stat().st_size > 32 * 1024**2:
        raise ValueError("capture exceeds budget")
    data = capture.read_bytes()
    if hashlib.sha256(data).hexdigest() != capture_sha256:
        raise ValueError("capture identity changed")
    report = json.loads(data)
    if not report["passed"] or not report["observer_pixel_parity_verified"] or len(report["geometry_snapshots"]) != 26:
        raise ValueError("passed initialized alignment capture required")
    lens = Path(report["runtime"]) / "Frameworks/liblens.dylib"
    if hashlib.sha256(lens.read_bytes()).hexdigest() != LENS_SHA256:
        raise ValueError("unsupported alignment runtime identity")
    # These tables are zero in the on-disk dylib and populated during model init.
    tables = report["geometry_snapshots"][0]["tables"]
    values = {"order": np.asarray(tables["order"], np.int32),
              "mean": np.asarray(tables["base"], np.float32).reshape(106, 2), "lens_sha256": np.asarray(LENS_SHA256)}
    if validate(values=values) != CONTENT_SHA256 or any(row["tables"] != tables for row in report["geometry_snapshots"]):
        raise ValueError("initialized alignment tables changed")
    if capture.read_bytes() != data:
        raise ValueError("capture changed during extraction")
    return values


def load_assets(*, path):
    if path.stat().st_size > 64 * 1024:
        raise ValueError("alignment asset exceeds budget")
    with np.load(path, allow_pickle=False) as archive:
        values = {key: archive[key].copy() for key in archive.files}
    if validate(values=values) != CONTENT_SHA256:
        raise ValueError("alignment table content changed")
    for value in values.values():
        value.setflags(write=False)
    return values


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", type=Path, required=True)
    parser.add_argument("--capture-sha256", required=True)
    parser.add_argument("--runtime", type=Path, default=Path(__file__).resolve().parents[1] / "runtime")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    runtime = args.runtime.resolve()
    if args.output.suffix != ".npz" or args.output.exists() or not args.output.resolve().is_relative_to(runtime):
        parser.error("fresh private .npz under runtime/ required")
    values = extract(capture=args.capture, capture_sha256=args.capture_sha256)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    np.savez(args.output, **values)
    print(validate(values=values))
