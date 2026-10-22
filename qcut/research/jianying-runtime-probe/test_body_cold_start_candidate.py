"""No-model contracts for the opt-in first-call research candidate."""
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "independent-beauty/research"))
import body_skeleton_sequence as production
from body_cold_start_candidate import ColdStartSkeletonCandidate


def pose():
    return [[30 + (index % 6) * 8, 40 + (index // 6) * 40, .9, 1] for index in range(18)]


class ColdStartContracts(unittest.TestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        self.image = np.full((192, 144, 4), 255, np.uint8)
        self.networks = Mock()
        self.networks.infer.return_value = {name: np.zeros((1, 2, 2, channels), np.int16)
            for name, channels in (("heatmap_output_0", 19), ("vectormap_output_0", 38), ("output_0", 17))}
        patch.object(production, "postprocess", return_value=[]).start()
        self.coarse = patch.object(production, "map_local_to_global", return_value=[pose()]).start()
        self.refine = patch.object(production, "refine_pose", return_value=pose()).start()
        self.candidate = ColdStartSkeletonCandidate(networks=self.networks)

    def passes(self):
        return [call.kwargs["network"] for call in self.networks.infer.call_args_list]

    def test_first_call_publishes_refined_body_and_advances_one_external_frame(self):
        result = self.candidate.update(algorithm=self.image)
        self.assertIsNotNone(result)
        self.assertEqual(self.passes(), ["coarse", "refine"])
        self.assertEqual(self.candidate.frame, 1)
        self.assertEqual(self.candidate.iterations, 1)
        self.candidate.update(algorithm=self.image)
        self.assertEqual(self.passes(), ["coarse", "refine", "refine"])
        self.assertEqual(self.candidate.frame, 2)

    def test_blank_first_call_consumes_gate_without_refining_a_later_seed(self):
        self.coarse.return_value = []
        self.assertIsNone(self.candidate.update(algorithm=self.image))
        self.coarse.return_value = [pose()]
        self.assertIsNone(self.candidate.update(algorithm=self.image))
        self.assertEqual(self.passes(), ["coarse", "coarse"])
        self.assertIsNotNone(self.candidate.update(algorithm=self.image))

    def test_failed_refinement_does_not_retry_until_body_appears(self):
        self.refine.return_value = [[-1, -1, -1, 0] for _ in range(18)]
        self.assertIsNone(self.candidate.update(algorithm=self.image))
        self.refine.return_value = pose()
        self.assertIsNone(self.candidate.update(algorithm=self.image))
        self.assertEqual(self.passes(), ["coarse", "refine", "coarse"])

    def test_resize_reseeds_without_rearming_first_call(self):
        self.candidate.update(algorithm=self.image)
        self.assertIsNone(self.candidate.update(algorithm=self.image[:-1]))
        self.assertEqual(self.passes(), ["coarse", "refine", "coarse"])

    def test_invalid_raster_does_not_consume_first_call(self):
        with self.assertRaises(ValueError):
            self.candidate.update(algorithm=self.image.astype(np.float32))
        self.assertEqual(self.candidate.frame, 0)
        self.assertIsNotNone(self.candidate.update(algorithm=self.image))

    def test_current_production_first_call_remains_suppressed(self):
        engine = production.BodySkeletonSequence(networks=self.networks)
        self.assertIsNone(engine.update(algorithm=self.image))
        self.assertEqual(self.passes(), ["coarse"])


if __name__ == "__main__":
    unittest.main()
