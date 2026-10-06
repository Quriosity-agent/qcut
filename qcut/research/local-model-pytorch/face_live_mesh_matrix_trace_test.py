"""Mock LLDB controller coverage; never launches or resumes a native process."""
import struct
import sys
import types
import unittest
from unittest import mock

import face_live_mesh_matrix_trace as trace
from face_live_mesh_matrix_abi import CORE_UUID, IDENTITIES, SITES
from face_live_mesh_matrix_audit_test import MatrixMemory
from face_live_mesh_trace_test import FakePoint


class MatrixTraceTests(unittest.TestCase):
    def setUp(self):
        self.memory = MatrixMemory()
        self.points = [FakePoint(identifier=index + 1, enabled=True) for index in range(3)]
        self.target, self.frame, self.location = (mock.Mock() for _ in range(3))
        self.target.GetNumBreakpoints.side_effect = lambda: len(self.points)
        self.target.GetBreakpointAtIndex.side_effect = lambda index: self.points[index]
        self.modules = {}
        self.active_history = []
        for role, (identity, _) in IDENTITIES.items():
            module = mock.Mock()
            module.GetUUIDString.return_value = identity
            header = module.GetObjectFileHeaderAddress.return_value
            header.IsValid.return_value = True
            header.GetFileAddress.return_value = 0
            header.GetLoadAddress.return_value = getattr(self.memory.scope, role + "_slide")
            self.modules[role] = module
        self.target.modules = list(self.modules.values())

        def create(**kwargs):
            point = FakePoint(identifier=len(self.points) + 1)
            original = point.SetEnabled

            def enabled(value):
                original(value)
                self.active_history.append(sum(item.IsEnabled() for item in self.points))

            point.SetEnabled = enabled
            self.points.append(point)

        self.commands = mock.Mock(side_effect=create)
        self.verify = mock.Mock(return_value={"static_route_verified": True})
        self.patches = mock.patch.multiple(trace, verify_libraries=self.verify, command=self.commands)
        self.patches.start()
        self.addCleanup(self.patches.stop)
        self.controller = self.make_controller()
        self.pc = self.frame.GetPCAddress.return_value
        self.pc.IsValid.return_value = True
        self.pc.GetModule.side_effect = lambda: self.modules[SITES[self.controller.mode][0]]
        self.pc.GetFileAddress.side_effect = lambda: SITES[self.controller.mode][1]
        self.pc.GetLoadAddress.side_effect = lambda _: (
            SITES[self.controller.mode][1] + self.controller.slides[SITES[self.controller.mode][0]])
        self.thread = self.frame.GetThread.return_value
        self.thread.GetThreadID.return_value = self.memory.scope.thread
        self.thread.GetNumFrames.return_value = 2
        caller = self.thread.GetFrameAtIndex.return_value.GetPCAddress.return_value
        caller.IsValid.return_value = True
        caller.GetModule.return_value = self.modules["core"]
        caller.GetFileAddress.side_effect = lambda: 0x5183DC if self.memory.branch == "update" else 0x5184E0
        self.location.GetBreakpoint.side_effect = lambda: self.controller.points[self.controller.mode]
        self.registers = {}
        self.register_patch = mock.patch.object(trace, "read_register",
            side_effect=lambda **kwargs: self.registers[kwargs["name"]])
        self.register_patch.start()
        self.addCleanup(self.register_patch.stop)

    def make_controller(self):
        return trace.MatrixTrace(target=self.target, core="/pinned/core", agfx="/pinned/agfx",
                                 callback="parent.on_matrix")

    def start(self, **overrides):
        values = dict(source=self.memory.source, prediction=1, timestamp_us=0,
            face_id=self.memory.face_id, thread=42, core_slide=self.memory.slide, read=self.memory.read)
        values.update(overrides)
        self.controller.start(**values)
        self.memory.audit = self.controller.audit

    def invoke(self, **overrides):
        self.registers = self.memory.registers()
        values = dict(frame=self.frame, location=self.location, prediction=1, timestamp_us=0,
                      face_id=self.memory.face_id)
        values.update(overrides)
        return self.controller.observe(**values)

    def resume(self):
        self.controller.resume(vertices=self.memory.receipt(channel="vertices"),
                               normals=self.memory.receipt(channel="normals"))

    def until(self, *, mode):
        for _ in range(20):
            if self.controller.mode == mode:
                return
            if self.controller.mode == "mesh_copies":
                self.resume()
            else:
                self.invoke()
        raise AssertionError("controller did not reach requested mode")

    def assert_disabled(self):
        self.assertTrue(all(not point.IsEnabled() for point in self.controller.points.values()))

    def test_two_getters_lend_slot_back_then_both_copy_branches(self):
        for branch in ("update", "create"):
            with self.subTest(branch=branch):
                self.memory.branch = branch
                self.start()
                self.assertEqual(sum(point.IsEnabled() for point in self.points), 4)
                self.invoke()
                self.invoke()
                self.invoke()
                self.invoke()
                self.assertEqual(self.controller.mode, "mesh_copies")
                self.assert_disabled()
                self.assertFalse(self.controller.report()["complete"])
                self.resume()
                self.until(mode="complete")
                self.assert_disabled()
                report = self.controller.report()
                self.assertTrue(report["complete"])
                self.assertTrue(report["matrix_cpu_consumer_verified"])
                self.assertEqual(len(report["current"]["events"]), 18)
                self.assertLessEqual(max(self.active_history), 4)
                for name in ("matrix_consumer_verified", "qcut_mesh_ownership_verified",
                             "gpu_consumption_verified", "renderer_consumption",
                             "product_backend_enabled", "target_memory_written", "unknown_stops_resumed"):
                    self.assertFalse(report[name])
        self.assertEqual(len(self.controller.history), 2)
        self.frame.EvaluateExpression.assert_not_called()
        self.thread.GetProcess.return_value.Continue.assert_not_called()
        self.thread.GetProcess.return_value.WriteMemory.assert_not_called()
        self.assertEqual(self.commands.call_count, len(SITES))
        for call in self.commands.call_args_list:
            self.assertIn("--hardware --disable", call.kwargs["text"])

    def test_resume_requires_parent_to_release_mesh_slot(self):
        self.start()
        self.until(mode="mesh_copies")
        borrowed = FakePoint(identifier=99, enabled=True)
        self.points.append(borrowed)
        with self.assertRaisesRegex(ValueError, "slot unavailable"):
            self.resume()
        self.assertTrue(borrowed.IsEnabled())
        self.assertTrue(self.controller.failed)
        self.assert_disabled()

    def test_inactive_and_out_of_order_resume_fail_without_any_target_operation(self):
        with self.assertRaisesRegex(ValueError, "inactive"):
            self.resume()
        self.assert_disabled()

    def test_resume_before_matrix_getters_fails(self):
        self.start()
        with self.assertRaisesRegex(ValueError, "waiting"):
            self.resume()
        self.assert_disabled()

    def test_scope_mismatch_disables_slot_and_prevents_restart(self):
        self.start()
        with self.assertRaisesRegex(ValueError, "scope"):
            self.invoke(prediction=2)
        self.assert_disabled()
        self.assertFalse(self.controller.report()["complete"])
        with self.assertRaisesRegex(ValueError, "cannot start"):
            self.start()

    def test_bad_stop_identity_fails_before_register_read(self):
        changes = ("pc", "uuid", "slide", "invalid", "point", "software", "disabled")
        for change in changes:
            with self.subTest(change=change):
                # Each case needs a fresh breakpoint inventory, not a growing synthetic target.
                self.controller.disable()
                self.points[:] = self.points[:3]
                self.controller = self.make_controller()
                self.start()
                point = self.controller.points["mvp_getter"]
                patches = []
                if change == "pc":
                    patches.append(mock.patch.object(self.pc, "GetFileAddress", return_value=0))
                elif change == "uuid":
                    patches.append(mock.patch.object(self.modules["core"], "GetUUIDString", return_value="foreign"))
                elif change == "slide":
                    patches.append(mock.patch.object(self.pc, "GetLoadAddress", return_value=0))
                elif change == "invalid":
                    patches.append(mock.patch.object(self.pc, "IsValid", return_value=False))
                elif change == "point":
                    patches.append(mock.patch.object(self.location, "GetBreakpoint", return_value=self.points[0]))
                elif change == "software":
                    point.hardware = False
                else:
                    point.SetEnabled(False)
                for patch in patches:
                    patch.start()
                trace.read_register.reset_mock()
                try:
                    with self.assertRaisesRegex(ValueError, "unverified"):
                        self.invoke()
                    trace.read_register.assert_not_called()
                    self.assert_disabled()
                finally:
                    for patch in reversed(patches):
                        patch.stop()

    def test_missing_or_duplicate_modules_fail_at_start_before_enabling_slot(self):
        for modules in ([], [self.modules["core"]], [*self.target.modules, self.modules["agfx"]]):
            with self.subTest(count=len(modules)):
                self.points[:] = self.points[:3]
                self.controller = self.make_controller()
                self.target.modules = modules
                before = len(self.points)
                with self.assertRaisesRegex(ValueError, "pinned"):
                    self.start()
                self.assertEqual(len(self.points), before)
                self.assert_disabled()

    def test_constructor_defers_aslr_reads_until_start(self):
        self.assertEqual(self.controller.slides, {})
        for module in self.modules.values():
            module.GetObjectFileHeaderAddress.assert_not_called()
        self.start()
        self.assertEqual(self.controller.slides, dict(core=self.memory.slide, agfx=self.memory.scope.agfx_slide))
        for module in self.modules.values():
            module.GetObjectFileHeaderAddress.assert_called_once()

    def test_invalid_load_address_or_changed_slide_cannot_activate_capture(self):
        self.modules["agfx"].GetObjectFileHeaderAddress.return_value.GetLoadAddress.return_value = 2**64 - 1
        with self.assertRaisesRegex(ValueError, "slide"):
            self.start()
        self.assert_disabled()

    def test_slide_change_between_completed_captures_fails(self):
        self.start()
        self.until(mode="complete")
        self.modules["agfx"].GetObjectFileHeaderAddress.return_value.GetLoadAddress.return_value += 4096
        with self.assertRaisesRegex(ValueError, "slides changed"):
            self.start()
        self.assert_disabled()

    def test_hash_failure_does_not_allocate_breakpoints(self):
        self.verify.side_effect = ValueError("matrix core hash mismatch")
        before = len(self.points)
        with self.assertRaisesRegex(ValueError, "hash"):
            self.make_controller()
        self.assertEqual(len(self.points), before)

    def test_foreign_or_software_active_slot_rejected(self):
        for software in (False, True):
            with self.subTest(software=software):
                self.controller.disable()
                self.controller.failed = False
                self.controller.audit = None
                if software:
                    self.points[0].hardware = False
                else:
                    self.points.append(FakePoint(identifier=99, enabled=True))
                with self.assertRaisesRegex(ValueError, "slot unavailable"):
                    self.start()
                self.assert_disabled()
                if not software:
                    self.points.pop()

    def test_breakpoint_inventory_limit_is_bounded(self):
        self.target.GetNumBreakpoints.side_effect = lambda: trace.MAX_BREAKPOINTS + 1
        with self.assertRaisesRegex(ValueError, "inventory"):
            self.make_controller()
        self.target.GetNumBreakpoints.side_effect = lambda: len(self.points)
        self.points.extend(FakePoint(identifier=100 + index) for index in range(20))
        with self.assertRaisesRegex(ValueError, "inventory"):
            self.make_controller()
        self.assertTrue(all(not point.IsEnabled() for point in self.points[3:]))

    def test_bad_hardware_creation_is_disabled(self):
        original = self.commands.side_effect

        def software(**kwargs):
            original(**kwargs)
            self.points[-1].hardware = False
            self.points[-1].SetEnabled(True)

        self.commands.side_effect = software
        with self.assertRaisesRegex(ValueError, "disabled hardware"):
            self.make_controller()
        self.assertFalse(self.points[-1].IsEnabled())

    def test_partial_register_error_disables_and_keeps_failure(self):
        self.start()
        trace.read_register.side_effect = ValueError("register read failed")
        with self.assertRaisesRegex(ValueError, "register read"):
            self.invoke()
        self.assert_disabled()
        self.assertTrue(self.controller.report()["failed"])

    def test_call_stack_scan_is_bounded_to_four_callers(self):
        self.start()
        self.until(mode="update_before")
        self.thread.GetNumFrames.return_value = 100000
        self.thread.GetFrameAtIndex.reset_mock()
        self.invoke()
        self.assertEqual([call.args[0] for call in self.thread.GetFrameAtIndex.call_args_list], [1, 2, 3, 4])

    def test_missing_copy_caller_fails_closed(self):
        self.start()
        self.until(mode="update_before")
        self.thread.GetNumFrames.return_value = 1
        with self.assertRaisesRegex(ValueError, "caller"):
            self.invoke()
        self.assert_disabled()

    def test_capture_count_is_bounded(self):
        for _ in range(trace.MAX_CAPTURES):
            self.start()
            self.until(mode="complete")
        with self.assertRaisesRegex(ValueError, "cannot start"):
            self.start()
        self.assertEqual(len(self.controller.history), trace.MAX_CAPTURES)
        self.assert_disabled()


