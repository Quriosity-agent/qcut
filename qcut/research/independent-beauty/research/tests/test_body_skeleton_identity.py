"""Default-target selection follows decoder order and coarse prune semantics."""
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from body_skeleton_identity import select_seed
import body_skeleton_decode as decoder


def pose(*, x=30, count=18, score=.9):
    return [[x + i % 6 * 8, 40 + i // 6 * 40, score, int(i < count)] for i in range(18)]


class DefaultBodyIdentity(unittest.TestCase):
    def test_empty_and_all_pruned_candidates_have_no_seed(self):
        for people in ([], [pose(count=7)], [pose(count=0), pose(score=-.01)]):
            with self.subTest(people=people):
                self.assertIsNone(select_seed(people=people))

    def test_first_eight_joint_candidate_beats_larger_higher_score_candidate(self):
        chosen = pose(x=100, count=8, score=0)
        self.assertEqual(select_seed(people=[pose(count=7), chosen, pose(x=10, score=1)]), chosen)

    def test_nonnegative_score_and_valid_flag_both_count(self):
        candidate = pose(count=8)
        candidate[0][2] = -np.finfo(np.float32).tiny
        self.assertIsNone(select_seed(people=[candidate]))
        candidate[0][2] = np.float32(-0.)
        self.assertEqual(select_seed(people=[candidate]), candidate)
        candidate[1][3] = 0
        self.assertIsNone(select_seed(people=[candidate]))

    def test_nan_score_is_not_counted(self):
        candidate = pose(count=8)
        candidate[0][2] = float('nan')
        self.assertIsNone(select_seed(people=[candidate]))

    def test_seed_does_not_alias_decoder_storage(self):
        original = pose()
        selected = select_seed(people=[original])
        selected[0][0] += 20
        self.assertNotEqual(selected[0][0], original[0][0])

    def test_still_pose_uses_same_pruned_first_candidate_rule(self):
        image = np.zeros((192, 144, 4), np.uint8)
        models = Mock()
        models.infer.return_value = {
            'heatmap_output_0': np.zeros((1, 2, 2, 19), np.int16),
            'vectormap_output_0': np.zeros((1, 2, 2, 38), np.int16),
            'output_0': np.zeros((1, 2, 2, 17), np.int16),
        }
        selected = pose(x=40)
        with patch.object(decoder, 'postprocess', return_value=[]), \
                patch.object(decoder, 'map_local_to_global', return_value=[pose(count=7), selected, pose()]), \
                patch.object(decoder, 'refine_pose', return_value=selected) as refine:
            result, details = decoder.pose_from_algorithm(algorithm=image, networks=models,
                                                          refinement_passes=1, tracker_crop=True)
        self.assertEqual(result, selected)
        self.assertEqual(refine.call_args.args[2], selected)
        self.assertEqual(details['coarsePeople'], 3)


if __name__ == '__main__':
    unittest.main()
