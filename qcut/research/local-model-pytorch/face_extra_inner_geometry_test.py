"""CPU receipt audits with independent scalar fixtures, not captured parity."""
import copy
import json
import struct
import unittest

import face_extra_crop_geometry as geometry
import face_extra_crop_trace as crop
import face_extra_inner_trace as inner
from face_extra_crop_geometry_test import rounded, scalar_inner
from face_extra_inner_trace_test import InnerTraceFixture


class DirectAuditFixture(InnerTraceFixture):
    use_heap_input = False

    def observer_payload(self):
        for address in (0x82000, 0x83000):
            self.memory[address] = struct.pack("<3f", 1, 0, 0)
            self.memory[address + 28] = struct.pack("<3f", 0, 1, 0)
        observer = self.direct_observer()
        self.start(observer=observer, prediction=0, bypass=1)
        self.boundary(observer=observer, name="after")
        self.start(observer=observer, prediction=1, bypass=0)
        inputs = [i / 8 + (0.75 if i % 2 else -0.375) for i in range(212)]
        if self.use_heap_input:
            self.heap_input(values=inputs + [1000 + i / 8 for i in range(348)])
        else:
            self.put_points(address=self.sp + 0x1b68, count=106, values=inputs)
        self.registers.update(self.arguments())
        self.boundary(observer=observer, name="inner_call")
        call = observer.inner_receipts[-1]["events"][0]
        before = call["inner_filter"]
        outputs = [scalar_inner(old=old, new=new, scale=before["scale"])
                   for old, new in zip(before["current_xy"], inputs, strict=True)]
        delta = [rounded(value=new - old) for old, new in zip(before["current_xy"], inputs, strict=True)]
        for address, values in ((0x70000, outputs), (0x71000, before["current_xy"]),
                                (0x72000, delta[::2]), (0x73000, delta[1::2])):
            self.memory[address] = bytearray(struct.pack(f"<{len(values)}f", *values))
        self.memory[self.filter + crop.STATE_ABI["first"]] = b"\0"
        self.put_points(address=self.sp + 0x1710, count=106, values=outputs)
        self.registers.update(x0=0, x1=0, x2=0, w0=222)
        self.boundary(observer=observer, name="inner_return")
        self.registers["w0"] = 0
        self.boundary(observer=observer, name="after")
        return dict(passed=True, target_memory_written=False, target_functions_evaluated=False,
                    software_breakpoints_used=False, extra_trace=observer.report())


