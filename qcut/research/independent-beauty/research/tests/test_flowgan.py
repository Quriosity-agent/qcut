import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from flowgan_assets import half_truncate, load, load_schema
from flowgan_metal import camera
from flowgan_render import run
from flowgan_frame import SOURCE as FRAME_SOURCE, resize as resize_frame

ROOT = Path(__file__).resolve().parents[2]


class FlowWeightsTests(unittest.TestCase):
    def test_half_truncation_handles_normal_subnormal_signed_and_zero(self):
        tiny = np.float32(2**-24)
        values = np.asarray([1.0009, -1.0009, tiny*6.9, -tiny*6.9, tiny*.9, -tiny*.9, 0, -0.0, 65504], np.float32)
        result = half_truncate(values=values)
        expected = np.asarray([0x3c00, 0xbc00, 6, 0x8006, 0, 0x8000, 0, 0x8000, 0x7bff], np.uint16)
        np.testing.assert_array_equal(result.view(np.uint16), expected)
        self.assertTrue(np.all(np.abs(result.astype(np.float32)) <= np.abs(values)))

    def test_unrepresentable_weights_are_rejected(self):
        for value in (np.nan, np.inf, -np.inf, 65505):
            with self.assertRaises(ValueError):
                half_truncate(values=np.asarray([value], np.float32))

    def test_schema_rejects_modified_graph(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'schema.json'
            path.write_text('{}')
            with patch('flowgan_assets.SCHEMA', path), self.assertRaises(ValueError):
                load_schema()

    def test_original_weights_are_packed_without_exported_runtime(self):
        spec, packed, mask = load(runtime=ROOT/'runtime')
        self.assertEqual(len(packed), 106)
        self.assertEqual(len(spec['steps']), 86)
        self.assertEqual(mask.shape, (320, 320, 4))
        for weight in spec['weights'].values():
            for name in ('path', 'bias'):
                self.assertEqual(hashlib.sha256(packed[weight[name]]).hexdigest(), weight[name+'Sha256'])

    def test_corrupt_original_model_is_rejected(self):
        spec = load_schema()
        with tempfile.TemporaryDirectory() as directory:
            runtime = Path(directory)
            (runtime/'Models').mkdir()
            (runtime/'Models'/spec['model']['filename']).write_bytes(bytes(spec['model']['bytes']))
            with self.assertRaises(ValueError):
                load(runtime=runtime)


class FlowPhotoTests(unittest.TestCase):
    def test_algorithm_image_preserves_identity_samples_and_gpu_isolation(self):
        rgba = np.full((160, 192, 4), 255, np.uint8)
        rgba[..., 0] = np.arange(192, dtype=np.uint8)[None, :]
        rgba[..., 1] = np.arange(160, dtype=np.uint8)[:, None]
        with tempfile.TemporaryDirectory() as directory:
            output, receipt = resize_frame(frame=rgba, size=(192, 160), runtime=Path(directory))
        np.testing.assert_array_equal(output, rgba)
        self.assertEqual(receipt['private_native_images'], [])
        self.assertEqual(receipt['inputRgbaSha256'], receipt['outputRgbaSha256'])
        self.assertEqual(receipt['sourceSha256'], hashlib.sha256(FRAME_SOURCE.read_bytes()).hexdigest())

    def test_algorithm_image_bounds_fail_before_compiling_a_gpu_host(self):
        rgba = np.full((160, 192, 4), 255, np.uint8)
        for frame, size in ((rgba, (641, 160)), (rgba, (15, 160)), (rgba, [192, 160]),
                (rgba.astype(float), (192, 160)), (np.zeros((1281, 160, 4), np.uint8), (160, 640))):
            with patch('flowgan_frame.build_host') as build, self.assertRaises(ValueError):
                resize_frame(frame=frame, size=size, runtime=ROOT/'runtime')
            build.assert_not_called()

    def test_algorithm_image_rejects_private_gpu_libraries(self):
        rgba = np.full((160, 192, 4), 255, np.uint8)
        with tempfile.TemporaryDirectory() as directory:
            host = Path(directory)/'host'
            host.write_bytes(b'owned-host')
            def write_result(command, **options):
                output = Path(command[1]).parent
                rgba.tofile(output/'output.rgba')
                (output/'output.rgba.json').write_text(json.dumps({'private_native_images': ['liblens.dylib']}))
            with patch('flowgan_frame.build_host', return_value=(host, {}, hashlib.sha256(FRAME_SOURCE.read_bytes()).hexdigest())), \
                    patch('flowgan_frame.subprocess.run', side_effect=write_result), self.assertRaisesRegex(ValueError, 'integrity'):
                resize_frame(frame=rgba, size=(192, 160), runtime=Path(directory))

    def test_camera_reconstructs_normalized_crop_and_quad(self):
        prediction = {'algorithmSize': [640, 640], 'crop': {'inverse': np.asarray([[1, 0, 160], [0, 1, 160]], np.float32)}}
        affine, mvp = camera(prediction=prediction)
        np.testing.assert_array_equal(mvp, np.diag(np.asarray([.5, .5, 1, 1], np.float32)))
        np.testing.assert_array_equal(affine, np.asarray([[320/639.5, 0, 160/639.5], [0, 320/639.5, 160/639.5]], np.float32))

    def test_crop_normalization_rounds_only_at_gpu_boundary(self):
        inverse = np.asarray([[1.2737361, .00827228, 115.51023], [-.00827228, 1.2737361, 82.884644]], np.float32)
        affine, _ = camera(prediction={"algorithmSize": [640, 640], "crop": {"inverse": inverse}})
        self.assertEqual(affine[0, 0], np.float32(.637366))
        self.assertNotEqual(affine[0, 0], np.float32(inverse[0, 0]/np.float32(639.5)*np.float32(320)))

    def test_rotation_normalization_avoids_intermediate_float32_rounding(self):
        inverse = np.asarray([[1, .013722432777285576, 0], [-.013722432777285576, 1, 0]], np.float32)
        affine, _ = camera(prediction={"algorithmSize": [640, 640], "crop": {"inverse": inverse}})
        self.assertEqual(int(affine[0, 1].view(np.uint32)), 0x3be1010e)
        self.assertNotEqual(affine[0, 1], np.float32(inverse[0, 1]*np.float32(320)/np.float32(639.5)))

    def test_invalid_camera_is_rejected(self):
        for inverse in (np.zeros((3, 3), np.float32), np.full((2, 3), np.nan, np.float32), np.zeros((2, 3), np.float64)):
            with self.assertRaises(ValueError):
                camera(prediction={'algorithmSize': [640, 640], 'crop': {'inverse': inverse}})

    def test_zero_strength_requires_no_assets_or_face(self):
        rgba = np.full((160, 160, 4), 255, np.uint8)
        rgba[:, :, 0] = np.arange(160, dtype=np.uint8)[:, None]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            receipt = run(rgba=rgba, intensity=0, runtime=root, output=root/'output.png', report=root/'report.json')
            np.testing.assert_array_equal(np.asarray(Image.open(root/'output.png')), rgba)
            self.assertEqual(receipt['changedPixels'], 0)
            self.assertIsNone(receipt['front'])
            self.assertIsNone(receipt['gpu'])
            self.assertEqual(receipt['independence']['private_native_images'], [])

    def test_invalid_photo_strength_and_alpha_are_rejected(self):
        photo = np.full((160, 160, 4), 255, np.uint8)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for strength, rgba in [(np.nan, photo), (-1, photo), (101, photo), (0, photo-1), (0, photo.astype(float))]:
                with self.assertRaises(ValueError):
                    run(rgba=rgba, intensity=strength, runtime=root, output=root/'output.png', report=root/'report.json')
