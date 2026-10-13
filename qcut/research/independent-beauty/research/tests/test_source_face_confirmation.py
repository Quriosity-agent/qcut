"""Bidirectional ambiguity evidence keeps current geometry and fails closed on missing support."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from face_selection_reference import ACCEPTANCE_POLICY, reference_from_receipt, rgba_hash
import source_face_confirmation as evidence
from slimface_detection import single_face_prediction


def prediction(*, points):
    return {'points': points.tolist(), 'prob': [.1], 'seed_prob': [.1]}


class SourceEvidenceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.path = self.directory / 'source-evidence.json'
        self.rgba = np.full((160, 128, 4), 255, np.uint8)
        self.rgba[0, 0, 0] = 0
        self.points = np.column_stack((np.linspace(20, 60, 106), np.linspace(30, 90, 106)))
        self.hand = self.points + [60, 60]
        self.frames = []
        for index, timestamp in enumerate((.92, .96, 1.04, 1.08)):
            rgba = self.rgba.copy()
            rgba[0, 0, 0] = index + 1
            name = f'source-evidence-{index}.rgba'
            (self.directory / name).write_bytes(rgba.tobytes())
            self.frames.append({'timestampSeconds': timestamp, 'rgbaSha256': rgba_hash(rgba=rgba), 'path': name})
        self.manifest = {'schemaVersion': 1, 'policy': evidence.POLICY, 'status': 'available',
                         'targetRgbaSha256': rgba_hash(rgba=self.rgba), 'width': 128, 'height': 160,
                         'targetTimestampSeconds': 1., 'frames': self.frames}
        self.write()

    def write(self, *, manifest=None):
        self.path.write_text(json.dumps(self.manifest if manifest is None else manifest))

    def select(self, *, current=None, neighbors=None, path=True):
        current = current if current is not None else [self.points, self.hand]
        neighbors = neighbors if neighbors is not None else [[self.points + [index / 10, 0]] for index in range(1, 5)]
        values = [current, *neighbors]
        worker = Mock()
        worker.detect.side_effect = lambda rgb: list(range(len(values[int(rgb[0, 0, 0])])))
        worker.landmarks.side_effect = lambda rgba, face: prediction(points=values[int(rgba[0, 0, 0])][face])
        with patch.dict(sys.modules, worker=worker):
            return single_face_prediction(rgba=self.rgba, source_evidence=self.path if path else None)

    def test_four_distinct_neighbors_select_same_current_geometry_independent_of_order(self):
        for current in ([self.points, self.hand], [self.hand, self.points]):
            result = self.select(current=current)
            np.testing.assert_array_equal(result['points'], self.points)
            self.assertEqual(result['acceptance_policy'], evidence.POLICY)
            receipt = result['source_confirmation']
            self.assertEqual(receipt['acceptedCurrentCandidateCount'], 2)
            self.assertEqual(receipt['neighborCount'], 4)
            self.assertTrue(evidence.confirmed_source_selection(alignment=result, source_sha256=rgba_hash(rgba=self.rgba)))
            self.assertEqual(receipt['manifestSha256'], hashlib.sha256(self.path.read_bytes()).hexdigest())
            self.assertFalse(receipt['referenceCoordinatesUsedForRendering'])
            self.assertFalse(receipt['transientSecondPersonVerified'])

    def test_sole_candidate_preserves_original_prediction_without_reading_evidence(self):
        self.path.unlink()
        with patch.object(evidence, 'read_source_evidence', side_effect=AssertionError('sole candidate has no history inference')):
            result = self.select(current=[self.points])
        self.assertEqual(result, prediction(points=self.points) | {'acceptance_policy': ACCEPTANCE_POLICY, 'rejected_candidate_count': 0})

    def test_zero_current_and_missing_or_unavailable_evidence_do_not_select(self):
        with self.assertRaisesRegex(ValueError, 'found 0'):
            self.select(current=[])
        with self.assertRaisesRegex(ValueError, 'found 2'):
            self.select(path=False)
        unavailable = {key: value for key, value in self.manifest.items() if key not in ('frames', 'targetTimestampSeconds')}
        unavailable.update(status='unavailable', reason='clip boundary')
        self.write(manifest=unavailable)
        with self.assertRaisesRegex(ValueError, 'clip boundary'):
            self.select()

    def test_neighbor_zero_faces_or_true_multiple_faces_remain_fatal(self):
        for invalid in ([], [self.points, self.hand]):
            for position in range(4):
                neighbors = [[self.points] for _ in range(4)]
                neighbors[position] = invalid
                with self.subTest(position=position, count=len(invalid)), self.assertRaisesRegex(ValueError, f'found {len(invalid)}'):
                    self.select(neighbors=neighbors)

    def test_scene_change_ambiguous_current_matches_and_neighbor_disagreement_fail(self):
        for current, neighbors, message in (([self.points, self.hand], [[self.points + [30, 30]]] * 4, 'found 0'),
                ([self.points, self.points + [1, 0]], [[self.points]] * 4, 'found 2'),
                ([self.points, self.hand], [[self.points], [self.points], [self.hand], [self.hand]], 'disagree')):
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                self.select(current=current, neighbors=neighbors)

    def test_success_or_cancelled_confirmation_cannot_leak_into_next_request(self):
        self.select()
        with patch.object(evidence, 'read_source_frame', side_effect=InterruptedError('cancelled')):
            with self.assertRaises(InterruptedError):
                self.select()
        with self.assertRaisesRegex(ValueError, 'found 2'):
            self.select(path=False)

    def test_target_hash_size_alpha_and_protocol_shape_are_strict(self):
        for key, value in (('schemaVersion', True), ('schemaVersion', 2), ('policy', 'other'), ('status', 'ready'),
                           ('width', True), ('height', 161), ('targetRgbaSha256', '0' * 64), ('extra', 1)):
            self.write(manifest=self.manifest | {key: value})
            with self.subTest(key=key), self.assertRaises(ValueError):
                evidence.read_source_evidence(path=self.path, rgba=self.rgba)
        self.write()
        rgba = self.rgba.copy()
        rgba[0, 0, 3] = 0
        self.write(manifest=self.manifest | {'targetRgbaSha256': rgba_hash(rgba=rgba)})
        with self.assertRaises(ValueError):
            evidence.read_source_evidence(path=self.path, rgba=rgba)

    def test_timestamp_order_bracketing_boolean_nonfinite_and_budget_are_strict(self):
        for timestamps in ((.9, .9, 1.1, 1.2), (.9, 1., 1.1, 1.2), (.9, .95, 1., 1.2),
                           (.49, .9, 1.1, 1.2), (.9, .95, 1.1, 1.51), (.9, True, 1.1, 1.2),
                           (.9, float('nan'), 1.1, 1.2)):
            manifest = copy.deepcopy(self.manifest)
            for frame, timestamp in zip(manifest['frames'], timestamps):
                frame['timestampSeconds'] = timestamp
            self.write(manifest=manifest)
            with self.subTest(timestamps=timestamps), self.assertRaises(ValueError):
                evidence.read_source_evidence(path=self.path, rgba=self.rgba)
        self.write()
        with patch.object(evidence, 'MAX_FRAME_BYTES', 1), self.assertRaises(ValueError):
            evidence.read_source_evidence(path=self.path, rgba=self.rgba)
        for target in (True, float('inf'), -.1):
            self.write(manifest=self.manifest | {'targetTimestampSeconds': target})
            with self.assertRaises(ValueError):
                evidence.read_source_evidence(path=self.path, rgba=self.rgba)

    def test_raw_paths_are_fixed_and_files_are_regular_exact_hashed_opaque(self):
        for invalid in ('../outside.rgba', '/tmp/outside.rgba', 'source-evidence-1.rgba'):
            manifest = copy.deepcopy(self.manifest)
            manifest['frames'][0]['path'] = invalid
            self.write(manifest=manifest)
            with self.assertRaises(ValueError):
                self.select()
        self.write()
        raw = self.directory / self.frames[0]['path']
        original = raw.read_bytes()
        for data in (original[:-1], b'\x00' + original[1:]):
            raw.write_bytes(data)
            with self.assertRaises(ValueError):
                self.select()
        rgba = np.frombuffer(original, np.uint8).copy().reshape(self.rgba.shape)
        rgba[0, 0, 3] = 0
        raw.write_bytes(rgba.tobytes())
        self.frames[0]['rgbaSha256'] = rgba_hash(rgba=rgba)
        self.write()
        with self.assertRaisesRegex(ValueError, 'opaque'):
            self.select()
        outside = self.directory / 'outside.rgba'
        outside.write_bytes(rgba.tobytes())
        raw.unlink()
        raw.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, 'regular'):
            self.select()

    def test_manifest_symlink_oversize_duplicate_keys_and_mutation_are_rejected(self):
        original = self.path.read_bytes()
        self.path.write_bytes(original.replace(b'"schemaVersion": 1', b'"schemaVersion": 1,"schemaVersion":1'))
        with self.assertRaises(ValueError):
            self.select()
        self.path.write_bytes(b' ' * (evidence.MAX_MANIFEST_BYTES + 1))
        with self.assertRaises(ValueError):
            self.select()
        outside = self.directory / 'manifest.json'
        outside.write_bytes(original)
        self.path.unlink()
        self.path.symlink_to(outside)
        with self.assertRaises(ValueError):
            self.select()
        self.path.unlink()
        self.path.write_bytes(original)
        read = evidence.read_source_frame
        def changed(**arguments):
            frame = read(**arguments)
            self.path.write_bytes(original + b'\n')
            return frame
        with patch.object(evidence, 'read_source_frame', side_effect=changed), self.assertRaisesRegex(ValueError, 'changed'):
            self.select()

    def test_stage_confirmation_is_bound_even_without_a_following_identity_stage(self):
        selected = self.select()
        receipt = {'scope': 'original-photo-independent-face-and-features-one-mesh',
                   'inputRgbaSha256': rgba_hash(rgba=self.rgba), 'alignment': selected}
        source = evidence.evidence_receipt(path=self.path, rgba=self.rgba)
        evidence.validate_stage_confirmation(receipt=receipt, source_receipt=source, source_sha256=rgba_hash(rgba=self.rgba))
        for changed in (None, source | {'manifestSha256': '0' * 64}, source | {'status': 'unavailable'}):
            with self.assertRaisesRegex(ValueError, 'this request evidence'):
                evidence.validate_stage_confirmation(receipt=receipt, source_receipt=changed, source_sha256=rgba_hash(rgba=self.rgba))
        with self.assertRaises(ValueError):
            reference_from_receipt(receipt=receipt | {'predictionCount': 1, 'fixedLandmarks': False},
                                   source_sha256=rgba_hash(rgba=self.rgba), width=128, height=160)

    def test_following_same_photo_reference_requires_complete_bound_confirmation(self):
        selected = self.select()
        receipt = {'scope': 'original-photo-independent-face-and-features-one-mesh',
                   'inputRgbaSha256': rgba_hash(rgba=self.rgba), 'predictionCount': 1,
                   'fixedLandmarks': False, 'alignment': selected}
        reference = reference_from_receipt(receipt=receipt, source_sha256=rgba_hash(rgba=self.rgba), width=128, height=160, source_manifest_sha256=hashlib.sha256(self.path.read_bytes()).hexdigest())
        np.testing.assert_array_equal(reference.points, self.points)
        corruptions = (('manifestSha256', '0' * 64), ('targetRgbaSha256', '0' * 64), ('neighborCount', True), ('neighborCount', 3),
                       ('neighbors', []), ('selectedCurrentCandidateIndex', True), ('selectedCurrentCandidateIndex', 2),
                       ('acceptedCurrentCandidateCount', 1), ('referenceCoordinatesUsedForRendering', True),
                       ('transientSecondPersonVerified', True))
        for key, value in corruptions:
            broken = copy.deepcopy(receipt)
            broken['alignment']['source_confirmation'][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                reference_from_receipt(receipt=broken, source_sha256=rgba_hash(rgba=self.rgba), width=128, height=160, source_manifest_sha256=hashlib.sha256(self.path.read_bytes()).hexdigest())
        for key, value in (('acceptedCandidateCount', True), ('matchedCurrentCandidateIndex', 1),
                           ('candidates', []), ('timestampSeconds', 1.1), ('rgbaSha256', 'invalid')):
            broken = copy.deepcopy(receipt)
            broken['alignment']['source_confirmation']['neighbors'][0][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                reference_from_receipt(receipt=broken, source_sha256=rgba_hash(rgba=self.rgba), width=128, height=160, source_manifest_sha256=hashlib.sha256(self.path.read_bytes()).hexdigest())


if __name__ == '__main__':
    unittest.main()
