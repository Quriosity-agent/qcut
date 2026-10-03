"""Owned seed report gates; synthetic reports are not fresh native parity."""
from copy import deepcopy
import unittest

from face_temporal_capture_audit_test import point_metric
from face_temporal_smoothing_audit_test import inputs as smoothing_inputs
import face_temporal_capture_audit as audit


def inputs():
    value = smoothing_inputs()
    replay = value["sequence_replay"]
    replay.update(owned_initialization_used=True, native_smoothing_seed_required=False,
                  independent_160_sampling_input_used=False, native_160_sampling_input_required=True,
                  native_smoothing_seed_predictions=[], owned_smoothing_seed_predictions=[0, 20])
    for snapshot, association, case in zip(value["capture"]["geometry_snapshots"],
            value["capture"]["prediction_inferences"], replay["cases"], strict=True):
        seeded = snapshot["index"] in (0, 20)
        state = case["temporal_smoothing"]
        state.update(owned_seed_used=seeded, native_seed_used=False)
        if not seeded:
            continue
        state["mode"] = "owned-initialization-seed"
        face = snapshot["faces"][0]
        inferred = next(item for item in association["inferences"] if item["size"] == 160)
        case["owned_initialization"] = dict(prediction=snapshot["index"], id=face["id"], slot=face["slot"],
            inference=inferred["inference"], network=inferred["network"], source="onnx-160-detection-backmap",
            passed=True, check=point_metric(), native_point_seed_used=False, native_detection_geometry_required=True)
    return value


class InitializationAuditTests(unittest.TestCase):
    def test_two_owned_seeds_remove_point_seed_dependency_but_not_native_inputs(self):
        value = inputs()
        original = deepcopy(value)
        result = audit.audit_reports(**value)
        self.assertTrue(result["pipeline_parity"])
        self.assertTrue(result["owned_initialization_used"])
        self.assertFalse(result["native_smoothing_seed_required"])
        self.assertEqual(result["native_smoothing_seed_predictions"], [])
        self.assertEqual(result["owned_smoothing_seed_predictions"], [0, 20])
        self.assertEqual(result["stages"]["owned_initialization"]["compared"], 2)
        self.assertTrue(result["stages"]["owned_initialization"]["exact"])
        self.assertTrue(result["native_160_sampling_input_required"])
        self.assertTrue(result["native_smoothing_initialization_required"])
        self.assertFalse(result["independent_160_sampling_input_used"])
        self.assertFalse(result["full_frame_geometry_independent"])
        self.assertFalse(result["raw_evidence_revalidated"])
        self.assertEqual(value, original)

    def test_seed_proof_typing_identity_and_source_cannot_be_forged(self):
        variants = dict(prediction=20, id=False, slot=1, inference=1, network="32768",
                        source="native-previous", passed=1, native_point_seed_used=True,
                        native_detection_geometry_required=False, check=point_metric(exact=False))
        for key, replacement in variants.items():
            value = inputs()
            value["sequence_replay"]["cases"][0]["owned_initialization"][key] = replacement
            with self.subTest(key=key), self.assertRaises(ValueError):
                audit.audit_reports(**value)

    def test_seed_requires_actual_160_prediction_association(self):
        value = inputs()
        value["capture"]["prediction_inferences"][0]["inferences"] = [
            item for item in value["capture"]["prediction_inferences"][0]["inferences"] if item["size"] == 120]
        with self.assertRaisesRegex(ValueError, "actual 160"):
            audit.audit_reports(**value)

    def test_missing_proof_and_undeclared_extra_proof_reject(self):
        for variant in ("missing", "history", "first", "no-face", "undeclared"):
            value = inputs()
            replay = value["sequence_replay"]
            if variant == "missing":
                replay["cases"][0].pop("owned_initialization")
            elif variant == "undeclared":
                replay["owned_initialization_used"] = False
            else:
                index = {"history": 2, "first": 1, "no-face": 18}[variant]
                replay["cases"][index]["owned_initialization"] = deepcopy(replay["cases"][0]["owned_initialization"])
            with self.subTest(variant=variant), self.assertRaises(ValueError):
                audit.audit_reports(**value)

    def test_owned_seed_declarations_and_summaries_remain_strict(self):
        for variant in ("missing", "bool", "native", "wrong-summary", "bool-summary", "empty-summary", "dependency", "no-smoothing"):
            value = inputs()
            replay = value["sequence_replay"]
            state = replay["cases"][0]["temporal_smoothing"]
            if variant == "missing":
                state.pop("owned_seed_used")
            elif variant == "bool":
                state["owned_seed_used"] = 1
            elif variant == "native":
                state["native_seed_used"] = True
            elif variant.endswith("summary"):
                replay["owned_smoothing_seed_predictions"] = {
                    "wrong-summary": [0], "bool-summary": [False, 20], "empty-summary": []}[variant]
            elif variant == "dependency":
                replay["native_smoothing_seed_required"] = True
            else:
                replay["owned_temporal_smoothing_used"] = False
            with self.subTest(variant=variant), self.assertRaises(ValueError):
                audit.audit_reports(**value)

    def test_no_face_never_preserves_owned_seed_state(self):
        value = inputs()
        value["sequence_replay"]["cases"][18]["temporal_smoothing"]["owned_seed_used"] = True
        with self.assertRaisesRegex(ValueError, "no-face"):
            audit.audit_reports(**value)

    def test_unverified_160_sampler_is_never_promoted(self):
        for owned in (False, True):
            value = inputs() if owned else smoothing_inputs()
            value["sequence_replay"]["independent_160_sampling_input_used"] = True
            with self.subTest(owned=owned), self.assertRaisesRegex(ValueError, "160 sampler"):
                audit.audit_reports(**value)

    def test_native_input_dependency_and_switch_types_cannot_disappear(self):
        for key, replacement in (("native_160_sampling_input_required", False),
                                 ("owned_initialization_used", 1), ("independent_160_sampling_input_used", 0)):
            value = inputs()
            value["sequence_replay"][key] = replacement
            with self.subTest(key=key), self.assertRaises(ValueError):
                audit.audit_reports(**value)


if __name__ == "__main__":
    unittest.main()
