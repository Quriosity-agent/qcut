"""Hash-bound FlowGAN architecture and independently packed local model weights."""
import hashlib
import json
from pathlib import Path
import struct

import numpy as np
from PIL import Image

SCHEMA = Path(__file__).with_name('flowgan_graph.json')
SCHEMA_SHA256 = '2e4e23eeed32dd815b625234d2abce55a828d55f37e5773fd2e2ccfa2b8de5ee'


def digest(*, data):
    return hashlib.sha256(data).hexdigest()


def half_truncate(*, values):
    values = np.asarray(values, dtype=np.float32)
    if not np.isfinite(values).all() or np.any(np.abs(values) > 65504):
        raise ValueError('finite representable model weights required')
    result = values.astype(np.float16)
    # RTZ also applies below the smallest normal half; masking float mantissas loses this.
    overshoot = np.abs(result.astype(np.float32)) > np.abs(values)
    result.view(np.uint16)[overshoot] -= np.uint16(1)
    return result


def load_schema():
    data = SCHEMA.read_bytes()
    if digest(data=data) != SCHEMA_SHA256:
        raise ValueError('pinned FlowGAN architecture required')
    return json.loads(data)


def load(*, runtime):
    spec = load_schema()
    model = spec['model']
    path = runtime/'Models'/model['filename']
    if path.stat().st_size != model['bytes']:
        raise ValueError('bounded FlowGAN model required')
    data = path.read_bytes()
    if digest(data=data) != model['sha256']:
        raise ValueError('FlowGAN model integrity mismatch')
    bm = data[model['bmOffset']:]
    if (digest(data=bm) != model['bmSha256'] or bm[:4] != b'BM\0\2'
            or struct.unpack_from('<II', bm, 20) != (model['arenaBytes'], model['arenaOffset'])):
        raise ValueError('FlowGAN arena header mismatch')
    arena = bm[model['arenaOffset']:model['arenaOffset']+model['arenaBytes']]
    if digest(data=arena) != model['arenaSha256']:
        raise ValueError('FlowGAN arena integrity mismatch')
    values = np.frombuffer(arena[:-4], '<f4')
    cursor, packed = 0, {}
    for key, weight in spec['weights'].items():
        co, ci, kernel = (weight[name] for name in ('co', 'ci', 'kernel'))
        count = co*kernel*kernel*(1 if weight['depth'] else ci)
        raw = values[cursor:cursor+count]
        bias = values[cursor+count:cursor+count+co]
        cursor += count+co
        padded_bias = np.zeros(((co+3)//4, 4), np.float32)
        padded_bias.reshape(-1)[:co] = bias
        if weight['depth']:
            raw = raw.reshape(kernel, kernel, co)
            padded = np.zeros(((co+3)//4, kernel, kernel, 4), np.float32)
            for output in range(co):
                padded[output//4, :, :, output%4] = raw[:, :, output]
        else:
            raw = raw.reshape(co, kernel, kernel, ci)
            padded = np.zeros(((co+3)//4, (ci+3)//4, kernel, kernel, 4, 4), np.float32)
            for output in range(co):
                for channel in range(ci):
                    padded[output//4, channel//4, :, :, output%4, channel%4] = raw[output, :, :, channel]
        for name, array in (('path', padded), ('bias', padded_bias)):
            payload = half_truncate(values=array).astype('<f2').tobytes()
            if digest(data=payload) != weight[name+'Sha256']:
                raise ValueError(f'packed FlowGAN weight mismatch at {key}')
            packed[weight[name]] = payload
    if cursor != len(values):
        raise ValueError('unconsumed FlowGAN parameters')
    mask_path = runtime/spec['mask']['path']
    mask_data = mask_path.read_bytes()
    if digest(data=mask_data) != spec['mask']['sha256']:
        raise ValueError('FlowGAN blend mask integrity mismatch')
    with Image.open(mask_path) as image:
        if image.size != (320, 320):
            raise ValueError('bounded FlowGAN blend mask required')
        mask = np.asarray(image.convert('RGBA'))
    return spec, packed, mask
