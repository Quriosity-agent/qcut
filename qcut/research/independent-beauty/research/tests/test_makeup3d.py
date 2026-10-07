import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from extra_sampling import signed_extra_input, warm_fitting_points
from facefitting1256_geometry import mesh_normals, landmark_basis
from facefitting1256_model import load_model, MODEL_NAME, MODEL_SHA256
from makeup3d_render import run
from makeup3d_metal import render

ROOT = Path(__file__).resolve().parents[2]


class ExtraFittingTests(unittest.TestCase):
    def test_translation_and_padding_preserve_bgr(self):
        frame = np.zeros((160, 160, 4), np.uint8)
        frame[:] = [25, 50, 75, 255]
        forward = np.asarray([[1, 0, 1], [0, 1, 0]], np.float32)
        tensor = signed_extra_input(frame=frame, forward=forward)
        np.testing.assert_array_equal(tensor[0, :, 0], np.full((160, 3), -128))
        np.testing.assert_array_equal(tensor[0, :, 1:], np.broadcast_to([-53, -78, -103], (160, 159, 3)))

    def test_sampling_inverse_quantization_boundary(self):
        frame = np.zeros((640, 640, 4), np.uint8)
        frame[:, :, 0] = (np.arange(640)[:, None] % 256).astype(np.uint8)
        frame[:, :, 3] = 255
        forward = np.asarray([[.493211925, -.0053251865, -75.563934],
                              [.0053251865, .493211925, -93.069496]], np.float32)
        tensor = signed_extra_input(frame=frame, forward=forward)
        self.assertEqual(int(tensor[0, 0, 24, 2]), 187-128)

    def test_sampling_rejects_invalid_source_and_singular_matrix(self):
        frame = np.zeros((160, 160, 4), np.uint8)
        for matrix in (np.zeros((2, 3), np.float32), np.full((2, 3), np.nan, np.float32)):
            with self.assertRaises(ValueError):
                signed_extra_input(frame=frame, forward=matrix)
        with self.assertRaises(ValueError):
            signed_extra_input(frame=frame.astype(np.float32), forward=np.asarray([[1, 0, 0], [0, 1, 0]], np.float32))

    def test_fitting_warmup_keeps_extra_points_and_separates_contour(self):
        seed = np.full((106, 2), 200, np.float32)
        points = np.full((240, 2), 205, np.float32)
        original = points.copy()
        result = warm_fitting_points(points=points, seed=seed, size=(640, 640))
        self.assertLess(result[0, 0], result[33, 0])
        self.assertGreater(result[33, 0], 204)
        np.testing.assert_array_equal(result[106:], points[106:])
        np.testing.assert_array_equal(points, original)


class ClassicalMeshTests(unittest.TestCase):
    def test_normals_weight_unit_faces_instead_of_triangle_area(self):
        vertices = np.asarray([[0, 0, 0], [4, 0, 0], [0, 4, 0], [0, 0, 1], [0, 1, 0], [9, 9, 9]], np.float32)
        triangles = np.asarray([[0, 1, 2], [0, 4, 3]], np.uint16)
        normals = mesh_normals(vertices=vertices, triangles=triangles)
        np.testing.assert_allclose(normals[0], [2**-.5, 0, 2**-.5], atol=1e-7)
        np.testing.assert_array_equal(normals[5], [0, 0, 0])

    def test_degenerate_triangles_have_zero_normals(self):
        values = mesh_normals(vertices=np.zeros((3, 3), np.float32), triangles=np.asarray([[0, 1, 2]], np.uint16))
        np.testing.assert_array_equal(values, np.zeros((3, 3), np.float32))

    @unittest.skipUnless((ROOT/'runtime/Models'/MODEL_NAME).exists(), 'private classical model unavailable')
    def test_private_model_schema_and_dynamic_contours(self):
        model = load_model(path=ROOT/'runtime/Models'/MODEL_NAME)
        self.assertEqual(model['basis'].shape, (70, 1463, 3))
        self.assertEqual(model['triangles'].shape, (2376, 3))
        coefficient = np.r_[np.float32(1), np.zeros(69, np.float32)]
        first = landmark_basis(model=model, coefficients=coefficient, pose=np.asarray([0., 0., 0., 0., 0., 1.]))
        changed = landmark_basis(model=model, coefficients=coefficient, pose=np.asarray([0., .2, 0., 0., 0., -35.]))
        np.testing.assert_array_equal(first[:, :57], changed[:, :57])
        self.assertFalse(np.array_equal(first[:, 57:], changed[:, 57:]))
        self.assertTrue(np.isfinite(model['uv']).all())
        self.assertEqual(hashlib.sha256((ROOT/'runtime/Models'/MODEL_NAME).read_bytes()).hexdigest(), MODEL_SHA256)

    def test_corrupt_model_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'invalid.model'
            path.write_bytes(bytes(100))
            with self.assertRaises(ValueError):
                load_model(path=path)


