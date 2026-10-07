"""Own standard-ONNX integer skin graph export; recovered model data stays local."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import onnx
from onnx import helper, numpy_helper, TensorProto

RANGES = {1: (-128, 127), 2: (-2047, 2047)}
SUPPORTED = {'Input', 'Convolution', 'DepthwiseSeparableConvolution', 'Concat', 'Eltwise', 'UpSampling', 'Sigmoid'}
PARSED_SHA256 = 'bbec360463a16dffeed0d75a29deeafdb9d2184b87bb2aa803807be15da11924'
ARENA_SHA256 = '1cd8f7cb05c1e0772ad9c41e31c309f217a57e4cea8464ffabdc97f80f014377'


class Builder:
    def __init__(self):
        self.nodes = []
        self.constants = []
        self.counter = 0

    def constant(self, value):
        name = f'constant_{len(self.constants)}'
        self.constants.append(numpy_helper.from_array(np.asarray(value), name=name))
        return name

    def node(self, operation, *inputs, output=None, **attributes):
        name = output or f'own_{self.counter}'
        self.counter += 1
        self.nodes.append(helper.make_node(operation, list(inputs), [name], **attributes))
        return name

    def integer(self, value):
        return self.constant(np.asarray(value, np.int64))

    def floor_divide(self, value, divisor):
        divisor = self.integer(divisor)
        remainder = self.node('Mod', value, divisor, fmod=0)
        return self.node('Div', self.node('Sub', value, remainder), divisor)

    def requantize(self, value, shift):
        if shift <= 0:
            return self.node('Mul', value, self.integer(1 << -shift))
        rounded = self.node('Add', value, self.integer(1 << (shift - 1)))
        return self.floor_divide(rounded, 1 << shift)

    def clamp(self, value, storage, relu=False):
        low, high = RANGES[storage['type']]
        return self.node('Clip', value, self.integer(max(low, 0) if relu else low), self.integer(high))

    def pad(self, value, height, width):
        return self.node('Pad', value, self.integer([0, height, width, 0, 0, height, width, 0]), self.integer(0), mode='constant')

    def slice(self, value, y, x, height, width, stride=(1, 1)):
        return self.node('Slice', value, self.integer([y, x]),
                         self.integer([y + stride[0] * height, x + stride[1] * width]),
                         self.integer([1, 2]), self.integer(stride))


def decode_parameters(*, arena, layer, channels):
    co = layer['shape'][3]
    kh, kw = layer['kernel']
    depthwise = layer['op'] == 'DepthwiseSeparableConvolution'
    count = co * kh * kw * (1 if depthwise else channels)
    offset = layer['arena_offset']
    kind = layer['weight']['type']
    if kind not in RANGES:
        raise ValueError('integer convolution weights required')
    if kind == 2 and layer['packed']:
        if count % 2:
            raise ValueError('paired packed kernels required')
        length = count * 3 // 2
        triples = np.frombuffer(arena, np.uint8, count=length, offset=offset).reshape(-1, 3).astype(np.int64)
        first = (triples[:, 0] << 4) | (triples[:, 1] >> 4)
        second = ((triples[:, 1] & 15) << 8) | triples[:, 2]
        kernel = np.stack((first, second), axis=-1).reshape(-1) - 2047
    else:
        dtype = np.dtype('i1' if kind == 1 else '<i2')
        length = count * dtype.itemsize
        kernel = np.frombuffer(arena, dtype, count=count, offset=offset).astype(np.int64)
    if layer['bias']:
        if layer['bias_storage']['type'] != 4:
            raise ValueError('integer accumulator bias representation required')
        bias = np.frombuffer(arena, '<i4', count=co, offset=offset + length).astype(np.int64)
        length += co * 4
    else:
        bias = np.zeros(co, np.int64)
    if length != layer['arena_bytes']:
        raise ValueError('convolution arena accounting mismatch')
    shape = (kh, kw, co) if depthwise else (co, kh, kw, channels)
    return kernel.reshape(shape), bias


def convolution(*, builder, value, layer, source, shape, arena):
    kernel, bias = decode_parameters(arena=arena, layer=layer, channels=shape[3])
    fraction = source['fraction'] + layer['weight']['fraction']
    if layer['bias']:
        shift = layer['bias_storage']['fraction'] - fraction
        bias = bias * (1 << -shift) if shift <= 0 else (bias + (1 << (shift - 1))) // (1 << shift)
    accumulated = builder.constant(bias.reshape(1, 1, 1, -1))
    ph, pw = layer['pad']
    sh, sw = layer['stride']
    kh, kw = layer['kernel']
    output_shape = (shape[0], (shape[1] + 2 * ph - kh) // sh + 1,
                    (shape[2] + 2 * pw - kw) // sw + 1, layer['shape'][3])
    padded = builder.pad(value, ph, pw)
    for y in range(kh):
        for x in range(kw):
            patch = builder.slice(padded, y, x, output_shape[1], output_shape[2], layer['stride'])
            weight = kernel[y, x] if layer['op'] == 'DepthwiseSeparableConvolution' else kernel[:, y, x].T
            product = builder.node('Mul' if layer['op'] == 'DepthwiseSeparableConvolution' else 'MatMul', patch, builder.constant(weight.copy()))
            accumulated = builder.node('Add', accumulated, product)
    wrapped = builder.node('Sub', builder.node('Mod', builder.node('Add', accumulated, builder.integer(1 << 31)),
                           builder.integer(1 << 32), fmod=0), builder.integer(1 << 31))
    scaled = builder.requantize(wrapped, fraction - layer['storage']['fraction'])
    return builder.clamp(scaled, layer['storage'], layer['relu']), output_shape


def upsample(*, builder, value, shape):
    n, h, w, channels = shape
    padded = builder.pad(value, 1, 1)
    main = builder.slice(padded, 1, 1, h, w)
    rows = []
    for dy in (0, 2):
        row = builder.slice(padded, dy, 1, h, w)
        columns = []
        for dx in (0, 2):
            column = builder.slice(padded, 1, dx, h, w)
            diagonal = builder.slice(padded, dy, dx, h, w)
            numerator = builder.node('Add', builder.node('Mul', main, builder.integer(9)), builder.node('Mul', row, builder.integer(3)))
            numerator = builder.node('Add', numerator, builder.node('Mul', column, builder.integer(3)))
            filtered = builder.floor_divide(builder.node('Add', numerator, diagonal), 16)
            columns.append(builder.node('Unsqueeze', filtered, builder.integer([3])))
        merged = builder.node('Concat', *columns, axis=3)
        rows.append(builder.node('Reshape', merged, builder.integer([n, h, 2 * w, channels])))
    stacked = [builder.node('Unsqueeze', row, builder.integer([2])) for row in rows]
    merged = builder.node('Concat', *stacked, axis=2)
    shape = (n, 2 * h, 2 * w, channels)
    return builder.node('Reshape', merged, builder.integer(shape)), shape


def build_model(*, graph, arena, height, width, output_names=None):
    if (type(height) is not int or type(width) is not int or min(height, width) < 16
            or max(height, width) > 512 or height % 16 or width % 16):
        raise ValueError('bounded skin dimensions divisible by 16 required')
    if graph['letter'] != 'B' or len(arena) != graph['arena_bytes'] or len(arena) > 16 * 1024**2:
        raise ValueError('bounded packed integer graph with exact arena required')
    if graph['stamp'] is not None and int.from_bytes(arena[-4:], 'little') != graph['stamp']:
        raise ValueError('skin arena stamp mismatch')
    inputs = [layer for layer in graph['layers'] if layer['op'] == 'Input']
    if len(inputs) != 1 or inputs[0]['shape'][0] != 1 or inputs[0]['shape'][3] != 3:
        raise ValueError('one three-channel skin input required')
    builder = Builder()
    shapes, types = {}, {}
    descriptors = graph['descriptors']
    for layer in graph['layers']:
        op = layer['op']
        if op not in SUPPORTED or len(layer['outputs']) != 1:
            raise ValueError(f'unsupported skin operator: {op}')
        target = layer['outputs'][0]
        if op == 'Input':
            if layer['storage']['type'] not in RANGES:
                raise ValueError('integer skin input required')
            shapes[target], types[target] = (1, height, width, 3), TensorProto.INT64
            continue
        source_names = layer['inputs']
        if not source_names or any(name not in shapes for name in source_names):
            raise ValueError('skin graph inputs must precede consumers')
        sources = list(source_names)
        source_shape = shapes[sources[0]]
        if op == 'Sigmoid':
            if layer is not graph['layers'][-1]:
                raise ValueError('only a terminal skin sigmoid is supported')
            value = builder.node('Cast', sources[0], to=TensorProto.FLOAT)
            scale = builder.constant(np.float32(2.0 ** -descriptors[sources[0]]['fraction']))
            exponent = builder.node('Exp', builder.node('Neg', builder.node('Mul', value, scale)))
            one = builder.constant(np.float32(1))
            value = builder.node('Div', one, builder.node('Add', one, exponent))
            shape, types[target] = source_shape, TensorProto.FLOAT
        elif op in ('Convolution', 'DepthwiseSeparableConvolution'):
            value, shape = convolution(builder=builder, value=sources[0], layer=layer,
                source=descriptors[sources[0]], shape=source_shape, arena=arena)
        elif op == 'UpSampling':
            if layer['mode'] != 'LINEAR':
                raise ValueError('only measured integer LINEAR x2 skin upsampling supported')
            value, shape = upsample(builder=builder, value=sources[0], shape=source_shape)
        elif op == 'Concat':
            if any(shapes[name][:3] != source_shape[:3] for name in sources):
                raise ValueError('matching concat spatial dimensions required')
            values = [name if descriptors[name]['fraction'] == layer['storage']['fraction']
                      else builder.clamp(builder.requantize(name, descriptors[name]['fraction'] - layer['storage']['fraction']), layer['storage']) for name in sources]
            value = builder.node('Concat', *values, axis=3)
            shape = (*source_shape[:3], sum(shapes[name][3] for name in sources))
        else:
            if len(sources) != 2 or shapes[sources[1]] != source_shape:
                raise ValueError('two matching add inputs required')
            common = max(descriptors[name]['fraction'] for name in sources)
            aligned = [builder.node('Mul', name, builder.integer(1 << (common - descriptors[name]['fraction']))) for name in sources]
            value = builder.clamp(builder.requantize(builder.node('Add', *aligned), common - layer['storage']['fraction']), layer['storage'], layer['relu'])
            shape = source_shape
        builder.node('Identity', value, output=target)
        shapes[target] = shape
        types.setdefault(target, TensorProto.INT64)
    input_name = inputs[0]['outputs'][0]
    output_names = output_names or [graph['layers'][-1]['outputs'][0]]
    if not output_names or len(set(output_names)) != len(output_names) or any(name not in shapes or name == input_name for name in output_names):
        raise ValueError('distinct produced skin outputs required')
    specification = helper.make_graph(builder.nodes, 'owned-integer-skin',
        [helper.make_tensor_value_info(input_name, TensorProto.INT64, shapes[input_name])],
        [helper.make_tensor_value_info(name, types[name], shapes[name]) for name in output_names], builder.constants)
    model = helper.make_model(specification, opset_imports=[helper.make_opsetid('', 18)], ir_version=10,
                              producer_name='qcut-owned-skin')
    onnx.checker.check_model(model, full_check=True)
    return model


def export(*, parsed, arena, output, report, height, width):
    if output.exists() or report.exists():
        raise ValueError('fresh private skin export paths required')
    root = Path(__file__).resolve().parents[1]
    if any(not any(path.resolve().is_relative_to((root / name).resolve()) for name in ('runtime', 'output')) for path in (output, report)):
        raise ValueError('recovered skin models and receipts must stay under ignored runtime/ or output/')
    graph_data, arena_data = parsed.read_bytes(), arena.read_bytes()
    if hashlib.sha256(graph_data).hexdigest() != PARSED_SHA256 or hashlib.sha256(arena_data).hexdigest() != ARENA_SHA256:
        raise ValueError('pinned skin graph and arena required')
    model = build_model(graph=json.loads(graph_data), arena=arena_data, height=height, width=width)
    output.parent.mkdir(parents=True, exist_ok=True)
    report.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(model, output)
    receipt = {'scope': 'independent-integer-skin-model-export-not-native-parity',
               'parsedSha256': hashlib.sha256(graph_data).hexdigest(), 'arenaSha256': hashlib.sha256(arena_data).hexdigest(),
               'sourceSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
               'modelSha256': hashlib.sha256(output.read_bytes()).hexdigest(),
               'artifact_sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
               'input_shape': [1, height, width, 3], 'input_type': 'int64', 'output_name': 'prob',
               'inputLayout': 'NHWC-int64-quantized-values', 'inputShape': [1, height, width, 3],
               'terminalType': 'float32-sigmoid', 'onnxVersion': onnx.__version__,
               'nativePixelsUsed': False, 'nativeGeometryUsed': False}
    report.write_text(json.dumps(receipt, indent=2) + '\n')
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--parsed', type=Path, required=True)
    parser.add_argument('--arena', type=Path, required=True)
    parser.add_argument('--height', type=int, required=True)
    parser.add_argument('--width', type=int, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    arguments = parser.parse_args()
    print(json.dumps(export(parsed=arguments.parsed, arena=arguments.arena, output=arguments.output,
          report=arguments.report, height=arguments.height, width=arguments.width)))
