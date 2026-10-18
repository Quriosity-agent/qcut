"""Compile fixed body graphs to standard CPU ONNX, retaining integer arithmetic.

Integer-valued FP64 MatMul replaces the NumPy correlation; no FP32 convolution,
quantized approximation, Torch export or vendor library is used. Accumulators
wrap before half-up requantization, including signed ties and INT32_MIN.
"""
import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

from body_espresso_fixed import RANGE, decode_bias, decode_kernel, requantize, shuffle_lanes
from body_espresso_graph import analyze


class Builder:
    def __init__(self):
        self.nodes, self.constants = [], []

    def constant(self, value):
        name = f'constant_{len(self.constants)}'
        self.constants.append(numpy_helper.from_array(np.asarray(value), name=name))
        return name

    def number(self, value):
        return self.constant(np.asarray(value, np.float64))

    def integer(self, value):
        return self.constant(np.asarray(value, np.int64))

    def node(self, operation, *inputs, output=None, **attributes):
        name = output or f'body_{len(self.nodes)}'
        self.nodes.append(helper.make_node(operation, list(inputs), [name], **attributes))
        return name

    def requantize(self, value, shift):
        if shift <= 0:
            return self.node('Mul', value, self.number(2 ** -shift))
        rounded = self.node('Add', value, self.number(2 ** (shift - 1)))
        return self.node('Floor', self.node('Div', rounded, self.number(2 ** shift)))

    def wrap32(self, value):
        quotient = self.node('Floor', self.node('Div', self.node('Add', value, self.number(2 ** 31)), self.number(2 ** 32)))
        return self.node('Sub', value, self.node('Mul', quotient, self.number(2 ** 32)))

    def clamp(self, value, storage, relu=False):
        low, high = RANGE[storage['type']]
        return self.node('Clip', value, self.number(max(low, 0) if relu else low), self.number(high))

    def pad(self, value, height, width, *, edge=False):
        return self.node('Pad', value, self.integer([0, height, width, 0, 0, height, width, 0]),
                         self.number(0), mode='edge' if edge else 'constant')

    def slice(self, value, starts, ends, axes, steps=None):
        inputs = [value, self.integer(starts), self.integer(ends), self.integer(axes)]
        if steps is not None:
            inputs.append(self.integer(steps))
        return self.node('Slice', *inputs)

    def spatial(self, value, y, x, height, width, stride=(1, 1)):
        return self.slice(value, [y, x], [y + stride[0] * height, x + stride[1] * width], [1, 2], stride)


def convolution(*, builder, value, layer, graph, arena):
    source = layer['inputs'][0]
    ci = graph['shapes'][source][3]
    kh, kw = layer['kernel']
    co = layer['shape'][3]
    depthwise = layer['op'] != 'Convolution'
    if layer['weight']['type'] not in RANGE:
        raise ValueError('only fixed integer body convolutions are supported')
    count = co * kh * kw * (1 if depthwise else ci)
    kernel, cursor = decode_kernel(arena, layer['arena_offset'], count, layer['weight'], layer['packed'])
    fraction = graph['descriptors'][source]['fraction'] + layer['weight']['fraction']
    bias = np.zeros(co, np.int64)
    if layer['bias']:
        bias = requantize(decode_bias(arena, cursor, co, False), layer['bias_storage']['fraction'] - fraction)
    # The largest integer sum is exactly representable in binary64, even for int16 input extrema.
    bound = count * 32768 * int(np.abs(kernel).max(initial=0)) + int(np.abs(bias).max(initial=0))
    if bound >= 2 ** 52:
        raise ValueError('body convolution exceeds the exact FP64 accumulator budget')
    sh, sw = layer['stride']
    ph, pw = layer['pad']
    dh, dw = layer.get('dilation', (1, 1))
    oh, ow = layer['shape'][1:3]
    padded = builder.pad(value, ph, pw)
    taps = [builder.spatial(padded, y * dh, x * dw, oh, ow, (sh, sw)) for y in range(kh) for x in range(kw)]
    if depthwise:
        weights = kernel.reshape(kh * kw, co)
        products = [builder.node('Mul', tap, builder.number(weight)) for tap, weight in zip(taps, weights)]
        accumulated = products[0]
        for product in products[1:]:
            accumulated = builder.node('Add', accumulated, product)
    else:
        columns = taps[0] if len(taps) == 1 else builder.node('Concat', *taps, axis=3)
        weights = kernel.reshape(co, kh, kw, ci).transpose(1, 2, 3, 0).reshape(kh * kw * ci, co)
        accumulated = builder.node('MatMul', columns, builder.number(weights.copy()))
    accumulated = builder.node('Add', accumulated, builder.number(bias))
    value = builder.requantize(builder.wrap32(accumulated), fraction - layer['storage']['fraction'])
    return builder.clamp(value, layer['storage'], layer['relu'])


