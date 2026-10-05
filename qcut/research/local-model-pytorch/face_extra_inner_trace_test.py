"""Synthetic stopped memory and breakpoint rotation; never native parity evidence."""
import copy
from pathlib import Path
import struct
import tempfile
import unittest
from unittest import mock

import face_extra_inner_trace as inner
import face_extra_crop_trace as crop
import face_live_extra_model_trace as model
import face_live_extra_trace as trace
from face_extra_crop_trace_test import CropMemoryFixture
from face_live_extra_trace_test import TraceFixture


class InnerMemoryFixture(CropMemoryFixture):
    def setUp(self):
        super().setUp()
        self.memory[self.runtime + 0x114] = b"\0"
        self.sp, self.fp = 0xb0000, 0xb3000
        self.native_scope = self.scope()
        self.put_points(address=self.sp + 0x1b68, count=106)
        self.put_points(address=self.sp + 0x1710, count=0)

    def put_points(self, *, address, count, values=None):
        self.memory[address] = struct.pack("<2Q", address + 16, 136)
        self.memory[address + 0x450] = struct.pack("<Q", count)
        if count:
            self.memory[address + 16] = bytearray(struct.pack(f"<{count * 2}f",
                *(values if values is not None else [i / 8 for i in range(count * 2)])))

    def arguments(self):
        return dict(x0=self.filter, x1=self.sp + 0x1b68, x2=self.sp + 0x1710, sp=self.sp, fp=self.fp)

    def heap_input(self, *, values=None):
        address, data = self.sp + 0x1b68, 0xc0000
        self.memory[address] = struct.pack("<2Q", data, 306)
        self.memory[address + 0x450] = struct.pack("<Q", 280)
        self.memory[data] = bytearray(struct.pack("<560f", *(values if values is not None else [i / 8 for i in range(560)])))
        return data

    def direct(self, *, event="call", previous=None, registers=None):
        return inner.capture(read=self.read, scope=self.native_scope, crop=self.capture(),
            prediction=0, thread=42, event=event, previous=previous,
            registers=self.arguments() if registers is None else registers)


