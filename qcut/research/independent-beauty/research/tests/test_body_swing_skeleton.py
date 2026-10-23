"""The cold gate is consumed even on blank input; float values stay physical."""

from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import body_skeleton_sequence as base
from body_swing_skeleton import SwingBodySkeleton


def pose():
    return [[30 + (i % 6) * 8, 40 + (i // 6) * 40, .9, 1] for i in range(18)]


class SwingSkeletonTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        self.image = np.full((192, 144, 4), 255, np.uint8)
        self.networks = Mock()
        self.networks.detect.return_value = (np.zeros((192, 144, 3), np.int16),
            {name: np.zeros((1, 2, 2, channels), np.float32) for name, channels in
             [('heatmap_output_0', 19), ('vectormap_output_0', 38), ('output_0', 34)]})
        self.engine = SwingBodySkeleton(networks=self.networks)
        patch.object(base, 'postprocess', return_value=[]).start()
        self.coarse = patch.object(base, 'map_local_to_global', return_value=[pose()]).start()
        self.refine = patch.object(base, 'refine_pose', return_value=pose()).start()

    def test_cold_call_publishes_after_one_refine_and_advances_once(self):
        self.assertIsNotNone(self.engine.update(algorithm=self.image))
        self.assertEqual([c.kwargs['network'] for c in self.networks.detect.call_args_list],
                         ['coarse', 'refine'])
        self.assertEqual(self.engine.frame, 1)
        self.assertEqual(len(self.engine.last_debug['detectorPasses']), 2)
        self.engine.update(algorithm=self.image)
        self.assertEqual(self.engine.frame, 2)
        self.assertEqual(len(self.engine.last_debug['detectorPasses']), 1)

    def test_blank_first_call_consumes_gate_and_loss_does_not_rearm(self):
        self.coarse.return_value = []
        self.assertIsNone(self.engine.update(algorithm=self.image))
        self.coarse.return_value = [pose()]
        self.assertIsNone(self.engine.update(algorithm=self.image))
        self.assertIsNotNone(self.engine.update(algorithm=self.image))
        self.refine.return_value = [[-1, -1, 0, 0] for _ in range(18)]
        self.assertIsNone(self.engine.update(algorithm=self.image))
        self.assertIsNone(self.engine.update(algorithm=self.image))
        self.assertEqual([c.kwargs['network'] for c in self.networks.detect.call_args_list],
                         ['coarse', 'coarse', 'refine', 'refine', 'coarse'])

    def test_resize_reseeds_without_extra_refinement(self):
        self.engine.update(algorithm=self.image)
        self.assertIsNone(self.engine.update(algorithm=self.image[:-1]))
        self.assertEqual(self.engine.frame, 2)
        self.assertEqual(len(self.engine.last_debug['detectorPasses']), 1)

    def test_float_output_is_not_scaled_or_quantized(self):
        values = np.array([[[[.125, .00012345]]]], np.float32)
        self.assertEqual(base.heatmaps(values), [[[float(values[0, 0, 0, 0])]],
                                                  [[float(values[0, 0, 0, 1])]]])
        self.assertEqual(base.heatmaps(np.array([[[[128, 1024]]]], np.int16)),
                         [[[.125]], [[1.0]]])

    def test_nonfinite_and_unsupported_tensor_storage_rejected(self):
        for output in (np.full((1, 2, 2, 3), np.nan, np.float32),
                       np.zeros((1, 2, 2, 3), np.float64), np.zeros((2, 2, 3), np.float32)):
            with self.assertRaises(ValueError):
                base.heatmaps(output)


if __name__ == '__main__':
    unittest.main()