def upsample(*, builder, value, shape, mode):
    if mode not in ('LINEAR', 'BILINEAR'):
        raise ValueError('only fixed x2 body upsampling is supported')
    n, h, w, c = shape
    padded = builder.pad(value, 1, 1, edge=mode == 'BILINEAR')
    main = builder.spatial(padded, 1, 1, h, w)
    rows = []
    for y in (0, 2):
        row = builder.spatial(padded, y, 1, h, w)
        columns = []
        for x in (0, 2):
            column = builder.spatial(padded, 1, x, h, w)
            diagonal = builder.spatial(padded, y, x, h, w)
            numerator = builder.node('Add', builder.node('Mul', main, builder.number(9)), builder.node('Mul', row, builder.number(3)))
            numerator = builder.node('Add', numerator, builder.node('Mul', column, builder.number(3)))
            filtered = builder.node('Floor', builder.node('Div', builder.node('Add', numerator, diagonal), builder.number(16)))
            columns.append(builder.node('Unsqueeze', filtered, builder.integer([3])))
        merged = builder.node('Concat', *columns, axis=3)
        rows.append(builder.node('Reshape', merged, builder.integer([n, h, 2 * w, c])))
    merged = builder.node('Concat', *[builder.node('Unsqueeze', row, builder.integer([2])) for row in rows], axis=2)
    return builder.node('Reshape', merged, builder.integer([n, 2 * h, 2 * w, c]))


