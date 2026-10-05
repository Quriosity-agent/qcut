"""CPU-only bounded Extra snapshots and hardware-observer state transitions."""
import copy
import struct
import unittest
from unittest import mock

import face_live_extra_trace as trace


class MemoryFixture:
    def setUp(self):
        self.owner, self.alignment, self.runtime = 0x10000, 0x30000, 0x20000
        self.registers = dict(x0=self.alignment, x3=self.owner + 0x7e58,
                              x4=self.owner + 0x7a40, x5=self.runtime, w0=0)
        self.memory, self.reads = {}, []
        self.memory[self.owner + 0x7c00] = struct.pack("<3Q", self.runtime, self.runtime + 4000,
                                                     self.runtime + 4000)
        self.memory[self.runtime] = struct.pack("<Q", self.alignment)
        self.memory[self.runtime + 8] = b"\x01"
        self.memory[self.runtime + 12] = struct.pack("<i", 7)
        self.memory[self.alignment + 0x934] = struct.pack("<I", 0x123456)
        for offset in (0, 4, 0xa, 0xb, 0x20, 0x21):
            self.memory[self.registers["x3"] + offset] = bytes([offset])
        for offset, value in ((0x3c, 4), (0x68, 2)):
            self.memory[self.registers["x4"] + offset] = struct.pack("<i", value)
        self.memory[self.runtime + 0x114] = b"\x01"
        self.put_matrix(address=self.alignment + 0xaa8, data=0x50000, cols=106)
        self.put_matrix(address=self.alignment + 0xb08, data=0x51000, cols=280)
        self.put_matrix(address=self.alignment + 0x1238, data=0x52000, cols=3)
        self.vector = 0x53000
        self.memory[self.runtime + 0x38] = struct.pack("<3Q", self.vector, self.vector + 2240,
                                                    self.vector + 2240)
        self.memory[self.vector] = bytearray(struct.pack("<560f", *range(560)))

    def put_matrix(self, *, address, data, cols, stride=None):
        stride = cols * 4 + 16 if stride is None else stride
        self.memory[address] = trace.MAT_HEADER.pack(0x42ff0005, 2, 2, cols, data,
                                                    0, 0, 0, 0, 0, 0, 0, stride, 4)
        for row in range(2):
            values = [row * 1000 + index / 4 for index in range(cols)]
            self.memory[data + row * stride] = bytearray(struct.pack(f"<{cols}f", *values))

    def read(self, *, address, size):
        self.reads.append((address, size))
        result = self.memory[address]
        if len(result) != size:
            raise ValueError("fixture read exceeds mapped span")
        return result

    def scope(self):
        return trace.context(read=self.read, registers=self.registers, owner=self.owner)


