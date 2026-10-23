"""Bounded source and timestamp contracts for original-host history experiments."""
import hashlib
import math
from pathlib import Path

CASES = {
    'same': (0, 1 / 30, 2 / 30, 2 / 30, 2 / 30, 2 / 30),
    'forward': tuple(index / 30 for index in range(6)),
    'backward': (0, 1 / 30, 2 / 30, 1 / 30, 0, 1 / 30),
    'jump': (0, 1 / 30, 2 / 30, 1, 1, 1 + 1 / 30),
}


def native_microseconds(*, value):
    if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value < 86400:
        raise ValueError('finite nonnegative bounded timestamp required')
    return math.floor(value * 1_000_000 + .5)


def source_identity(*, manifest):
    width, height = manifest['width'], manifest['height']
    if type(width) is not int or type(height) is not int or min(width, height) < 16 or width * height > 3840 * 2160:
        raise ValueError('bounded source dimensions required')
    inputs = manifest['inputs']
    if not isinstance(inputs, dict) or not inputs:
        raise ValueError('hashed original source required')
    name, expected = next(iter(inputs.items()))
    path = Path(name).resolve(strict=True)
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if len(raw) != width * height * 4 or digest != expected:
        raise ValueError('original source bytes differ from provenance')
    if any(alpha != 255 for alpha in raw[3::4]):
        raise ValueError('opaque original source required')
    return {'path': str(path), 'sha256': digest, 'width': width, 'height': height}


def parameters(*, parts):
    return {'body_adjust_' + part: [{'id': -1, 'intensity':
             .4 if part == 'SlimBody' else .3 if part == 'StretchLeg' else 0}] for part in parts}
