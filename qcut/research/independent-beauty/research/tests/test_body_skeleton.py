"""Body skeleton: exact network interpreter, float32 kernels and the still-frame pose geometry."""
from fractions import Fraction
import math
import os
from pathlib import Path
import sys
import unittest

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import body_espresso_fixed as fixed
import body_skeleton_decode as decode
import body_skeleton_kernels as kernels
from body_skeleton_model import ASSET, load_networks

RUNTIME = Path(__file__).resolve().parents[2] / 'runtime'
HAS_ASSET = (RUNTIME / 'research' / ASSET).is_file()
PHOTO = Path(os.environ.get('QCUT_BODY_PHOTO', '/nonexistent'))


def naive_correlate(source, kernel, *, stride, pad, dilation, depthwise):
    n, h, w, ci = source.shape
    kh, kw = kernel.shape[:2] if depthwise else kernel.shape[1:3]
    padded = np.pad(source, ((0, 0), (pad[0], pad[0]), (pad[1], pad[1]), (0, 0)))
    oh = (h + 2 * pad[0] - dilation[0] * (kh - 1) - 1) // stride[0] + 1
    ow = (w + 2 * pad[1] - dilation[1] * (kw - 1) - 1) // stride[1] + 1
    co = ci if depthwise else kernel.shape[0]
    out = np.zeros((n, oh, ow, co), np.int64)
    for y in range(oh):
        for x in range(ow):
            for i in range(kh):
                for j in range(kw):
                    pixel = padded[:, y * stride[0] + i * dilation[0], x * stride[1] + j * dilation[1], :].astype(np.int64)
                    if depthwise:
                        out[:, y, x, :] += pixel * kernel[i, j].astype(np.int64)
                    else:
                        out[:, y, x, :] += pixel @ kernel[:, i, j, :].astype(np.int64).T
    return out


class Interpreter(unittest.TestCase):
    def test_float64_correlation_is_exact_for_integer_layers(self):
        rng = np.random.default_rng(7)
        source = rng.integers(-2047, 2048, (1, 9, 7, 5))
        for depthwise, stride, pad, dilation in ((False, (1, 1), (1, 1), (1, 1)), (False, (2, 2), (1, 1), (1, 1)),
                                                 (True, (1, 1), (2, 2), (2, 2)), (True, (2, 1), (1, 1), (1, 1))):
            kernel = rng.integers(-2047, 2049, (3, 3, 5) if depthwise else (4, 3, 3, 5))
            got = fixed.correlate(source.astype(np.float64), kernel.astype(np.float64), stride=stride, pad=pad,
                                  dilation=dilation, depthwise=depthwise)
            want = naive_correlate(source, kernel, stride=stride, pad=pad, dilation=dilation, depthwise=depthwise)
            np.testing.assert_array_equal(np.rint(got).astype(np.int64), want)


def scalar_cubic(mat, out_h, out_w):
    """The scalar reference: float32 taps chained by single-rounding fused multiply-adds."""
    f32 = kernels.f32
    h, w = len(mat), len(mat[0])
    xs, ys = [], []
    for size, out, record in ((w, out_w, xs), (h, out_h, ys)):
        for dst in range(out):
            t = f32((dst + .5) * size / out - .5)
            src = math.floor(t)
            record.append((src, kernels._cubic_coefficients(f32(t - src))))

    def taps(values, c):
        exact = lambda a, b, d: float(Fraction(a) * Fraction(b) + Fraction(d))
        return f32(exact(values[3], c[3], f32(exact(values[2], c[2], f32(exact(values[1], c[1], f32(values[0] * c[0])))))))

    horizontal = [[taps([f32(row[max(0, min(w - 1, sx + k - 1))]) for k in range(4)], c) for sx, c in xs] for row in mat]
    return [[taps([horizontal[max(0, min(h - 1, sy + k - 1))][x] for k in range(4)], c) for x in range(out_w)] for sy, c in ys]


class Kernels(unittest.TestCase):
    def test_fma_rounds_once(self):
        a, b, c = 0.1, 10.0, -1.0
        self.assertEqual(kernels.fma(a, b, c), float(Fraction(a) * Fraction(b) + Fraction(c)))
        self.assertNotEqual(kernels.fma(a, b, c), a * b + c)

    def test_vectorized_cubic_matches_the_scalar_reference(self):
        rng = np.random.default_rng(3)
        mat = np.asarray(rng.random((7, 5)) * 1.2 - .1, np.float32).tolist()
        self.assertEqual(kernels.resize_cubic(mat, 28, 20), scalar_cubic(mat, 28, 20))

    def test_fcvtzs_truncates_and_saturates(self):
        self.assertEqual([kernels.fcvtzs(v) for v in (-1.7, 1.7, 3e10, -3e10, math.nan)],
                         [-1, 1, 2147483647, -2147483648, 0])


class PoseGeometry(unittest.TestCase):
    def test_refine_crop_of_a_native_box(self):
        # The first refine box of a measured native render and its 144x192 placement.
        layout, roi = decode.crop_layout_and_roi([70, 138, 220, 443])
        self.assertEqual(layout, [24, 0, 95, 192])
        self.assertAlmostEqual(roi[3], 443.0, places=4)

    def test_neck_is_the_integer_shoulder_midpoint(self):
        coco = [[i, 2 * i, .5, 1] for i in range(17)]
        coco[5], coco[6] = [10, 20, .8, 1], [13, 25, .6, 1]
        cpm = decode.coco17_to_cpm18(coco)
        self.assertEqual(cpm[1][:2], [11, 22])
        self.assertAlmostEqual(cpm[1][2], .7, places=6)
        self.assertEqual(cpm[2], coco[6])  # right shoulder from COCO 6

    def test_body_box_widens_upright_bodies(self):
        # 21x301 joints: 40 % side margins (tall body), 20 % top/bottom, then widened
        # towards half the height by a truncated half-deficit on each side.
        points = [[170, 100, 1., 1], [190, 400, 1., 1]] + [[-1, -1, -1., 0]] * 16
        self.assertEqual(decode.next_body_box(points, (360, 640)), [75, 39, 210, 422])
        self.assertIsNone(decode.next_body_box([[-1, -1, -1., 0]] * 18, (360, 640)))

    def test_algorithm_image_keeps_aspect_with_long_side_640(self):
        for (w, h), size in (((720, 1280), (360, 640)), ((1920, 1080), (640, 360)), ((1000, 1000), (640, 640)),
                             ((480, 640), (480, 640))):
            image = decode.algorithm_image(np.zeros((h, w, 4), np.uint8))
            self.assertEqual(image.shape[:2][::-1], size)


class StillPose(unittest.TestCase):
    @unittest.skipUnless(HAS_ASSET and PHOTO.is_file(), 'private asset or QCUT_BODY_PHOTO (720x1280 body photo) missing')
    def test_real_photo_matches_the_native_refine_crops(self):
        rgba = np.asarray(Image.open(PHOTO).convert('RGBA')).copy()
        points, perception = decode.still_pose(rgba=rgba, networks=load_networks(runtime=RUNTIME))
        self.assertIsNotNone(points)
        if rgba.shape[:2] == (1280, 720):
            # Both refinement crops of a native render of this photo (captured 2026-10-17).
            self.assertEqual(perception['refineBoxes'], [[70, 138, 220, 443], [72, 139, 214, 430]])


if __name__ == '__main__':
    unittest.main()