class BoundedMemoryTests(MemoryFixture, unittest.TestCase):
    def test_matrix_reads_only_two_float_rows_not_unmapped_padding(self):
        address = self.alignment + 0xaa8
        values = trace.matrix(read=self.read, address=address, columns=(106,))
        self.assertEqual(values[0], [index / 4 for index in range(106)])
        self.assertEqual(values[1], [1000 + index / 4 for index in range(106)])
        self.assertEqual(self.reads, [(address, trace.MAT_HEADER.size), (0x50000, 424),
                                     (0x50000 + 440, 424)])

    def test_matrix_supported_columns_and_maximum_stride(self):
        for count in (3, 106, 280):
            with self.subTest(count=count):
                self.put_matrix(address=0x60000, data=0x61000, cols=count, stride=4096)
                value = trace.matrix(read=self.read, address=0x60000, columns=(count,))
                self.assertEqual([len(row) for row in value], [count, count])
                self.assertEqual(self.reads[-1], (0x62000, count * 4))

    def test_bad_matrix_dimensions_flags_and_strides_fail_before_payload(self):
        address = self.alignment + 0xaa8
        fields = list(trace.MAT_HEADER.unpack(self.memory[address]))
        for index, bad in ((0, 6), (1, 1), (1, 3), (2, 1), (2, 3), (3, 0), (3, -1),
                           (3, 105), (3, 281), (12, 0), (12, 423), (12, 4097), (13, 8)):
            changed = fields.copy()
            changed[index] = bad
            self.memory[address] = trace.MAT_HEADER.pack(*changed)
            self.reads.clear()
            with self.subTest(index=index, bad=bad), self.assertRaisesRegex(ValueError, "descriptor"):
                trace.matrix(read=self.read, address=address, columns=(106,))
            self.assertEqual(self.reads, [(address, trace.MAT_HEADER.size)])

    def test_nonfinite_or_unbounded_matrix_coordinates_rejected(self):
        for bad in (float("nan"), float("inf"), -float("inf"), 32769, -32769):
            struct.pack_into("<f", self.memory[0x50000], 0, bad)
            with self.subTest(bad=bad), self.assertRaisesRegex(ValueError, "finite bounded"):
                trace.matrix(read=self.read, address=self.alignment + 0xaa8, columns=(106,))

    def test_checked_reads_reject_bad_address_short_nonbytes_and_reader_errors(self):
        for address in (0, 4095, True, (1 << 64) - 2):
            read = mock.Mock(return_value=b"\0" * 4)
            with self.subTest(address=address), self.assertRaises(ValueError):
                trace.floats(read=read, address=address, count=1)
            read.assert_not_called()
        for result in (b"\0" * 3, b"\0" * 5, "0000", None):
            with self.subTest(result=result), self.assertRaises(ValueError):
                trace.floats(read=mock.Mock(return_value=result), address=4096, count=1)
        with self.assertRaisesRegex(ValueError, "remote memory read failed"):
            trace.scalar(read=mock.Mock(side_effect=OSError("unmapped")), address=4096, kind="<I")

    def test_float_budget_is_strict_and_coordinate_endpoints_are_allowed(self):
        for count in (0, -1, 561, True, 1.0, "2"):
            read = mock.Mock()
            with self.subTest(count=count), self.assertRaisesRegex(ValueError, "float count"):
                trace.floats(read=read, address=4096, count=count)
            read.assert_not_called()
        read = mock.Mock(return_value=struct.pack("<2f", -32768, 32768))
        self.assertEqual(trace.floats(read=read, address=4096, count=2), [-32768, 32768])

    def test_vectors_accept_only_106_or_280_xy_pairs(self):
        for count in (106, 280):
            for capacity in (count * 8, 4096):
                self.memory[self.runtime + 0x38] = struct.pack("<3Q", self.vector,
                    self.vector + count * 8, self.vector + capacity)
                self.memory[self.vector] = struct.pack(f"<{count * 2}f", *range(count * 2))
                with self.subTest(count=count, capacity=capacity):
                    self.assertEqual(trace.points(read=self.read, runtime=self.runtime), list(range(count * 2)))
                    self.assertEqual(self.reads[-1], (self.vector, count * 8))

    def test_vector_descriptors_fail_before_any_point_read(self):
        start = self.vector
        bad_vectors = [(0, 848, 848), (start + 1, start + 849, start + 849),
            (start, start - 8, start), (start, start, start), (start, start + 840, start + 848),
            (start, start + 2248, start + 2248), (start, start + 848, start + 840),
            (start, start + 848, start + 4097), (start, start + 848, start + 852)]
        for value in bad_vectors:
            self.memory[self.runtime + 0x38] = struct.pack("<3Q", *value)
            self.reads.clear()
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "point vector"):
                trace.points(read=self.read, runtime=self.runtime)
            self.assertEqual(self.reads, [(self.runtime + 0x38, 24)])

    def test_vector_nonfinite_coordinates_are_rejected(self):
        for value in (float("nan"), float("inf"), 65536):
            struct.pack_into("<f", self.memory[self.vector], 0, value)
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "finite bounded"):
                trace.points(read=self.read, runtime=self.runtime)