class DirectReplayTests(DirectAuditFixture, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.payload = self.observer_payload()

    def test_actual_input_output_and_all_848_coordinate_state_values_match_scalar_fixture(self):
        original = copy.deepcopy(self.payload)
        report = geometry.audit_direct_inner_filter(observer=self.payload)
        self.assertEqual(self.payload, original)
        self.assertTrue(report["arithmetic_bits_equal"])
        self.assertTrue(report["direct_capture_complete"])
        self.assertEqual([case["mode"] for case in report["cases"]], ["proven-bypass", "direct-cubic-inner-update"])
        case = report["cases"][1]
        self.assertEqual(sum(case["checks"][key]["compared_values"] for key in
            ("output_xy", "current_xy", "previous_xy", "delta_x", "delta_y")), 848)
        self.assertTrue(case["actual_inner_call_arguments_captured"])
        self.assertFalse(case["native_stage2_matrices_used_as_arithmetic_input"])
        for key in ("owned_geometry_enabled", "geometry_parity_verified", "product_parity_verified"):
            self.assertIs(report[key], False)
        self.assertEqual(json.loads(json.dumps(report, allow_nan=False)), report)

    def test_existing_replay_entry_uses_direct_trace_when_present(self):
        self.assertEqual(geometry.audit_inner_filter(observer=self.payload),
                         geometry.audit_direct_inner_filter(observer=self.payload))

    def test_changed_return_state_is_reference_only_and_fails_bits(self):
        expected = geometry.audit_direct_inner_filter(observer=self.payload)["cases"][1]
        returned = self.payload["extra_trace"]["inner_filter_trace"]["receipts"][1]["events"][1]
        returned["inner_filter"]["current_xy"][0] += 1
        report = geometry.audit_direct_inner_filter(observer=self.payload)
        actual = report["cases"][1]
        self.assertFalse(report["arithmetic_bits_equal"])
        self.assertEqual(actual["output_sha256"], expected["output_sha256"])
        self.assertEqual(actual["input_sha256"], expected["input_sha256"])
        self.assertEqual(actual["checks"]["current_xy"]["mismatched_values"], 1)

    def test_changed_return_output_cannot_supply_arithmetic(self):
        expected = geometry.audit_direct_inner_filter(observer=self.payload)["cases"][1]
        returned = self.payload["extra_trace"]["inner_filter_trace"]["receipts"][1]["events"][1]
        returned["output"]["xy"][0] += 1
        actual = geometry.audit_direct_inner_filter(observer=self.payload)["cases"][1]
        self.assertFalse(actual["checks"]["output_xy"]["equal"])
        self.assertEqual(actual["output_sha256"], expected["output_sha256"])

    def test_stage2_reconstruction_is_separate_and_never_substitutes_for_actual_input(self):
        expected = geometry.audit_direct_inner_filter(observer=self.payload)["cases"][1]
        events = self.payload["extra_trace"]["events"]
        events[2]["snapshot"]["published_xy"][0] += 100
        events[2]["crop_geometry"]["published_xy"][0] += 100
        events[3]["snapshot"]["published_xy"][0] += 200
        events[3]["crop_geometry"]["published_xy"][0] += 200
        events[3]["crop_geometry"]["transforms"]["stage2"]["forward"][0][2] += 10
        events[3]["crop_geometry"]["inner_filter"]["current_xy"][0] += 50
        actual = geometry.audit_direct_inner_filter(observer=self.payload)["cases"][1]
        self.assertTrue(actual["arithmetic_bits_equal"])
        self.assertEqual(actual["output_sha256"], expected["output_sha256"])
        self.assertEqual(actual["input_sha256"], expected["input_sha256"])
        self.assertNotEqual(actual["reconstructed_vs_direct_input"], expected["reconstructed_vs_direct_input"])

    def test_changed_actual_input_changes_independent_output_without_correction(self):
        expected = geometry.audit_direct_inner_filter(observer=self.payload)["cases"][1]
        events = self.payload["extra_trace"]["inner_filter_trace"]["receipts"][1]["events"]
        for event in events:
            event["input"]["xy"][0] += 5
        actual = geometry.audit_direct_inner_filter(observer=self.payload)["cases"][1]
        self.assertNotEqual(actual["output_sha256"], expected["output_sha256"])
        self.assertFalse(actual["arithmetic_bits_equal"])

    def test_missing_or_unfinished_direct_evidence_fails_not_reconstructed_fallback(self):
        original = copy.deepcopy(self.payload)
        for key, value in (("schema", "other"), ("lens_sha256", "0" * 64), ("complete", False),
                            ("target_functions_evaluated", True), ("receipts", [])):
            self.payload = copy.deepcopy(original)
            self.payload["extra_trace"]["inner_filter_trace"][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                geometry.audit_inner_filter(observer=self.payload)
        self.payload = copy.deepcopy(original)
        self.payload["extra_trace"].pop("inner_filter_trace")
        with self.assertRaises(ValueError):
            geometry.audit_direct_inner_filter(observer=self.payload)

    def test_wrong_offsets_identity_policy_stack_layout_and_counts_rejected(self):
        original = copy.deepcopy(self.payload)
        for key, value in (("event", "call"), ("offset", inner.CALL), ("thread", 999),
                ("prediction", True), ("face_id", 8), ("sp", self.sp + 16), ("fp", self.fp + 16),
                ("filter_address", self.filter + 8), ("diagnostic_only", 1)):
            self.payload = copy.deepcopy(original)
            row = self.payload["extra_trace"]["inner_filter_trace"]["receipts"][1]["events"][1]
            row[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                geometry.audit_direct_inner_filter(observer=self.payload)
        for field in ("input", "output"):
            for key, value in (("address", 0), ("data", 0), ("capacity", 137), ("count", 105), ("xy", [])):
                self.payload = copy.deepcopy(original)
                row = self.payload["extra_trace"]["inner_filter_trace"]["receipts"][1]["events"][1]
                row[field][key] = value
                with self.subTest(field=field, key=key), self.assertRaises(ValueError):
                    geometry.audit_direct_inner_filter(observer=self.payload)

    def test_unpaired_duplicate_and_false_bypass_receipts_rejected(self):
        original = copy.deepcopy(self.payload)
        for change in ("missing", "duplicate", "false-bypass", "bypass-events", "incomplete"):
            self.payload = copy.deepcopy(original)
            receipts = self.payload["extra_trace"]["inner_filter_trace"]["receipts"]
            if change == "missing":
                receipts[1]["events"].pop()
            if change == "duplicate":
                receipts[1]["events"] *= 2
            if change == "false-bypass":
                receipts[1]["bypass_reason"] = "config-0xa-bit0"
            if change == "bypass-events":
                receipts[0]["events"] = receipts[1]["events"]
            if change == "incomplete":
                receipts[1]["complete"] = False
            with self.subTest(change=change), self.assertRaises(ValueError):
                geometry.audit_direct_inner_filter(observer=self.payload)

    def test_invalid_history_values_cannot_be_trusted_as_native_state(self):
        original = copy.deepcopy(self.payload)
        for key, value in (("count", True), ("count", 107), ("first", 1), ("scale", -1),
                            ("width", 0), ("delta_x", [float("nan")] * 106)):
            self.payload = copy.deepcopy(original)
            self.payload["extra_trace"]["inner_filter_trace"]["receipts"][1]["events"][0]["inner_filter"][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                geometry.audit_direct_inner_filter(observer=self.payload)


class HeapReplayTests(DirectAuditFixture, unittest.TestCase):
    use_heap_input = True

    def setUp(self):
        super().setUp()
        self.payload = self.observer_payload()

    def test_full_input_hash_and_explicit_106_consumption(self):
        import hashlib
        case = geometry.audit_direct_inner_filter(observer=self.payload)["cases"][1]
        inputs = self.payload["extra_trace"]["inner_filter_trace"]["receipts"][1]["events"][0]["input"]["xy"]
        self.assertTrue(case["arithmetic_bits_equal"])
        self.assertEqual((case["input_point_count"], case["consumed_point_count"], case["output_point_count"],
                          case["unconsumed_tail_point_count"]), (280, 106, 106, 174))
        self.assertEqual(case["input_sha256"], hashlib.sha256(struct.pack("<560f", *inputs)).hexdigest())
        self.assertEqual(case["consumed_input_sha256"], hashlib.sha256(struct.pack("<212f", *inputs[:212])).hexdigest())

    def test_unconsumed_tail_changes_full_hash_not_arithmetic_or_consumed_hash(self):
        expected = geometry.audit_direct_inner_filter(observer=self.payload)["cases"][1]
        for row in self.payload["extra_trace"]["inner_filter_trace"]["receipts"][1]["events"]:
            row["input"]["xy"][212] += 10
        actual = geometry.audit_direct_inner_filter(observer=self.payload)["cases"][1]
        self.assertTrue(actual["arithmetic_bits_equal"])
        self.assertNotEqual(actual["input_sha256"], expected["input_sha256"])
        self.assertEqual(actual["consumed_input_sha256"], expected["consumed_input_sha256"])
        self.assertEqual(actual["output_sha256"], expected["output_sha256"])

    def test_return_tail_mutation_is_not_treated_as_ignored(self):
        self.payload["extra_trace"]["inner_filter_trace"]["receipts"][1]["events"][1]["input"]["xy"][559] += 1
        with self.assertRaisesRegex(ValueError, "const input"):
            geometry.audit_direct_inner_filter(observer=self.payload)

    def test_return_output_and_state_remain_reference_only_for_heap_input(self):
        expected = geometry.audit_direct_inner_filter(observer=self.payload)["cases"][1]
        returned = self.payload["extra_trace"]["inner_filter_trace"]["receipts"][1]["events"][1]
        returned["output"]["xy"][0] += 1
        returned["inner_filter"]["current_xy"][0] += 1
        actual = geometry.audit_direct_inner_filter(observer=self.payload)["cases"][1]
        self.assertFalse(actual["arithmetic_bits_equal"])
        self.assertEqual(actual["input_sha256"], expected["input_sha256"])
        self.assertEqual(actual["output_sha256"], expected["output_sha256"])

    def test_heap_receipt_alias_capacity_and_unimplemented_branch_rejected(self):
        original = copy.deepcopy(self.payload)
        for kind in ("alias", "capacity", "near-zero", "empty", "consumed"):
            payload = copy.deepcopy(original)
            for row in payload["extra_trace"]["inner_filter_trace"]["receipts"][1]["events"]:
                if kind == "alias":
                    row["input"]["data"] = row["output"]["data"]
                if kind == "capacity":
                    row["input"]["capacity"] = 307
                if kind == "near-zero":
                    row["inner_filter"]["scale"] = 0
                if kind == "empty":
                    row["inner_filter"]["current_xy"] = []
                if kind == "consumed":
                    row["consumed_point_count"] = 280
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                geometry.audit_direct_inner_filter(observer=payload)


if __name__ == "__main__":
    unittest.main()