class DirectMemoryTests(InnerMemoryFixture, unittest.TestCase):
    def test_actual_point136_input_and_empty_output_read_exact_payload(self):
        result = self.direct()
        self.assertEqual(result["offset"], inner.CALL)
        self.assertEqual(result["input"]["xy"], [i / 8 for i in range(212)])
        self.assertEqual(result["output"]["xy"], [])
        self.assertIn((self.sp + 0x1b68 + 0x450, 8), self.reads)
        self.assertNotIn((self.sp + 0x1b68 + 0x430, 8), self.reads)
        self.assertNotIn((self.sp + 0x1710 + 16, 0), self.reads)
        self.assertNotIn(self.source_data, [address for address, _ in self.reads])
        self.assertLess(result["read_budget"]["calls"], inner.READ_CALLS)
        self.assertLess(result["read_budget"]["bytes"], inner.READ_BYTES)

    def test_return_uses_saved_pointers_not_clobbered_registers_and_copies_are_detached(self):
        call = self.direct()
        saved = copy.deepcopy(call)
        self.put_points(address=self.sp + 0x1710, count=106)
        returned = self.direct(event="return", previous=call, registers=dict(sp=self.sp, fp=self.fp))
        self.assertEqual(returned["offset"], inner.RETURN)
        self.assertNotIn("return_code", returned)
        self.assertEqual(returned["output"]["count"], 106)
        struct.pack_into("<f", self.memory[self.sp + 0x1b68 + 16], 0, 99)
        returned["input"]["xy"][0] = 55
        self.assertEqual(call, saved)

    def test_const_input_signed_zero_mutation_rejected(self):
        call = self.direct()
        self.put_points(address=self.sp + 0x1710, count=106)
        struct.pack_into("<I", self.memory[self.sp + 0x1b68 + 16], 0, 0x80000000)
        with self.assertRaisesRegex(ValueError, "const direct inner input changed"):
            self.direct(event="return", previous=call)

    def test_pointer_count_and_capacity_fail_before_payload(self):
        address = self.sp + 0x1b68
        for pointer, capacity, count in ((0, 136, 106), (address + 20, 136, 106),
                (address + 16, 137, 106), (address + 16, 105, 106), (address + 16, 136, 105)):
            self.memory[address] = struct.pack("<2Q", pointer, capacity)
            self.memory[address + 0x450] = struct.pack("<Q", count)
            self.reads.clear()
            with self.subTest(pointer=pointer, capacity=capacity, count=count), self.assertRaises(ValueError):
                inner.point_vector(read=self.read, address=address, count=106)
            self.assertNotIn((address + 16, 848), self.reads)

    def test_unmapped_old_count_offset_cannot_substitute_for_point_count(self):
        address = self.sp + 0x1b68
        self.memory[address + 0x430] = struct.pack("<Q", 106)
        self.memory.pop(address + 0x450)
        with self.assertRaises(ValueError):
            inner.point_vector(read=self.read, address=address, count=106)

    def test_failed_descriptor_records_actual_values_without_accepting_heap_layout(self):
        address, begin = self.sp + 0x1b68, 0xdead000
        self.memory[address] = struct.pack("<2Q", begin, 306)
        self.memory[address + 0x450] = struct.pack("<Q", 280)
        self.reads.clear()
        with self.assertRaises(ValueError) as raised:
            inner.point_vector(read=self.read, address=address, count=106)
        self.assertEqual(str(raised.exception),
            f"unsupported inline Point136 AutoVector: address={address:#x}, begin={begin:#x}, "
            "capacity=306, size=280, expected_count=106")
        self.assertEqual(self.reads, [(address, 16), (address + 0x450, 8)])

    def test_output_descriptor_failure_keeps_expected_zero_count(self):
        address = self.sp + 0x1710
        self.memory[address + 0x450] = struct.pack("<Q", 106)
        self.reads.clear()
        with self.assertRaises(ValueError) as raised:
            inner.point_vector(read=self.read, address=address, count=0)
        self.assertEqual(str(raised.exception),
            f"unsupported inline Point136 AutoVector: address={address:#x}, begin={address + 16:#x}, "
            "capacity=136, size=106, expected_count=0")
        self.assertEqual(self.reads, [(address, 16), (address + 0x450, 8)])

    def test_count_does_not_read_spare_capacity(self):
        address = self.sp + 0x1b68
        self.reads.clear()
        inner.point_vector(read=self.read, address=address, count=106)
        self.assertEqual(self.reads, [(address, 16), (address + 0x450, 8), (address + 16, 848)])

    def test_signed_zero_subnormal_and_finite_guards(self):
        address = self.sp + 0x1b68 + 16
        self.memory[address][:12] = struct.pack("<3I", 0x80000000, 1, 0x80000001)
        values = self.direct()["input"]["xy"][:3]
        self.assertEqual(struct.pack("<3f", *values), bytes(self.memory[address][:12]))
        for value in (float("nan"), float("inf"), 32769):
            struct.pack_into("<f", self.memory[address], 0, value)
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.direct()

    def test_exact_filter_stack_and_vector_argument_ownership(self):
        for key in ("x0", "x1", "x2", "sp", "fp"):
            registers = self.arguments()
            registers[key] += 8
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.direct(registers=registers)

    def test_wrong_return_stack_prediction_face_or_output_storage_rejected(self):
        call = self.direct()
        self.put_points(address=self.sp + 0x1710, count=106)
        for key in ("sp", "fp", "thread", "prediction", "face_id"):
            previous = dict(call, **{key: call[key] + 16})
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "unpaired"):
                self.direct(event="return", previous=previous)
        self.memory[self.sp + 0x1710] = struct.pack("<2Q", self.sp + 0x1710 + 16, 106)
        with self.assertRaisesRegex(ValueError, "output ownership"):
            self.direct(event="return", previous=call)

    def test_bypass_reasons_use_actual_flag_bits(self):
        crop = self.capture()
        self.assertIsNone(inner.route(crop=crop))
        for field, key, value, expected in (("face_bytes", "0x4d", 1, "face-0x4d-bit0"),
                ("config_bytes", "0x0", 2, "config-0x0-bit0-clear"),
                ("config_bytes", "0xa", 3, "config-0xa-bit0")):
            changed = copy.deepcopy(crop)
            changed[field][key] = value
            self.assertEqual(inner.route(crop=changed), expected)
        crop["face_bytes"]["0x4d"] = 2
        crop["config_bytes"]["0xa"] = 2
        self.assertIsNone(inner.route(crop=crop))

    def test_missing_face_branch_or_unsupported_routing_fails(self):
        for field, key, value in (("face_bytes", "0x4d", None), ("config_bytes", "0x4", 0),
                ("config_bytes", "0xb", 1), ("config_bytes", "0x20", 1),
                ("config_bytes", "0x21", 1), ("face_modes", "0x68", 1)):
            crop = self.capture()
            crop[field][key] = value
            with self.subTest(field=field, key=key), self.assertRaises(ValueError):
                inner.route(crop=crop)

    def test_routing_changed_at_call_fails(self):
        crop = self.capture()
        self.memory[self.registers["x3"] + 0xa] = b"\1"
        with self.assertRaisesRegex(ValueError, "routing changed"):
            inner.capture(read=self.read, scope=self.native_scope, crop=crop, prediction=0,
                          thread=42, event="call", registers=self.arguments())

    def test_observed_heap280_reads_only_560_floats_and_returns_inline106(self):
        data = self.heap_input()
        call = self.direct()
        self.assertEqual((call["input"]["count"], call["input"]["capacity"]), (280, 306))
        self.assertEqual(len(call["input"]["xy"]), 560)
        self.assertIn((data, 2240), self.reads)
        self.assertNotIn((data, 2448), self.reads)
        self.assertEqual(call["consumed_point_count"], 106)
        self.put_points(address=self.sp + 0x1710, count=106)
        returned = self.direct(event="return", previous=call)
        self.assertEqual(returned["input"], call["input"])
        self.assertEqual((returned["output"]["count"], returned["output"]["capacity"]), (106, 136))

    def test_heap_input_tail_is_const_even_when_not_consumed(self):
        data = self.heap_input()
        call = self.direct()
        self.put_points(address=self.sp + 0x1710, count=106)
        struct.pack_into("<f", self.memory[data], 212 * 4, 99)
        with self.assertRaisesRegex(ValueError, "const direct inner input"):
            self.direct(event="return", previous=call)

    def test_heap_layout_capacity_count_alignment_overflow_and_aliases_rejected_before_payload(self):
        address = self.sp + 0x1b68
        for begin, capacity, count in ((0xc0000, 305, 280), (0xc0000, 307, 280),
                (0xc0000, 306, 279), (0xc0000, 306, 106), (0xc0004, 306, 280),
                (inner.MAX_ADDRESS - 7, 306, 280), (address + 16, 306, 280),
                (self.sp + 0x1710 + 16, 306, 280), (self.filter, 306, 280),
                (0x70000, 306, 280), (0x70000 - 2440, 306, 280)):
            self.memory[address] = struct.pack("<2Q", begin, capacity)
            self.memory[address + 0x450] = struct.pack("<Q", count)
            self.reads.clear()
            with self.subTest(begin=begin, capacity=capacity, count=count), self.assertRaises(ValueError):
                self.direct()
            self.assertNotIn((begin, 2240), self.reads)

    def test_unimplemented_empty_or_near_zero_branch_fails_before_input_payload(self):
        data = self.heap_input()
        for scale in (0, 1e-6):
            self.memory[self.filter + crop.STATE_ABI["scale"]] = struct.pack("<f", scale)
            self.reads.clear()
            with self.assertRaisesRegex(ValueError, "near-zero"):
                self.direct()
            self.assertNotIn((data, 2240), self.reads)
        for key in ("count", "width", "height"):
            self.memory[self.filter + crop.STATE_ABI[key]] = struct.pack("<i", 0)
        for key in ("current", "previous", "delta_x", "delta_y"):
            self.memory[self.filter + crop.STATE_ABI[key]] = bytes(24)
        with self.assertRaisesRegex(ValueError, "initialized primary106"):
            self.direct()


