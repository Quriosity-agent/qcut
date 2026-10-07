"""Export a bounded local SpotAcne graph and independent half-vector weight packing."""
import argparse
import hashlib
import json
from pathlib import Path
import struct

import numpy as np

from flowgan_assets import half_truncate

MODEL_SHA = '11f3a90604b6ccdc95f9dbd150884e05e0b9eafed098ad62f1112d949b8916cf'
BM_SHA = 'd83a7198afee5f9466720d3c64687fdf285cc58c5fa11d9a2d86face3400b36f'
GRAPH_SHA = 'dd1d38695aa8c6d2f3945915e1f1cefe046e772e1ecde65ce501f31736de0393'
ARENA_SHA = '6b318af6d358caf4e7bcf3dc85015d1b076afedd9086d0b1a255e2a2d53f9729'


def digest(*, data):
    return hashlib.sha256(data).hexdigest()


def parse_graph(*, text):
    if not isinstance(text, str) or not 0 < len(text) <= 16384:
        raise ValueError('bounded local spot graph required')
    rows = [line.removesuffix('\\n').split() for line in text.splitlines() if line.strip()]
    if len(rows) != 68 or rows[0] != ['D'] or rows[1][:2] != ['1', '65']:
        raise ValueError('one-input 65-layer float32 spot graph required')
    shapes, steps, weights, aliases = {}, [], {}, {}
    arena_cursor = 0
    for index, row in enumerate(rows[2:]):
        if len(row) < 2:
            raise ValueError('truncated spot layer')
        op, name = row[:2]
        output = f'feature_{index}'
        params, inputs = {}, []
        if op == 'DataV2':
            if index != 0 or row[2:] != ['1', '512', '512', '3', '4', '0', '0']:
                raise ValueError('bounded RGB spot input required')
            target, shape = name, [1, 3, 512, 512]
        elif op in ('Convolution', 'DepthwiseSeparableConvolution'):
            if len(row) != 19 or row[11:17] != ['4', '0']*3 or row[17] not in aliases:
                raise ValueError('known float32 convolution inputs required')
            co, kh, kw, sh, sw, ph, pw, bias, relu = map(int, row[2:11])
            if (not 1 <= co <= 576 or kh != kw or kh not in (1, 3)
                    or sh != sw or sh not in (1, 2) or ph != pw or ph != kh//2
                    or bias != 1 or relu not in (0, 1)):
                raise ValueError('bounded spot convolution required')
            source, target = aliases[row[17]], row[18]
            n, ci, h, w = shapes[source]
            depth = op == 'DepthwiseSeparableConvolution'
            if depth and co != ci:
                raise ValueError('unit depthwise multiplier required')
            shape = [n, co, (h+2*ph-kh)//sh+1, (w+2*pw-kw)//sw+1]
            count = co*kh*kw*(1 if depth else ci)+co
            weights[str(index)] = dict(path=f'weight-{index}.half', bias=f'bias-{index}.half',
                co=co, ci=ci, kernel=kh, stride=sh, pad=ph, depth=depth,
                arenaOffset=arena_cursor, arenaBytes=count*4)
            arena_cursor += count*4
            inputs, params = [source], {'relu': bool(relu)}
        elif op == 'Eltwise':
            if (len(row) != 8 or row[5:7] != ['4', '0'] or row[7] not in ('0', '1')
                    or any(key not in aliases for key in row[2:4])):
                raise ValueError('bounded residual addition required')
            inputs, target = [aliases[key] for key in row[2:4]], row[4]
            shape = shapes[inputs[0]]
            if shapes[inputs[1]] != shape:
                raise ValueError('residual shapes must agree')
            params = {'relu': row[7] == '1'}
        elif op == 'UpSampling':
            if len(row) != 5 or row[4] != 'BILINEAR' or row[2] not in aliases:
                raise ValueError('twofold bilinear spot resize required')
            inputs, target = [aliases[row[2]]], row[3]
            n, c, h, w = shapes[inputs[0]]
            shape = [n, c, h*2, w*2]
        elif op == 'Tanh':
            if len(row) != 6 or row[4:] != ['4', '0'] or row[2] not in aliases or index != 65:
                raise ValueError('final spot Tanh required')
            inputs, target = [aliases[row[2]]], row[3]
            shape = shapes[inputs[0]]
        else:
            raise ValueError('unsupported spot operation')
        if target in aliases or min(shape) <= 0 or shape[1] > 576 or max(shape[2:]) > 512:
            raise ValueError('unique bounded spot output required')
        shapes[output], aliases[target] = list(shape), output
        steps.append(dict(op=op, inputs=inputs, output=output, params=params))
    if shapes['feature_65'] != [1, 4, 512, 512] or len(weights) != 46 or arena_cursor != 7996176:
        raise ValueError('complete spot topology and parameter extent required')
    return dict(shapes=shapes, steps=steps, weights=weights, input='feature_0', output='feature_65')


def pack_weight(*, kernel, bias, depth):
    kernel, bias = np.asarray(kernel, np.float32), np.asarray(bias, np.float32)
    if kernel.ndim != 4 or bias.shape != (kernel.shape[0],) or not isinstance(depth, bool):
        raise ValueError('OHWI kernel and matching bias required')
    co, kh, kw, ci = kernel.shape
    if (min(co, kh, kw, ci) <= 0 or max(co, ci) > 576 or kh != kw
            or kh not in (1, 3) or (depth and ci != 1)):
        raise ValueError('bounded square kernel required')
    padded_bias = np.zeros(((co+3)//4, 4), np.float32)
    padded_bias.reshape(-1)[:co] = bias
    if depth:
        padded = np.zeros(((co+3)//4*4, kh, kw), np.float32)
        padded[:co] = kernel[..., 0]
        padded = padded.reshape(-1, 4, kh, kw).transpose(0, 2, 3, 1)
    else:
        padded = np.zeros(((co+3)//4*4, kh, kw, (ci+3)//4*4), np.float32)
        padded[:co, :, :, :ci] = kernel
        padded = padded.reshape(-1, 4, kh, kw, (ci+3)//4, 4).transpose(0, 4, 2, 3, 1, 5)
    return tuple(half_truncate(values=value).astype('<f2').tobytes() for value in (padded, padded_bias))


def pack_arena(*, spec, arena):
    if len(arena) != 7996180 or digest(data=arena) != ARENA_SHA:
        raise ValueError('pinned spot parameter arena required')
    packed = {}
    for weight in spec['weights'].values():
        co, ci, kernel = (weight[name] for name in ('co', 'ci', 'kernel'))
        offset, size = weight['arenaOffset'], weight['arenaBytes']
        values = np.frombuffer(arena[offset:offset+size], '<f4')
        raw, bias = values[:-co], values[-co:]
        raw = (raw.reshape(kernel, kernel, co).transpose(2, 0, 1)[..., None]
               if weight['depth'] else raw.reshape(co, kernel, kernel, ci))
        for name, payload in zip(('path', 'bias'), pack_weight(kernel=raw, bias=bias, depth=weight['depth'])):
            packed[weight[name]] = payload
            weight[name+'Sha256'] = digest(data=payload)
    return packed


def export(*, model, bm, graph, output):
    if output.exists() or output.resolve() in (model.resolve(), bm.resolve(), graph.resolve()):
        raise ValueError('fresh private model directory required')
    original, bundle, text = model.read_bytes(), bm.read_bytes(), graph.read_bytes()
    if digest(data=original) != MODEL_SHA or digest(data=bundle) != BM_SHA or digest(data=text) != GRAPH_SHA:
        raise ValueError('pinned local spot sources required')
    if (len(bundle) != 8007642 or bundle[:4] != b'BM\0\4'
            or struct.unpack_from('<II', bundle, 20) != (7996180, 11386)):
        raise ValueError('pinned spot BM layout required')
    arena = bundle[11386:11386+7996180]
    spec = parse_graph(text=text.decode())
    packed = pack_arena(spec=spec, arena=arena)
    contract = dict(format='owned-spot-acne-half-network-v1', modelSha256=MODEL_SHA,
        bundleSha256=BM_SHA, graphSha256=GRAPH_SHA, arenaSha256=ARENA_SHA, **spec)
    output.mkdir(parents=True)
    (output/'graph.private.txt').write_bytes(text)
    (output/'arena.bin').write_bytes(arena)
    (output/'source.bm').write_bytes(bundle)
    (output/'model.contract.json').write_text(json.dumps(contract, sort_keys=True, indent=2)+'\n')
    return dict(files={path.name: digest(data=path.read_bytes()) for path in output.iterdir()},
                halfBufferCount=len(packed), privateAssetDependency=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('model', 'bm', 'graph', 'output'):
        parser.add_argument('--'+name, type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(export(model=args.model, bm=args.bm, graph=args.graph, output=args.output), indent=2))