class MatrixRegisterTests(unittest.TestCase):
    def test_simd_register_uses_two_exact_little_endian_words(self):
        frame, error = mock.Mock(), mock.Mock()
        error.Success.return_value = True
        data = frame.FindRegister.return_value.GetData.return_value
        frame.FindRegister.return_value.IsValid.return_value = True
        data.GetByteSize.return_value = 16
        data.GetUnsignedInt64.side_effect = [0x0102030405060708, 0x1112131415161718]
        module = types.SimpleNamespace(SBError=lambda: error)
        with mock.patch.dict(sys.modules, lldb=module):
            result = trace.read_register(frame=frame, name="q0")
        self.assertEqual(result, struct.pack("<2Q", 0x0102030405060708, 0x1112131415161718))
        self.assertEqual([call.args[1] for call in data.GetUnsignedInt64.call_args_list], [0, 8])
        frame.EvaluateExpression.assert_not_called()

    def test_missing_wrong_width_or_unreadable_simd_rejected(self):
        for failure in ("missing", "width", "read"):
            with self.subTest(failure=failure):
                frame, error = mock.Mock(), mock.Mock()
                value = frame.FindRegister.return_value
                value.IsValid.return_value = failure != "missing"
                value.GetData.return_value.GetByteSize.return_value = 8 if failure == "width" else 16
                value.GetData.return_value.GetUnsignedInt64.return_value = 0
                error.Success.return_value = failure != "read"
                with mock.patch.dict(sys.modules, lldb=types.SimpleNamespace(SBError=lambda: error)):
                    with self.assertRaisesRegex(ValueError, "SIMD"):
                        trace.read_register(frame=frame, name="q1")

    def test_integer_registers_use_existing_reader(self):
        frame = mock.Mock()
        with mock.patch.object(trace, "register", return_value=42) as reader:
            self.assertEqual(trace.read_register(frame=frame, name="x19"), 42)
            reader.assert_called_once_with(frame=frame, name="x19")


if __name__ == "__main__":
    unittest.main()
