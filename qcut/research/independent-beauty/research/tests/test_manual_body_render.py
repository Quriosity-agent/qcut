"""QCut-owned manual body tools (stretch, slim, zoom): native amounts, geometry, receipt and CLI."""
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


def column_ramp(*, width, height):
    """Each column a distinct value (index mod 256 in R, index // 256 in G)."""
    rgba = np.zeros((height, width, 4), np.uint8)
    columns = np.arange(width)
    rgba[..., 0] = (columns % 256)[None, :]
    rgba[..., 1] = (columns // 256)[None, :]
    rgba[..., 3] = 255
    return rgba


class SlimGeometry(unittest.TestCase):
    def test_table_is_well_formed_and_peaks_at_the_quarter_lines(self):
        table, step = body.load_slim_field()
        self.assertEqual(table.shape, (41, 41))
        self.assertAlmostEqual(step, 0.025)
        row, column = np.unravel_index(np.argmax(table), table.shape)
        self.assertEqual(row, 0)
        self.assertAlmostEqual(column * step, 0.5, delta=0.03)
        self.assertGreater(table.max(), 0.19)
        self.assertLess(table[-1].max(), 0.01)

    def test_zero_and_outside_the_rectangle_keep_the_photo(self):
        rgba = column_ramp(width=300, height=400)
        np.testing.assert_array_equal(
            body.apply_slim(rgba=rgba, intensity=0, x=.5, y=.5, width=.4, height=.5, rotation=0), rgba)
        result = body.apply_slim(rgba=rgba, intensity=50, x=.5, y=.5, width=.4, height=.5, rotation=0)
        # The rectangle spans columns 90..210 and rows 100..300.
        np.testing.assert_array_equal(result[:99], rgba[:99])
        np.testing.assert_array_equal(result[:, :89], rgba[:, :89])
        self.assertFalse(np.array_equal(result, rgba))

    def test_positive_pulls_towards_the_centre_line_and_negative_pushes_out(self):
        width, height = 300, 400
        rgba = column_ramp(width=width, height=height)
        middle = height // 2
        for intensity, sign in ((50, 1), (-50, -1)):
            row = body.apply_slim(rgba=rgba, intensity=intensity, x=.5, y=.5, width=.4, height=.5,
                                  rotation=0)[middle, :, 0].astype(int)
            # A quarter of the way in from the left side (column 120) shows a source
            # column further out (towards the side) when slimming, closer in otherwise.
            self.assertEqual(np.sign(120 - row[120]), sign)
            self.assertEqual(np.sign(row[180] - 180), sign)
            self.assertTrue(np.all(np.diff(row[90:211]) >= 0))

    def test_rotation_turns_the_pull_with_the_rectangle(self):
        rgba = row_ramp(width=300, height=300)
        upright = body.apply_slim(rgba=rgba, intensity=50, x=.5, y=.5, width=.4, height=.4, rotation=0)
        np.testing.assert_array_equal(upright, rgba)  # rows never move without rotation
        turned = body.apply_slim(rgba=rgba, intensity=50, x=.5, y=.5, width=.4, height=.4, rotation=90)
        self.assertFalse(np.array_equal(turned, rgba))


class ZoomGeometry(unittest.TestCase):
    def test_centre_magnification_follows_the_native_amounts(self):
        # Native centre magnification is 1 + 0.4 i growing, 1 + 0.25 i shrinking.
        for intensity, expected in ((50, 1.2), (-50, 0.875), (25, 1.1)):
            amount = intensity / 100
            near = 1e-4
            self.assertAlmostEqual((near + body.zoom_motion(radius=near, amount=amount)) / near, expected, places=4)
        self.assertEqual(body.zoom_motion(radius=1.0, amount=0.5), 0)

    def test_zoom_direction_and_native_whole_frame_resampling(self):
        width, height = 320, 240
        rgba = column_ramp(width=width, height=height)
        # Radius 0.25 of the shorter side: 60 px around the centre.
        grown = body.apply_zoom(rgba=rgba, intensity=50, x=.5, y=.5, radius=.25)
        shrunk = body.apply_zoom(rgba=rgba, intensity=-50, x=.5, y=.5, radius=.25)
        middle = height // 2
        for result in (grown, shrunk):
            self.assertTrue(np.all(result[..., 3] == 255))
        np.testing.assert_array_equal(grown[:59], shrunk[:59])
        self.assertFalse(np.array_equal(grown[:59], rgba[:59]))
        # 30 px right of the centre: magnifying shows a source column nearer the centre.
        self.assertLess(int(grown[middle, 190, 0]), 190)
        self.assertGreater(int(shrunk[middle, 190, 0]), 190)
        np.testing.assert_array_equal(body.apply_zoom(rgba=rgba, intensity=0, x=.5, y=.5, radius=.25), rgba)


class Validation(unittest.TestCase):
    def test_settings_outside_the_editor_ranges_are_refused(self):
        good = {'intensity': 20, 'upper': .7, 'bottom': .2}
        slim = {'intensity': -20, 'x': .5, 'y': .5, 'width': .3, 'height': .4, 'rotation': 30}
        zoom = {'intensity': 10, 'x': .4, 'y': .6, 'radius': .2}
        self.assertEqual(set(body.validate_manual_body(
            manual_body={'stretch': good, 'slim': slim, 'zoom': zoom})), {'stretch', 'slim', 'zoom'})
        for bad in ({}, {'slim': {}}, {'stretch': {**good, 'intensity': 51}}, {'stretch': {**good, 'upper': .21}},
                    {'slim': {**slim, 'rotation': 181}}, {'slim': {**slim, 'width': 0.01}},
                    {'zoom': {**zoom, 'radius': 0.6}}, {'zoom': {**zoom, 'extra': 1}}, {'twist': {}},
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

    def test_canonical_pipeline_runs_all_three_tools_in_the_native_order(self):
        rng = np.random.default_rng(5)
        rgba = rng.integers(0, 256, (200, 120, 4), np.uint8)
        rgba[..., 3] = 255
        manual_body = {'stretch': {'intensity': 30, 'upper': 0.6, 'bottom': 0.2},
                       'slim': {'intensity': 40, 'x': 0.5, 'y': 0.45, 'width': 0.5, 'height': 0.4, 'rotation': 20},
                       'zoom': {'intensity': -30, 'x': 0.45, 'y': 0.7, 'radius': 0.3}}
        expected = body.apply_zoom(rgba=body.apply_slim(rgba=body.apply_stretch(
            rgba=rgba, **manual_body['stretch']), **manual_body['slim']), **manual_body['zoom'])
        request = {'values': {}, 'makeup': {}, 'manualBody': manual_body}
        for runner, execution in ((None, 'subprocess'), (run_stage, 'resident')):
            with self.subTest(execution=execution), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                Image.fromarray(rgba).save(directory / 'in.png')
                (directory / 'request.json').write_text(json.dumps(request))
                receipt = pipeline.run(image=directory / 'in.png', request=directory / 'request.json',
                                       runtime=directory, output=directory / 'out.png', report=directory / 'out.json',
                                       stage_runner=runner)
                written = np.asarray(Image.open(directory / 'out.png').convert('RGBA'))
            np.testing.assert_array_equal(written, expected)
            self.assertEqual(receipt['adjustments'], request)
            self.assertEqual([stage['id'] for stage in receipt['stages']], ['manual-body'])
            self.assertEqual(receipt['stages'][0]['execution'], execution)

    def test_plan_validation_refuses_untrusted_manual_body_settings(self):
        scripts = pipeline.allowed_scripts(catalog=json.loads(
            (Path(pipeline.__file__).parent / 'independent-pipeline-catalog.json').read_text()))
        stage = {'id': 'manual-body', 'kind': 'manual-body', 'script': 'manual_body_render.py',
                 'parameters': [], 'controls': {}}
        good = {'intensity': 20, 'upper': .7, 'bottom': .2}
        pipeline.validate_plan(plan={'version': 1, 'stages': [stage], 'adjustments': {
            'values': {}, 'makeup': {}, 'manualBody': {'stretch': good}}}, scripts=scripts)
        slim = {'intensity': -20, 'x': .5, 'y': .4, 'width': .3, 'height': .4, 'rotation': -45}
        zoom = {'intensity': 30, 'x': .5, 'y': .6, 'radius': .2}
        pipeline.validate_plan(plan={'version': 1, 'stages': [stage], 'adjustments': {
            'values': {}, 'makeup': {}, 'manualBody': {'slim': slim, 'zoom': zoom}}}, scripts=scripts)
        for manual_body in ({'slim': good}, {'zoom': slim}, {'twist': good}, {'slim': {**slim, 'rotation': 270}},
                            {'slim': {**slim, 'x': 1.2}}, {'zoom': {**zoom, 'radius': '0.2'}},
                            {'zoom': {**zoom, 'intensity': float('nan')}}, {'stretch': {**good, 'upper': 1.5}},
                            {'stretch': {**good, 'intensity': 101}}, {'stretch': {'intensity': 20}}, []):
            with self.subTest(manual_body=manual_body), self.assertRaises(ValueError):
                pipeline.validate_plan(plan={'version': 1, 'stages': [stage], 'adjustments': {
                    'values': {}, 'makeup': {}, 'manualBody': manual_body}}, scripts=scripts)


if __name__ == '__main__':
    unittest.main()
