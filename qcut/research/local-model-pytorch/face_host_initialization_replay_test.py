"""Initialization-to-decode integration uses owned seeds, not returned points."""
import unittest
from unittest.mock import patch

import numpy as np

from face_temporal_smoothing_replay_test import initialized, observed
import face_temporal_smoothing as math
import face_temporal_smoothing_replay as smoothing
import face_host_geometry_sequence_replay as replay


class InitializationReplayTests(unittest.TestCase):
    def test_owned_seed_reaches_exact_normalized_consumer_points(self):
        seed, points = np.zeros((106, 2), np.float32), np.ones((106, 2), np.float32)
        expected, state = math.update_base(state=initialized(points=seed), points=points, optimized=False)
        row = observed(index=0, points=points, state=state)
        native = dict(timestamp_us=0, faces=[dict(id=1, points=replay.normalized(points=expected, request=row["request"]).tolist())])
        with patch.object(replay, "decode_actual", return_value=(points, points)):
            case, generated = replay.decode_case(snapshot=row, raw=points, native_frame=native,
                temporal=smoothing.TemporalReplay(owned_initialization=True), initialization_seed=seed)
        self.assertTrue(case["temporal_smoothing"]["owned_seed_used"])
        self.assertFalse(case["temporal_smoothing"]["native_seed_used"])
        self.assertTrue(case["checks"]["normalized"]["exact"])
        self.assertEqual(generated, native["faces"])

    def test_owned_seed_requires_smoothing_and_missing_seed_never_falls_back(self):
        seed, points = np.zeros((106, 2), np.float32), np.ones((106, 2), np.float32)
        _, state = math.update_base(state=initialized(points=seed), points=points, optimized=False)
        row = observed(index=0, points=points, state=state)
        with patch.object(replay, "decode_actual", return_value=(points, points)):
            with self.assertRaisesRegex(ValueError, "requires temporal"):
                replay.decode_case(snapshot=row, raw=points, initialization_seed=seed)
            with self.assertRaisesRegex(ValueError, "fallback forbidden"):
                replay.decode_case(snapshot=row, raw=points, temporal=smoothing.TemporalReplay(owned_initialization=True))


if __name__ == "__main__":
    unittest.main()
