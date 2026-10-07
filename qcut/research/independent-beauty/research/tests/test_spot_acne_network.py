import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from flowgan_assets import half_truncate
from spot_acne_assets import local_file
from spot_acne_export import pack_weight, parse_graph
from spot_acne_metal import camera
from spot_acne_network import infer
from spot_acne_render import run

ROOT = Path(__file__).resolve().parents[2]


class SpotDataTests(unittest.TestCase):
    def test_regular_packing_preserves_all_lanes_and_zero_pads_tails(self):
        raw = np.arange(5*3*3*5, dtype=np.float32).reshape(5, 3, 3, 5)/17
        bias = np.asarray([1, -1.0009, 2**-24, -2**-25, 0], np.float32)
        weight, packed_bias = pack_weight(kernel=raw, bias=bias, depth=False)
        actual = np.frombuffer(weight, '<f2').reshape(2, 2, 3, 3, 4, 4)
        expected = half_truncate(values=raw)
        for out_channel in range(8):
            for in_channel in range(8):
                lane = actual[out_channel//4, in_channel//4, :, :, out_channel%4, in_channel%4]
                np.testing.assert_array_equal(lane, expected[out_channel, :, :, in_channel]
                    if out_channel < 5 and in_channel < 5 else np.zeros((3, 3), np.float16))
        b = np.frombuffer(packed_bias, '<u2')
        np.testing.assert_array_equal(b[:5], [0x3c00, 0xbc00, 1, 0x8000, 0])
        np.testing.assert_array_equal(b[5:], 0)

    def test_depthwise_packing_keeps_channel_and_spatial_order(self):
        raw = np.arange(5*3*3, dtype=np.float32).reshape(5, 3, 3, 1)/8
        weight, bias = pack_weight(kernel=raw, bias=np.arange(5, dtype=np.float32), depth=True)
        actual = np.frombuffer(weight, '<f2').reshape(2, 3, 3, 4)
        for channel in range(5):
            np.testing.assert_array_equal(actual[channel//4, :, :, channel%4], raw[channel, :, :, 0])
        np.testing.assert_array_equal(actual[1, :, :, 1:], 0)
        np.testing.assert_array_equal(np.frombuffer(bias, '<f2'), [0, 1, 2, 3, 4, 0, 0, 0])

    def test_weights_reject_unsupported_dimensions_and_nonfinite_values(self):
        for kernel, bias, depth in ((np.ones((1, 2, 2, 1)), [0], False),
                (np.ones((1, 1, 1, 2)), [0], True), (np.ones((577, 1, 1, 1)), np.zeros(577), False),
                (np.asarray([[[[np.nan]]]]), [0], False), (np.ones((1, 1, 1, 1)), [np.inf], False)):
            with self.subTest(shape=kernel.shape), self.assertRaises(ValueError):
                pack_weight(kernel=kernel, bias=bias, depth=depth)

    def test_graph_rejects_unknown_or_unbounded_text(self):
        for text in ('', 'D\n1 65\n', 'x'*16385, None):
            with self.assertRaises(ValueError):
                parse_graph(text=text)

    def test_assets_reject_symlinks_size_and_wrong_pin(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'data'
            path.write_bytes(b'owned')
            link = Path(directory)/'link'
            link.symlink_to(path)
            for value, limit in ((path, 2), (link, 100), (path, 100)):
                with self.assertRaises(ValueError):
                    local_file(path=value, expected='0'*64, limit=limit)


class SpotPhotoTests(unittest.TestCase):
    def test_camera_identity_has_no_translation_at_crop_center(self):
        crop = dict(crop=dict(inverse=[[1, 0, 64], [0, 1, 64]]), front=dict(algorithmSize=[640, 640]))
        np.testing.assert_array_equal(camera(crop=crop), np.diag(np.asarray([.8, .8, 1, 1], np.float32)))

    def test_network_invalid_inputs_fail_before_asset_or_gpu_access(self):
        for value in (None, np.zeros((512, 512, 3), np.float32), np.zeros((512, 512, 4), np.float64),
                      np.full((512, 512, 4), np.nan, np.float32), np.full((512, 512, 4), 1.001, np.float32)):
            with patch('spot_acne_network.load') as assets, self.assertRaises(ValueError):
                infer(crop=value, runtime=Path('absent'))
            assets.assert_not_called()

    def test_zero_is_identity_without_any_frontend_network_or_assets(self):
        rgba = np.full((160, 192, 4), 255, np.uint8)
        rgba[..., 0] = np.arange(192, dtype=np.uint8)
        with tempfile.TemporaryDirectory() as directory, patch('spot_acne_render.crop_photo') as crop:
            output, report = Path(directory)/'zero.png', Path(directory)/'zero.json'
            receipt = run(rgba=rgba, intensity=0, runtime=Path('absent'), output=output, report=report)
            np.testing.assert_array_equal(np.asarray(Image.open(output)), rgba)
            self.assertIsNone(receipt['diagnostics'])
            self.assertEqual(receipt['independence']['private_native_images'], [])
            crop.assert_not_called()


@unittest.skipUnless(sys.platform == 'darwin', 'owned Metal kernel tests require macOS')
class SpotKernelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='owned-gan-kernel-tests-')
        cls.host = Path(cls.directory.name)/'host'
        subprocess.run(['xcrun', 'swiftc', '-O', str(Path(__file__).with_name('gan_compute_probe.swift')),
            '-o', str(cls.host)], check=True, capture_output=True, timeout=60)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def gpu(self, *, kernel, params, inputs, weights=(), bias=(), second=(), grid=(1, 1, 1), count=4):
        request = Path(self.directory.name)/'request.json'
        request.write_text(json.dumps(dict(kernel=kernel, params=params, grid=grid, input=list(inputs),
            weights=list(weights), bias=list(bias), second=list(second), outputCount=count)))
        process = subprocess.run([str(self.host), str(ROOT/'research/gan_compute.metal'), str(request)],
            capture_output=True, check=True, timeout=30)
        return np.asarray(json.loads(process.stdout), np.float16)

    def test_convolution_bias_follows_float32_cancellation(self):
        weights = np.zeros(2*9*16, np.float32)
        weights[4*16] = 512
        weights[(9+4)*16] = -512
        value = self.gpu(kernel='conv', params=[1, 1, 2, 1, 1, 1, 3, 1, 1, 0, 0],
            inputs=[32768, 0, 0, 0]*2, weights=weights.tolist(), bias=[1, 0, 0, 0])
        np.testing.assert_array_equal(value, [1, 0, 0, 0])

    def test_zero_padding_and_relu_do_not_clamp_input_edges(self):
        weights = np.full(9*16, 100, np.float32)
        weights[4*16:5*16] = np.eye(4).reshape(-1)
        value = self.gpu(kernel='conv', params=[1, 1, 1, 1, 1, 1, 3, 1, 1, 1, 0],
            inputs=[1, 2, 3, 4], weights=weights.tolist(), bias=[-2, 0, 0, 0])
        np.testing.assert_array_equal(value, [0, 2, 3, 4])

    def test_four_pixel_pointwise_tail_matches_scalar_kernel(self):
        params = [5, 1, 1, 5, 1, 1, 1, 1, 0, 0, 0]
        inputs = np.arange(20, dtype=np.float32)/8
        arguments = dict(params=params, inputs=inputs.tolist(), weights=np.eye(4).reshape(-1).tolist(), bias=[1, 2, 3, 4], count=20)
        scalar = self.gpu(kernel='pointConv', grid=(5, 1, 1), **arguments)
        grouped = self.gpu(kernel='pointConvFour', grid=(2, 1, 1), **arguments)
        np.testing.assert_array_equal(grouped, scalar)
        np.testing.assert_array_equal(grouped.reshape(5, 4), inputs.reshape(5, 4)+[1, 2, 3, 4])

    def test_depthwise_product_rounds_to_half_before_float32_accumulation(self):
        a = np.asarray([.33325, .701, -.913, .417], np.float16)
        b = np.asarray([.777, -.531, .33325, .701], np.float16)
        bias = np.asarray([.01, -.02, .03, -.04], np.float16)
        expected = ((a*b).astype(np.float32)+bias.astype(np.float32)).astype(np.float16)
        result = self.gpu(kernel='depth', params=[1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
            inputs=a.astype(float).tolist(), weights=b.astype(float).tolist(), bias=bias.astype(float).tolist())
        np.testing.assert_array_equal(result, expected)

    def test_tanh_zero_saturation_sign_and_half_range(self):
        result = self.gpu(kernel='pointwise', params=[2, 1, 1, 2, 1, 1, 0, 0, 0, 0, 3],
            inputs=[-16, -1, 0, 1, 16, .5, -.5, 0], grid=(2, 1, 1), count=8)
        np.testing.assert_array_equal(result[[0, 2, 4, 7]], [-1, 0, 1, 0])
        self.assertTrue(np.all(np.abs(result) <= 1))
        self.assertAlmostEqual(float(result[1]), -float(result[3]), places=3)
        self.assertAlmostEqual(float(result[5]), -float(result[6]), places=3)

    def test_bilinear_upsample_clamps_half_pixel_border(self):
        result = self.gpu(kernel='resize', params=[2, 1, 1, 4, 2, 1, 0, 0, 0, 0, 0],
            inputs=[0]*4+[4]*4, grid=(4, 2, 1), count=32)
        np.testing.assert_array_equal(result.reshape(2, 4, 4), np.broadcast_to(np.asarray([0, 1, 3, 4])[None, :, None], (2, 4, 4)))


if __name__ == '__main__':
    unittest.main()
