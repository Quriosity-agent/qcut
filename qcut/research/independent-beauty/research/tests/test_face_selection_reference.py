"""Same-photo identity rejects new distractors without reusing original geometry."""
from dataclasses import FrozenInstanceError
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from face_selection_reference import (ACCEPTANCE_POLICY, FaceSelectionReference, bind_reference,
    candidate_association, read_reference, reference_from_receipt, rgba_hash, write_reference)
from slimface_detection import single_face_prediction


def predicted(*, points):
    return {'points': points.tolist(), 'prob': [.1], 'seed_prob': [.1], 'acceptance_policy': ACCEPTANCE_POLICY}


class FaceReferenceTests(unittest.TestCase):
    def setUp(self):
        self.rgba = np.full((160, 128, 4), 255, np.uint8)
        self.points = np.column_stack((np.linspace(20, 60, 106), np.linspace(30, 90, 106)))
        self.identity = rgba_hash(rgba=self.rgba)
        self.reference = FaceSelectionReference(source_sha256=self.identity, input_sha256=self.identity,
            width=128, height=160, points=self.points)

    def receipt(self):
        return {'scope': 'original-photo-independent-face-and-features-one-mesh',
                'inputRgbaSha256': self.identity, 'predictionCount': 1, 'fixedLandmarks': False,
                'alignment': predicted(points=self.points)}

    def select(self, *, points, reference=True):
        worker = Mock(detect=Mock(return_value=[{}] * len(points)),
                      landmarks=Mock(side_effect=[predicted(points=value) for value in points]))
        with patch.dict(sys.modules, worker=worker):
            return single_face_prediction(rgba=self.rgba, face_reference=self.reference if reference else None)

    def test_post_warp_hand_is_excluded_independent_of_order_and_current_points_are_used(self):
        current = self.points * [1.03, .98] + [-1, 2]
        hand = self.points + [60, 60]
        with self.assertRaisesRegex(ValueError, 'found 2'):
            self.select(points=[current, hand], reference=False)
        for candidates in ([current, hand], [hand, current]):
            result = self.select(points=candidates)
            np.testing.assert_array_equal(result['points'], current)
            self.assertFalse(np.array_equal(result['points'], self.reference.points))
            self.assertEqual(result['face_selection']['acceptedCandidateCount'], 2)
            self.assertEqual(result['face_selection']['matchedCandidateCount'], 1)
            self.assertEqual(result['face_selection']['unmatchedCandidateCount'], 1)
            self.assertFalse(result['face_selection']['referenceCoordinatesUsedForRendering'])

    def test_missing_ambiguous_and_original_multiple_faces_remain_fail_closed(self):
        for points, count in (([], 0), ([self.points + [60, 60]], 0),
                              ([self.points, self.points + [1, 1]], 2)):
            with self.subTest(count=count), self.assertRaisesRegex(ValueError, f'matching face; found {count}'):
                self.select(points=points)
        with self.assertRaisesRegex(ValueError, 'accepted face; found 2'):
            self.select(points=[self.points, self.points + [60, 60]], reference=False)

    def test_displacement_contract_includes_boundary_and_rejects_beyond_it(self):
        accepted = candidate_association(reference=self.reference, prediction=predicted(points=self.points + [10, 0]))
        rejected = candidate_association(reference=self.reference, prediction=predicted(points=self.points + [10.0001, 0]))
        self.assertTrue(accepted['matches'])
        self.assertEqual(accepted['normalizedMedianDisplacement'], .25)
        self.assertFalse(rejected['matches'])
        self.assertTrue(rejected['mutualEnvelopeCenters'])

    def test_enormous_nested_candidate_cannot_match_by_center_alone(self):
        wide = (self.points - [40, 60]) * 2 + [40, 60]
        self.assertFalse(candidate_association(reference=self.reference, prediction=predicted(points=wide))['matches'])

    def test_wrong_stage_pixels_dimensions_or_source_fail_before_prediction(self):
        worker = Mock()
        changed = self.rgba.copy()
        changed[0, 0, 0] = 0
        with patch.dict(sys.modules, worker=worker):
            for rgba in (changed, self.rgba[:-1]):
                with self.assertRaisesRegex(ValueError, 'stage RGBA'):
                    single_face_prediction(rgba=rgba, face_reference=self.reference)
        worker.detect.assert_not_called()
        with self.assertRaisesRegex(ValueError, 'different source'):
            bind_reference(reference=self.reference, rgba=changed, source_sha256='0' * 64)
        bound = bind_reference(reference=self.reference, rgba=changed, source_sha256=self.identity)
        self.assertEqual(bound.source_sha256, self.identity)
        self.assertNotEqual(bound.input_sha256, self.identity)
        self.assertEqual(bound.points, self.reference.points)
        self.assertEqual(self.reference.input_sha256, self.identity)

    def test_failed_or_successful_selection_cannot_leak_to_next_request(self):
        for points in ([self.points], [self.points + [60, 60]]):
            try:
                self.select(points=points)
            except ValueError:
                pass
            with self.assertRaisesRegex(ValueError, 'accepted face; found 2'):
                self.select(points=[self.points, self.points + [60, 60]], reference=False)

    def test_invalid_current_geometry_is_fatal_instead_of_unmatched(self):
        for points in (self.points * np.nan, self.points.astype(str), self.points[:105], self.points * 0):
            with self.subTest(shape=points.shape), self.assertRaises(ValueError):
                self.select(points=[self.points, points])

    def test_original_receipt_requires_strict_policy_hash_scope_and_accepted_probabilities(self):
        reference = reference_from_receipt(receipt=self.receipt(), source_sha256=self.identity, width=128, height=160)
        self.assertEqual(reference, self.reference)
        for key, value in (('inputRgbaSha256', '0' * 64), ('scope', 'later-stage'),
                           ('predictionCount', 2), ('fixedLandmarks', True)):
            receipt = self.receipt() | {key: value}
            with self.subTest(key=key), self.assertRaises(ValueError):
                reference_from_receipt(receipt=receipt, source_sha256=self.identity, width=128, height=160)
        for probabilities in ([.9], [float('nan')], ['.1'], [], None):
            receipt = self.receipt()
            receipt['alignment']['prob'] = probabilities
            with self.assertRaises(ValueError):
                reference_from_receipt(receipt=receipt, source_sha256=self.identity, width=128, height=160)

    def test_nested_package_uses_original_face_or_local_receipt_and_rejects_wrong_hash(self):
        for key in ('face', 'features'):
            original = self.receipt()
            if key == 'features':
                original['scope'] = 'original-photo-independent-shared-local-package'
            outer = {'scope': 'original-photo-independent-face-then-local-packages',
                     'packageReceipts': {key: original}, 'alignment': predicted(points=self.points + 1)}
            reference = reference_from_receipt(receipt=outer, source_sha256=self.identity, width=128, height=160)
            self.assertEqual(reference, self.reference)
            original['inputRgbaSha256'] = '0' * 64
            with self.assertRaisesRegex(ValueError, 'unprocessed input'):
                reference_from_receipt(receipt=outer, source_sha256=self.identity, width=128, height=160)

    def test_transport_round_trip_is_bounded_typed_and_deeply_immutable(self):
        self.points[0] = 0
        self.assertNotEqual(self.reference.points[0], (0, 0))
        with self.assertRaises(FrozenInstanceError):
            self.reference.width = 20
        with self.assertRaises(TypeError):
            self.reference.points[0][0] = 20
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'reference.json'
            write_reference(reference=self.reference, path=path)
            self.assertEqual(read_reference(path=path), self.reference)
            for changes in ({'version': True}, {'width': True}, {'policy': 'unknown'}, {'extra': 0}):
                path.write_text(json.dumps(self.reference.as_dict() | changes))
                with self.assertRaises(ValueError):
                    read_reference(path=path)
            path.write_text(' ' * (32 * 1024 + 1))
            with self.assertRaisesRegex(ValueError, 'bounded'):
                read_reference(path=path)


if __name__ == '__main__':
    unittest.main()
