"""Mock LLDB coverage; no native processes, expressions, or target writes."""
import struct
import unittest
from unittest import mock

import face_live_mesh_trace as trace
from face_live_mesh_abi import CORE_UUID, SITES, COPY_RETURNS
from face_live_mesh_capture_test import MeshMemory


class FakePoint:
    def __init__(self, *, identifier, enabled=False, hardware=True):
        self.identifier, self.enabled, self.hardware = identifier, enabled, hardware
        self.callback = None

    def GetID(self):
        return self.identifier

    def SetEnabled(self, enabled):
        self.enabled = enabled

    def IsEnabled(self):
        return self.enabled

    def IsHardware(self):
        return self.hardware

    def SetScriptCallbackFunction(self, callback):
        self.callback = callback


class MeshTraceTests(unittest.TestCase):
    def setUp(self):
        self.memory = MeshMemory()
        self.target, self.frame, self.location = (mock.Mock() for _ in range(3))
        self.points = [FakePoint(identifier=index + 1, enabled=True) for index in range(3)]
        self.module = mock.Mock()
        self.module.GetUUIDString.return_value = CORE_UUID
        self.target.modules = [self.module]
        self.target.GetNumBreakpoints.side_effect = lambda: len(self.points)
        self.target.GetBreakpointAtIndex.side_effect = lambda index: self.points[index]
        self.commands = []

        def create(**kwargs):
            self.commands.append(kwargs["text"])
            self.points.append(FakePoint(identifier=len(self.points) + 1))

        self.patch = mock.patch.multiple(trace, verify_library=mock.Mock(return_value={"verified": True}),
                                        command=mock.Mock(side_effect=create))
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.controller = self.make_controller()
        self.pc = self.frame.GetPCAddress.return_value
        self.pc.IsValid.return_value = True
        self.pc.GetModule.return_value = self.module
        self.pc.GetFileAddress.side_effect = lambda: SITES[self.controller.mode]
        self.pc.GetLoadAddress.side_effect = lambda _: self.memory.slide + SITES[self.controller.mode]
        self.thread = self.frame.GetThread.return_value
        self.thread.GetThreadID.return_value = 42
        self.thread.GetProcess.return_value.GetTarget.return_value = self.target
        self.caller = self.thread.GetFrameAtIndex.return_value.GetPCAddress.return_value
        self.caller.IsValid.return_value = True
        self.caller.GetModule.return_value = self.module
        self.caller.GetFileAddress.return_value = 0xC1F6C8
        self.location.GetBreakpoint.side_effect = lambda: self.controller.points[self.controller.mode]
        self.registers = {}
        self.register_patch = mock.patch.object(trace, "register", side_effect=lambda **kw: self.registers[kw["name"]])
        self.register_patch.start()
        self.addCleanup(self.register_patch.stop)

    def make_controller(self):
        return trace.MeshTrace(target=self.target, core="/pinned/core", callback="parent.on_mesh")

    def getter(self):
        self.registers = dict(x0=self.memory.mesh, x9=0xA000, x10=8, w19=0, x20=0xB000)
        self.memory.put(address=0xA000, data=struct.pack("<Q", self.memory.mesh))
        self.controller.SetEnabled(True)

    def invoke(self, **overrides):
        arguments = dict(frame=self.frame, location=self.location, prediction=1, timestamp_us=0,
                         face_id=7, read=self.memory.read)
        arguments.update(overrides)
        return self.controller.observe(**arguments)

    def copy(self, *, channel):
        _, self.registers, _ = self.memory.copied(channel=channel)
        self.registers["x30"] = self.memory.slide + COPY_RETURNS[channel]

    def complete(self):
        self.getter()
        self.invoke()
        self.copy(channel="vertices")
        self.invoke()
        self.copy(channel="normals")
        self.invoke()

    def test_single_fourth_slot_three_stops_then_disabled(self):
        self.assertEqual(sum(point.IsEnabled() for point in self.points), 3)
        self.getter()
        for stage in ("getter", "vertices", "normals"):
            self.assertEqual(self.controller.mode, stage)
            self.assertEqual(sum(point.IsEnabled() for point in self.points), 4)
            if stage != "getter":
                self.copy(channel=stage)
            self.invoke()
        self.assertEqual(sum(point.IsEnabled() for point in self.points), 3)
        report = self.controller.report()
        self.assertTrue(report["complete"])
        self.assertEqual(report["completed"], 1)
        self.assertEqual(len(report["events"]), 3)
        for key in ("renderer_consumption", "qcut_mesh_ownership_verified", "gpu_consumption_verified",
                    "matrix_consumer_verified", "product_backend_enabled", "target_memory_written"):
            self.assertFalse(report[key])
        self.assertTrue(all("--hardware --disable" in command for command in self.commands))
        self.frame.EvaluateExpression.assert_not_called()
        self.thread.GetProcess.return_value.Continue.assert_not_called()
        self.thread.GetProcess.return_value.WriteMemory.assert_not_called()

    def test_no_getter_and_partial_sequence_are_not_complete(self):
        self.assertFalse(self.controller.report()["complete"])
        self.getter()
        self.invoke()
        self.assertFalse(self.controller.report()["complete"])
        self.controller.disable()
        self.assertFalse(self.controller.report()["complete"])

    def test_pending_copy_cannot_loan_slot_to_other_observer(self):
        self.getter()
        self.invoke()
        with self.assertRaisesRegex(ValueError, "lend"):
            self.controller.SetEnabled(False)

    def test_missing_core_or_hash_failure_does_not_create_breakpoints(self):
        trace.verify_library.side_effect = ValueError("hash mismatch")
        before = len(self.points)
        with self.assertRaisesRegex(ValueError, "hash"):
            self.make_controller()
        self.assertEqual(len(self.points), before)
        trace.verify_library.side_effect = None
        self.target.modules = []
        with self.assertRaisesRegex(ValueError, "pinned"):
            self.make_controller()
        self.assertEqual(len(self.points), before)

    def test_fourth_slot_occupied_is_rejected(self):
        self.points.append(FakePoint(identifier=99, enabled=True))
        with self.assertRaisesRegex(ValueError, "unavailable"):
            self.controller.SetEnabled(True)
        self.assertEqual(self.controller.mode, "disabled")
        self.assertTrue(self.points[-1].IsEnabled())

    def test_existing_software_breakpoint_is_rejected(self):
        self.points[0].hardware = False
        with self.assertRaisesRegex(ValueError, "unavailable"):
            self.controller.SetEnabled(True)

    def test_unbounded_breakpoint_list_fails_before_iteration(self):
        self.target.GetNumBreakpoints.side_effect = lambda: trace.MAX_BREAKPOINTS + 1
        with self.assertRaisesRegex(ValueError, "inventory"):
            self.make_controller()

    def test_wrong_pc_uuid_or_location_fails_closed(self):
        for change in ("pc", "uuid", "invalid", "point"):
            with self.subTest(change=change):
                self.controller = self.make_controller()
                self.getter()
                if change == "pc":
                    self.pc.GetFileAddress.side_effect = lambda: SITES["getter"] + 4
                elif change == "uuid":
                    self.module.GetUUIDString.return_value = "foreign"
                elif change == "invalid":
                    self.pc.IsValid.return_value = False
                else:
                    self.location.GetBreakpoint.side_effect = lambda: self.points[0]
                with self.assertRaisesRegex(ValueError, "unverified"):
                    self.invoke()
                self.assertTrue(self.controller.report()["failed"])
                self.assertEqual(self.controller.mode, "disabled")
                self.module.GetUUIDString.return_value = CORE_UUID
                self.pc.GetFileAddress.side_effect = lambda: SITES[self.controller.mode]
                self.pc.IsValid.return_value = True
                self.location.GetBreakpoint.side_effect = lambda: self.controller.points[self.controller.mode]

    def test_getter_index_count_list_and_caller_fail(self):
        for name, value in (("w19", 1), ("x10", 88), ("x10", 9), ("x0", 0x3000)):
            with self.subTest(name=name, value=value):
                self.controller = self.make_controller()
                self.getter()
                self.registers[name] = value
                with self.assertRaises(ValueError):
                    self.invoke()
        self.controller = self.make_controller()
        self.getter()
        self.caller.GetFileAddress.return_value = 0xC1F62C
        with self.assertRaisesRegex(ValueError, "caller"):
            self.invoke()

    def test_scope_prediction_time_thread_and_id_cannot_change(self):
        for arguments in (dict(prediction=2), dict(timestamp_us=100), dict(face_id=8), dict(thread=9)):
            with self.subTest(arguments=arguments):
                self.controller = self.make_controller()
                self.getter()
                self.invoke()
                self.copy(channel="vertices")
                if "thread" in arguments:
                    self.thread.GetThreadID.return_value = arguments["thread"]
                    arguments = {}
                with self.assertRaisesRegex(ValueError, "scope"):
                    self.invoke(**arguments)
                self.thread.GetThreadID.return_value = 42

    def test_wrong_copy_return_address_fails(self):
        self.getter()
        self.invoke()
        self.copy(channel="vertices")
        self.registers["x30"] += 4
        with self.assertRaisesRegex(ValueError, "copy loop"):
            self.invoke()

    def test_geometry_mutation_since_getter_fails(self):
        self.getter()
        self.invoke()
        self.copy(channel="vertices")
        self.memory.put(address=self.memory.mesh + 0x80, data=struct.pack("<f", 2))
        with self.assertRaisesRegex(ValueError, "changed since getter"):
            self.invoke()

    def test_normal_destination_must_be_same_mesh(self):
        self.getter()
        self.invoke()
        self.copy(channel="vertices")
        self.invoke()
        self.copy(channel="normals")
        self.registers["x19"] += 8
        with self.assertRaisesRegex(ValueError, "renderer object"):
            self.invoke()

    def test_completed_capture_budget_is_bounded(self):
        for _ in range(trace.MAX_CAPTURES):
            self.complete()
        with self.assertRaisesRegex(ValueError, "budget"):
            self.controller.SetEnabled(True)


if __name__ == "__main__":
    unittest.main()
