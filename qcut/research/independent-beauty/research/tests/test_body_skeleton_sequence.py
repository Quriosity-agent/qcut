"""Verify seed suppression, loss/reacquisition and default target selection."""
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import body_skeleton_sequence as module


def pose():
    return [[30 + (i % 6) * 8, 40 + (i // 6) * 40, .9, 1] for i in range(18)]


class SkeletonLifecycle(unittest.TestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        self.image = np.full((192, 144, 4), 255, np.uint8)
        self.models = Mock()
        self.models.infer.return_value = {key: np.zeros((1, 2, 2, channels), np.int16)
                                          for key, channels in [('heatmap_output_0', 19),
                                                                ('vectormap_output_0', 38), ('output_0', 17)]}
        self.engine = module.BodySkeletonSequence(networks=self.models)
        patch.object(module, 'postprocess', return_value=[]).start()
        self.coarse = patch.object(module, 'map_local_to_global', return_value=[pose()]).start()
        self.refine = patch.object(module, 'refine_pose', return_value=pose()).start()

    def test_first_pass_seeds_then_refines_without_repeating_detector(self):
        self.assertIsNone(self.engine.update(algorithm=self.image))
        self.assertEqual(self.engine.last_debug['state'], {'mode': 0, 'iterations': 0, 'objects': 1, 'id': 0})
        output = self.engine.update(algorithm=self.image)
        self.assertEqual(output['coords'].shape, (18, 2))
        self.assertEqual([call.kwargs['network'] for call in self.models.infer.call_args_list], ['coarse', 'refine'])
        self.assertEqual(self.engine.last_debug['state']['iterations'], 1)

    def test_loss_reacquires_and_suppresses_new_seed(self):
        self.engine.update(algorithm=self.image)
        self.refine.return_value = [[-1, -1, 0, 0] for _ in range(18)]
        self.assertIsNone(self.engine.update(algorithm=self.image))
        self.assertEqual(self.engine.last_debug['state']['objects'], 0)
        self.refine.return_value = pose()
        self.assertIsNone(self.engine.update(algorithm=self.image))
        self.assertEqual(self.engine.last_debug['state']['iterations'], 0)
        self.assertIsNotNone(self.engine.update(algorithm=self.image))

    def test_multiple_people_seed_first_valid_decoder_candidate(self):
        first = pose()
        rejected = [[*point[:3], 0] for point in first]
        second = [[point[0] + 20, *point[1:]] for point in first]
        self.coarse.return_value = [rejected, first, second]
        self.assertIsNone(self.engine.update(algorithm=self.image))
        self.assertEqual(self.engine.points, first)
        self.assertEqual(self.engine.frame, 1)
        self.assertEqual(self.engine.last_debug['state']['id'], 0)

    def test_new_person_does_not_reseed_active_target(self):
        self.engine.update(algorithm=self.image)
        self.coarse.return_value = [pose(), pose()]
        for _ in range(35):
            self.assertIsNotNone(self.engine.update(algorithm=self.image))
        self.assertEqual(self.coarse.call_count, 1)
        self.assertEqual(self.engine.last_debug['state']['iterations'], 35)

    def test_lost_target_reuses_id_zero_for_next_valid_seed(self):
        self.engine.update(algorithm=self.image)
        self.refine.return_value = [[-1, -1, -1, 0] for _ in range(18)]
        self.assertIsNone(self.engine.update(algorithm=self.image))
        replacement = [[point[0] + 15, *point[1:]] for point in pose()]
        self.coarse.return_value = [replacement, pose()]
        self.assertIsNone(self.engine.update(algorithm=self.image))
        self.assertEqual(self.engine.points, replacement)
        self.assertEqual(self.engine.last_debug['state'],
                         {'mode': 0, 'iterations': 0, 'objects': 1, 'id': 0})

    def test_size_change_reseeds_with_same_models_and_reuses_id_zero(self):
        self.engine.update(algorithm=self.image)
        self.engine.update(algorithm=self.image)
        replacement = [[point[0] + 10, *point[1:]] for point in pose()]
        self.coarse.return_value = [replacement]
        resized = self.image[:-1]
        self.assertIsNone(self.engine.update(algorithm=resized))
        self.assertIs(self.engine.networks, self.models)
        self.assertEqual(self.engine.points, replacement)
        self.assertEqual(self.engine.size, (144, 191))
        self.assertEqual(self.engine.frame, 3)
        self.assertEqual(self.engine.last_debug['state'],
                         {'mode': 0, 'iterations': 0, 'objects': 1, 'id': 0})
        self.assertIsNotNone(self.engine.update(algorithm=resized))
        self.assertEqual([call.kwargs['network'] for call in self.models.infer.call_args_list],
                         ['coarse', 'refine', 'coarse', 'refine'])

    def test_size_change_discards_old_target_when_new_seed_is_absent(self):
        self.engine.update(algorithm=self.image)
        self.coarse.return_value = []
        self.assertIsNone(self.engine.update(algorithm=self.image[:, :-1]))
        self.assertIsNone(self.engine.points)
        self.assertEqual(self.engine.last_debug['state'],
                         {'mode': 0, 'iterations': 0, 'objects': 0, 'id': None})


if __name__ == '__main__':
    unittest.main()
