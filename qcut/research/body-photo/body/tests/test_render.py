"""Public rendering reports pixels honestly and never publishes failed output."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np
from PIL import Image

import render


class RenderContract(unittest.TestCase):
    def setUp(self):
        verification = patch.object(render, "verify_installation", return_value={"verified": True})
        verification.start()
        self.addCleanup(verification.stop)
        self.temporary = tempfile.TemporaryDirectory(prefix='body-render-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / 'source.png'
        self.output = self.root / 'output.png'
        self.report = self.root / 'report.json'
        rows, columns = np.mgrid[:64, :48]
        self.rgba = np.stack((columns * 4, rows * 3, columns + rows,
                              np.full_like(rows, 255)), axis=-1).astype(np.uint8)
        Image.fromarray(self.rgba).save(self.source)

    def fake_engine(self, *, change=False, wrong_hash=False, parts=None):
        def run(*, rgba, controls, runtime, output, report):
            result = rgba.copy()
            if change:
                result[0, 0, 0] ^= 1
            Image.fromarray(result).save(output)
            receipt = {'inputRgbaSha256': hashlib.sha256(rgba.tobytes()).hexdigest(),
                       'outputRgbaSha256': hashlib.sha256(result.tobytes()).hexdigest(),
                       'changedPixels': int(change), 'reason': 'no person detected' if not change else None,
                       'nativeGeometryUsed': False, 'fixedLandmarks': False,
                       'independence': {'private_native_images': []}, 'parts': parts or {}}
            if wrong_hash:
                receipt['outputRgbaSha256'] = '0' * 64
            report.write_text(json.dumps(receipt))
            return receipt
        return SimpleNamespace(__file__=str(render.BODY_ROOT / 'engine/research/body_smart_render.py'), run=run)

    def test_public_control_transport_rejects_ambiguous_or_unsupported_values(self):
        for value in ('{"StretchLeg":1,"StretchLeg":2}', '{"StretchLeg":true}',
                      '{"StretchLeg":1.0}', '{"StretchLeg":NaN}', '{"WidenShoulderTest":20}',
                      '{"SlimArm":100.1}', '{"SlimBody":true}',
                      '{"SmallHead":101}', '[]'):
            with self.subTest(value=value), self.assertRaises((ValueError, TypeError)):
                render.parse_controls(text=value)
        self.assertEqual(render.parse_controls(text='{}'), {name: 0 for name in render.PUBLIC_CONTROLS})

    @unittest.skipUnless(sys.platform == 'darwin', 'body product currently targets macOS Metal')
    def test_new_control_values_and_movement_survive_the_isolated_engine_wrapper(self):
        parts = {'SlimBody': {'intensity': .3, 'moved': True},
                 'SlimArm': {'intensity': None, 'moved': True}}
        engine = self.fake_engine(change=True, parts=parts)
        base_run = engine.run
        observed = []

        def run(**arguments):
            observed.append(arguments['controls'])
            return base_run(**arguments)

        engine.run = run
        with patch.dict(sys.modules, {'body_smart_render': engine}):
            receipt = render.render_image(image=self.source, controls={'SlimBody': 100, 'SlimArm': 100},
                                          output=self.output, report=self.report)
        expected = {name: 100 if name in parts else 0 for name in render.PUBLIC_CONTROLS}
        self.assertEqual(observed, [render.to_engine_controls(controls=expected)])
        self.assertEqual(receipt['controls'], expected)
        self.assertEqual(receipt['parts']['SlimArm'], parts['SlimArm'])
        self.assertEqual(receipt['parts']['SlimBody'], parts['SlimBody'])
        self.assertEqual(receipt['actualEffectStatus'], 'applied')

    def test_source_keeps_its_original_pixels_and_rejects_alpha_or_oversized_frame(self):
        np.testing.assert_array_equal(render.read_source(image=self.source), self.rgba)
        self.rgba[1, 2, 3] = 254
        Image.fromarray(self.rgba).save(self.source)
        with self.assertRaisesRegex(ValueError, 'opaque'):
            render.read_source(image=self.source)
        Image.new('RGB', (4096, 2026)).save(self.source)
        with self.assertRaisesRegex(ValueError, '8294400'):
            render.read_source(image=self.source)

    def test_original_image_cannot_be_selected_as_an_output(self):
        before = self.source.read_bytes()
        with self.assertRaisesRegex(ValueError, 'distinct'):
            render.validate_paths(image=self.source, output=self.source, report=self.report)
        self.assertEqual(self.source.read_bytes(), before)

    def test_environment_cannot_redirect_inference_to_qcut_or_a_broker(self):
        contaminated = {'QCUT_INDEPENDENT_BEAUTY_RUNTIME': '/outside', 'QCUT_BODY_SKELETON_BACKEND': 'invalid',
                        'BEAUTY_ONNX_BROKER_SOCKET': '/outside', 'BEAUTY_RESEARCH_MODELS': '/outside',
                        'DYLD_INSERT_LIBRARIES': '/outside', 'PYTHONPATH': '/outside'}
        with patch.dict(os.environ, contaminated):
            with render.engine_environment(body_root=render.BODY_ROOT):
                self.assertFalse(any(name.startswith(('QCUT_', 'DYLD_')) for name in os.environ))
                self.assertNotIn('BEAUTY_ONNX_BROKER_SOCKET', os.environ)
                self.assertNotIn('PYTHONPATH', os.environ)
                self.assertEqual(os.environ['BEAUTY_RENDER_RESOLUTION'], 'original')
                self.assertEqual(os.environ['BEAUTY_RESEARCH_MODELS'],
                                 str(render.BODY_ROOT.parent / 'runtime/body/research'))
            for name, value in contaminated.items():
                self.assertEqual(os.environ[name], value)

    @unittest.skipUnless(sys.platform == 'darwin', 'body product currently targets macOS Metal')
    def test_missing_body_is_unavailable_and_never_reported_as_applied(self):
        with patch.dict(sys.modules, {'body_smart_render': self.fake_engine()}):
            result = render.render_image(image=self.source, controls={'StretchLeg': 100},
                                         output=self.output, report=self.report)
        self.assertEqual(result['actualEffectStatus'], 'unavailable')
        self.assertEqual(result['changedPixels'], 0)
        self.assertEqual(result['inputRgbaSha256'], result['outputRgbaSha256'])
        self.assertTrue(result['sourceAndAssetsUnchanged'])

    @unittest.skipUnless(sys.platform == 'darwin', 'body product currently targets macOS Metal')
    def test_mismatched_engine_receipt_never_publishes_output(self):
        with patch.dict(sys.modules, {'body_smart_render': self.fake_engine(change=True, wrong_hash=True)}):
            with self.assertRaisesRegex(ValueError, 'provenance'):
                render.render_image(image=self.source, controls={'SmallHead': 60},
                                    output=self.output, report=self.report)
        self.assertFalse(self.output.exists())
        self.assertFalse(self.report.exists())

    @unittest.skipUnless(sys.platform == 'darwin', 'body product currently targets macOS Metal')
    def test_nonzero_numpy_diagnostics_use_the_actual_saved_engine_receipt(self):
        engine = self.fake_engine(change=True)
        base_run = engine.run

        def run(**arguments):
            receipt = base_run(**arguments)
            receipt['pose'] = np.asarray([[np.float32(.25), np.float32(.5)]])
            arguments['report'].write_text(json.dumps({**receipt, 'pose': receipt['pose'].tolist()}))
            return receipt

        engine.run = run
        with patch.dict(sys.modules, {'body_smart_render': engine}):
            receipt = render.render_image(image=self.source, controls={'StretchLeg': 100},
                                          output=self.output, report=self.report)
        self.assertEqual(receipt['actualEffectStatus'], 'applied')
        self.assertEqual(json.loads(self.report.read_text())['execution']['pose'], [[.25, .5]])

    @unittest.skipUnless(sys.platform == 'darwin', 'body product currently targets macOS Metal')
    def test_non_identity_zero_request_is_rejected(self):
        with patch.dict(sys.modules, {'body_smart_render': self.fake_engine(change=True)}):
            with self.assertRaisesRegex(ValueError, 'zero-strength'):
                render.render_image(image=self.source, controls={}, output=self.output, report=self.report)
        self.assertFalse(self.output.exists())

    def test_two_file_publish_does_not_overwrite_a_racing_report(self):
        self.report.write_text('existing report')
        with self.assertRaises(FileExistsError):
            render.publish(output=self.output, png=b'new image', report=self.report, receipt={})
        self.assertFalse(self.output.exists())
        self.assertEqual(self.report.read_text(), 'existing report')



if __name__ == '__main__':
    unittest.main()
