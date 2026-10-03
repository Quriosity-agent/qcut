"""Synthetic filter-state contracts; no native assets or runtime required."""
from copy import deepcopy
import unittest

from face_host_geometry_contract_test import geometry_row
import face_host_geometry_contract as contract


def states():
    return [dict(count=count, first=False, alpha=0.2, scale=6.6666665,
                 escale=10, width=480, height=640, current_xy=[0.0] * (count * 2),
                 previous_xy=[0.0] * (count * 2), delta_x=[0.0] * count,
                 delta_y=[0.0] * count) for count in (33, 73)]


class SmoothingContractTests(unittest.TestCase):
    def test_legacy_absence_and_native_two_partitions_without_mutation(self):
        row = geometry_row()
        contract.validate_snapshot(row=row)
        row["faces"][0]["smoothing"] = states()
        before = deepcopy(row)
        contract.validate_snapshot(row=row)
        self.assertEqual(row, before)

    def test_first_update_allows_empty_histories(self):
        value = states()
        for item in value:
            item.update(first=True, previous_xy=[], delta_x=[], delta_y=[])
        contract.smoothing_states(value=value)

    def test_partition_types_counts_and_order(self):
        for value in (None, [], {}, [states()[0]], states()[::-1]):
            with self.subTest(value=value), self.assertRaises(ValueError):
                contract.smoothing_states(value=value)
        for key, value in (("count", True), ("count", 33.0), ("count", 34),
                           ("first", 1), ("first", None)):
            items = states()
            items[0][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                contract.smoothing_states(value=items)

    def test_numeric_bounds_and_dimension_types(self):
        for key, value in (("alpha", -0.1), ("alpha", 1.01), ("alpha", True),
                           ("scale", float("nan")), ("scale", 2**20 + 1),
                           ("escale", -1), ("escale", 32769), ("escale", float("inf")),
                           ("width", 0), ("width", True), ("height", 4097), ("height", 480.0)):
            items = states()
            items[0][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                contract.smoothing_states(value=items)

    def test_vectors_require_bounded_finite_values_and_matching_lengths(self):
        for key in ("current_xy", "previous_xy", "delta_x", "delta_y"):
            for value in (None, (), [0], [True] * len(states()[0][key]),
                          [float("nan")] * len(states()[0][key]), [65537] * len(states()[0][key])):
                items = states()
                items[0][key] = value
                with self.subTest(key=key), self.assertRaises(ValueError):
                    contract.smoothing_states(value=items)

    def test_history_pairs_and_nonfirst_update_are_not_guessed(self):
        for first, dx, dy in ((True, [], [0] * 33), (False, [], [])):
            items = states()
            items[0].update(first=first, delta_x=dx, delta_y=dy)
            with self.subTest(first=first), self.assertRaises(ValueError):
                contract.smoothing_states(value=items)


if __name__ == "__main__":
    unittest.main()
