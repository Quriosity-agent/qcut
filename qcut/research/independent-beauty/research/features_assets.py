"""Read the pinned mouth-corner coefficient table into private runtime assets."""
import argparse
import hashlib
from pathlib import Path

import numpy as np

from liquefy_assets import content_digest
from slimface_mesh_assets import CORE_SHA256, address_bytes, arm64_image

TABLE_ADDRESS = 0x2cce220
CONTENT_SHA256 = '4c02b7b5b1caacc2a654aefee3b2b709bba836cdfb1b97aa6cced519a0d4e9c3'


def validate_assets(*, values):
    if set(values) != {'mouth_corner'} or content_digest(values=values) != CONTENT_SHA256:
        raise ValueError('mouth-corner asset identity mismatch')
    coefficients = values['mouth_corner']
    if (coefficients.shape != (20, 3) or coefficients.dtype != np.float32
            or not np.isfinite(coefficients).all()
            or not np.array_equal(coefficients[:, 0], np.arange(84, 104, dtype=np.float32))):
        raise ValueError('invalid mouth-corner coefficients')
    coefficients.setflags(write=False)
    return values


def load_assets(*, path):
    if path.stat().st_size > 4096:
        raise ValueError('mouth-corner asset exceeds budget')
    with np.load(path, allow_pickle=False) as archive:
        return validate_assets(values={key: archive[key].copy() for key in archive.files})


def extract(*, runtime):
    library = (runtime / 'Frameworks/libcccreator.dylib').read_bytes()
    if hashlib.sha256(library).hexdigest() != CORE_SHA256:
        raise ValueError('unsupported mouth-corner library identity')
    image = arm64_image(data=library)
    coefficients = np.frombuffer(address_bytes(image=image, address=TABLE_ADDRESS, size=240),
                                  '<f4').reshape(20, 3).copy()
    return validate_assets(values={'mouth_corner': coefficients})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    arguments = parser.parse_args()
    if (arguments.output.exists() or arguments.output.suffix != '.npz'
            or not arguments.output.resolve().is_relative_to(arguments.runtime.resolve())):
        parser.error('fresh private .npz under runtime required')
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    np.savez(arguments.output, **extract(runtime=arguments.runtime))
