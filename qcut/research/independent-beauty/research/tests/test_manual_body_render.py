"""QCut-owned manual body stretch: native amounts, geometry, receipt and CLI."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import independent_pipeline as pipeline
from independent_stage_runner import run_stage
import manual_body_render as body


def row_ramp(*, width, height):
    """Each row a distinct grey (row index mod 256 in R, index // 256 in G)."""
    rgba = np.zeros((height, width, 4), np.uint8)
    rows = np.arange(height)
    rgba[..., 0] = (rows % 256)[:, None]
    rgba[..., 1] = (rows // 256)[:, None]
    rgba[..., 3] = 255
    return rgba


class StretchAmounts(unittest.TestCase):
    def test_edge_pixels_match_the_native_tool_measurements(self):
        # Per-edge pixels at full scale read from native renders of
        # coordinate-encoded frames (stretch, then shrink).
        stretch = [(1280, .72, .18, 64), (1280, .448, .202, 64), (1280, .95, .05, 64), (1280, .6, .4, 64),
                   (1280, .3, .1, 64), (720, .72, .18, 36), (1920, .72, .18, 96), (1080, .72, .18, 54),
                   (1000, .72, .18, 50), (1333, .72, .18, 66), (1130, .72, .18, 56), (1280, .515, .485, 63),
                   (1280, .51, .49, 63), (1280, .53, .47, 63)]
        shrink = [(1280, .72, .18, 25), (1280, .448, .202, 25), (1280, .95, .05, 25), (1280, .6, .4, 25),
                  (1280, .3, .1, 25), (720, .72, .18, 14), (1920, .72, .18, 38), (1080, .72, .18, 21),
                  (1000, .72, .18, 20), (1333, .72, .18, 26), (1130, .72, .18, 22), (1280, .515, .485, 19),
                  (1280, .51, .49, 12), (1280, .53, .47, 25)]
        for intensity, table in ((50, stretch), (-50, shrink)):
            for height, upper, bottom, expected in table:
                with self.subTest(intensity=intensity, height=height, upper=upper, bottom=bottom):
                    self.assertEqual(body.stretch_edge_pixels(height=height, intensity=intensity,
                                                              upper=upper, bottom=bottom), expected)


class StretchGeometry(unittest.TestCase):
    def test_zero_is_exact_identity(self):
        rgba = row_ramp(width=8, height=300)
        np.testing.assert_array_equal(body.apply_stretch(rgba=rgba, intensity=0, upper=.72, bottom=.18), rgba)

    def test_positive_lengthens_the_band_and_pushes_the_rest_out(self):
        height = 1280
        rows = body.stretch_source_rows(height=height, intensity=50, upper=.72, bottom=.18)
        self.assertFalse(np.isnan(rows).any())
        self.assertTrue(np.all(np.diff(rows) > 0))
        top, end = (1 - .72) * height, (1 - .18) * height
        # Above the band the picture moves up by half of 64 px (then the grid's
        # 250/249 spread about the centre); below it, down.
        np.testing.assert_allclose(rows[100] - 100.5, 32 * body.GRID_SCALE + (100.5 - 640) * (body.GRID_SCALE - 1),
                                   atol=1e-6)
        inside = (rows > top + 2) & (rows < end - 2)
        slope = np.polyfit(np.flatnonzero(inside), rows[inside], 1)[0]
        self.assertAlmostEqual(slope, body.GRID_SCALE * (end - top) / (end - top + 64), places=6)

    def test_negative_shortens_the_band_and_uncovers_strips_showing_the_photo(self):
        rgba = row_ramp(width=4, height=1280)
        result = body.apply_stretch(rgba=rgba, intensity=-50, upper=.72, bottom=.18)
        rows = body.stretch_source_rows(height=1280, intensity=-50, upper=.72, bottom=.18)
        # 25 px at full scale, 12.5 at -50: the photo keeps the rows whose
        # centre lies within 12.5 px of an edge. A centre exactly on the line
        # is covered at the top and not at the bottom: 12 rows and 13, as the
        # native tool leaves them.
        np.testing.assert_array_equal(np.flatnonzero(np.isnan(rows[:40])), np.arange(12))
        np.testing.assert_array_equal(np.flatnonzero(np.isnan(rows[-40:])), np.arange(27, 40))
        np.testing.assert_array_equal(result[:12], rgba[:12])
        np.testing.assert_array_equal(result[-13:], rgba[-13:])
        # The first covered rows sample the clamped top edge of the photo.
        np.testing.assert_array_equal(result[12, 0, :2], rgba[0, 0, :2])
        middle = np.flatnonzero(~np.isnan(rows))
        self.assertTrue(np.all(np.diff(rows[middle]) > 0))

    def test_only_rows_move_and_portrait_and_landscape_scale_with_height(self):
        for width, height in ((720, 1280), (1280, 720)):
            rgba = np.zeros((height, width, 4), np.uint8)
            rgba[..., 0] = (np.arange(width) % 256)[None, :]
            rgba[..., 3] = 255
            result = body.apply_stretch(rgba=rgba, intensity=50, upper=.72, bottom=.18)
            np.testing.assert_array_equal(result, rgba)
            self.assertEqual(body.stretch_edge_pixels(height=height, intensity=50, upper=.72, bottom=.18),
                             int(.05 * height))

    def test_alpha_stays_opaque_and_values_stay_in_range(self):
        rng = np.random.default_rng(7)
        rgba = rng.integers(0, 256, (257, 31, 4), np.uint8)
        rgba[..., 3] = 255
        for intensity in (-50, -13, 13, 50):
            result = body.apply_stretch(rgba=rgba, intensity=intensity, upper=.6, bottom=.35)
            self.assertEqual(result.dtype, np.uint8)
            self.assertTrue(np.all(result[..., 3] == 255))


class Validation(unittest.TestCase):
    def test_settings_outside_the_editor_ranges_are_refused(self):
        good = {'intensity': 20, 'upper': .7, 'bottom': .2}
        body.validate_manual_body(manual_body={'stretch': good})
        for bad in ({}, {'slim': {}}, {'stretch': {**good, 'intensity': 51}}, {'stretch': {**good, 'upper': .21}},
                    {'stretch': {**good, 'bottom': -0.1}}, {'stretch': {**good, 'intensity': float('nan')}},
                    {'stretch': {**good, 'intensity': True}}, {'stretch': {**good, 'extra': 1}},
                    {'stretch': {'intensity': 20, 'upper': .7}}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                body.validate_manual_body(manual_body=bad)


class Run(unittest.TestCase):
    def test_receipt_hashes_and_isolation(self):
        rgba = row_ramp(width=16, height=640)
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            receipt = body.run(rgba=rgba, manual_body={'stretch': {'intensity': 30, 'upper': .8, 'bottom': .3}},
                               runtime=directory, output=directory / 'out.png', report=directory / 'out.json')
            written = np.asarray(Image.open(directory / 'out.png').convert('RGBA'))
            self.assertEqual(receipt['inputRgbaSha256'], hashlib.sha256(rgba.tobytes()).hexdigest())
            self.assertEqual(receipt['outputRgbaSha256'], hashlib.sha256(written.tobytes()).hexdigest())
            self.assertEqual(json.loads((directory / 'out.json').read_text()), receipt)
        self.assertEqual(receipt['independence']['private_native_images'], [])
        self.assertIs(receipt['nativeGeometryUsed'], False)
        self.assertIs(receipt['nativeProductParityVerified'], False)
        self.assertEqual(receipt['stretchEdgePixels'], int(.05 * 640))
        self.assertGreater(receipt['changedPixels'], 0)

    def test_transparent_input_is_refused(self):
        rgba = row_ramp(width=4, height=40)
        rgba[0, 0, 3] = 0
        with tempfile.TemporaryDirectory() as temporary, self.assertRaises(ValueError):
            directory = Path(temporary)
            body.run(rgba=rgba, manual_body={'stretch': {'intensity': 10, 'upper': .8, 'bottom': .3}},
                     runtime=directory, output=directory / 'out.png', report=directory / 'out.json')

    def test_command_line_renders_like_the_function(self):
        rgba = row_ramp(width=12, height=480)
        settings = {'stretch': {'intensity': -40, 'upper': .9, 'bottom': .1}}
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            Image.fromarray(rgba).save(directory / 'in.png')
            subprocess.run([sys.executable, '-B', str(Path(body.__file__)), '--image', str(directory / 'in.png'),
                            '--manual-body', json.dumps(settings), '--runtime', str(directory),
                            '--output', str(directory / 'out.png'), '--report', str(directory / 'out.json')],
                           check=True, capture_output=True, cwd=Path(body.__file__).parent)
            written = np.asarray(Image.open(directory / 'out.png').convert('RGBA'))
        np.testing.assert_array_equal(written, body.apply_stretch(rgba=rgba, **settings['stretch']))


class Pipeline(unittest.TestCase):
    def test_canonical_pipeline_runs_the_stretch_as_a_subprocess_and_resident(self):
        rng = np.random.default_rng(3)
        rgba = rng.integers(0, 256, (160, 96, 4), np.uint8)
        rgba[..., 3] = 255
        stretch = {'intensity': -35, 'upper': 0.75, 'bottom': 0.3}
        request = {'values': {}, 'makeup': {}, 'manualBody': {'stretch': stretch}}
        for runner, execution in ((None, 'subprocess'), (run_stage, 'resident')):
            with self.subTest(execution=execution), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                Image.fromarray(rgba).save(directory / 'in.png')
                (directory / 'request.json').write_text(json.dumps(request))
                receipt = pipeline.run(image=directory / 'in.png', request=directory / 'request.json',
                                       runtime=directory, output=directory / 'out.png', report=directory / 'out.json',
                                       stage_runner=runner)
                written = np.asarray(Image.open(directory / 'out.png').convert('RGBA'))
            np.testing.assert_array_equal(written, body.apply_stretch(rgba=rgba, **stretch))
            self.assertEqual(receipt['adjustments'], request)
            self.assertEqual([stage['id'] for stage in receipt['stages']], ['manual-body'])
            self.assertEqual(receipt['stages'][0]['execution'], execution)
            self.assertIs(receipt['nativeFallbackUsed'], False)

    def test_plan_validation_refuses_untrusted_manual_body_settings(self):
        scripts = pipeline.allowed_scripts(catalog=json.loads(
            (Path(pipeline.__file__).parent / 'independent-pipeline-catalog.json').read_text()))
        stage = {'id': 'manual-body', 'kind': 'manual-body', 'script': 'manual_body_render.py',
                 'parameters': [], 'controls': {}}
        good = {'intensity': 20, 'upper': .7, 'bottom': .2}
        pipeline.validate_plan(plan={'version': 1, 'stages': [stage], 'adjustments': {
            'values': {}, 'makeup': {}, 'manualBody': {'stretch': good}}}, scripts=scripts)
        for manual_body in ({'slim': good}, {'stretch': {**good, 'upper': 1.5}},
                            {'stretch': {**good, 'intensity': 101}}, {'stretch': {'intensity': 20}}, []):
            with self.subTest(manual_body=manual_body), self.assertRaises(ValueError):
                pipeline.validate_plan(plan={'version': 1, 'stages': [stage], 'adjustments': {
                    'values': {}, 'makeup': {}, 'manualBody': manual_body}}, scripts=scripts)


if __name__ == '__main__':
    unittest.main()
