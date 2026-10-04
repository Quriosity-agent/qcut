"""Ownership reports must prove cloning, rather than silently accept empty traces."""

import copy
import unittest

import face_owned_result_probe as probe


def audit(*, faces: int = 1) -> dict:
    return {"event": "face_clone_audit", "distinct_buffer": True,
            "initial_refcount": 0, "owned_refcount": 1, "source_refcount": 2,
            "vector_counts": [faces, 0, 0, 0, 0, 0], "primary_metadata_equal": True,
            "primary_points_isolated": True, "native_analysis_bypassed": False}


class CountTests(unittest.TestCase):
    def test_boundaries(self):
        for frames, warmup in ((1, 0), (24, 6)):
            probe.validate_counts(frames=frames, warmup=warmup)

    def test_invalid_counts(self):
        for frames in (0, 25, -1, True, 1.0):
            with self.subTest(frames=frames), self.assertRaises(ValueError):
                probe.validate_counts(frames=frames, warmup=0)
        for warmup in (-1, 7, False, 2.0):
            with self.subTest(warmup=warmup), self.assertRaises(ValueError):
                probe.validate_counts(frames=1, warmup=warmup)


class AuditTests(unittest.TestCase):
    def validate(self, *, item: dict, require_face: bool = True):
        return probe.validate_audits(events=[item, {"event": "algorithm_update"}],
                                     require_face=require_face)

    def test_complete_report(self):
        result = self.validate(item=audit())
        self.assertEqual(result["audited_clones"], 1)
        self.assertEqual(result["primary_faces_audited"], 1)
        self.assertFalse(result["native_analysis_bypassed"])

    def test_no_face_control_is_explicit(self):
        self.validate(item=audit(faces=0), require_face=False)
        with self.assertRaisesRegex(RuntimeError, "no primary face"):
            self.validate(item=audit(faces=0))

    def test_cold_consumer_audit_keeps_actual_update_count(self):
        events = [audit(), {"event": "live_owned_conversion"}, {"event": "algorithm_update"},
                  audit(), {"event": "live_owned_conversion"}]
        result = probe.validate_audits(events=events, require_face=True, require_live_consumers=True)
        self.assertEqual(result["audited_clones"], 2)
        self.assertEqual(result["native_update_calls"], 1)
        self.assertEqual(result["audit_basis"], "live-owned-conversion")
        with self.assertRaises(RuntimeError):
            probe.validate_audits(events=events, require_face=True)

    def test_inspection_does_not_count_as_live_consumption(self):
        with self.assertRaises(RuntimeError):
            probe.validate_audits(events=[audit(), {"event": "live_inspection_conversion"}],
                                  require_face=True, require_live_consumers=True)

    def test_missing_update_or_audit(self):
        for events in ([], [audit()], [{"event": "algorithm_update"}],
                       [audit(), audit(), {"event": "algorithm_update"}]):
            with self.subTest(events=events), self.assertRaises(RuntimeError):
                probe.validate_audits(events=events, require_face=False)

    def test_missing_contract_fields(self):
        for key in ("distinct_buffer", "initial_refcount", "owned_refcount", "source_refcount",
                    "vector_counts", "primary_metadata_equal", "primary_points_isolated",
                    "native_analysis_bypassed"):
            item = {name: value for name, value in audit().items() if name != key}
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                self.validate(item=item)

    def test_wrong_ownership_and_shared_storage(self):
        for key, value in (("distinct_buffer", False), ("initial_refcount", 1),
                           ("initial_refcount", False), ("owned_refcount", 2),
                           ("owned_refcount", True), ("source_refcount", 0),
                           ("source_refcount", True), ("primary_metadata_equal", False),
                           ("primary_points_isolated", False), ("native_analysis_bypassed", True)):
            item = audit()
            item[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(RuntimeError):
                self.validate(item=item)

    def test_bounded_exact_vector_schema(self):
        for counts in (None, [], [1] * 5, [1] * 7, [11, 0, 0, 0, 0, 0],
                       [-1, 0, 0, 0, 0, 0], [True, 0, 0, 0, 0, 0], [1.0, 0, 0, 0, 0, 0]):
            item = copy.deepcopy(audit())
            item["vector_counts"] = counts
            with self.subTest(counts=counts), self.assertRaises(RuntimeError):
                self.validate(item=item)


if __name__ == "__main__":
    unittest.main()
