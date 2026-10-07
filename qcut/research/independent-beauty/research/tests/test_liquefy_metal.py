from pathlib import Path
import sys
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from liquefy_metal import render, render_passes


class LiquefyMetalTests(unittest.TestCase):
    def specification(self, *, shift=0, count=1, mask_amount=255):
        uv = np.zeros((2270, 2), np.float32)
        uv[:4] = [[0, 0], [1, 0], [0, 1], [1, 1]]
        positions = np.zeros((2270, 3), np.float32)
        positions[:, :2] = uv*2-1
        triangles = np.zeros((4472, 3), np.uint16)
        triangles[:2] = [[0, 1, 2], [1, 3, 2]]
        return {'support': {'positions': positions, 'uv': uv}, 'triangles': triangles,
            'steps': {'start': np.zeros((count, 2), np.float32),
                'end': np.tile(np.array([[-shift, 0]], np.float32), (count, 1)),
                'action': np.zeros(count, np.float32), 'strength': np.ones(count, np.float32),
                'radius': np.full(count, 1e6, np.float32)},
            'intensity': 1., 'radial_profile': 'linear', 'mask_uv': uv.copy(),
            'mask': np.full((1, 1, 4), mask_amount, np.uint8)}

    def test_gpu_orientation_ordered_steps_and_mask(self):
        rgba = np.array([[[0, 30, 60, 255], [80, 110, 140, 255], [200, 210, 220, 255]],
                         [[20, 40, 60, 255], [100, 120, 140, 255], [220, 230, 240, 255]]], np.uint8)
        original = rgba.copy()
        with tempfile.TemporaryDirectory() as temporary:
            runtime = Path(temporary)
            identity, receipt = render(rgba=rgba, runtime=runtime, **self.specification())
            np.testing.assert_array_equal(identity, rgba)
            once, _ = render(rgba=rgba, runtime=runtime, **self.specification(shift=1))
            np.testing.assert_array_equal(once, rgba[:, [1, 2, 2]])
            twice, _ = render(rgba=rgba, runtime=runtime, **self.specification(shift=.5, count=2))
            np.testing.assert_array_equal(twice, rgba[:, [1, 2, 2]])
            masked, _ = render(rgba=rgba, runtime=runtime, **self.specification(shift=1, mask_amount=0))
            np.testing.assert_array_equal(masked, rgba)
        self.assertEqual(receipt['private_native_images'], [])
        self.assertEqual(receipt['coordinateTextureSize'], 512)
        self.assertEqual(receipt['coveredCoordinatePixels'], 512*512)
        np.testing.assert_array_equal(rgba, original)

    def test_fractional_sampling_and_transparent_identity(self):
        rgba = np.array([[[0, 30, 60, 255], [80, 110, 140, 255], [200, 210, 220, 255]]], np.uint8)
        with tempfile.TemporaryDirectory() as temporary:
            runtime = Path(temporary)
            moved, _ = render(rgba=rgba, runtime=runtime, **self.specification(shift=.25))
            np.testing.assert_array_equal(moved, [[[20, 50, 80, 255], [110, 135, 160, 255], [200, 210, 220, 255]]])
            rgba[0, :, 3] = [0, 64, 255]
            identity, _ = render(rgba=rgba, runtime=runtime, **self.specification())
            np.testing.assert_array_equal(identity, rgba)

    def test_uncovered_coordinate_field_rejects_output(self):
        specification = self.specification()
        specification['triangles'].fill(0)
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaises(subprocess.CalledProcessError) as context:
                render(rgba=np.full((2, 3, 4), 255, np.uint8), runtime=Path(temporary), **specification)
        self.assertIn('did not cover the coordinate texture', context.exception.stderr)

    def test_multiple_coordinate_passes_sample_photo_once(self):
        rgba = np.array([[[0, 0, 0, 255], [255, 255, 255, 255], [0, 0, 0, 255], [255, 255, 255, 255]]], np.uint8)
        original = rgba.copy()
        passes = [self.specification(shift=.25), self.specification(shift=.25)]
        with tempfile.TemporaryDirectory() as temporary:
            runtime = Path(temporary)
            combined, receipt = render_passes(rgba=rgba, passes=passes, runtime=runtime)
            first, _ = render(rgba=rgba, runtime=runtime, **passes[0])
            sequential, _ = render(rgba=first, runtime=runtime, **passes[1])
            np.testing.assert_array_equal(combined, [[[128, 128, 128, 255], [128, 128, 128, 255], [128, 128, 128, 255], [255, 255, 255, 255]]])
            self.assertFalse(np.array_equal(combined, sequential))
        self.assertEqual(receipt['coordinatePassCount'], 2)
        self.assertEqual(receipt['photoSamplePassCount'], 1)
        np.testing.assert_array_equal(rgba, original)

    def test_every_coordinate_pass_requires_full_coverage(self):
        good = self.specification()
        invalid = self.specification()
        invalid['triangles'].fill(0)
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaises(subprocess.CalledProcessError) as context:
                render_passes(rgba=np.full((2, 3, 4), 255, np.uint8), passes=[invalid, good], runtime=Path(temporary))
        self.assertIn('did not cover the coordinate texture', context.exception.stderr)

    def test_photo_quad_identity_on_non_square_bounded_frames(self):
        with tempfile.TemporaryDirectory() as temporary:
            runtime = Path(temporary)
            for height, width in ((17, 29), (9, 1280), (1280, 9)):
                with self.subTest(height=height, width=width):
                    y, x = np.mgrid[:height, :width]
                    rgba = np.stack(((x * 17 + y * 31) % 256, (x * 11 + y * 3) % 256,
                        (x * 3 + y * 23) % 256, np.full((height, width), 255)), axis=-1).astype(np.uint8)
                    result, receipt = render_passes(rgba=rgba, passes=[self.specification(), self.specification()], runtime=runtime)
                    np.testing.assert_array_equal(result, rgba)
                    self.assertEqual(receipt['coveredPhotoPixels'], height * width)
                    self.assertEqual(receipt['photoTransport'], 'fullscreen-raster-fragment')

    def test_invalid_fields_fail_before_compilation(self):
        rgba = np.full((2, 3, 4), 255, np.uint8)
        invalid = [self.specification() for _ in range(9)]
        invalid[0]['triangles'][0, 0] = 2270
        invalid[1]['support']['uv'][0, 0] = np.nan
        invalid[2]['mask_uv'] = np.zeros((2269, 2), np.float32)
        invalid[3]['steps']['radius'][0] = 0
        invalid[4]['radial_profile'] = 'unknown'
        invalid[5]['intensity'] = True
        invalid[6]['mask'] = np.zeros((1, 1025, 4), np.uint8)
        invalid[7]['support']['positions'] = np.zeros((2270, 2), np.float32)
        invalid[8]['support']['positions'][0, 2] = np.nan
        with patch('liquefy_metal.build_host') as compile_host:
            for specification in invalid:
                with self.subTest(specification=specification), self.assertRaises(ValueError):
                    render(rgba=rgba, runtime=Path('missing'), **specification)
            with self.assertRaises(ValueError):
                render(rgba=np.zeros((1, 1281, 4), np.uint8), runtime=Path('missing'), **self.specification())
            for passes in ([], [self.specification()] * 7, (), None, [None], [{}], [self.specification() | {'unknown': 1}]):
                with self.assertRaises(ValueError):
                    render_passes(rgba=rgba, passes=passes, runtime=Path('missing'))
            compile_host.assert_not_called()


if __name__ == '__main__':
    unittest.main()
