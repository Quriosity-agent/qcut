from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from slimface_detection import single_face_prediction, single_face_points
from alignment_photo import RejectedPhotoFace, RejectedPhotoGeometry, describe_photo
from alignment_decode import OutOfFrameLandmarks


def prediction(*, seed_prob, tracking_prob):
    return {"points": np.ones((106, 2), np.float32).tolist(), "seed_prob": [seed_prob], "prob": [tracking_prob],
            "final_tracking_points": True, "native_tracking_matrices_used": False}


class SelectionTests(unittest.TestCase):
    def test_classified_outside_candidate_is_rejected_without_mutating_coordinates(self):
        for coordinate in ((-1, 20), (101, 20), (20, -1), (20, 201)):
            points = np.full((106, 2), 20, np.float32)
            points[0] = coordinate
            before = points.copy()
            warm = {"heads": {160: {"prob": np.array([.1], np.float32)}}, "seed_crop": {"rect": [0, 0, 100]}}
            result = {"heads": {120: {"prob": np.array([.1], np.float32)}}, "points": points}
            with self.subTest(coordinate=coordinate), self.assertRaises(RejectedPhotoGeometry) as raised:
                describe_photo(warm=warm, result=result, size=(100, 200), original_size=(300, 400), algorithm_box_preserved=True)
            self.assertIsInstance(raised.exception.__cause__, OutOfFrameLandmarks)
            np.testing.assert_array_equal(points, before)

    def test_malformed_geometry_remains_a_fatal_contract_error(self):
        points = np.ones((106, 2), np.float32)
        for invalid in (points[:105], points.astype(np.float64), points * np.nan, points * np.inf):
            warm = {"heads": {160: {"prob": np.array([.1], np.float32)}}, "seed_crop": {"rect": [0, 0, 100]}}
            result = {"heads": {120: {"prob": np.array([.1], np.float32)}}, "points": invalid}
            with self.assertRaises(ValueError) as raised:
                describe_photo(warm=warm, result=result, size=(100, 200), original_size=(300, 400), algorithm_box_preserved=True)
            self.assertNotIsInstance(raised.exception, RejectedPhotoFace)

    def test_invalid_geometry_candidates_preserve_single_face_policy(self):
        valid = prediction(seed_prob=.1, tracking_prob=.2)
        rejected = RejectedPhotoGeometry("outside frame")
        for custom in (False, True):
            for outputs, accepted_count in (([rejected, valid], 1), ([valid, rejected], 1), ([rejected, rejected], 0), ([valid, rejected, valid], 2)):
                worker = Mock(detect=Mock(return_value=[{}] * len(outputs)), landmarks=Mock(side_effect=outputs))
                predictor = Mock(side_effect=outputs) if custom else None
                with self.subTest(custom=custom, accepted_count=accepted_count), patch.dict(sys.modules, worker=worker):
                    if accepted_count == 1:
                        selected = single_face_prediction(rgba=np.full((32, 32, 4), 128, np.uint8), predictor=predictor)
                        self.assertEqual(selected["points"], valid["points"])
                        self.assertEqual(selected["rejected_candidate_count"], 1)
                    else:
                        with self.assertRaisesRegex(ValueError, f"found {accepted_count}"):
                            single_face_prediction(rgba=np.full((32, 32, 4), 128, np.uint8), predictor=predictor)

    def test_classified_false_candidate_cannot_discard_a_valid_face(self):
        for custom in (False, True):
            with self.subTest(custom=custom):
                outputs = [prediction(seed_prob=.1, tracking_prob=.2), RejectedPhotoFace("photo candidate rejected")]
                worker = Mock(detect=Mock(return_value=[{}, {}]), landmarks=Mock(side_effect=outputs))
                predictor = Mock(side_effect=outputs) if custom else None
                with patch.dict(sys.modules, worker=worker):
                    selected = single_face_prediction(rgba=np.full((32, 32, 4), 128, np.uint8), predictor=predictor)
                self.assertEqual(selected["prob"], [.2])
                self.assertEqual(selected["rejected_candidate_count"], 1)

    def test_untyped_geometry_and_runtime_failures_are_not_candidate_rejections(self):
        for failure in (ValueError("malformed coordinates"), RuntimeError("model crashed")):
            worker = Mock(detect=Mock(return_value=[{}, {}]),
                          landmarks=Mock(side_effect=[prediction(seed_prob=.1, tracking_prob=.2), failure]))
            with patch.dict(sys.modules, worker=worker), self.assertRaises(type(failure)):
                single_face_prediction(rgba=np.full((32, 32, 4), 128, np.uint8))

    def test_both_seed_and_tracking_scores_are_required_for_acceptance(self):
        outputs = [prediction(seed_prob=.9, tracking_prob=.1), prediction(seed_prob=.1, tracking_prob=.9),
                   prediction(seed_prob=.2, tracking_prob=.3)]
        worker = Mock(detect=Mock(return_value=[{}, {}, {}]), landmarks=Mock(side_effect=outputs))
        with patch.dict(sys.modules, worker=worker):
            selected = single_face_prediction(rgba=np.full((32, 32, 4), 128, np.uint8))
        self.assertEqual(selected["prob"], [.3])
        self.assertFalse(selected["native_tracking_matrices_used"])
        self.assertTrue(selected["final_tracking_points"])
        self.assertIn("research", selected["acceptance_policy"])

    def test_no_or_ambiguous_accepted_face_fails(self):
        for count in (0, 2):
            worker = Mock(detect=Mock(return_value=[{}] * count),
                          landmarks=Mock(return_value=prediction(seed_prob=.1, tracking_prob=.1)))
            with patch.dict(sys.modules, worker=worker), self.assertRaises(ValueError):
                single_face_prediction(rgba=np.full((32, 32, 4), 128, np.uint8))

    def test_legacy_points_wrapper_returns_owned_final106(self):
        worker = Mock(detect=Mock(return_value=[{}]), landmarks=Mock(return_value=prediction(seed_prob=.5, tracking_prob=.5)))
        with patch.dict(sys.modules, worker=worker):
            points = single_face_points(rgba=np.full((32, 32, 4), 128, np.uint8))
        np.testing.assert_array_equal(points, np.ones((106, 2)))


if __name__ == "__main__":
    unittest.main()
