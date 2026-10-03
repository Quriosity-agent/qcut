"""Temporal neural windows include idle and shared-network faces, never guess IDs."""
from copy import deepcopy
import unittest

import face_host_geometry_contract as contract
import face_host_geometry_contract_test as fixtures
from face_host_geometry_contract_test import geometry_row


class TemporalTests(unittest.TestCase):
    def test_static_policy_still_rejects_repeated_markers(self):
        rows = [geometry_row(), geometry_row(index=1)]
        rows[1]["bytenn_sequence"] = rows[0]["bytenn_sequence"]
        with self.assertRaises(ValueError):
            contract.validate_sequence(records=rows)
        self.assertEqual(contract.validate_sequence(records=rows, temporal=True), rows)

    def test_temporal_policy_rejects_decreasing_markers_and_nonbool_policy(self):
        rows = [geometry_row(), geometry_row(index=1)]
        rows[1]["bytenn_sequence"] = 1
        with self.assertRaises(ValueError):
            contract.validate_sequence(records=rows, temporal=True)
        for temporal in (1, 0, None, "true", []):
            with self.subTest(temporal=temporal), self.assertRaises(ValueError):
                contract.validate_sequence(records=[geometry_row()], temporal=temporal)

    def test_idle_window_is_explicitly_empty_not_a_reused_inference(self):
        fixture = fixtures.ContractTests().association_fixture()
        fixture["records"][1]["bytenn_sequence"] = 4
        before = deepcopy(fixture)
        result = contract.associate_inferences(**fixture, temporal=True)
        self.assertEqual(result[1], dict(prediction=1, neural_window=[4, 4], inferences=[]))
        self.assertEqual(fixture, before)
        with self.assertRaises(ValueError):
            contract.associate_inferences(**fixture)

    def test_multiple_actual_120_inferences_are_kept_without_slot_assignments(self):
        fixture = fixtures.ContractTests().association_fixture()
        fixture["metadata"].append(dict(index=2, kind="espresso-inference",
                                        fields=dict(self="32768", inference="2", rc="0")))
        result = contract.associate_inferences(**fixture, temporal=True)
        self.assertEqual({item["inference"] for item in result[0]["inferences"]}, {0, 2})
        self.assertTrue(all("id" not in item and "slot" not in item for item in result[0]["inferences"]))
        with self.assertRaisesRegex(ValueError, "one actual 120"):
            contract.associate_inferences(**fixture)

    def test_temporal_policy_does_not_weaken_metadata_validation(self):
        fixture = fixtures.ContractTests().association_fixture()
        fixture["metadata"][0]["fields"]["rc"] = "1"
        with self.assertRaisesRegex(ValueError, "successful neural"):
            contract.associate_inferences(**fixture, temporal=True)

    def test_more_than_ten_120_inferences_in_one_window_are_rejected(self):
        fixture = fixtures.ContractTests().association_fixture()
        identity = "32768"
        fixture["networks"][identity]["successful_inferences"] = list(range(12))
        fixture["records"] = [geometry_row()]
        fixture["records"][0]["bytenn_sequence"] = 16
        fixture["metadata"] = [dict(index=index, kind="espresso-inference",
                                     fields=dict(self=identity, inference=str(index), rc="0")) for index in range(11)]
        with self.assertRaises(ValueError):
            contract.associate_inferences(**fixture, temporal=True)


if __name__ == "__main__":
    unittest.main()
