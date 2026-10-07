"""Pinned private 174-point templates for six aegyo and six eyeliner cards."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct

import numpy as np

from lip_assets import float_property
from liquefy_assets import content_digest

CARDS = json.loads(Path(__file__).with_name('eye_cards.json').read_text())


def card_spec(*, card):
    if not isinstance(card, str) or card not in CARDS:
        raise ValueError('pinned independent eye card required')
    return CARDS[card]


def validate_assets(*, card, values):
    spec = card_spec(card=card)
    if set(values) != {'uv', 'triangles', 'texture_transform', 'position_scale'} or content_digest(values=values) != spec['contentSha256']:
        raise ValueError('private eye template identity mismatch')
    for value in values.values():
        value.setflags(write=False)
    return values


def extract(*, runtime, card):
    spec = card_spec(card=card)
    root = runtime/'Cache/effect'/spec['package']
    files = ((spec['mesh'], spec['meshSha256']), (spec['material'], spec['materialSha256']),
             ('makeup.prefab', spec['prefabSha256']), *((layer['path'], layer['sha256']) for layer in spec['layers']))
    for relative, digest in files:
        if hashlib.sha256((root/relative).read_bytes()).hexdigest() != digest:
            raise ValueError('pinned private eye resource required')
    mesh = (root/spec['mesh']).read_bytes()
    tag = bytes.fromhex('6e587acf18000000')+struct.pack('<I', 6960)
    if mesh.count(tag) != 1:
        raise ValueError('unique four-component eye template required')
    vertices = np.frombuffer(mesh, '<f4', count=6960, offset=mesh.index(tag)+12).reshape(1740, 4)
    tag = bytes.fromhex('5f2c286b16000000')+struct.pack('<I', 1002)
    arrays = [np.frombuffer(mesh, '<u2', count=1002, offset=match.start()+12).copy()
              for match in re.finditer(re.escape(tag), mesh)]
    if len(arrays) != 10 or any(not np.array_equal(arrays[i], arrays[0]+i*174) for i in range(10)):
        raise ValueError('ten equivalent indexed eye submeshes required')
    if any(not np.array_equal(vertices[:174, 2:], vertices[i*174:(i+1)*174, 2:]) for i in range(10)):
        raise ValueError('eye UV differs between face slots')
    material = (root/spec['material']).read_bytes()
    if [value.decode() for value in re.findall(rb'AMAZING_USE_[A-Z_]+|USE_SEG', material)] != spec['defines']:
        raise ValueError('unverified eye material variant')
    return validate_assets(card=card, values={'uv': vertices[:174, 2:].copy(),
        'triangles': arrays[0].reshape(334, 3),
        'texture_transform': float_property(data=material, name='uSTMatrix', count=16).reshape(4, 4).T.copy(),
        'position_scale': np.ones(2, np.float32)})


def load_assets(*, path, card):
    if path.stat().st_size > 8192:
        raise ValueError('bounded private eye template required')
    with np.load(path, allow_pickle=False) as archive:
        return validate_assets(card=card, values={key: archive[key].copy() for key in archive.files})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, default=Path(__file__).resolve().parents[1]/'runtime')
    parser.add_argument('--card', choices=tuple(CARDS), required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() or args.output.suffix != '.npz' or not args.output.resolve().is_relative_to(args.runtime.resolve()):
        parser.error('fresh private .npz under runtime/ required')
    np.savez(args.output, **extract(runtime=args.runtime, card=args.card))
