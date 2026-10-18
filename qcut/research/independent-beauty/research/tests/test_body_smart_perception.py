"""Face-candidate rejection must preserve usable body perception."""
from contextlib import contextmanager, ExitStack
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import body_smart_perception as perception


def face_result(*, outside=False):
    points = np.full((106, 2), [24, 24], np.float32)
    points[0], points[-1] = [10, 12], [40, 48]
    points[[84, 90]] = [28, 36]
    if outside:
        points[0, 0] = -1
    return {'points': points, 'tracked': points.copy(),
            'heads': {120: {'prob': np.array([.1], np.float32)}}}


@contextmanager
def face_inference(*, results):
    detector = Mock()
    detector.detect.return_value = {
        'rects': np.tile(np.array([8, 8, 40, 48], np.float32), (len(results), 1)),
        'algorithm_size': (64, 64),
    }
    warm = {'tracked': face_result()['tracked'],
            'heads': {160: {'prob': np.array([.1], np.float32)}}}
    candidates, sequences = [], []
    for result in results:
        sequence = Mock()
        if isinstance(result, Exception):
            sequence.process.side_effect = result
        else:
            sequence.process.return_value = result
        sequences.append(sequence)
        candidates.append((sequence, warm, {}, (64, 64)))
    with ExitStack() as stack:
        stack.enter_context(patch.object(perception, 'Detector', return_value=detector))
        stack.enter_context(patch.object(perception, 'Stage1'))
        stack.enter_context(patch.object(perception, 'load_assets'))
        stack.enter_context(patch.object(perception, 'start_photo', side_effect=candidates))
        yield sequences


class FaceCandidates(unittest.TestCase):
    def setUp(self):
        self.algorithm = np.full((64, 64, 4), 255, np.uint8)
        self.runtime = Path('/unused-test-runtime')

    def test_outside_candidate_does_not_discard_later_valid_face(self):
        valid = face_result()
        with face_inference(results=[face_result(outside=True), valid]) as sequences:
            faces, rectangles, rolls, details = perception.detect_faces(
                algorithm=self.algorithm, runtime=self.runtime)
        expected = valid['points'] / np.float32(64)
        expected[:, 1] = np.float32(1) - expected[:, 1]
        np.testing.assert_array_equal(faces, expected[None])
        np.testing.assert_array_equal(rectangles, np.array([[10, 16, 30, 36]], np.float32) / 64)
        self.assertEqual(rolls.shape, (1,))
        self.assertTrue(np.isfinite(rolls).all())
        self.assertEqual(details, {'candidates': 2, 'accepted': 1, 'rejected': 1})
        for sequence in sequences:
            self.assertEqual(sequence.process.call_count, 1)

    def test_all_outside_faces_still_return_body_for_rendering(self):
        pose = np.tile(np.array([16, 48, 1, 1], np.float32), (18, 1))
        networks = Mock(provenance={'asset': 'mock-skeleton'})
        with face_inference(results=[face_result(outside=True), face_result(outside=True)]), \
                patch.object(perception, 'algorithm_image', return_value=(self.algorithm, {})), \
                patch.object(perception, 'load_networks', return_value=networks), \
                patch.object(perception, 'pose_from_algorithm', return_value=(pose, {})):
            body, details = perception.perceive(rgba=self.algorithm, runtime=self.runtime)
        np.testing.assert_array_equal(body['coords'], np.full((18, 2), .25, np.float32))
        np.testing.assert_array_equal(body['visibility'], np.ones(18, np.uint8))
        self.assertIsNone(body['faces'])
        self.assertIsNone(body['rectangles'])
        self.assertIsNone(body['rolls'])
        self.assertEqual(details['faces'], {'candidates': 2, 'accepted': 0, 'rejected': 2})
        self.assertEqual(details['selectedBody'], 0)

    def test_runtime_failure_is_not_reclassified_as_a_rejected_candidate(self):
        failure = RuntimeError('inference unavailable')
        with face_inference(results=[failure, face_result()]) as sequences:
            with self.assertRaises(RuntimeError) as caught:
                perception.detect_faces(algorithm=self.algorithm, runtime=self.runtime)
        self.assertIs(caught.exception, failure)
        self.assertEqual(sequences[0].process.call_count, 1)
        sequences[1].process.assert_not_called()


if __name__ == '__main__':
    unittest.main()
