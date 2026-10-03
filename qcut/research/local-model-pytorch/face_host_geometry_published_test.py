"""Synthetic published-vector and routing-state schema; no proprietary assets."""
from copy import deepcopy
import unittest

from face_host_geometry_contract_test import geometry_row, inactive_row
import face_host_geometry_contract as contract
import face_host_geometry_output as output


def published_row():
    row = geometry_row()
    points = output.first_points(value=row["faces"][0]["tracked"]).reshape(-1).tolist()
    row["faces"][0]["published"] = dict(record=131072, count=106, storage_points=106,
                                       capacity_points=106, points_xy=points)
    row["returned_result"] = dict(count=1, faces=[dict(index=0, points_xy=points.copy())])
    row["runtime_state"] = dict(base_output_mode_bit=False, optimized_output_bit=True,
                                config_cache_mode=0, cache_skip_bit=False, cache_counter=0)
    return row


class PublishedTests(unittest.TestCase):
    def test_initialized_vectors_and_empty_inactive_slots_are_valid(self):
        row = published_row()
        before = deepcopy(row)
        contract.validate_snapshot(row=row)
        self.assertEqual(row, before)
        row = inactive_row()
        for face in row["faces"]:
            face["published"] = dict(record=131072 + face["slot"] * 400, count=0,
                                     storage_points=0, capacity_points=0, points_xy=[])
        contract.validate_snapshot(row=row)
        row["faces"][0]["published"].update(count=106, storage_points=280, capacity_points=512, points_xy=[0] * 212)
        contract.validate_snapshot(row=row)

    def test_count_array_object_and_record_fields_are_strict(self):
        changes = (("count", False), ("count", 0), ("count", 1), ("count", 107),
                   ("count", 106.0), ("record", 0), ("record", True), ("points_xy", []),
                   ("points_xy", [float("nan")] * 212), ("points_xy", [True] * 212),
                   ("storage_points", 0), ("storage_points", 212), ("storage_points", 281),
                   ("capacity_points", 105), ("capacity_points", 513), ("capacity_points", True))
        for key, value in changes:
            row = published_row()
            row["faces"][0]["published"][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                contract.validate_snapshot(row=row)
        for value in (None, [], False, {}):
            row = published_row()
            row["faces"][0]["published"] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                contract.validate_snapshot(row=row)

    def test_pool_stride_and_complete_capture_are_required(self):
        for variant in ("partial", "alias", "different_pool", "negative_base"):
            row = inactive_row()
            for face in row["faces"]:
                face["published"] = dict(record=131072 + face["slot"] * 400, count=0,
                                         storage_points=0, capacity_points=0, points_xy=[])
            if variant == "partial":
                row["faces"][1].pop("published")
            elif variant == "alias":
                row["faces"][1]["published"]["record"] = 131072
            elif variant == "different_pool":
                row["faces"][1]["published"]["record"] += 4096
            else:
                row["faces"] = [row["faces"][-1]]
                row["faces"][0]["published"]["record"] = 4096
            with self.subTest(variant=variant), self.assertRaises(ValueError):
                contract.validate_snapshot(row=row)

    def test_runtime_flags_require_typed_bits_and_signed_int32(self):
        for key in ("base_output_mode_bit", "optimized_output_bit", "cache_skip_bit"):
            for value in (0, 1, None, "true"):
                row = published_row()
                row["runtime_state"][key] = value
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    contract.validate_snapshot(row=row)
        for key in ("config_cache_mode", "cache_counter"):
            for value in (True, 0.0, None, 2**31, -(2**31)-1):
                row = published_row()
                row["runtime_state"][key] = value
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    contract.validate_snapshot(row=row)
            row = published_row()
            row["runtime_state"][key] = -(2**31)
            contract.validate_snapshot(row=row)
        row = published_row()
        row["runtime_state"] = []
        with self.assertRaises(ValueError):
            contract.validate_snapshot(row=row)

    def test_four_layers_distinguish_before_and_after_publication(self):
        row = published_row()
        result = output.output_layers(snapshot=row)
        self.assertTrue(result["published_observed"])
        self.assertTrue(result["published_to_returned_exact"])
        row["faces"][0]["tracked"][0][0] += 0.25
        result = output.output_layers(snapshot=row)
        self.assertFalse(result["tracked_to_published"][0]["exact"])
        self.assertTrue(result["published_to_returned_exact"])
        row["returned_result"]["faces"][0]["points_xy"][0] += 0.5
        result = output.output_layers(snapshot=row)
        self.assertFalse(result["published_to_returned_exact"])

    def test_legacy_absence_is_not_reported_as_observed_active_publication(self):
        row = published_row()
        row["faces"][0].pop("published")
        result = output.output_layers(snapshot=row)
        self.assertFalse(result["published_observed"])
        self.assertIsNone(result["published_to_returned_exact"])

    def test_empty_legacy_results_are_not_false_publication_proof(self):
        row = inactive_row()
        row["returned_result"] = dict(count=0, faces=[])
        for faces in (row["faces"], []):
            row["faces"] = faces
            result = output.output_layers(snapshot=row)
            self.assertFalse(result["published_observed"])
            self.assertIsNone(result["published_to_returned_exact"])


if __name__ == "__main__":
    unittest.main()
