"""Report-level smoothing provenance gates; no runtime or raw parity claim."""
from copy import deepcopy
import unittest

from face_temporal_capture_audit_test import fixture, point_metric
from face_host_geometry_smoothing_test import states
import face_temporal_capture_audit as audit


def inputs():
    value = fixture()
    replay = value["sequence_replay"]
    replay.update(owned_temporal_smoothing_used=True, native_smoothing_initialization_required=True,
                  native_smoothing_seed_predictions=[0, 20], post_tracking_gap_predictions=[14])
    for snapshot, case in zip(value["capture"]["geometry_snapshots"], replay["cases"], strict=True):
        index, face = snapshot["index"], snapshot["faces"][0]
        snapshot["runtime_state"] = dict(base_output_mode_bit=False, optimized_output_bit=False,
                                        config_cache_mode=0, cache_skip_bit=True, cache_counter=0)
        face["published"] = dict(record=131072, count=106, storage_points=106, capacity_points=106, points_xy=[0, 1] * 106)
        layer = case["native_output_layers"]
        if index == 14:
            layer.update(post_tracking_changed=True, tracked_to_returned=[point_metric(exact=False)])
        layer.update(published_observed=True, published_to_returned_exact=True,
                     tracked_to_published=deepcopy(layer["tracked_to_returned"]),
                     published_to_returned=[point_metric()] if face["active"] else [])
        if not face["active"]:
            case["temporal_smoothing"] = dict(passed=True, mode="no-face", native_seed_used=False, checks={})
            continue
        face["smoothing"] = states()
        first = index == 1
        for state in face["smoothing"]:
            state["first"] = first
        mode = "owned-input-initialization" if first else (
            "native-initialization-seed" if index in (0, 20) else "owned-history-update")
        case["temporal_smoothing"] = dict(passed=True, mode=mode, native_seed_used=index in (0, 20),
            native_initialization_signal_required=True, checks={name: point_metric()
            for name in (("current",) if first else ("current", "previous", "delta"))})
    return value


class SmoothingAuditTests(unittest.TestCase):
    def test_owned_output_can_pass_while_raw_tracked_is_intentionally_different(self):
        result = audit.audit_reports(**inputs())
        self.assertTrue(result["pipeline_parity"])
        self.assertTrue(result["stages"]["owned_smoothing"]["exact"])
        self.assertEqual(result["stages"]["owned_smoothing"]["compared"], 24)
        self.assertEqual(result["stages"]["tracked_to_returned"]["failed_indices"], [14])
        self.assertEqual(result["native_smoothing_seed_predictions"], [0, 20])
        self.assertFalse(result["full_frame_geometry_independent"])
        self.assertFalse(result["raw_evidence_revalidated"])

    def test_missing_checks_wrong_transitions_and_hidden_dependencies_reject(self):
        for variant in ("checks", "mode", "seed", "summary", "bool_summary", "dependency", "route", "undeclared", "published"):
            value = inputs()
            replay = value["sequence_replay"]
            evidence = replay["cases"][14]["temporal_smoothing"]
            if variant == "checks":
                evidence["checks"].pop("delta")
            elif variant == "mode":
                evidence["mode"] = "native-initialization-seed"
            elif variant == "seed":
                evidence["native_seed_used"] = True
            elif variant == "summary":
                replay["native_smoothing_seed_predictions"] = []
            elif variant == "bool_summary":
                replay["native_smoothing_seed_predictions"] = [False, 20]
            elif variant == "dependency":
                replay["native_smoothing_initialization_required"] = False
            elif variant == "route":
                value["capture"]["geometry_snapshots"][14]["runtime_state"]["optimized_output_bit"] = True
            elif variant == "undeclared":
                replay["owned_temporal_smoothing_used"] = False
            else:
                replay["cases"][14]["native_output_layers"].update(published_observed=False, published_to_returned_exact=None)
            with self.subTest(variant=variant), self.assertRaises(ValueError):
                audit.audit_reports(**value)

    def test_nonzero_state_error_never_promotes_passed(self):
        value = inputs()
        value["sequence_replay"]["cases"][14]["temporal_smoothing"]["checks"]["current"] = point_metric(exact=False)
        with self.assertRaisesRegex(ValueError, "aggregate"):
            audit.audit_reports(**value)

    def test_no_face_must_clear_history_and_not_hide_a_seed(self):
        for field, value in (("mode", "owned-history-update"), ("native_seed_used", True), ("checks", {"current": point_metric()})):
            rows = inputs()
            rows["sequence_replay"]["cases"][18]["temporal_smoothing"][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "no-face"):
                audit.audit_reports(**rows)


if __name__ == "__main__":
    unittest.main()
