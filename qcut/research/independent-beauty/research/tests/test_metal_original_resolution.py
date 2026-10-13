"""Execute every real host contract before allocation, plus HD GPU transport and preview equivalence."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from makeup_metal import build_host

ROOT = Path(__file__).resolve().parents[2]
HOSTS = {
    'makeup_metal': 'makeup-metal', 'face_metal': 'face-metal', 'liquefy_metal': 'liquefy-metal',
    'smooth_metal': 'smooth-metal', 'whiten_metal': 'whiten-metal', 'flowgan_metal': 'flowgan-metal',
    'flowgan_frame': 'flowgan-frame-metal', 'spot_acne_crop': 'spot-acne-crop',
    'spot_acne_metal': 'spot-acne-metal', 'makeup3d_metal': 'makeup3d-metal',
}


@unittest.skipUnless(sys.platform == 'darwin', 'public Metal hosts require macOS')
class MetalOriginalResolutionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.runtime = tempfile.TemporaryDirectory(prefix='qcut-hd-host-tests-')
        cls.addClassCleanup(cls.runtime.cleanup)
        def compile_host(name):
            return name, build_host(runtime=Path(cls.runtime.name), source=ROOT/'research'/f'{name}.swift', prefix=HOSTS[name])
        with ThreadPoolExecutor(max_workers=2) as pool:
            cls.hosts = dict(pool.map(compile_host, HOSTS))

    def request(self, name, directory, width, height):
        def texture(edge, filename):
            return {'path': str(directory/filename), 'width': edge, 'height': edge}
        image = {'path': str(directory/'input.rgba'), 'width': width, 'height': height}
        outside = str(directory.parent/'outside.rgba')
        if name == 'smooth_metal':
            return {'source': image, 'skin': texture(1, 'skin.rgba'), 'face': texture(256, 'face.rgba'),
                    'cube': texture(512, 'cube.rgba'), 'mesh': None, 'strength': .5, 'output': outside, 'stages': False}
        if name == 'whiten_metal':
            return {'textures': [image, texture(512, 'cube.rgba'), texture(1, 'skin.rgba')], 'strength': .5, 'output': outside}
        request = {'width': width, 'height': height}
        if name in ('makeup_metal', 'face_metal', 'liquefy_metal'):
            request.update(input=image['path'], output=outside, passes=[])
        if name == 'flowgan_metal':
            request.update(shapes={}, steps=[], weights={}, source=image['path'], affine=[0]*6, mvp=[0]*16,
                           intensity=.5, maskWidth=320, maskHeight=320)
        if name == 'flowgan_frame':
            request.update(targetWidth=16, targetHeight=16)
        if name == 'spot_acne_crop':
            request.update(affine=[])
        if name == 'spot_acne_metal':
            request.update(mvp=[], intensity=.5)
        if name == 'makeup3d_metal':
            request.update(input=image['path'], output=outside, vertices=str(directory/'vertices'),
                           indices=str(directory/'indices'), uniforms=str(directory/'uniforms'), pigment=texture(1, 'pigment.rgba'))
        return request

    def invoke(self, name, request, directory):
        path = directory/'request.json'
        path.write_text(json.dumps(request)+'\n')
        host, environment, _ = self.hosts[name]
        return subprocess.run([str(host), str(path)], env=environment, capture_output=True, text=True, timeout=30)

    def test_all_hosts_require_explicit_original_above_preview_cap(self):
        for name in HOSTS:
            with self.subTest(host=name), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                for mode in (None, 'preview'):
                    request = self.request(name, directory, 1281, 16)
                    if mode:
                        request['resolutionMode'] = mode
                    process = self.invoke(name, request, directory)
                    self.assertNotEqual(process.returncode, 0)
                    self.assertIn('bounded source frame dimensions required', process.stderr)
                request['resolutionMode'] = 'original'
                process = self.invoke(name, request, directory)
                self.assertNotEqual(process.returncode, 0)
                self.assertNotIn('bounded source frame dimensions required', process.stderr)
                self.assertNotIn('resolution mode required', process.stderr)

    def test_all_hosts_reject_invalid_mode_before_source_io(self):
        for name in HOSTS:
            with self.subTest(host=name), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                request = self.request(name, directory, 64, 16)
                request['resolutionMode'] = 'unbounded'
                process = self.invoke(name, request, directory)
                self.assertNotEqual(process.returncode, 0)
                self.assertIn('preview or original resolution mode required', process.stderr)

    def test_all_hosts_reject_over_4096_and_int_overflow_without_allocation(self):
        for name in HOSTS:
            for width, height in ((4097, 16), (16, 4097), (2**63-1, 16), (16, 0), (-1, 16)):
                with self.subTest(host=name, width=width, height=height), tempfile.TemporaryDirectory() as temporary:
                    directory = Path(temporary)
                    request = self.request(name, directory, width, height)
                    request['resolutionMode'] = 'original'
                    process = self.invoke(name, request, directory)
                    self.assertNotEqual(process.returncode, 0)
                    self.assertIn('bounded source frame dimensions required', process.stderr)
                    self.assertNotEqual(process.returncode, -4)

    def test_4096_square_boundary_passes_only_the_source_guard(self):
        for name in HOSTS:
            with self.subTest(host=name), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                request = self.request(name, directory, 4096, 4096)
                request['resolutionMode'] = 'original'
                process = self.invoke(name, request, directory)
                self.assertNotEqual(process.returncode, 0)
                self.assertNotIn('bounded source frame dimensions required', process.stderr)
                self.assertNotIn('bounded source RGBA byte count required', process.stderr)

    def test_model_and_material_dimensions_remain_fixed_in_original_mode(self):
        cases = [
            ('smooth_metal', lambda r: r['skin'].update(width=513), 'bounded skin texture required'),
            ('smooth_metal', lambda r: r['face'].update(width=257), '256-square face mask required'),
            ('whiten_metal', lambda r: r['textures'][1].update(width=513), '512-square color cube required'),
            ('flowgan_metal', lambda r: r.update(maskWidth=321), 'bounded mask required'),
            ('flowgan_frame', lambda r: r.update(targetWidth=641), 'bounded NH target dimensions required'),
        ]
        for name, mutate, error in cases:
            with self.subTest(host=name, error=error), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                request = self.request(name, directory, 1281, 16)
                request['resolutionMode'] = 'original'
                mutate(request)
                process = self.invoke(name, request, directory)
                self.assertNotEqual(process.returncode, 0)
                self.assertIn(error, process.stderr)

    def test_real_hd_gpu_frame_transport_retains_pixels_and_observable_opt_in(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            pixels = np.full((17, 1281, 4), [17, 123, 235, 255], dtype=np.uint8)
            pixels.tofile(directory/'input.rgba')
            request = {'width': 1281, 'height': 17, 'targetWidth': 16, 'targetHeight': 16, 'resolutionMode': 'original'}
            process = self.invoke('flowgan_frame', request, directory)
            self.assertEqual(process.returncode, 0, process.stderr)
            actual = np.fromfile(directory/'output.rgba', np.uint8).reshape(16, 16, 4)
            np.testing.assert_array_equal(actual, np.full((16, 16, 4), [17, 123, 235, 255], dtype=np.uint8))
            receipt = json.loads((directory/'output.rgba.json').read_text())
            self.assertEqual(receipt['resolutionMode'], 'original')
            self.assertEqual(receipt['sourceFrameSize'], [1281, 17])
            self.assertEqual(receipt['sourceRgbaBytes'], pixels.nbytes)
            self.assertEqual(receipt['maxSourceEdge'], 4096)
            self.assertEqual(receipt['private_native_images'], [])
            self.assertTrue(receipt['images'])

    def test_real_4096_makeup_source_does_not_raise_the_material_limit(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            pixels = np.random.default_rng(2049).integers(0, 256, (17, 4096, 4), dtype=np.uint8)
            pixels[..., 3] = 255
            pixels.tofile(directory/'input.rgba')
            np.zeros((174, 8), dtype=np.float32).tofile(directory/'vertices')
            np.zeros(1002, dtype=np.uint16).tofile(directory/'indices')
            np.array([12, 24, 36, 255], dtype=np.uint8).tofile(directory/'pigment.rgba')
            pigment = {'path': str(directory/'pigment.rgba'), 'width': 1, 'height': 1}
            request = {'input': str(directory/'input.rgba'), 'output': str(directory/'output.rgba'),
                       'width': 4096, 'height': 17, 'resolutionMode': 'original', 'passes': [
                           {'name': 'Eyeline', 'strength': .5, 'modes': [1], 'pupil': False, 'cutoff': False,
                            'vertexCount': 174, 'indexCount': 1002, 'vertices': str(directory/'vertices'),
                            'indices': str(directory/'indices'), 'textures': [pigment]}]}
            process = self.invoke('makeup_metal', request, directory)
            self.assertEqual(process.returncode, 0, process.stderr)
            actual = np.fromfile(directory/'output.rgba', np.uint8).reshape(pixels.shape)
            np.testing.assert_array_equal(actual, pixels)
            receipt = json.loads((directory/'output.rgba.json').read_text())
            self.assertEqual(receipt['sourceFrameSize'], [4096, 17])
            self.assertEqual(receipt['sourceRgbaBytes'], pixels.nbytes)
            self.assertEqual(receipt['maxSourceEdge'], 4096)
            self.assertEqual(receipt['private_native_images'], [])
            pigment['width'] = 2049
            process = self.invoke('makeup_metal', request, directory)
            self.assertNotEqual(process.returncode, 0)
            self.assertIn('bounded pigment dimensions required', process.stderr)

    def test_default_explicit_preview_and_original_are_gpu_exact_below_1280(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            pixels = np.random.default_rng(1729).integers(0, 256, (32, 71, 4), dtype=np.uint8)
            pixels[..., 3] = 255
            pixels.tofile(directory/'input.rgba')
            outputs = []
            for mode in (None, 'preview', 'original'):
                request = {'width': 71, 'height': 32, 'targetWidth': 16, 'targetHeight': 16}
                if mode:
                    request['resolutionMode'] = mode
                process = self.invoke('flowgan_frame', request, directory)
                self.assertEqual(process.returncode, 0, process.stderr)
                outputs.append((directory/'output.rgba').read_bytes())
                receipt = json.loads((directory/'output.rgba.json').read_text())
                self.assertEqual(receipt['resolutionMode'], mode or 'preview')
                self.assertEqual(receipt['maxSourceEdge'], 4096 if mode == 'original' else 1280)
            self.assertEqual(outputs[0], outputs[1])
            self.assertEqual(outputs[0], outputs[2])


if __name__ == '__main__':
    unittest.main()
