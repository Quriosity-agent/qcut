"""Pinned pink eyeshadow resources sharing the verified eye174 template."""
import hashlib

from eye_assets import extract as extract_eye, load_assets as load_eye

CARD = 'eyeshadow-girl-pink'
SPEC = {'package': '7408077631049960744/1a234c85160694dd855f9cfe76a81145',
    'layers': ({'path': 'image/eyeshadow/default/eyeshadow.png', 'mode': 'multiply',
        'sha256': 'd321a574722209a20e90d4a2e06a178b4ff7be8c94e6b8392b49c7139ef835a4'},
        {'path': 'image/eyeshadow/default/eyeshadowScreen.png', 'mode': 'screen',
        'sha256': '4560c48cc274bc888c373ce305e53285308b08023d851c1c85c9e6ad96052404'})}
FILES = {'mesh/eyeshadow_faceu_mesh.mesh': '52d3d05868f5fb0c46dd06715be78722560984c704d9a899428a6d001fce39b6',
    'material/eyeshadow/default.material': 'fe1fc9bab945c57f5f0204f1b6221aca218c430958fb33861aa4afd4fc3a0e57',
    'makeup.prefab': 'ae593ed56c3249f15d587d292fc9f0366ba6b6f443f7432ad971162364c1e042'}


def card_spec(*, card):
    if card != CARD:
        raise ValueError('pinned independent eyeshadow card required')
    return SPEC


def extract(*, runtime):
    root = runtime/'Cache/effect'/SPEC['package']
    for relative, digest in FILES.items():
        if hashlib.sha256((root/relative).read_bytes()).hexdigest() != digest:
            raise ValueError('pinned private eyeshadow resource required')
    return extract_eye(runtime=runtime, card='aegyo-doll')


def load_assets(*, path, card):
    card_spec(card=card)
    return load_eye(path=path, card='aegyo-doll')
