"""Synthetic load/store pairs and a four-slot debugger; no target execution."""
import struct
import unittest
from unittest import mock

import face_live_makeup_point_rotation as rotation
import face_live_bridge_lldb as bridge
import face_live_bridge_probe as probe


class Breakpoint:
    def __init__(self, *, enabled=True, hardware=True):
        self.enabled, self.hardware, self.changes = enabled, hardware, []

    def SetEnabled(self, value):
        self.enabled = value
        self.changes.append(value)

    def IsEnabled(self):
        return self.enabled

    def IsHardware(self):
        return self.hardware

    def SetScriptCallbackFunction(self, value):
        self.callback = value


class RotationTests(unittest.TestCase):
    def setUp(self):
        self.points = [Breakpoint() for _ in range(4)]
        self.target = mock.Mock()
        self.target.GetNumBreakpoints.side_effect = lambda: len(self.points)
        self.target.GetBreakpointAtIndex.side_effect = lambda index: self.points[index]
        self.command = self.enterContext(mock.patch.object(rotation, "command", side_effect=self.create))
        self.row = dict(prediction=1, thread=123, point_index=0, binding_id=2, graph_id=3,
            caller_offset=0x9eb9c4, base=8192, points_begin=16384, source_address=16384,
            loaded_bits=list(struct.unpack("<2I", struct.pack("<2f", 0.25, 0.75))), width=640, height=480)
        self.frame, self.location = mock.Mock(), mock.Mock()
        self.address = self.frame.GetPCAddress.return_value
        self.address.IsValid.return_value = True
        self.address.GetModule.return_value.GetUUIDString.return_value = rotation.trace.CORE_UUID
        self.address.GetFileAddress.return_value = rotation.POINT_STORED
        self.thread = self.frame.GetThread.return_value
        self.thread.GetThreadID.return_value = 123
        self.caller = self.thread.GetFrameAtIndex.return_value.GetPCAddress.return_value
        self.caller.IsValid.return_value = True
        self.caller.GetModule.return_value.GetUUIDString.return_value = rotation.trace.CORE_UUID
        self.caller.GetFileAddress.return_value = self.row["caller_offset"]
        self.location.GetBreakpoint.return_value.IsHardware.return_value = True
        self.registers = dict(x19=8192, x8=0, x9=32768, x11=32768, w21=640, w22=480)
        self.stored_bits = list(struct.unpack("<2I", struct.pack("<2f", 160, 120)))
        self.memory = {16384: struct.pack("<2I", *self.row["loaded_bits"]),
                       32768: struct.pack("<2I", *self.stored_bits)}
        self.enterContext(mock.patch.object(rotation, "register", side_effect=lambda **kw: self.registers[kw["name"]]))
        self.enterContext(mock.patch.object(rotation.trace, "float_register_bits",
            side_effect=lambda **kw: self.stored_bits[0 if kw["name"] == "s2" else 1]))

    def create(self, **kwargs):
        self.assertIn("--hardware --disable", kwargs["text"])
        self.assertIn("0xa20804", kwargs["text"])
        self.points.append(Breakpoint(enabled=False))

    def build(self):
        return rotation.PointRotation(target=self.target, load=self.points[3], callback="store_callback")

    def read(self, *, address, size):
        data = self.memory[address]
        self.assertEqual(len(data), size)
        return data

    def observe(self, *, controller):
        controller.observe(frame=self.frame, location=self.location, prediction=1, read=self.read)

    def test_two_locations_never_require_fifth_hardware_slot(self):
        controller = self.build()
        self.assertEqual(sum(point.enabled for point in self.points), 4)
        self.assertFalse(controller.report()["complete"])
        controller.loaded(row=self.row)
        self.assertFalse(self.points[3].enabled)
        self.assertTrue(self.points[4].enabled)
        self.assertFalse(controller.report()["complete"])
        self.observe(controller=controller)
        self.assertTrue(controller.report()["complete"])
        self.assertEqual(controller.report()["stores"], 1)
        self.assertEqual(controller.events[0]["stored_bits"], self.stored_bits)
        self.assertTrue(self.points[3].enabled)
        self.assertFalse(self.points[4].enabled)
        self.assertEqual(sum(point.enabled for point in self.points), 4)
        self.frame.EvaluateExpression.assert_not_called()
        self.thread.GetProcess.assert_not_called()

    def test_slot_can_be_lent_to_extra_only_without_pending_store(self):
        controller = self.build()
        controller.SetEnabled(False)
        self.assertEqual(sum(point.enabled for point in self.points), 3)
        controller.SetEnabled(True)
        controller.loaded(row=self.row)
        with self.assertRaisesRegex(ValueError, "pending"):
            controller.SetEnabled(False)
        with self.assertRaisesRegex(ValueError, "unexpected"):
            controller.loaded(row=self.row)
        self.observe(controller=controller)
        controller.SetEnabled(False)

    def test_store_without_load_or_duplicate_store_is_rejected(self):
        controller = self.build()
        with self.assertRaisesRegex(ValueError, "no paired"):
            self.observe(controller=controller)
        controller.loaded(row=self.row)
        self.observe(controller=controller)
        with self.assertRaisesRegex(ValueError, "no paired"):
            self.observe(controller=controller)

    def test_counts_are_bounded_and_incomplete_cannot_pass(self):
        controller = self.build()
        controller.loads = rotation.trace.MAX_HITS
        with self.assertRaisesRegex(ValueError, "unbounded"):
            controller.loaded(row=self.row)
        self.assertFalse(controller.report()["complete"])

    def test_software_or_excess_hardware_slots_rejected(self):
        self.points[3].hardware = False
        with self.assertRaisesRegex(ValueError, "hardware"):
            self.build()
        self.points[3].hardware = True
        self.points.append(Breakpoint())
        with self.assertRaisesRegex(ValueError, "budget"):
            self.build()

    def test_register_identity_offsets_and_aliasing_rejected(self):
        for key, bad in (("x19", 9000), ("x8", 8), ("w21", 641), ("w22", 481),
                         ("x9", 16384), ("x11", 0), ("x11", 32776)):
            with self.subTest(key=key):
                good = self.registers[key]
                self.registers[key] = bad
                with self.assertRaises(ValueError):
                    rotation.observe_store(frame=self.frame, location=self.location, prediction=1,
                                          read=self.read, row=self.row)
                self.registers[key] = good

    def test_actual_memory_and_register_bits_must_match_expected_float32(self):
        for address in (16384, 32768):
            good = self.memory[address]
            self.memory[address] = struct.pack("<2f", 1, 1)
            with self.subTest(address=address), self.assertRaisesRegex(ValueError, "post-store value"):
                rotation.observe_store(frame=self.frame, location=self.location, prediction=1,
                                      read=self.read, row=self.row)
            self.memory[address] = good
        self.stored_bits[0] += 1
        with self.assertRaisesRegex(ValueError, "post-store value"):
            rotation.observe_store(frame=self.frame, location=self.location, prediction=1,
                                  read=self.read, row=self.row)

    def test_module_pc_caller_thread_and_prediction_are_pinned(self):
        for target, method, bad in ((self.address, "IsValid", False),
                (self.address, "GetFileAddress", rotation.POINT_STORED + 4),
                (self.address.GetModule(), "GetUUIDString", "foreign"),
                (self.caller, "GetFileAddress", 0x9eb7bc),
                (self.thread, "GetThreadID", 124),
                (self.location.GetBreakpoint(), "IsHardware", False)):
            value = getattr(target, method)
            good = value.return_value
            value.return_value = bad
            with self.subTest(method=method), self.assertRaises(ValueError):
                rotation.observe_store(frame=self.frame, location=self.location, prediction=1,
                                      read=self.read, row=self.row)
            value.return_value = good
        with self.assertRaises(ValueError):
            rotation.observe_store(frame=self.frame, location=self.location, prediction=0,
                                  read=self.read, row=self.row)

    def test_last_point_uses_exact_index_and_does_not_read_past_it(self):
        self.row.update(point_index=105, source_address=16384 + 840)
        self.registers.update(x8=840, x11=32768 + 840)
        self.memory[16384 + 840] = self.memory[16384]
        self.memory[32768 + 840] = self.memory[32768]
        controller = self.build()
        controller.loaded(row=self.row)
        self.observe(controller=controller)
        self.assertEqual(controller.events[0]["destination_address"], 32768 + 840)

    def test_error_callback_keeps_fail_closed_policy(self):
        state = mock.Mock(started=0, index=1, failures=[])
        state.rotation.observe.side_effect = ValueError("bad store")
        with mock.patch.object(bridge, "STATE", state), mock.patch.object(bridge.time, "monotonic", return_value=1):
            self.assertTrue(bridge.on_point_store_breakpoint(self.frame, self.location, {}))
        self.assertEqual(state.failures, ["ValueError: bad store"])
        state.process.Continue.assert_not_called()

    def test_rotation_without_primary_observer_is_rejected_before_prepare(self):
        with self.assertRaisesRegex(ValueError, "requires"):
            probe.run(args=mock.Mock(rotate_makeup_points=True, trace_makeup_points=False))


if __name__ == "__main__":
    unittest.main()
