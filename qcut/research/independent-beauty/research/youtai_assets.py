"""Pinned private small-face coefficients, never distributed with the source."""
import argparse
import hashlib
from pathlib import Path

import numpy as np

from liquefy_assets import content_digest, observed
from slimface_mesh_assets import CORE_SHA256, address_bytes, arm64_image

PACKAGE = '7406181120506678580/51c8fe396e4ba74acdb7bf73058a7fbe/AmazingFeature'
PACKAGE_FILES = {
    'main.scene': 'cd65217c4af20357d8dcd86fe8ba7904c600e5a2499ac24b7da86c3c4f73a41a',
    'lua/reshape.lua': 'a27894cefd3196b56c8a42b97ba9e9e1a1c4d876a6cf736d1a4351bfa47313bf',
    'xshader/fdx.vert': '7e9795207bc2409092b891b6d0173987320fc1514ae7ea108788e3a276c3b369',
    'xshader/fdx.frag': '95fa84eab1997804a7e57c53906417d2c79708aedec5d7524741d3353a2d0cc3',
    'xshader/fd_withoutMask.vert': '444d06c063831dde475e13b18cd1070001a4f1402ef407d3e58fb6b3ed41e59f',
    'xshader/fd_withoutMask.frag': 'c406f750403fc65a9a9dabb48aca03263a039f696a6196c671f9fd8a004d7b92',
}
TABLES = {
    'eye_zoom': (0x2cce52c, (18, 3), '<f4'),
    'eye_expand': (0x2cce6dc, (18, 3), '<f4'),
    'eye_rotate_left': (0x2cce4ec, (8,), '<i4'),
    'eye_rotate_right': (0x2cce50c, (8,), '<i4'),
    'mouth_left': (0x2ccead8, (12,), '<i4'),
    'mouth_right': (0x2cceb08, (8,), '<i4'),
    'mouth_move': (0x2cceb28, (20,), '<i4'),
    'lip_coefficients': (0x2cceb78, (10, 3), '<f4'),
}
CONTENT_SHA256 = '42564a99ff4d128e70c78bc31bb0958724c913b6d61bf7cb528c2983f60cf496'


def validate_assets(*, values):
    if set(values) != {*TABLES, 'weights', 'steps', 'constants'} or content_digest(values=values) != CONTENT_SHA256:
        raise ValueError('small-face asset identity mismatch')
    for value in values.values():
        if not np.isfinite(value).all():
            raise ValueError('nonfinite small-face asset')
        value.setflags(write=False)
    return values


def load_assets(*, path):
    if path.stat().st_size > 32768:
        raise ValueError('small-face asset exceeds budget')
    with np.load(path, allow_pickle=False) as archive:
        return validate_assets(values={key: archive[key].copy() for key in archive.files})


def extract(*, runtime, step_traces):
    core = (runtime / 'Frameworks/libcccreator.dylib').read_bytes()
    if hashlib.sha256(core).hexdigest() != CORE_SHA256:
        raise ValueError('unsupported small-face library')
    package = runtime / 'Cache/effect' / PACKAGE
    for name, digest in PACKAGE_FILES.items():
        if hashlib.sha256((package / name).read_bytes()).hexdigest() != digest:
            raise ValueError('small-face package identity mismatch')
    if not 2 <= len(step_traces) <= 6 or len(set(step_traces)) != len(step_traces):
        raise ValueError('two to six distinct read-only step traces required')
    records = [observed(path=path) for path in step_traces]
    if any(len(rows) != 1 for rows in records):
        raise ValueError('one step consumer per original frame required')
    records = [rows[0] for rows in records]
    if (any(row['steps'] != records[0]['steps'] or row['anchor_mode'] != 0 or not row['input_unchanged'] for row in records)
            or len({np.asarray(row['points'], np.float32).tobytes() for row in records}) != len(records)):
        raise ValueError('static steps on distinct original faces required')
    image = arm64_image(data=core)
    values = {name: np.frombuffer(address_bytes(image=image, address=address,
              size=int(np.prod(shape)) * np.dtype(dtype).itemsize), dtype).reshape(shape).copy()
              for name, (address, shape, dtype) in TABLES.items()}
    values['constants'] = np.asarray([np.frombuffer(address_bytes(image=image, address=address, size=8), '<f8')[0]
                                      for address in (0x2ccdaa8, 0x2cb5b40, 0x2cb7d00, 0x2caa0a8)], np.float64)
    scene = (package / 'main.scene').read_bytes()
    tag = bytes.fromhex('6e587acf18000000bd000000')
    offsets = [offset + len(tag) for offset in range(len(scene)) if scene.startswith(tag, offset)]
    weights = [np.frombuffer(scene, '<f4', count=189, offset=offset).reshape(63, 3).copy() for offset in offsets]
    if len(weights) != 10 or any(not np.array_equal(weights[0], value) for value in weights):
        raise ValueError('ten identical small-face components required')
    values['weights'] = weights[0]
    values['steps'] = np.asarray(records[0]['steps'], np.float32)
    return validate_assets(values=values)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, default=Path(__file__).resolve().parents[1] / 'runtime')
    parser.add_argument('--step-trace', type=Path, action='append', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() or args.output.suffix != '.npz' or not args.output.resolve().is_relative_to(args.runtime.resolve()):
        parser.error('fresh private .npz output under runtime/ required')
    np.savez(args.output, **extract(runtime=args.runtime, step_traces=args.step_trace))