def shuffled(*, builder, value, shape, groups, lanes):
    n, h, w, c = shape
    if c % (groups * lanes):
        raise ValueError('body shuffle channels must divide into complete lane groups')
    value = builder.node('Reshape', value, builder.integer([n, h, w, groups, c // (groups * lanes), lanes]))
    value = builder.node('Transpose', value, perm=[0, 1, 2, 4, 3, 5])
    return builder.node('Reshape', value, builder.integer(shape))


def shuffle_net(*, builder, sources, layer, graph):
    names = layer['inputs']
    source_shape = graph['shapes'][names[0]]
    channels = sum(graph['shapes'][name][3] for name in names)
    shape = (*source_shape[:3], channels)
    lanes = layer['groups']
    joined = builder.node('Concat', *sources, axis=3)
    value = shuffled(builder=builder, value=joined, shape=shape, groups=2, lanes=lanes)
    fractions = np.concatenate([np.full(graph['shapes'][name][3], graph['descriptors'][name]['fraction']) for name in names])
    fractions = shuffle_lanes(fractions.reshape(1, 1, 1, -1), 2, lanes).reshape(-1)
    half = channels // 2
    outputs = []
    for index, target in enumerate(layer['outputs']):
        storage = graph['descriptors'][target]
        parts = []
        for channel, fraction in enumerate(fractions[index * half:(index + 1) * half]):
            offset = index * half + channel
            part = builder.slice(value, [offset], [offset + 1], [3])
            parts.append(builder.requantize(part, int(fraction) - storage['fraction']))
        part = builder.node('Concat', *parts, axis=3)
        low, high = RANGE[storage['type']]
        if storage['type'] == 2:
            upper = np.arange(half) % (2 * lanes) < lanes
            part = builder.node('Where', builder.constant(upper), builder.node('Min', part, builder.number(high)),
                                builder.node('Max', part, builder.number(low)))
        else:
            part = builder.clamp(part, storage)
        outputs.append(part)
    return outputs


def fixed_graph(*, text, shape):
    if (len(shape) != 4 or any(type(side) is not int for side in shape) or shape[0] != 1 or shape[3] != 3 or
            any(type(side) is not int or not 32 <= side <= 224 or side % 16 for side in shape[1:3])):
        raise ValueError('body input must be NHWC 1xHxWx3, with 32..224 sides divisible by 16')
    rows = []
    for row in text.splitlines():
        tokens = row.removesuffix('\\n').split()
        if tokens and tokens[0] == 'DataV2':
            tokens[2:6] = map(str, shape)
        rows.append(' '.join(tokens))
    return analyze('\n'.join(rows))


def build_model(*, text, arena, shape, outputs):
    graph = fixed_graph(text=text, shape=shape)
    if graph['letter'] != 'B' or len(arena) != graph['arena_bytes']:
        raise ValueError('packed body graph with exact arena size required')
    if graph['stamp'] is not None and int.from_bytes(arena[-4:], 'little') != graph['stamp']:
        raise ValueError('body graph and weight stamp differ')
    if not outputs or len(set(outputs)) != len(outputs) or any(name not in graph['shapes'] or name == 'data' for name in outputs):
        raise ValueError('distinct produced body outputs required')
    required, needed = set(), set(outputs)
    for index in range(len(graph['layers']) - 1, -1, -1):
        layer = graph['layers'][index]
        if any(name in needed for name in layer['outputs']):
            required.add(index)
            needed.update(layer['inputs'])
    builder, values = Builder(), {}
    for index, layer in enumerate(graph['layers']):
        if index not in required:
            continue
        op, names = layer['op'], layer['inputs']
        if op == 'Input':
            if layer['name'] != 'data' or layer['storage'] != {'type': 2, 'fraction': 6}:
                raise ValueError('fixed body data input with fraction six required')
            values['data'] = builder.node('Cast', 'input', to=TensorProto.DOUBLE)
            continue
        sources = [values[name] for name in names]
        descriptors = [graph['descriptors'][name] for name in names]
        if any(storage['type'] not in RANGE for storage in descriptors):
            raise ValueError('only integer body activations are supported')
        shape_in = graph['shapes'][names[0]]
        storage = layer.get('storage')
        if op in ('Convolution', 'DepthwiseSeparableConvolution', 'DilationSeparableConvolution'):
            result = [convolution(builder=builder, value=sources[0], layer=layer, graph=graph, arena=arena)]
        elif op == 'Eltwise':
            common = max(item['fraction'] for item in descriptors)
            aligned = [builder.requantize(value, item['fraction'] - common) for value, item in zip(sources, descriptors)]
            value = builder.requantize(builder.node('Add', *aligned), common - storage['fraction'])
            result = [builder.clamp(value, storage, layer['relu'])]
        elif op == 'Concat':
            parts = [value if item['fraction'] == storage['fraction'] else
                     builder.clamp(builder.requantize(value, item['fraction'] - storage['fraction']), storage)
                     for value, item in zip(sources, descriptors)]
            result = [builder.node('Concat', *parts, axis=3)]
        elif op == 'Slice':
            result = []
            for target, start, end in zip(layer['outputs'], (0, layer['split']), (layer['split'], shape_in[3])):
                target_storage = graph['descriptors'][target]
                value = builder.slice(sources[0], [start], [end], [3])
                if descriptors[0]['fraction'] != target_storage['fraction']:
                    value = builder.clamp(builder.requantize(value, descriptors[0]['fraction'] - target_storage['fraction']), target_storage)
                result.append(value)
        elif op == 'Shuffle':
            result = [shuffled(builder=builder, value=sources[0], shape=shape_in, groups=layer['parts'], lanes=layer['groups'])]
        elif op == 'ShuffleNet':
            result = shuffle_net(builder=builder, sources=sources, layer=layer, graph=graph)
        elif op == 'UpSampling':
            result = [upsample(builder=builder, value=sources[0], shape=shape_in, mode=layer['mode'])]
        else:
            raise ValueError(f'unsupported required fixed body operation: {op}')
        values.update(zip(layer['outputs'], result))
    for output in outputs:
        builder.node('Cast', values[output], output=output, to=TensorProto.INT16)
    model = helper.make_model(helper.make_graph(builder.nodes, 'qcut-fixed-body-fp64',
        [helper.make_tensor_value_info('input', TensorProto.INT16, shape)],
        [helper.make_tensor_value_info(name, TensorProto.INT16, graph['shapes'][name]) for name in outputs],
        builder.constants), opset_imports=[helper.make_opsetid('', 18)], ir_version=10,
        producer_name='qcut-owned-body-fixed-onnx')
    onnx.checker.check_model(model, full_check=True)
    return model
