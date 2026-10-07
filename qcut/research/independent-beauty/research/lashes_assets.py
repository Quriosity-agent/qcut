"""Pinned lash textures using the verified shared 174-point eye template."""
import hashlib

from eye_assets import extract as extract_eye, load_assets as load_eye

CARD = 'lashes-natural-ii'
SPEC = {'package': '7406175199361649920/2334785805777457e48251169bf65b10',
    'layers': ({'path': 'image/eyelash/default/eyelash.png', 'mode': 'multiply',
                'sha256': '73b11857c0386fdff1c63adbc3ca977a56e15c393124e26b1c1d3b56c86fff67'},)}
FILES = {'mesh/eyelash_faceu_mesh.mesh': '176c7b9169e89d5ada55f9b7c92d7aae7e8dc00b4700898a7e4df7dc183bc6ce',
    'material/eyelash/default.material': 'af63ae72e48562ea5f5adb17168b84359bc0869f3b80e8cfd182ddbdec45cb4f',
    'makeup.prefab': '6bdaa98eea44bfa92f3bdc8ba9e558a6845a9433207ef8987c96dada60385b49'}


def card_spec(*, card):
    if card != CARD:
        raise ValueError('pinned independent lash card required')
    return SPEC


def extract(*, runtime):
    root = runtime/'Cache/effect'/SPEC['package']
    for relative, digest in FILES.items():
        if hashlib.sha256((root/relative).read_bytes()).hexdigest() != digest:
            raise ValueError('pinned private lash resource required')
    # The pinned lash mesh has the same UV, topology and ST content as eyeliner.
    return extract_eye(runtime=runtime, card='eyeliner-natural')


def load_assets(*, path, card):
    card_spec(card=card)
    return load_eye(path=path, card='eyeliner-natural')