class InnerTraceFixture(InnerMemoryFixture, TraceFixture):
    def setUp(self):
        super().setUp()
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name) / "models"
        self.registers.update(x1=self.source, x2=self.parameter, sp=self.sp, fp=self.fp)
        self.frame.GetPC.return_value = self.base + trace.CALL
        patch = mock.patch.object(model, "snapshot", return_value=None)
        patch.start()
        self.addCleanup(patch.stop)

    def direct_observer(self, *, proxy=None):
        return trace.ExtraTrace(target=self.target, point_breakpoint=proxy or self.point,
            callback="test.on_extra", inner_model=True, model_directory=self.directory)

    def boundary(self, *, observer, name):
        offsets = dict(before=trace.CALL, after=trace.RETURN, inner_call=inner.CALL, inner_return=inner.RETURN)
        self.frame.GetPCAddress.return_value.GetFileAddress.return_value = offsets[name]
        self.location.GetBreakpoint.return_value = observer.breakpoints[name]
        observer.observe(frame=self.frame, location=self.location, read=self.read)

    def start(self, *, observer, prediction, bypass):
        self.registers.update(x0=self.alignment, x1=self.source, x2=self.parameter)
        self.memory[self.native_scope["configs"] + 0xa] = bytes([bypass])
        self.begin(observer=observer, prediction=prediction)
        self.boundary(observer=observer, name="before")

    def inner_pair(self, *, observer):
        self.registers.update(self.arguments())
        self.boundary(observer=observer, name="inner_call")
        self.put_points(address=self.sp + 0x1710, count=106)
        self.registers.update(x0=0, x1=0, x2=0, w0=999)
        self.boundary(observer=observer, name="inner_return")
        self.registers["w0"] = 0


