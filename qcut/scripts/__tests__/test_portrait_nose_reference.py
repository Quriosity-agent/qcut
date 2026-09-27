import importlib.util
import unittest
from pathlib import Path

import numpy as np

SPEC = importlib.util.spec_from_file_location("portrait_nose_reference", Path(__file__).parents[1] / "compare-portrait-nose-reference.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class NoseMetricsTests(unittest.TestCase):
    def test_identical_delta(self):
        delta = np.array([1, -1, 2], dtype=float)
        metrics = MODULE.delta_metrics(reference=delta, candidate=delta)
        self.assertAlmostEqual(metrics["deltaCosine"], 1)
        self.assertEqual(metrics["deltaMae"], 0)

    def test_opposite_direction_is_not_similar(self):
        delta = np.array([1, -1], dtype=float)
        metrics = MODULE.delta_metrics(reference=delta, candidate=-delta)
        self.assertAlmostEqual(metrics["deltaCosine"], -1)
        self.assertEqual(metrics["deltaMae"], 2)

    def test_scaling_keeps_direction_but_changes_error(self):
        delta = np.array([1, -1], dtype=float)
        metrics = MODULE.delta_metrics(reference=delta, candidate=delta * 2)
        self.assertAlmostEqual(metrics["deltaCosine"], 1)
        self.assertEqual(metrics["deltaMae"], 1)

    def test_no_change_does_not_claim_perfect_similarity(self):
        zero = np.zeros(3)
        metrics = MODULE.delta_metrics(reference=zero, candidate=zero)
        self.assertIsNone(metrics["deltaCosine"])
        self.assertEqual(metrics["deltaMae"], 0)

    def test_rejects_invalid_samples(self):
        for left, right in [(np.zeros(2), np.zeros(3)), (np.array([]), np.array([])), (np.array([np.nan]), np.array([0]))]:
            with self.subTest(left=left, right=right), self.assertRaises(ValueError):
                MODULE.delta_metrics(reference=left, candidate=right)


if __name__ == "__main__":
    unittest.main()