class ContextAndSnapshotTests(MemoryFixture, unittest.TestCase):
    def test_context_binds_exact_owner_pool_alignment_and_face(self):
        scope = self.scope()
        self.assertEqual(scope, dict(owner=self.owner, alignment=self.alignment, runtime=self.runtime,
            face_id=7, configs=self.registers["x3"], face_config=self.registers["x4"]))
        original = self.runtime
        self.runtime = original + 9 * 400
        self.registers["x5"] = self.runtime
        for offset in (0, 8, 12):
            self.memory[self.runtime + offset] = self.memory[original + offset]
        self.assertEqual(self.scope()["runtime"], self.runtime)

    def test_configuration_owner_mismatch_never_reads_memory(self):
        for key in ("x3", "x4"):
            registers = dict(self.registers, **{key: self.registers[key] + 8})
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "configuration owner"):
                trace.context(read=self.read, registers=registers, owner=self.owner)
        self.assertEqual(self.reads, [])

    def test_pool_bounds_slot_alignment_and_capacity_are_guarded(self):
        start = self.runtime
        for begin, end, capacity, runtime in ((0, 4000, 4000, start),
                (start, start + 3999, start + 3999, start),
                (start, start + 4000, start + 4008, start),
                (start, start + 4000, start + 4000, start - 400),
                (start, start + 4000, start + 4000, start + 4000),
                (start, start + 4000, start + 4000, start + 4)):
            self.memory[self.owner + 0x7c00] = struct.pack("<3Q", begin, end, capacity)
            self.registers["x5"] = runtime
            with self.subTest(runtime=runtime, end=end), self.assertRaisesRegex(ValueError, "owner pool"):
                self.scope()

    def test_inactive_uninitialized_wrong_alignment_and_negative_face_rejected(self):
        for address, value, message in ((self.runtime, struct.pack("<Q", self.alignment + 16), "initialized"),
                (self.runtime + 8, b"\x00", "initialized"),
                (self.runtime + 8, b"\x02", "initialized"),
                (self.alignment + 0x934, struct.pack("<I", 0), "initialized"),
                (self.runtime + 12, struct.pack("<i", -1), "face ID")):
            original = self.memory[address]
            self.memory[address] = value
            with self.subTest(address=address, value=value), self.assertRaisesRegex(ValueError, message):
                self.scope()
            self.memory[address] = original

    def test_snapshots_copy_all_matrices_vector_and_modes(self):
        scope = self.scope()
        before = trace.snapshot(read=self.read, scope=scope)
        original = copy.deepcopy(before)
        for address in (0x50000, 0x51000, 0x52000, self.vector):
            struct.pack_into("<f", self.memory[address], 0, 25)
        self.memory[self.registers["x3"]] = b"\x07"
        self.memory[self.registers["x4"] + 0x3c] = struct.pack("<i", 0)
        self.memory[self.runtime + 0x114] = b"\x00"
        after = trace.snapshot(read=self.read, scope=scope)
        self.assertEqual(before, original)
        for name in ("stage1", "tracked", "inverse"):
            self.assertEqual(after[name][0][0], 25)
        self.assertEqual(after["published_xy"][0], 25)
        self.assertEqual(after["config_bytes"]["0x0"], 7)
        self.assertEqual(after["face_modes"], {"0x3c": 0, "0x68": 2})
        self.assertEqual(after["reset_byte"], 0)
        after["tracked"][0][0] = 99
        self.assertEqual(before, original)
        self.assertEqual(struct.unpack_from("<f", self.memory[0x51000])[0], 25)


class TraceFixture(MemoryFixture):
    def setUp(self):
        super().setUp()
        self.target = mock.Mock()
        module = mock.Mock()
        module.GetUUIDString.return_value = trace.LENS_UUID
        self.target.modules = [module]
        self.hardware, self.active_counts = [], []
        for _ in range(4):
            self.add_breakpoint(enabled=True)
        self.point = self.hardware[-1]
        self.target.GetNumBreakpoints.side_effect = lambda: len(self.hardware)
        self.target.GetBreakpointAtIndex.side_effect = self.hardware.__getitem__
        patch = mock.patch.object(trace, "command", side_effect=lambda **kwargs: self.add_breakpoint(enabled=False))
        self.command = patch.start()
        self.addCleanup(patch.stop)
        patch = mock.patch.object(trace, "register", side_effect=lambda **kwargs: self.registers[kwargs["name"]])
        patch.start()
        self.addCleanup(patch.stop)
        self.frame, self.location = mock.Mock(), mock.Mock()
        self.frame.GetThread.return_value.GetThreadID.return_value = 123
        address = self.frame.GetPCAddress.return_value
        address.IsValid.return_value = True
        address.GetModule.return_value.GetUUIDString.return_value = trace.LENS_UUID
        address.GetFileAddress.return_value = trace.CALL

    def add_breakpoint(self, *, enabled):
        point = mock.Mock()
        point.IsHardware.return_value = True
        point.IsEnabled.return_value = enabled
        point.GetID.return_value = len(self.hardware) + 1
        def enable(value):
            point.IsEnabled.return_value = value
            self.active_counts.append(sum(item.IsEnabled() for item in self.hardware))
        point.SetEnabled.side_effect = enable
        self.hardware.append(point)
        return point

    def observer(self):
        return trace.ExtraTrace(target=self.target, point_breakpoint=self.point, callback="test.on_extra")

    def begin(self, *, observer, prediction=0):
        observer.begin(prediction=prediction, owner=self.owner, thread=123)

    def observe(self, *, observer, name):
        self.frame.GetPCAddress.return_value.GetFileAddress.return_value = trace.CALL if name == "before" else trace.RETURN
        self.location.GetBreakpoint.return_value = observer.breakpoints[name]
        observer.observe(frame=self.frame, location=self.location, read=self.read)

    def pair(self, *, observer, prediction=0):
        self.begin(observer=observer, prediction=prediction)
        self.observe(observer=observer, name="before")
        self.observe(observer=observer, name="after")


