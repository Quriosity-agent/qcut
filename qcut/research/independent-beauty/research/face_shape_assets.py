"""Extract pinned private face coefficient tables; publish no table contents."""
import argparse
import hashlib
from pathlib import Path

import numpy as np

from slimface_mesh_assets import CORE_SHA256, address_bytes, arm64_image

TABLES = {"cut": (0x2ccdbbc, 33), "cheek": (0x2ccddf0, 14),
          "jaw": (0x2ccdf88, 18), "vface": (0x2cce060, 18),
          "chin": (0x2cce310, 17),
          "sharp_positive": (0x2cce3dc, 8), "sharp_negative": (0x2cce43c, 5)}
CONTENT_SHA256 = "5572071b6e4a7123df75ff90f98fed1be237efb3783a1c36d4900fccb8fb273f"


def validate_assets(*, values):
    if set(values) != set(TABLES):
        raise ValueError("unexpected face coefficient fields")
    digest = hashlib.sha256()
    for name in sorted(values):
        value = values[name]
        if value.shape != (TABLES[name][1], 3) or value.dtype != np.dtype("float32"):
            raise ValueError(f"invalid {name} coefficient dimensions")
        if not np.isfinite(value).all() or np.any(value[:, 0] != value[:, 0].astype(int)):
            raise ValueError(f"invalid {name} coefficients")
        if np.any(value[:, 0] < 0) or np.any(value[:, 0] >= 106):
            raise ValueError(f"invalid {name} landmark indices")
        digest.update(name.encode())
        digest.update(value.dtype.str.encode())
        digest.update(str(value.shape).encode())
        digest.update(value.tobytes())
    if digest.hexdigest() != CONTENT_SHA256:
        raise ValueError("face coefficient content changed")
    for value in values.values():
        value.setflags(write=False)
    return values


def load_assets(*, path):
    if path.stat().st_size > 64 * 1024:
        raise ValueError("face coefficient asset exceeds budget")
    with np.load(path, allow_pickle=False) as archive:
        return validate_assets(values={key: archive[key].copy() for key in archive.files})


def extract(*, runtime):
    data = (runtime / "Frameworks/libcccreator.dylib").read_bytes()
    if hashlib.sha256(data).hexdigest() != CORE_SHA256:
        raise ValueError("unsupported face coefficient library")
    image = arm64_image(data=data)
    values = {name: np.frombuffer(address_bytes(image=image, address=address, size=count * 12),
                                 "<f4").reshape(count, 3).copy()
              for name, (address, count) in TABLES.items()}
    return validate_assets(values=values)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, default=Path(__file__).resolve().parents[1] / "runtime")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() or args.output.suffix != ".npz" or not args.output.resolve().is_relative_to(args.runtime.resolve()):
        parser.error("use a fresh local .npz path under runtime/")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    np.savez(args.output, **extract(runtime=args.runtime))
