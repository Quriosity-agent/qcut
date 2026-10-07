from pathlib import Path
import sys
import unittest

import numpy as np
import onnx
import onnxruntime as ort
from onnx import helper, TensorProto

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from skin_mask_export import Builder, build_model, decode_parameters


def execute_model(model, feeds):
    options = ort.SessionOptions()
    options.intra_op_num_threads = options.inter_op_num_threads = 1
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    session = ort.InferenceSession(model.SerializeToString(), sess_options=options, providers=['CPUExecutionProvider'])
    return session.run(None, feeds)


def basic_graph(layers):
    storage = {'type': 2, 'fraction': 7}
    input_layer = {'op': 'Input', 'inputs': [], 'outputs': ['data'], 'shape': [1, 16, 16, 3], 'storage': storage}
    descriptors = {'data': storage}
    for layer in layers:
        descriptors[layer['outputs'][0]] = layer.get('storage', storage)
    return {'letter': 'B', 'stamp': 12, 'arena_bytes': 4, 'layers': [input_layer, *layers], 'descriptors': descriptors}


class SkinExportTest(unittest.TestCase):
    def test_requantization_negative_values_floor_instead_of_truncate(self):
        builder = Builder()
        output = builder.requantize('data', 4)
        graph = helper.make_graph(builder.nodes, 'signed-rounding',
            [helper.make_tensor_value_info('data', TensorProto.INT64, [11])],
            [helper.make_tensor_value_info(output, TensorProto.INT64, [11])], builder.constants)
        model = helper.make_model(graph, opset_imports=[helper.make_opsetid('', 18)], ir_version=10)
        values = np.array([-33, -25, -24, -17, -9, -8, -1, 0, 7, 8, 24], np.int64)
        result = execute_model(model, {'data': values})[0]
        np.testing.assert_array_equal(result, (values + 8) // 16)

    def test_packed_kernel_keeps_highest_code_and_decodes_order(self):
        layer = {'op': 'Convolution', 'shape': [1, 1, 1, 2], 'kernel': [1, 1],
                 'arena_offset': 0, 'weight': {'type': 2}, 'packed': True,
                 'bias': False, 'arena_bytes': 3}
        kernel, bias = decode_parameters(arena=bytes([255, 240, 0]), layer=layer, channels=1)
        np.testing.assert_array_equal(kernel.reshape(-1), [2048, -2047])
        np.testing.assert_array_equal(bias, [0, 0])

    def test_integer_upsampling_zero_padded_edges_and_signed_floor(self):
        up = {'op': 'UpSampling', 'inputs': ['data'], 'outputs': ['upsampled'], 'mode': 'LINEAR'}
        sigmoid = {'op': 'Sigmoid', 'inputs': ['upsampled'], 'outputs': ['prob']}
        graph = basic_graph([up, sigmoid])
        model = build_model(graph=graph, arena=(12).to_bytes(4, 'little'), height=16, width=16,
                            output_names=['upsampled', 'prob'])
        rng = np.random.default_rng(691)
        source = rng.integers(-128, 128, (1, 16, 16, 3), dtype=np.int64)
        output, probabilities = execute_model(model, {'data': source})
        padded = np.pad(source, ((0, 0), (1, 1), (1, 1), (0, 0)))
        expected = np.empty((1, 32, 32, 3), np.int64)
        for dy in (0, 1):
            for dx in (0, 1):
                row, column = dy * 2, dx * 2
                expected[:, dy::2, dx::2] = (9 * source + 3 * padded[:, row:row + 16, 1:17]
                    + 3 * padded[:, 1:17, column:column + 16] + padded[:, row:row + 16, column:column + 16]) // 16
        np.testing.assert_array_equal(output, expected)
        np.testing.assert_allclose(probabilities, 1 / (1 + np.exp(-expected.astype(np.float32) / 128)), atol=1e-7)

    def test_integer_convolution_bias_scale_relu_and_output_saturation(self):
        storage = {'type': 2, 'fraction': 7}
        layer = {'op': 'Convolution', 'inputs': ['data'], 'outputs': ['logits'], 'shape': [1, 16, 16, 1],
                 'kernel': [1, 1], 'stride': [1, 1], 'pad': [0, 0], 'arena_offset': 0, 'arena_bytes': 7,
                 'bias': True, 'relu': True, 'weight': {'type': 1, 'fraction': 2},
                 'bias_storage': {'type': 4, 'fraction': 11}, 'storage': storage, 'packed': False}
        graph = basic_graph([layer, {'op': 'Sigmoid', 'inputs': ['logits'], 'outputs': ['prob']}])
        arena = np.array([20, -30, 40], np.int8).tobytes() + np.array([-512], '<i4').tobytes() + (12).to_bytes(4, 'little')
        graph['arena_bytes'] = len(arena)
        model = build_model(graph=graph, arena=arena, height=16, width=16, output_names=['logits'])
        rng = np.random.default_rng(548)
        source = rng.integers(-2047, 2048, (1, 16, 16, 3), dtype=np.int64)
        expected = np.clip((source @ np.array([[20], [-30], [40]], np.int64) - 128 + 2) // 4, 0, 2047)
        result = execute_model(model, {'data': source})[0]
        np.testing.assert_array_equal(result, expected)

    def test_profile_stamp_and_unsupported_operations_fail_closed(self):
        graph = basic_graph([{'op': 'Sigmoid', 'inputs': ['data'], 'outputs': ['prob']}])
        for height, width in ((15, 16), (32, 33), (1024, 128), (True, 128)):
            with self.subTest(size=(height, width)), self.assertRaises(ValueError):
                build_model(graph=graph, arena=(12).to_bytes(4, 'little'), height=height, width=width)
        with self.assertRaises(ValueError):
            build_model(graph=graph, arena=bytes(4), height=16, width=16)
        graph['layers'][-1]['op'] = 'DeConvolution'
        with self.assertRaises(ValueError):
            build_model(graph=graph, arena=(12).to_bytes(4, 'little'), height=16, width=16)


if __name__ == '__main__':
    unittest.main()
