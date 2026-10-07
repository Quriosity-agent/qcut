from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from slimface_detection import single_face_prediction, single_face_points


def prediction(*, seed_prob, tracking_prob):
    return {"points": np.ones((106, 2), np.float32).tolist(), "seed_prob": [seed_prob], "prob": [tracking_prob],
            "final_tracking_points": True, "native_tracking_matrices_used": False}


class SelectionTests(unittest.TestCase):
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
