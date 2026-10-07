"""Pinned soft-pink lip resources sharing the independently solved mouth64 template."""
import argparse
import hashlib
from pathlib import Path

import numpy as np

from lip_assets import load_assets as load_lip, float_property
from makeup_mesh_assets import mesh_arrays
from liquefy_assets import content_digest

CARD = 'lip-soft-pink'
SPEC = {'package': '7408076694126365992/3ff9996e22120348c34b3abbed86712c',
    'coverageBits': 8,
    'mouthTextures': {
        'Close': {'path': 'image/lip/default/lipClose.png',
            'sha256': '9212f5b19e03021bc92e41a06a0ebaaf9bff2bb2b5cd82ba95fc8a83b4dff830'},
        'Open': {'path': 'image/lip/default/lipOpen.png',
            'sha256': 'fc70378d3b5a418075ca40568ed3a08aff9bca318baf8db0e8eff7305be1b801'}},
    'layers': ({'path': 'image/lip/default/lipClose.png', 'mode': 'multiply', 'customColor': True,
        'sha256': '9212f5b19e03021bc92e41a06a0ebaaf9bff2bb2b5cd82ba95fc8a83b4dff830'},)}
FILES = {'mesh/lips_keypoint_faceu_mesh.mesh': '71fd0b733a1cbe8f30ad625a4e7379c846eab48f95318d567588784774a45bd7',
    'material/lip/default.material': '665f17f93ce5580456dd70227b06796a5ecea958e7a9ca2ced96473f66ba95b5', 'makeup.prefab': '34bbc12551ae7de3df42b39add027564eb431dad4d75d0a170d157c5f6dc9a38'}
CONTENT_SHA256 = '3d551ec993367c14497a172103a29b48dcf130fc24c91d048506d993bb305bf3'


def card_spec(*, card):
    if card != CARD:
        raise ValueError('pinned soft-pink lip card required')
    return SPEC


def validate_assets(*, values):
    if (set(values) != {'uv', 'triangles', 'texture_transform', 'position_scale', 'custom_color'}
            or content_digest(values=values) != CONTENT_SHA256):
        raise ValueError('private soft-pink lip template identity mismatch')
    for value in values.values():
        value.setflags(write=False)
    return values


def extract(*, runtime):
    base = load_lip(path=runtime/'research/lip-v1.npz')
    root = runtime/'Cache/effect'/SPEC['package']
    for relative, digest in {**FILES, SPEC['layers'][0]['path']: SPEC['layers'][0]['sha256']}.items():
        if hashlib.sha256((root/relative).read_bytes()).hexdigest() != digest:
            raise ValueError('private soft-pink lip resource identity mismatch')
    uv, triangles = mesh_arrays(data=(root/'mesh/lips_keypoint_faceu_mesh.mesh').read_bytes(),
        floats=9920, vertices=248, stride=4, indices=1113)
    material = (root/'material/lip/default.material').read_bytes()
    values = {'uv': uv, 'triangles': triangles, 'position_scale': base['position_scale'].copy()}
    values.update(texture_transform=float_property(data=material, name='uSTMatrix', count=16).reshape(4, 4).T.copy(),
        custom_color=float_property(data=material, name='customColor', count=3))
    return validate_assets(values=values)


def load_assets(*, path, card):
    card_spec(card=card)
    if path.stat().st_size > 8192:
        raise ValueError('bounded private soft-pink lip template required')
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
