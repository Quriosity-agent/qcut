"""Causal seed selection never searches heads or captured previous-point values."""
from copy import deepcopy
import unittest

from face_host_initialization_test import fixture
import face_host_initialization as initialization


def window():
    _, snapshot, _ = fixture()
    association = dict(prediction=0, neural_window=[0, 16], inferences=[
        dict(size=120, network="32768", inference=0, record_index=8),
        dict(size=160, network="57344", inference=0, record_index=4),
        dict(size=160, network="57344", inference=1, record_index=12)])
    return snapshot, association


class SelectionTests(unittest.TestCase):
    def test_initialization_precedes_tracking_and_extra_detection_is_not_a_seed(self):
        snapshot, association = window()
        before = deepcopy(association)
        selected, proof = initialization.select_initialization(snapshot=snapshot, association=association)
        self.assertEqual(selected["inference"], 0)
        self.assertEqual(proof, dict(association_mode="single-face-pretracking-160",
            seed_record_index=4, tracking_record_index=8, tracking_inference=0, excluded_160_inferences=[1]))
        self.assertEqual(association, before)

    def test_selection_uses_record_order_not_list_order_or_point_values(self):
        snapshot, association = window()
        expected = initialization.select_initialization(snapshot=snapshot, association=association)
        association["inferences"].reverse()
        snapshot["faces"][0]["smoothing"][0]["previous_xy"] = [999.0] * 66
        self.assertEqual(initialization.select_initialization(snapshot=snapshot, association=association), expected)

    def test_two_pretracking_candidates_are_rejected_not_ranked_numerically(self):
        snapshot, association = window()
        association["inferences"][-1]["record_index"] = 5
        with self.assertRaisesRegex(ValueError, "ambiguous"):
            initialization.select_initialization(snapshot=snapshot, association=association)

    def test_only_posttracking_detection_cannot_initialize(self):
        snapshot, association = window()
        association["inferences"].pop(1)
        with self.assertRaisesRegex(ValueError, "before tracking"):
            initialization.select_initialization(snapshot=snapshot, association=association)

    def test_missing_or_multiple_tracking_inferences_reject(self):
        for multiple in (False, True):
            snapshot, association = window()
            if multiple:
                association["inferences"].append(dict(size=120, network="32768", inference=1, record_index=10))
            else:
                association["inferences"].pop(0)
            with self.subTest(multiple=multiple), self.assertRaisesRegex(ValueError, "tracking inference"):
                initialization.select_initialization(snapshot=snapshot, association=association)

    def test_wrong_prediction_window_owner_and_typed_identity_reject(self):
        for change in ("prediction", "bool_prediction", "window", "bool_window", "empty_window",
                       "network", "bool_inference", "bool_size", "bool_record", "outside", "duplicate"):
            snapshot, association = window()
            if change == "prediction":
                association["prediction"] = 1
            elif change == "bool_prediction":
                association["prediction"] = False
            elif change == "window":
                association["neural_window"][1] = 17
            elif change == "bool_window":
                association["neural_window"][0] = False
            elif change == "empty_window":
                association["neural_window"][0] = 16
            elif change == "network":
                association["inferences"][1]["network"] = "65536"
            elif change == "outside":
                association["inferences"][1]["record_index"] = 16
            elif change == "duplicate":
                association["inferences"].append(deepcopy(association["inferences"][1]))
            else:
                key = {"bool_inference": "inference", "bool_size": "size", "bool_record": "record_index"}[change]
                association["inferences"][1][key] = False
            with self.subTest(change=change), self.assertRaises(ValueError):
                initialization.select_initialization(snapshot=snapshot, association=association)

    def test_seed_is_only_required_for_new_nonfirst_state(self):
        snapshot, _ = window()
        face = snapshot["faces"][0]
        identity = (face["slot"], face["alignment"], face["id"])
        self.assertTrue(initialization.initialization_required(snapshot=snapshot, prior_identity=None))
        self.assertFalse(initialization.initialization_required(snapshot=snapshot, prior_identity=identity))
        for state in face["smoothing"]:
            state["first"] = True
        self.assertFalse(initialization.initialization_required(snapshot=snapshot, prior_identity=None))
        face["active"] = False
        self.assertFalse(initialization.initialization_required(snapshot=snapshot, prior_identity=None))

    def test_partial_reset_and_multiface_remain_unsupported(self):
        snapshot, _ = window()
        snapshot["faces"][0]["smoothing"][0]["first"] = True
        with self.assertRaisesRegex(ValueError, "partial"):
            initialization.initialization_required(snapshot=snapshot, prior_identity=None)
        snapshot, _ = window()
        snapshot["faces"].append(dict(deepcopy(snapshot["faces"][0]), slot=1, id=2, alignment=69632))
        with self.assertRaisesRegex(ValueError, "single-face"):
            initialization.initialization_required(snapshot=snapshot, prior_identity=None)


if __name__ == "__main__":
    unittest.main()
