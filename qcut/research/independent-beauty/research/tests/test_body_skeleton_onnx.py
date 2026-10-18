"""Exact body graph arithmetic, backend selection and bounded session reuse."""
from pathlib import Path
import os
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

import numpy as np
import onnxruntime as ort
from onnx import TensorProto, helper

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from body_espresso_fixed import run, requantize, wrap32
from body_espresso_onnx import Builder, build_model
import body_skeleton_model as skeleton
from body_skeleton_model import ASSET, BACKEND_ENV, SkeletonNetworks, selected_backend
from body_skeleton_onnx import ExactOnnxNetworks, MAX_SESSIONS

ASSET_PATH = Path(__file__).resolve().parents[2] / 'runtime' / 'research' / ASSET


def execute(*, model, tensor):
    options = ort.SessionOptions()
    options.intra_op_num_threads = options.inter_op_num_threads = 1
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    session = ort.InferenceSession(model.SerializeToString(), sess_options=options, providers=['CPUExecutionProvider'])
    return dict(zip([output.name for output in session.get_outputs()], session.run(None, {'input': tensor})))


def graph_text(*, rows):
    return '\n'.join(['B', f'1 {len(rows)}', 'DataV2 data 1 32 32 3 2 6 0', *rows])


class Arithmetic(unittest.TestCase):
    def test_signed_ties_and_int32_overflow_match_integer_oracle(self):
        values = np.array([-2**32 - 9, -2**31 - 1, -2**31, -33, -25, -24, -9, -8, -1,
                           0, 7, 8, 24, 2**31 - 1, 2**31, 2**32 + 9], np.int64)
        builder = Builder()
        output = builder.requantize(builder.wrap32('input'), 4)
        model = helper.make_model(helper.make_graph(builder.nodes, 'body-rounding',
            [helper.make_tensor_value_info('input', TensorProto.DOUBLE, [len(values)])],
            [helper.make_tensor_value_info(output, TensorProto.DOUBLE, [len(values)])], builder.constants),
            opset_imports=[helper.make_opsetid('', 18)], ir_version=10)
        actual = execute(model=model, tensor=values.astype(np.float64))[output]
        np.testing.assert_array_equal(actual, requantize(wrap32(values), 4))

    def test_convolution_signed_bias_wrap_and_saturation(self):
        text = graph_text(rows=['Convolution conv 2 1 1 1 1 0 0 1 0 1 2 4 8 2 6 data output'])
        arena = np.array([127, -128, 17, -2, 3, -4], np.int8).tobytes() + np.array([-2**31, 2**31 - 1], '<i4').tobytes()
        tensor = np.random.default_rng(1801).integers(-32768, 32768, (1, 32, 32, 3), dtype=np.int16)
        model = build_model(text=text, arena=arena, shape=tensor.shape, outputs=['output'])
        actual = execute(model=model, tensor=tensor)['output']
        expected = run(text, arena, {'data': (tensor, [2, 6])})['output']['data'].astype(np.int16)
        np.testing.assert_array_equal(actual, expected)

    def test_upsampling_edges_and_negative_floor_both_profiles(self):
        tensor = np.random.default_rng(1802).integers(-128, 128, (1, 32, 32, 3), dtype=np.int16)
        for mode in ('LINEAR', 'BILINEAR'):
            with self.subTest(mode=mode):
                text = graph_text(rows=[f'UpSampling up data output {mode}'])
                model = build_model(text=text, arena=b'', shape=tensor.shape, outputs=['output'])
                actual = execute(model=model, tensor=tensor)['output']
                expected = run(text, b'', {'data': (tensor, [2, 6])})['output']['data'].astype(np.int16)
                np.testing.assert_array_equal(actual, expected)

    def test_shuffle_net_retains_one_sided_int16_lane_clamps(self):
        text = graph_text(rows=['ShuffleNet split 2 data data 1 2 left 6 right 5'])
        tensor = np.tile(np.array([[-32768, 32767, -4095]], np.int16), (1, 32, 32, 1))
        model = build_model(text=text, arena=b'', shape=tensor.shape, outputs=['left', 'right'])
        actual = execute(model=model, tensor=tensor)
        expected = run(text, b'', {'data': (tensor, [2, 6])})
        for name in actual:
            np.testing.assert_array_equal(actual[name], expected[name]['data'].astype(np.int16))

    def test_concat_and_slice_pass_unscaled_values_without_clamping(self):
        text = graph_text(rows=['Concat concat 2 data data joined 2 6',
                                'Slice split joined 0 0 3 2 left 6 right 5'])
        tensor = np.full((1, 32, 32, 3), 3000, np.int16)
        model = build_model(text=text, arena=b'', shape=tensor.shape, outputs=['left', 'right'])
        actual = execute(model=model, tensor=tensor)
        expected = run(text, b'', {'data': (tensor, [2, 6])})
        for name in actual:
            np.testing.assert_array_equal(actual[name], expected[name]['data'].astype(np.int16))

    def test_invalid_shape_arena_or_required_float_op_fails_closed(self):
        text = graph_text(rows=['Sigmoid sigmoid data output'])
        for shape in ((1, 31, 32, 3), (1, 32, 240, 3), (2, 32, 32, 3)):
            with self.subTest(shape=shape), self.assertRaises(ValueError):
                build_model(text=text, arena=b'', shape=shape, outputs=['output'])
        with self.assertRaisesRegex(ValueError, 'unsupported required'):
            build_model(text=text, arena=b'', shape=(1, 32, 32, 3), outputs=['output'])
        with self.assertRaisesRegex(ValueError, 'arena size'):
            build_model(text=text, arena=b'x', shape=(1, 32, 32, 3), outputs=['output'])


