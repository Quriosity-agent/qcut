"""Decode the pinned private jawline template without loading vendor libraries."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct

import numpy as np

from lip_assets import float_property
from liquefy_assets import content_digest
from slimface_mesh_assets import CORE_SHA256, address_bytes, arm64_image

SPEC = json.loads(Path(__file__).with_name('jawline_card.json').read_text())
PACKAGE = SPEC['package']
PACKAGE_FILES = SPEC['files']


def validate_assets(*, values):
    if set(values) != set(SPEC['shapes']) or content_digest(values=values) != SPEC['contentSha256']:
        raise ValueError('jawline template identity mismatch')
    for name, value in values.items():
        if (value.shape != tuple(SPEC['shapes'][name]) or value.dtype.str != SPEC['dtypes'][name]
                or not np.isfinite(value).all()):
            raise ValueError('bounded jawline array required')
        value.setflags(write=False)
    return values


def load_assets(*, path):
    if path.stat().st_size > 65536:
        raise ValueError('bounded private jawline template required')
    with np.load(path, allow_pickle=False) as archive:
        return validate_assets(values={name: archive[name].copy() for name in archive.files})


def extract(*, runtime):
    package = runtime/'Cache/effect'/PACKAGE
    for name, identity in PACKAGE_FILES.items():
        if hashlib.sha256((package/name).read_bytes()).hexdigest() != identity:
            raise ValueError('pinned jawline package required')
    core = (runtime/'Frameworks/libcccreator.dylib').read_bytes()
    if hashlib.sha256(core).hexdigest() != CORE_SHA256:
        raise ValueError('unsupported jawline library')
    image = arm64_image(data=core)
    data = (package/'AmazingFeature/warpX/modelInfo.warpXModel').read_bytes()
    text = (package/'AmazingFeature/warpX/item_xiahexian_boundary.warpX').read_text()
    mesh = (package/'AmazingFeature_shadow/mesh/stereo_faceu_mesh.mesh').read_bytes()
    vertex_tag = bytes.fromhex('6e587acf18000000') + struct.pack('<I', 9920)
    index_tag = bytes.fromhex('5f2c286b16000000') + struct.pack('<I', 1113)
    if len(data) != 6884 or mesh.count(vertex_tag) != 1 or mesh.count(index_tag) != 10:
        raise ValueError('pinned warp and ten shadow face slots required')
    values = {
        'base': np.frombuffer(data, '<f4', count=212, offset=0x5b8).reshape(106, 2).copy(),
        'x_axis': np.frombuffer(data, '<f4', count=140, offset=0x118).copy(),
        'y_axis': np.frombuffer(data, '<f4', count=146, offset=0x35c).copy(),
        'triangles': np.frombuffer(data, '<i4', count=396, offset=0xbdc).reshape(-1, 3).copy(),
        'offsets': np.asarray([[float(x), float(y)] for x, y in re.findall(
            r'\{x:\s*([-+eE.\d]+), y:\s*([-+eE.\d]+)\}', text)], np.float32),
        'positions': np.asarray([int(value) for value in re.findall(r'^  - (\d+)$', text, re.M)], np.int32),
        'center_indices': np.frombuffer(address_bytes(image=image, address=0x2cde234, size=44), '<i4').copy(),
        'outer_indices': np.frombuffer(address_bytes(image=image, address=0x2cde260, size=176), '<i4').copy(),
        'center_fade': np.frombuffer(address_bytes(image=image, address=0x2cde030, size=8), '<f8').copy(),
        'shadow_uv': np.frombuffer(mesh, '<f4', count=9920, offset=mesh.index(vertex_tag)+12).reshape(2480, 4)[:248, 2:].copy(),
        'shadow_triangles': np.frombuffer(mesh, '<u2', count=1113, offset=mesh.index(index_tag)+12).reshape(-1, 3).copy(),
        'shadow_transform': float_property(data=(package/'AmazingFeature_shadow/material/Stereo_MATERIAL.material').read_bytes(),
            name='uSTMatrix', count=16).reshape(4, 4).T.copy(),
    }
    return validate_assets(values=values)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, default=Path(__file__).resolve().parents[1]/'runtime')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() or args.output.suffix != '.npz' or not args.output.resolve().is_relative_to(args.runtime.resolve()):
        parser.error('fresh private npz under runtime required')
    np.savez(args.output, **extract(runtime=args.runtime))
