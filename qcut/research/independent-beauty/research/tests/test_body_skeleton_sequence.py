"""Verify seed suppression, loss/reacquisition and explicit identity rejection."""
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

    def test_multiple_people_are_never_silently_reduced_to_first(self):
        self.coarse.return_value = [pose(), pose()]
        with self.assertRaises(module.AmbiguousBodyFrame):
            self.engine.update(algorithm=self.image)
        self.assertIsNone(self.engine.points)
        self.assertEqual(self.engine.frame, 0)

    def test_size_change_requires_reset_before_any_network_call(self):
        self.engine.update(algorithm=self.image)
        with self.assertRaisesRegex(ValueError, 'reset'):
            self.engine.update(algorithm=self.image[:-1])
        self.assertEqual(self.models.infer.call_count, 1)
        self.engine.reset()
        self.assertIsNone(self.engine.update(algorithm=self.image[:-1]))


if __name__ == '__main__':
    unittest.main()
