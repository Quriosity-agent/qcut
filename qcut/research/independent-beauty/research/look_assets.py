"""Pinned oxygen-look meshes and textures; private payloads remain under runtime/."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

from lip_assets import float_property
from liquefy_assets import content_digest
from makeup_mesh_assets import mesh_arrays

CARD = 'look-oxygen'
SPEC = json.loads(Path(__file__).with_name('look_oxygen_card.json').read_text())


def validate_assets(*, values):
    fields = {layer['name']+'_'+field for layer in SPEC['layers'] for field in ('uv', 'triangles', 'transform')}
    if set(values) != fields or content_digest(values=values) != SPEC['contentSha256']:
        raise ValueError('private oxygen-look geometry identity mismatch')
    for value in values.values():
        value.setflags(write=False)
    return values


def extract(*, runtime):
    root = runtime/'Cache/effect'/SPEC['package']
    for relative, digest in SPEC['files'].items():
        if hashlib.sha256((root/relative).read_bytes()).hexdigest() != digest:
            raise ValueError('pinned private oxygen-look package required')
    values = {}
    for layer in SPEC['layers']:
        uv, triangles = mesh_arrays(data=(root/'AmazingFeature'/layer['mesh']).read_bytes(),
            floats=10*layer['vertices']*layer['stride'], vertices=layer['vertices'],
            stride=layer['stride'], indices=layer['indices'], uv_offset=layer['uvOffset'])
        material = (root/'AmazingFeature'/layer['material']).read_bytes()
        values.update({layer['name']+'_uv': uv, layer['name']+'_triangles': triangles,
            layer['name']+'_transform': float_property(data=material, name='uSTMatrix', count=16).reshape(4, 4).T.copy()})
    return validate_assets(values=values)


def load_assets(*, path):
    if path.stat().st_size > 65536:
        raise ValueError('bounded private oxygen-look template required')
    with np.load(path, allow_pickle=False) as archive:
        return validate_assets(values={key: archive[key].copy() for key in archive.files})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, default=Path(__file__).resolve().parents[1]/'runtime')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() or args.output.suffix != '.npz' or not args.output.resolve().is_relative_to(args.runtime.resolve()):
        parser.error('fresh private .npz under runtime/ required')
    np.savez(args.output, **extract(runtime=args.runtime))
