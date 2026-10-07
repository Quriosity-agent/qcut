"""Hash-bound private NH canonical geometry extraction and loading."""
import argparse
import hashlib
from pathlib import Path

import numpy as np

from alignment_transform import points106
from slimface_mesh_assets import CORE_SHA256, address_bytes, arm64_image

MEAN_SHA256 = '3c68979e89af5a444cc3902a8f232b29e9285a024ad696a1dc4ee0268ef54f12'


def validate_mean(*, mean):
    points106(points=mean)
    if hashlib.sha256(mean.tobytes()).hexdigest() != MEAN_SHA256:
        raise ValueError('private NH canonical geometry identity mismatch')
    mean.setflags(write=False)
    return mean


def extract_mean(*, core):
    data = core.read_bytes()
    if hashlib.sha256(data).hexdigest() != CORE_SHA256:
        raise ValueError('pinned NH geometry library required')
    raw = address_bytes(image=arm64_image(data=data), address=0x2d0f330, size=848)
    return validate_mean(mean=np.frombuffer(raw, '<f4').reshape(106, 2).copy())


def load_mean(*, path):
    if path.stat().st_size > 2048:
        raise ValueError('bounded private NH canonical geometry required')
    return validate_mean(mean=np.load(path, allow_pickle=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--core', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    runtime = Path(__file__).resolve().parents[1]/'runtime'
    if args.output.exists() or args.output.suffix != '.npy' or not args.output.resolve().is_relative_to(runtime.resolve()):
        parser.error('fresh private .npy under runtime/ required')
    np.save(args.output, extract_mean(core=args.core), allow_pickle=False)