class ExtraTraceTests(TraceFixture, unittest.TestCase):
    def test_install_is_pinned_disabled_hardware_only(self):
        observer = self.observer()
        self.assertFalse(self.point.IsEnabled())
        self.assertEqual(self.command.call_args_list, [mock.call(debugger=self.target.GetDebugger(),
            text=f"breakpoint set --hardware --disable -s liblens.dylib -a {offset:#x}")
            for offset in (trace.CALL, trace.RETURN)])
        for point in observer.breakpoints.values():
            self.assertFalse(point.IsEnabled())
            point.SetScriptCallbackFunction.assert_called_once_with("test.on_extra")

    def test_missing_or_duplicate_pinned_image_rejected_before_install(self):
        module = self.target.modules[0]
        for modules in ([], [module, module]):
            self.target.modules = modules
            with self.subTest(modules=len(modules)), self.assertRaisesRegex(ValueError, "pinned Extra image"):
                self.observer()
        self.command.assert_not_called()
        self.point.SetEnabled.assert_not_called()

    def test_failed_or_software_breakpoint_creation_rejected(self):
        self.command.side_effect = None
        with self.assertRaisesRegex(ValueError, "creation failed"):
            self.observer()
        def software(**kwargs):
            self.add_breakpoint(enabled=False).IsHardware.return_value = False
        self.command.side_effect = software
        with self.assertRaisesRegex(ValueError, "software breakpoint forbidden"):
            self.observer()

    def test_two_predictions_switch_exactly_one_extra_slot_and_complete_readonly_report(self):
        observer = self.observer()
        self.assertFalse(observer.report()["complete"])
        for prediction in range(2):
            self.begin(observer=observer, prediction=prediction)
            for name in ("before", "after"):
                self.assertEqual([key for key, point in observer.breakpoints.items() if point.IsEnabled()], [name])
                self.assertFalse(self.point.IsEnabled())
                self.observe(observer=observer, name=name)
            self.assertTrue(self.point.IsEnabled())
            self.assertFalse(any(point.IsEnabled() for point in observer.breakpoints.values()))
        report = observer.report()
        self.assertTrue(report["complete"])
        self.assertEqual(report["schema"], "face-live-extra-boundary-v1")
        self.assertEqual([(row["event"], row["prediction"]) for row in report["events"]],
                         [("before", 0), ("after", 0), ("before", 1), ("after", 1)])
        for row in report["events"]:
            self.assertEqual((row["thread"], row["owner"], row["face_id"]), (123, self.owner, 7))
        self.assertEqual(report["events"][1]["return_code"], 0)
        for key in ("target_memory_written", "native_points_sent_to_worker", "product_parity_verified"):
            self.assertIs(report[key], False)
        self.assertLessEqual(max(self.active_counts), 4)
        self.frame.EvaluateExpression.assert_not_called()
        self.frame.GetThread.return_value.GetProcess.assert_not_called()

    def test_fifth_active_breakpoint_is_rejected(self):
        observer = self.observer()
        self.add_breakpoint(enabled=True)
        with self.assertRaisesRegex(ValueError, "hardware breakpoint budget"):
            observer.arm(name="before")

    def test_prediction_budget_requires_exact_integers_and_in_order(self):
        observer = self.observer()
        for prediction in (-1, 1, 2, True, 0.0):
            with self.subTest(prediction=prediction), self.assertRaisesRegex(ValueError, "ordered cold predictions"):
                self.begin(observer=observer, prediction=prediction)
        self.pair(observer=observer)
        self.pair(observer=observer, prediction=1)
        with self.assertRaisesRegex(ValueError, "ordered cold predictions"):
            self.begin(observer=observer, prediction=2)
        with self.assertRaisesRegex(ValueError, "call budget"):
            self.observe(observer=observer, name="before")

    def test_prediction_cannot_skip_an_entire_missing_call_pair(self):
        observer = self.observer()
        self.begin(observer=observer)
        with self.assertRaisesRegex(ValueError, "missing previous Extra call/return"):
            self.begin(observer=observer, prediction=1)

    def test_owner_or_thread_change_between_predictions_rejected(self):
        observer = self.observer()
        self.pair(observer=observer)
        for owner, thread in ((self.owner + 8, 123), (self.owner, 124)):
            with self.subTest(owner=owner, thread=thread), self.assertRaisesRegex(ValueError, "owner/thread changed"):
                observer.begin(prediction=1, owner=owner, thread=thread)
        self.assertEqual(observer.prediction, 0)

    def test_unpaired_reentrant_or_unknown_events_rejected(self):
        observer = self.observer()
        with self.assertRaises(ValueError):
            self.observe(observer=observer, name="before")
        self.begin(observer=observer)
        with self.assertRaisesRegex(ValueError, "unpaired Extra return"):
            self.observe(observer=observer, name="after")
        self.observe(observer=observer, name="before")
        with self.assertRaisesRegex(ValueError, "unexpected Extra call order"):
            self.observe(observer=observer, name="before")
        with self.assertRaisesRegex(ValueError, "ordered cold predictions"):
            self.begin(observer=observer, prediction=1)
        self.frame.GetPCAddress.return_value.GetFileAddress.return_value = trace.RETURN + 4
        with self.assertRaisesRegex(ValueError, "unpaired Extra return"):
            observer.observe(frame=self.frame, location=self.location, read=self.read)
        self.assertEqual(len(observer.events), 1)
        self.assertFalse(observer.report()["complete"])

    def test_wrong_thread_software_or_unpinned_location_rejected(self):
        observer = self.observer()
        self.begin(observer=observer)
        address = self.frame.GetPCAddress.return_value
        for method, value in ((self.frame.GetThread().GetThreadID, 999),
                (observer.breakpoints["before"].IsHardware, False), (address.IsValid, False),
                (address.GetModule().GetUUIDString, "other-image")):
            old = method.return_value
            method.return_value = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.observe(observer=observer, name="before")
            method.return_value = old
        self.assertEqual(observer.events, [])
        self.assertIsNone(observer.pending)

    def test_before_after_events_own_independent_matrix_and_vector_copies(self):
        observer = self.observer()
        self.begin(observer=observer)
        self.observe(observer=observer, name="before")
        original = copy.deepcopy(observer.events[0])
        struct.pack_into("<f", self.memory[0x51000], 0, 123)
        struct.pack_into("<f", self.memory[self.vector], 0, 234)
        self.observe(observer=observer, name="after")
        self.assertEqual(observer.events[0], original)
        self.assertEqual(observer.events[1]["snapshot"]["tracked"][0][0], 123)
        self.assertEqual(observer.events[1]["snapshot"]["published_xy"][0], 234)
        observer.events[1]["snapshot"]["tracked"][0][0] = 345
        self.assertEqual(observer.events[0], original)

    def test_return_rejects_face_context_changed_during_call(self):
        observer = self.observer()
        self.begin(observer=observer)
        self.observe(observer=observer, name="before")
        self.memory[self.runtime + 12] = struct.pack("<i", 8)
        with self.assertRaises(ValueError):
            self.observe(observer=observer, name="after")
        self.assertEqual(len(observer.events), 1)


if __name__ == "__main__":
    unittest.main()