class Backend(unittest.TestCase):
    def test_numpy_is_default_and_onnx_requires_explicit_selection(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(selected_backend(), 'numpy')
        with patch.dict(os.environ, {BACKEND_ENV: 'onnx-exact'}):
            self.assertEqual(selected_backend(), 'onnx-exact')
            self.assertEqual(selected_backend(backend='numpy'), 'numpy')
        with self.assertRaises(ValueError):
            selected_backend(backend='automatic-approximation')

    def test_unverified_runtime_version_does_not_silently_run(self):
        with patch.object(ort, '__version__', '99.0.0'), self.assertRaisesRegex(ValueError, 'verified onnxruntime'):
            ExactOnnxNetworks(networks={}, outputs={})

    def test_backend_switch_invalidates_cached_networks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'research').mkdir()
            (root / 'research' / ASSET).write_bytes(b'fixture')
            skeleton._LOADED.clear()
            try:
                with patch.object(skeleton, 'SkeletonNetworks', side_effect=[Mock(), Mock()]) as create:
                    numpy = skeleton.load_networks(runtime=root, backend='numpy')
                    self.assertIs(skeleton.load_networks(runtime=root, backend='numpy'), numpy)
                    accelerated = skeleton.load_networks(runtime=root, backend='onnx-exact')
                    self.assertIsNot(accelerated, numpy)
                    self.assertEqual(create.call_count, 2)
                    self.assertEqual(create.call_args.kwargs['backend'], 'onnx-exact')
            finally:
                skeleton._LOADED.clear()

    def test_session_lru_is_bounded_and_rebuilds_evicted_shape(self):
        model = Mock()
        model.SerializeToString.return_value = b'mock-model'
        session = Mock()
        session.get_providers.return_value = ['CPUExecutionProvider']
        session.run.return_value = [np.zeros((1, 1, 1, 1), np.int16)]
        networks = ExactOnnxNetworks(networks={'coarse': ('graph', b'arena')}, outputs={'coarse': ['output']})
        with patch('body_skeleton_onnx.build_model', return_value=model) as build, \
                patch.object(ort, 'InferenceSession', return_value=session):
            tensors = [np.zeros((1, 32, width, 3), np.int16) for width in (32, 48, 64, 80, 96)]
            for tensor in tensors:
                networks.infer(tensor=tensor, network='coarse')
            self.assertEqual(len(networks.sessions), MAX_SESSIONS)
            networks.infer(tensor=tensors[-1], network='coarse')
            self.assertEqual(build.call_count, 5)
            networks.infer(tensor=tensors[0], network='coarse')
            self.assertEqual(build.call_count, 6)
            self.assertEqual(len(networks.provenance['models']), MAX_SESSIONS)


@unittest.skipUnless(ASSET_PATH.is_file(), 'private pinned body weight asset is not installed')
class PinnedNetworks(unittest.TestCase):
    def test_coarse_and_refine_integer_outputs_match_numpy_with_original_weights(self):
        oracle = SkeletonNetworks(path=ASSET_PATH, backend='numpy')
        accelerated = SkeletonNetworks(path=ASSET_PATH, backend='onnx-exact')
        rng = np.random.default_rng(20261018)
        for name, height, width in (('coarse', 224, 128), ('refine', 192, 144)):
            for low, high in ((-128, 128), (-32768, 32768)):
                with self.subTest(network=name, domain=(low, high)):
                    tensor = rng.integers(low, high, (1, height, width, 3), dtype=np.int16)
                    expected = oracle.infer(tensor=tensor, network=name)
                    actual = accelerated.infer(tensor=tensor, network=name)
                    self.assertEqual(set(actual), set(expected))
                    for output in expected:
                        self.assertEqual(actual[output].dtype, np.int16)
                        np.testing.assert_array_equal(actual[output], expected[output])
        self.assertEqual(accelerated.provenance['graphs'], oracle.provenance['graphs'])
        self.assertEqual(accelerated.provenance['arenas'], oracle.provenance['arenas'])
        self.assertFalse(accelerated.provenance['inference']['runtimeReadsVendorInstallation'])

    def test_modified_weights_fail_before_creating_an_accelerator(self):
        with np.load(ASSET_PATH, allow_pickle=False) as source:
            arrays = {name: source[name].copy() for name in source.files}
        arrays['coarse_arena'].reshape(-1)[0] ^= 1
        with tempfile.TemporaryDirectory() as temporary:
            modified = Path(temporary) / ASSET
            np.savez(modified, **arrays)
            with patch('body_skeleton_onnx.ExactOnnxNetworks') as create, \
                    self.assertRaisesRegex(ValueError, 'differs from the verified weights'):
                SkeletonNetworks(path=modified, backend='onnx-exact')
            create.assert_not_called()


if __name__ == '__main__':
    unittest.main()