class DirectRotationTests(InnerTraceFixture, unittest.TestCase):
    def test_bypass_then_actual_pair_keeps_four_stage2_events_and_four_enabled_slots(self):
        observer = self.direct_observer()
        self.start(observer=observer, prediction=0, bypass=1)
        self.assertEqual(observer.armed, "after")
        self.boundary(observer=observer, name="after")
        self.start(observer=observer, prediction=1, bypass=0)
        self.assertEqual(observer.armed, "inner_call")
        self.inner_pair(observer=observer)
        self.boundary(observer=observer, name="after")
        report = observer.report()
        self.assertTrue(report["complete"])
        self.assertEqual(len(report["events"]), 4)
        receipts = report["inner_filter_trace"]["receipts"]
        self.assertEqual(receipts[0]["bypass_reason"], "config-0xa-bit0")
        self.assertEqual(receipts[0]["events"], [])
        self.assertEqual([row["event"] for row in receipts[1]["events"]], ["call", "return"])
        inner.validate_trace(trace=report["inner_filter_trace"], events=report["events"])
        self.assertLessEqual(max(self.active_counts), 4)
        self.assertTrue(self.point.IsEnabled())

    def test_point_proxy_requires_only_setenabled(self):
        proxy = mock.Mock(spec_set=["SetEnabled"])
        proxy.SetEnabled.side_effect = self.point.SetEnabled
        observer = self.direct_observer(proxy=proxy)
        self.start(observer=observer, prediction=0, bypass=0)
        self.inner_pair(observer=observer)
        self.assertFalse(self.point.IsEnabled())
        self.boundary(observer=observer, name="after")
        self.assertTrue(self.point.IsEnabled())
        self.assertEqual(proxy.SetEnabled.call_args, mock.call(True))

    def test_missing_return_never_completes_or_rearms_points(self):
        observer = self.direct_observer()
        self.start(observer=observer, prediction=0, bypass=0)
        self.registers.update(self.arguments())
        self.boundary(observer=observer, name="inner_call")
        with self.assertRaisesRegex(ValueError, "missing direct inner return"):
            self.boundary(observer=observer, name="after")
        self.assertFalse(observer.report()["complete"])
        self.assertFalse(self.point.IsEnabled())

    def test_duplicate_or_wrong_order_inner_boundaries_fail(self):
        observer = self.direct_observer()
        self.start(observer=observer, prediction=0, bypass=0)
        with self.assertRaisesRegex(ValueError, "unexpected direct inner"):
            self.boundary(observer=observer, name="inner_return")
        self.registers.update(self.arguments())
        self.boundary(observer=observer, name="inner_call")
        with self.assertRaisesRegex(ValueError, "unexpected direct inner"):
            self.boundary(observer=observer, name="inner_call")

    def test_bypass_cannot_receive_inner_events(self):
        observer = self.direct_observer()
        self.start(observer=observer, prediction=0, bypass=1)
        with self.assertRaisesRegex(ValueError, "unexpected direct inner"):
            self.boundary(observer=observer, name="inner_call")

    def test_inner_callback_wrong_thread_rejected(self):
        observer = self.direct_observer()
        self.start(observer=observer, prediction=0, bypass=0)
        self.registers.update(self.arguments())
        self.frame.GetThread.return_value.GetThreadID.return_value = 999
        with self.assertRaisesRegex(ValueError, "thread/breakpoint"):
            self.boundary(observer=observer, name="inner_call")


if __name__ == "__main__":
    unittest.main()
