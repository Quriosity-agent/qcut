"""Pure matrix planning tests; no native process or proprietary asset required."""
import unittest
from pathlib import Path

from beauty_dual_matrix import batches, identifier, manifest_for


class MatrixPlanningTests(unittest.TestCase):
    def case(self, *, index, package="/pinned/face", available=True):
        return dict(id=f"control-{index}", package=package, parameters={"intensity": index + 1},
                    available=available, expectedChange=True)

    def test_groups_only_one_host_package_and_respects_prediction_budget(self):
        cases = [self.case(index=index) for index in range(49)]
        cases += [self.case(index=100, package="/pinned/makeup")]
        groups = batches(cases=cases)
        self.assertEqual([len(group) for group in groups], [24, 24, 1, 1])
        self.assertEqual([case for group in groups for case in group], cases)

    def test_unavailable_is_not_executed_and_duplicate_case_is_error(self):
        self.assertEqual(batches(cases=[self.case(index=0, available=False)]), [])
        with self.assertRaisesRegex(ValueError, "duplicate"):
            batches(cases=[self.case(index=0), self.case(index=0)])

    def test_manifest_keeps_same_pixels_zero_time_and_actual_parameters(self):
        cases = [self.case(index=index) for index in range(2)]
        manifest = manifest_for(image=Path("/portrait/original.png"), cases=cases)
        self.assertEqual(manifest["version"], 1)
        self.assertEqual([row["timestamp"] for row in manifest["frames"]], [0, 0])
        self.assertEqual([row["image"] for row in manifest["frames"]], ["/portrait/original.png"] * 2)
        self.assertEqual([row["parameters"] for row in manifest["frames"]], [case["parameters"] for case in cases])

    def test_paths_and_batch_budget_are_bounded(self):
        for value in ("../escape", "a/b", "x\n", "", "a" * 121):
            with self.subTest(value=value), self.assertRaises(ValueError):
                identifier(value=value)
        for limit in (0, 25):
            with self.assertRaises(ValueError):
                batches(cases=[], limit=limit)
        with self.assertRaisesRegex(ValueError, "absolute"):
            batches(cases=[self.case(index=0, package="relative")])


if __name__ == "__main__":
    unittest.main()
