from copy import deepcopy
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
from dynamic_makeup_controls import CARDS, GEOMETRY_FAMILIES, ORDER
from dynamic_makeup_render import ROOT, render_rgba, run


class DynamicMakeupRenderTests(unittest.TestCase):
    def image(self):
        rgba = np.arange(36, dtype=np.uint8).reshape(3, 3, 4)
        rgba[..., 3] = 255
        return rgba

    def test_empty_zero_and_subthreshold_are_exact_identity_without_inference(self):
        rgba = self.image()
        original = rgba.copy()
        for intensity in (None, 0, .099, .1):
            selections = {} if intensity is None else {
                category: {'cardId': CARDS[category][0], 'intensity': intensity} for category in ORDER}
            with patch('dynamic_makeup_render.predict_extra_photo') as predict, \
                    patch('dynamic_makeup_render.working_mesh') as geometry, \
                    patch('dynamic_makeup_render.load_geometry') as assets, \
                    patch('dynamic_makeup_render.selection_pass') as pigment, \
                    patch('dynamic_makeup_render.render_pigments') as gpu:
                result, receipt = render_rgba(rgba=rgba, selections=selections, runtime=Path('missing'))
            np.testing.assert_array_equal(result, original)
            np.testing.assert_array_equal(rgba, original)
            self.assertIsNot(result, rgba)
            self.assertEqual(receipt['sharedInferenceCount'], 0)
            self.assertIsNone(receipt['extra'])
            self.assertIsNone(receipt['gpu'])
            self.assertEqual(receipt['layers'], [])
            self.assertTrue(receipt['zeroSelectionsIdentity'])
            self.assertFalse(receipt['privateAssetDependency'])
            for mocked in (predict, geometry, assets, pigment, gpu):
                mocked.assert_not_called()

    def test_active_pigments_share_one_original_inference_and_one_geometry_in_fixed_order(self):
        rgba = self.image()
        original = rgba.copy()
        categories = tuple(category for category in ORDER if GEOMETRY_FAMILIES[category] == 'face248')
        selections = {category: {'cardId': CARDS[category][0], 'intensity': 37}
                      for category in reversed(categories)}
        selections_original = deepcopy(selections)
        prediction = {'points': np.arange(480, dtype=np.float32).reshape(240, 2).tolist(),
                      'algorithmSize': [3, 3]}
        positions = np.arange(496, dtype=np.float32).reshape(248, 2)
        geometry_original = positions.copy()
        output = rgba.copy()
        output[0, 0, 0] = 200

        def pigment_pass(*, positions, category, selection, runtime):
            return {'name': category}, {'category': category, **selection}

        with patch('dynamic_makeup_render.predict_extra_photo', return_value=prediction) as predict, \
                patch('dynamic_makeup_render.load_geometry', return_value={'geometry': True}) as assets, \
                patch('dynamic_makeup_render.working_mesh', return_value=positions) as geometry, \
                patch('dynamic_makeup_render.selection_pass', side_effect=pigment_pass) as pigment, \
                patch('dynamic_makeup_render.render_pigments', return_value=(output, {'private_native_images': []})) as gpu:
            result, receipt = render_rgba(rgba=rgba, selections=selections, runtime=ROOT/'runtime')
        self.assertEqual(predict.call_count, 1)
        self.assertIs(predict.call_args.kwargs['rgba'], rgba)
        self.assertTrue(predict.call_args.kwargs['interleave_alignment'])
        self.assertEqual(predict.call_args.kwargs['model_root'], (ROOT/'runtime/research').resolve())
        assets.assert_called_once_with(path=(ROOT/'runtime/research/lip-v1.npz').resolve())
        self.assertEqual(geometry.call_count, 1)
        self.assertEqual(pigment.call_count, len(categories))
        self.assertEqual([call.kwargs['category'] for call in pigment.call_args_list], list(categories))
        for call in pigment.call_args_list:
            self.assertIs(call.kwargs['positions'], positions)
        self.assertEqual(gpu.call_count, 1)
        self.assertIs(gpu.call_args.kwargs['rgba'], rgba)
        self.assertEqual([entry['name'] for entry in gpu.call_args.kwargs['passes']], list(categories))
        geometry_hash = hashlib.sha256(positions.tobytes()).hexdigest()
        self.assertEqual({layer['sharedGeometrySha256'] for layer in receipt['layers']}, {geometry_hash})
        self.assertEqual(receipt['sharedInferenceCount'], 1)
        self.assertEqual(receipt['inputRgbaSha256'], hashlib.sha256(original.tobytes()).hexdigest())
        self.assertEqual(receipt['outputRgbaSha256'], hashlib.sha256(output.tobytes()).hexdigest())
        np.testing.assert_array_equal(result, output)
        np.testing.assert_array_equal(rgba, original)
        np.testing.assert_array_equal(positions, geometry_original)
        self.assertEqual(selections, selections_original)
        for key in ('nativeGeometryUsed', 'nativePixelsUsed', 'nativeInputsUsed', 'nativeFallbackUsed', 'fixedLandmarks'):
            self.assertFalse(receipt[key])

    def test_two_families_share_original_extra_and_build_each_geometry_once(self):
        rgba = self.image()
        prediction = {'points': np.arange(480, dtype=np.float32).reshape(240, 2).tolist(), 'algorithmSize': [3, 3]}
        face = np.arange(496, dtype=np.float32).reshape(248, 2)
        eyes = np.arange(348, dtype=np.float32).reshape(174, 2)
        selected = {category: {'cardId': CARDS[category][0], 'intensity': 37} for category in reversed(ORDER)}

        def pigment_pass(*, positions, category, selection, runtime):
            expected = eyes if GEOMETRY_FAMILIES[category] == 'eye174' else face
            self.assertIs(positions, expected)
            return {'name': category}, {'category': category, **selection}

        with patch('dynamic_makeup_render.predict_extra_photo', return_value=prediction) as predict, \
                patch('dynamic_makeup_render.load_geometry', return_value={}), \
                patch('dynamic_makeup_render.working_mesh', return_value=face) as face_geometry, \
                patch('dynamic_makeup_render.eye_mesh', return_value=eyes) as eye_geometry, \
                patch('dynamic_makeup_render.selection_pass', side_effect=pigment_pass), \
                patch('dynamic_makeup_render.render_pigments', return_value=(rgba, {'private_native_images': []})) as gpu:
            _, receipt = render_rgba(rgba=rgba, selections=selected, runtime=ROOT/'runtime')
        self.assertEqual(predict.call_count, 1)
        self.assertIs(predict.call_args.kwargs['rgba'], rgba)
        self.assertEqual(face_geometry.call_count, 1)
        self.assertEqual(eye_geometry.call_count, 1)
        self.assertIs(face_geometry.call_args.kwargs['points'], eye_geometry.call_args.kwargs['points'])
        expected = {'face248': hashlib.sha256(face.tobytes()).hexdigest(),
                    'eye174': hashlib.sha256(eyes.tobytes()).hexdigest()}
        self.assertEqual(receipt['geometryFamilies'], expected)
        self.assertEqual(receipt['geometryMeshCount'], 2)
        self.assertEqual(receipt['sharedInferenceCount'], 1)
        self.assertEqual([layer['category'] for layer in receipt['layers']], list(ORDER))
        self.assertEqual(gpu.call_count, 1)
        for layer in receipt['layers']:
            family = GEOMETRY_FAMILIES[layer['category']]
            self.assertEqual(layer['geometryFamily'], family)
            self.assertEqual(layer['sharedGeometrySha256'], expected[family])

    def test_only_eye_group_does_not_load_or_build_face_geometry(self):
        rgba = self.image()
        prediction = {'points': np.ones((240, 2), np.float32).tolist(), 'algorithmSize': [3, 3]}
        eye = np.zeros((174, 2), np.float32)
        selected = {'eyeliner': {'cardId': CARDS['eyeliner'][0], 'intensity': 37}}
        with patch('dynamic_makeup_render.predict_extra_photo', return_value=prediction), \
                patch('dynamic_makeup_render.load_geometry') as load_face, \
                patch('dynamic_makeup_render.working_mesh') as build_face, \
                patch('dynamic_makeup_render.eye_mesh', return_value=eye) as build_eye, \
                patch('dynamic_makeup_render.selection_pass', return_value=({'name': 'Eyeline'}, selected['eyeliner'])), \
                patch('dynamic_makeup_render.render_pigments', return_value=(rgba, {'private_native_images': []})):
            _, receipt = render_rgba(rgba=rgba, selections=selected, runtime=ROOT/'runtime')
        load_face.assert_not_called()
        build_face.assert_not_called()
        self.assertEqual(build_eye.call_count, 1)
        self.assertEqual(set(receipt['geometryFamilies']), {'eye174'})
        self.assertEqual(receipt['geometryMeshCount'], 1)

    def test_wrong_runtime_fails_before_inference_or_assets(self):
        selected = {'lip': {'cardId': 'lip-soft-pink', 'intensity': 37}}
        with patch('dynamic_makeup_render.predict_extra_photo') as predict, \
                patch('dynamic_makeup_render.load_geometry') as assets:
            with self.assertRaisesRegex(ValueError, 'runtime must match'):
                render_rgba(rgba=self.image(), selections=selected, runtime=Path('/missing/dynamic-runtime'))
        predict.assert_not_called()
        assets.assert_not_called()

    def test_bad_frames_and_controls_fail_before_inference(self):
        bad_frames = (np.zeros((2, 2, 4), np.uint8), np.ones((2, 2, 4), np.float32),
                      np.full((1, 1281, 4), 255, np.uint8))
        with patch('dynamic_makeup_render.predict_extra_photo') as predict:
            for rgba in bad_frames:
                with self.subTest(shape=rgba.shape), self.assertRaises(ValueError):
                    render_rgba(rgba=rgba, selections={}, runtime=ROOT/'runtime')
            with self.assertRaises(ValueError):
                render_rgba(rgba=self.image(), selections={'lip': {'cardId': 'lip-soft-pink', 'intensity': True}},
                            runtime=ROOT/'runtime')
        predict.assert_not_called()

    def test_private_native_library_is_rejected_on_the_zero_path(self):
        with patch('dynamic_makeup_render.native_images', return_value={'private_native_images': ['libcccreator.dylib']}):
            with self.assertRaisesRegex(ValueError, 'private effect libraries'):
                render_rgba(rgba=self.image(), selections={}, runtime=Path('missing'))

    def test_existing_or_aliased_outputs_fail_before_decode(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            image, output, report = root/'input.png', root/'result.png', root/'receipt.json'
            for existing in (output, report):
                existing.write_bytes(b'preserve')
                with patch('dynamic_makeup_render.decode_image') as decode:
                    with self.assertRaises(ValueError):
                        run(image=image, selections={}, runtime=ROOT/'runtime', output=output, report=report)
                decode.assert_not_called()
                self.assertEqual(existing.read_bytes(), b'preserve')
                existing.unlink()
            with patch('dynamic_makeup_render.decode_image') as decode:
                with self.assertRaises(ValueError):
                    run(image=image, selections={}, runtime=ROOT/'runtime', output=output,
                        report=root/'nested/../result.png')
            decode.assert_not_called()

    def test_fresh_run_writes_decodable_result_bound_to_unchanged_source(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            image, output, report = root/'input.png', root/'new/result.png', root/'new/receipt.json'
            Image.fromarray(self.image()).save(image)
            source = image.read_bytes()
            receipt = run(image=image, selections={}, runtime=Path('missing'), output=output, report=report)
            np.testing.assert_array_equal(np.array(Image.open(output).convert('RGBA')), self.image())
            self.assertEqual(json.loads(report.read_text()), receipt)
            self.assertEqual(receipt['sourceSha256'], hashlib.sha256(source).hexdigest())
            self.assertEqual(image.read_bytes(), source)


if __name__ == '__main__':
    unittest.main()
