"""Pinned local SpotAcne data and owned half-vector model reconstruction."""
import json
from pathlib import Path

import numpy as np
from PIL import Image

from spot_acne_export import ARENA_SHA, BM_SHA, GRAPH_SHA, MODEL_SHA, digest, pack_arena, parse_graph

MODEL = 'newbandou_v1.0_size0_md5bb66e26e632c60d1dff15a1ceec50d4f.model'
PACKAGE = '7442228961163088434/e8b424917121b52fc69cba119274cc47'
PRIVATE_FILES = {'graph.private.txt': GRAPH_SHA, 'arena.bin': ARENA_SHA, 'source.bm': BM_SHA,
                 'model.contract.json': 'a2a441012008400e3148b5aa114ab11e698ef792bdc91ca396b6257a553237b0'}
MASK = 'AmazingFeature/image/blurmask.png'
MASK_SHA = '240fe6d8b95ac4d9d0943eb55bbd20c74cbcf78af5a4b265a297a6f8fbb53b1d'


def local_file(*, path, expected, limit=9*1024**2):
    if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= limit:
        raise ValueError('bounded regular local spot asset required')
    data = path.read_bytes()
    if digest(data=data) != expected:
        raise ValueError('spot asset identity mismatch: '+path.name)
    return data


def load(*, runtime):
    runtime = Path(runtime)
    local_file(path=runtime/'Models'/MODEL, expected=MODEL_SHA)
    directory = runtime/'research/spot-acne-private-model'
    files = {name: local_file(path=directory/name, expected=expected) for name, expected in PRIVATE_FILES.items()}
    spec = parse_graph(text=files['graph.private.txt'].decode())
    packed = pack_arena(spec=spec, arena=files['arena.bin'])
    contract = json.loads(files['model.contract.json'])
    if (contract['format'] != 'owned-spot-acne-half-network-v1'
            or any(contract[key] != spec[key] for key in ('shapes', 'steps', 'weights', 'input', 'output'))):
        raise ValueError('spot model contract differs from independent reconstruction')
    mask_path = runtime/'Cache/effect'/PACKAGE/MASK
    local_file(path=mask_path, expected=MASK_SHA, limit=1024**2)
    with Image.open(mask_path) as image:
        if image.size != (320, 320):
            raise ValueError('bounded spot blend mask required')
        mask = np.asarray(image.convert('RGBA'))
    return spec, packed, mask, dict(modelSha256=MODEL_SHA, privateFiles=PRIVATE_FILES, maskSha256=MASK_SHA)
