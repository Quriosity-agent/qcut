from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from brow_assets import CARDS as BROW_CARDS
from dynamic_makeup_controls import CARDS
from dynamic_makeup_passes import selection_pass


class DynamicMakeupPassTests(unittest.TestCase):
    def test_every_brow_card_uses_its_pinned_texture_on_unscaled_shared_geometry(self):
        runtime = Path('/bounded-dynamic-runtime')
        positions = np.zeros((248, 2), np.float32)
        original_assets = {'uv': np.zeros((248, 2), np.float32)}
        for card, (package, identity) in BROW_CARDS.items():
            with self.subTest(card=card), \
                    patch('dynamic_makeup_passes.load_brows', return_value=original_assets) as load, \
                    patch('dynamic_makeup_passes.build_pass', return_value={'name': 'Brow'}) as build:
                pigment, details = selection_pass(positions=positions, category='brows',
                    selection={'cardId': card, 'intensity': 37}, runtime=runtime)
            load.assert_called_once_with(path=runtime/'research/brow-v1.npz')
            kwargs = build.call_args.kwargs
            self.assertIs(kwargs['positions'], positions)
            self.assertEqual(kwargs['package'], runtime/'Cache/effect'/package)
            self.assertEqual(kwargs['strength'], .37)
            self.assertEqual(kwargs['layers'][0]['sha256'], identity)
            self.assertEqual(kwargs['layers'][0]['path'], 'image/eyebrow/eyebrow.png')
            self.assertEqual(kwargs['layers'][0]['mode'], 'multiply')
            np.testing.assert_array_equal(kwargs['assets']['position_scale'], np.ones(2, np.float32))
            self.assertNotIn('position_scale', original_assets)
            self.assertEqual(pigment['name'], 'Brow')
            self.assertEqual(details['cardId'], card)

    def test_blush_has_two_ordered_blends_and_uses_the_bound_runtime(self):
        runtime, positions = Path('/bounded-dynamic-runtime'), np.zeros((248, 2), np.float32)
        with patch('dynamic_makeup_passes.load_face', return_value={}) as load, \
                patch('dynamic_makeup_passes.build_pass', return_value={'name': 'Blusher'}) as build:
            _, details = selection_pass(positions=positions, category='blush',
                selection={'cardId': 'blush-baby-pink', 'intensity': 80}, runtime=runtime)
        load.assert_called_once_with(path=runtime/'research/blush-baby-pink-v1.npz', card='blush-baby-pink')
        kwargs = build.call_args.kwargs
        self.assertIs(kwargs['positions'], positions)
        self.assertEqual(kwargs['name'], 'Blusher')
        self.assertEqual(kwargs['strength'], .8)
        self.assertEqual([layer['mode'] for layer in kwargs['layers']], ['multiply', 'normal'])
        self.assertEqual([layer['path'] for layer in kwargs['layers']],
                         ['image/blusher/blusher.png', 'image/blusher/highlight.png'])
        self.assertTrue(kwargs['package'].is_relative_to(runtime/'Cache/effect'))
        self.assertEqual(details['category'], 'blush')

    def test_contour_uses_shared_face_geometry_and_pinned_soft_light_texture(self):
        runtime, positions = Path('/bounded-dynamic-runtime'), np.zeros((248, 2), np.float32)
        original = positions.copy()
        with patch('dynamic_makeup_passes.load_face', return_value={}) as load, \
                patch('dynamic_makeup_passes.build_pass', return_value={'name': 'Stereo'}) as build:
            _, details = selection_pass(positions=positions, category='contour',
                selection={'cardId': 'contour-mixed', 'intensity': 50}, runtime=runtime)
        load.assert_called_once_with(path=runtime/'research/contour-mixed-v1.npz', card='contour-mixed')
        kwargs = build.call_args.kwargs
        self.assertIs(kwargs['positions'], positions)
        self.assertEqual(kwargs['name'], 'Stereo')
        self.assertEqual(kwargs['strength'], .5)
        self.assertEqual([layer['mode'] for layer in kwargs['layers']], ['soft-light'])
        self.assertEqual([layer['path'] for layer in kwargs['layers']], ['image/stereo/stereo.png'])
        self.assertEqual(details['category'], 'contour')
        np.testing.assert_array_equal(positions, original)

    def test_all_eye_cards_bind_their_pinned_layers_to_the_eye_family(self):
        runtime, positions = Path('/bounded-dynamic-runtime'), np.zeros((174, 2), np.float32)
        for category in ('eyeliner', 'aegyo', 'eyeshadow'):
            loader = 'load_shadow' if category == 'eyeshadow' else 'load_eye'
            for card in CARDS[category]:
                with self.subTest(category=category, card=card), \
                        patch('dynamic_makeup_passes.'+loader, return_value={}) as load, \
                        patch('dynamic_makeup_passes.build_pass', return_value={}) as build:
                    _, details = selection_pass(positions=positions, category=category,
                        selection={'cardId': card, 'intensity': 37}, runtime=runtime)
                load.assert_called_once_with(path=runtime/f'research/{card}-v1.npz', card=card)
                kwargs = build.call_args.kwargs
                self.assertIs(kwargs['positions'], positions)
                self.assertEqual(details['geometryFamily'], 'eye174')
                self.assertEqual([layer['mode'] for layer in kwargs['layers']],
                                 ['multiply'] if category == 'eyeliner' else ['multiply', 'screen'])
                self.assertEqual(kwargs['name'], {'eyeliner': 'Eyeline', 'aegyo': 'Eyemazing', 'eyeshadow': 'Eyeshadow'}[category])

    def test_mesh_family_mismatch_and_cross_category_card_fail_before_assets(self):
        with patch('dynamic_makeup_passes.load_eye') as eye, patch('dynamic_makeup_passes.load_brows') as brow:
            for category, card, count in (('eyeliner', CARDS['eyeliner'][0], 248),
                                           ('brows', CARDS['brows'][0], 174),
                                           ('aegyo', CARDS['eyeliner'][0], 174)):
                with self.subTest(category=category), self.assertRaises(ValueError):
                    selection_pass(positions=np.zeros((count, 2), np.float32), category=category,
                                   selection={'cardId': card, 'intensity': 37}, runtime=Path('/unused'))
        eye.assert_not_called()
        brow.assert_not_called()

    def test_lip_material_uses_shared_mouth_geometry_without_mutating_it(self):
        runtime = Path('/bounded-dynamic-runtime')
        for gap, state in ((0, 'Close'), (.2, 'Open')):
            positions = np.zeros((248, 2), np.float32)
            positions[225], positions[192], positions[240] = [0, gap], [0, -1], [0, gap+1]
            original = positions.copy()
            with patch('dynamic_makeup_passes.load_lip', return_value={}) as load, \
                    patch('dynamic_makeup_passes.build_pass', return_value={'name': 'Lip'}) as build:
                _, details = selection_pass(positions=positions, category='lip',
                    selection={'cardId': 'lip-soft-pink', 'intensity': 80}, runtime=runtime)
            load.assert_called_once_with(path=runtime/'research/lip-soft-pink-v1.npz', card='lip-soft-pink')
            kwargs = build.call_args.kwargs
            self.assertIs(kwargs['positions'], positions)
            self.assertEqual(kwargs['layers'][0]['path'], f'image/lip/default/lip{state}.png')
            self.assertTrue(kwargs['layers'][0]['customColor'])
            self.assertEqual(kwargs['layers'][0]['mode'], 'multiply')
            self.assertEqual(details['materialSelection']['textureState'], state)
            np.testing.assert_array_equal(positions, original)


if __name__ == '__main__':
    unittest.main()