class ClassicalRenderTests(unittest.TestCase):
    @unittest.skipUnless(sys.platform == 'darwin', 'system Metal unavailable')
    def test_near_surface_survives_a_later_far_triangle(self):
        rgba = np.full((160, 160, 4), 255, np.uint8)
        vertices = np.zeros((1463, 8), np.float32)
        shape = np.asarray([[-.8, -.8], [.8, -.8], [0, .8]], np.float32)
        vertices[:3, :2] = shape
        vertices[3:6, :2] = shape
        vertices[:3, 2], vertices[3:6, 2] = -.5, .5
        vertices[:3, 3:5], vertices[3:6, 3:5] = [.25, .5], [.75, .5]
        vertices[:6, 7] = 1
        triangles = np.zeros((2376, 3), np.uint16)
        triangles[:2] = [[0, 1, 2], [3, 4, 5]]
        mesh = {'vertices': vertices, 'triangles': triangles,
                'model': np.eye(4, dtype=np.float32), 'mvp': np.eye(4, dtype=np.float32)}
        pigment = np.asarray([[[255, 0, 0, 255], [0, 0, 255, 255]]], np.uint8)
        with tempfile.TemporaryDirectory() as directory:
            output, receipt = render(rgba=rgba, mesh=mesh, pigment=pigment,
                intensity=100, highlight=False, runtime=Path(directory))
        np.testing.assert_array_equal(output[80, 80], [255, 0, 0, 255])
        np.testing.assert_array_equal(output[0, 0], rgba[0, 0])
        self.assertEqual(receipt['private_native_images'], [])

    def test_zero_strength_preserves_photo_without_private_assets(self):
        rgba = np.full((160, 160, 4), 255, np.uint8)
        rgba[:, :, 0] = np.arange(160, dtype=np.uint8)[:, None]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            receipt = run(rgba=rgba, card='freckles-sunburn', intensity=0, runtime=root,
                          output=root/'output.png', report=root/'report.json')
            np.testing.assert_array_equal(np.asarray(Image.open(root/'output.png')), rgba)
            self.assertEqual(receipt['changedPixels'], 0)
            self.assertIsNone(receipt['fitting'])
            self.assertEqual(receipt['independence']['private_native_images'], [])
            self.assertEqual(json.loads((root/'report.json').read_text())['outputRgbaSha256'], hashlib.sha256(rgba.tobytes()).hexdigest())

    def test_invalid_card_strength_and_alpha_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            photo = np.full((160, 160, 4), 255, np.uint8)
            for card, intensity, rgba in [('unknown', 0, photo), ('highlight-sweetheart', float('nan'), photo),
                                          ('highlight-sweetheart', 0, photo-1)]:
                with self.assertRaises(ValueError):
                    run(rgba=rgba, card=card, intensity=intensity, runtime=root,
                        output=root/'output.png', report=root/'report.json')
