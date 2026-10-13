"""No-effect portrait stages keep the original strict lipstick selection path."""
import copy
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from face_selection_reference import reference_from_receipt, rgba_hash
from portrait_features_render import render_rgba


class NoEffectIdentityTests(unittest.TestCase):
    def setUp(self):
        self.rgba = np.full((160, 128, 4), 255, np.uint8)
        self.source_hash = rgba_hash(rgba=self.rgba)
        self.points = np.column_stack((np.linspace(20, 60, 106), np.linspace(30, 90, 106))).tolist()

    def reference(self, *, receipt):
        return reference_from_receipt(receipt=receipt, source_sha256=self.source_hash, width=128, height=160)

    def no_effect(self):
        with patch('face_features_render.single_face_prediction', side_effect=AssertionError('no prediction')), \
                patch('face_features_render.render', side_effect=AssertionError('no GPU')), \
                patch('liquefy_combination_render.single_face_prediction', side_effect=AssertionError('no prediction')), \
                patch('liquefy_combination_render.render_passes', side_effect=AssertionError('no GPU')):
            output, receipt = render_rgba(rgba=self.rgba, controls={'TotalFace': .0001, 'underjaw': .0001},
                                          runtime=Path('unused-runtime'))
        np.testing.assert_array_equal(output, self.rgba)
        return receipt

    def active_receipt(self, *, local=False):
        return {'scope': 'original-photo-independent-shared-local-package' if local
                else 'original-photo-independent-face-and-features-one-mesh',
                'inputRgbaSha256': self.source_hash, 'outputRgbaSha256': self.source_hash,
                'decodedSize': [128, 160], 'predictionCount': 1, 'meshPassCount': 1,
                'fixedLandmarks': False, 'zeroControlsIdentity': False,
                'sharedLocalPredictionCount': 1 if local else 0,
                'passOrder': ['underjaw'] if local else ['LinkedOrgans'], 'photoSamplePassCount': 1,
                'gpu': {'private_native_images': []},
                'alignment': {'points': self.points, 'prob': [.1], 'seed_prob': [.1],
                              'acceptance_policy': 'research-seed-and-120-prob0<=0.5'}}

    def test_real_tiny_common_and_local_controls_return_no_reference_without_models(self):
        receipt = self.no_effect()
        self.assertTrue(receipt['zeroControlsIdentity'])
        self.assertIsNone(self.reference(receipt=receipt))

    def test_tiny_common_active_local_keeps_original_local_prediction(self):
        active = self.active_receipt(local=True)
        with patch('portrait_features_render.face_features_render.render_rgba', side_effect=AssertionError('inactive common')), \
                patch('portrait_features_render.liquefy_combination_render.render_rgba', return_value=(self.rgba, active)):
            _, receipt = render_rgba(rgba=self.rgba, controls={'TotalFace': .0001, 'underjaw': 20}, runtime=Path('unused'))
        self.assertEqual(receipt['packageStages'], ['features'])
        np.testing.assert_array_equal(self.reference(receipt=receipt).points, self.points)

    def test_active_common_tiny_local_preserves_common_prediction(self):
        for controls in ({'TotalFace': 25, 'underjaw': .0001}, {'TotalFace': .0001, 'EnlargeEye': 20, 'underjaw': .0001}):
            active = self.active_receipt()
            with patch('portrait_features_render.face_features_render.render_rgba', return_value=(self.rgba, active)), \
                    patch('portrait_features_render.liquefy_combination_render.render_rgba', side_effect=AssertionError('inactive local')):
                _, receipt = render_rgba(rgba=self.rgba, controls=controls, runtime=Path('unused'))
            self.assertIs(receipt, active)
            np.testing.assert_array_equal(self.reference(receipt=receipt).points, self.points)

    def test_verified_identity_face_package_can_yield_to_original_local_package(self):
        receipt = {'scope': 'original-photo-independent-face-then-local-packages',
                   'packageReceipts': {'face': self.no_effect(), 'features': self.active_receipt(local=True)}}
        np.testing.assert_array_equal(self.reference(receipt=receipt).points, self.points)
        receipt['packageReceipts']['features']['inputRgbaSha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'unprocessed input'):
            self.reference(receipt=receipt)

    def test_incomplete_or_contradictory_identity_receipts_do_not_skip_alignment(self):
        baseline = self.no_effect()
        for key, value in (('scope', 'unrecognized'), ('predictionCount', True), ('predictionCount', 1),
                           ('meshPassCount', True), ('meshPassCount', 1), ('alignment', {}),
                           ('fixedLandmarks', True), ('zeroControlsIdentity', False),
                           ('changedPixelCount', 1), ('decodedSize', [128, 159]),
                           ('outputRgbaSha256', '0' * 64), ('inputRgbaSha256', '0' * 64)):
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                self.reference(receipt=baseline | {key: value})
        for key in ('alignment', 'predictionCount', 'meshPassCount', 'zeroControlsIdentity', 'changedPixelCount', 'decodedSize'):
            incomplete = {name: value for name, value in baseline.items() if name != key}
            with self.subTest(missing=key), self.assertRaises(ValueError):
                self.reference(receipt=incomplete)

    def test_invalid_face_package_cannot_fall_through_to_usable_local_alignment(self):
        invalid = self.no_effect() | {'zeroControlsIdentity': False}
        receipt = {'scope': 'original-photo-independent-face-then-local-packages',
                   'packageReceipts': {'face': invalid, 'features': self.active_receipt(local=True)}}
        with self.assertRaises(ValueError):
            self.reference(receipt=receipt)

    def test_active_original_face_is_preferred_to_later_post_warp_local_points(self):
        original, later = self.active_receipt(), self.active_receipt(local=True)
        later = copy.deepcopy(later)
        later['inputRgbaSha256'] = '0' * 64
        later['alignment']['points'] = (np.asarray(self.points) + 4).tolist()
        outer = {'scope': 'original-photo-independent-face-then-local-packages',
                 'packageReceipts': {'face': original, 'features': later}}
        self.assertEqual(self.reference(receipt=outer).as_dict(), self.reference(receipt=original).as_dict())


if __name__ == '__main__':
    unittest.main()
