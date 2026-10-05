"""Read-only reshape tracing with a synthetic four-slot hardware debugger."""
import json
import unittest
from unittest import mock

import face_live_reshape_points as points
import face_live_reshape_trace as trace
import face_live_bridge_lldb_test as debugger_fixtures
from face_live_reshape_points_test import ReshapeMemory


class Breakpoint:
    def __init__(self, *, identifier, owner, enabled=False, hardware=True):
        self.identifier, self.owner = identifier, owner
        self.enabled, self.hardware, self.callback = enabled, hardware, None

    def GetID(self):
        return self.identifier

    def IsEnabled(self):
        return self.enabled

    def IsHardware(self):
        return self.hardware

    def SetEnabled(self, enabled):
        self.enabled = enabled
        self.owner.history.append((self.identifier, enabled,
            sum(point.IsEnabled() for point in self.owner.breakpoints)))

    def SetScriptCallbackFunction(self, callback):
        self.callback = callback


class ReshapeTraceTests(unittest.TestCase):
    def setUp(self):
        self.memory = ReshapeMemory()
        self.memory.install(case=self)
        self.target, self.frame, self.location = mock.Mock(), mock.Mock(), mock.Mock()
        self.breakpoints, self.history = [], []
        self.target.GetNumBreakpoints.side_effect = lambda: len(self.breakpoints)
        self.target.GetBreakpointAtIndex.side_effect = lambda index: self.breakpoints[index]
        self.command = self.enterContext(mock.patch.object(trace, "command", side_effect=self.create))
        self.identity = dict(uuid=points.CORE_UUID, sha256="a" * 64)
        self.verify = self.enterContext(mock.patch.object(trace, "verify_library", return_value=self.identity))
        self.diagnostics = self.enterContext(mock.patch.object(trace, "register",
            side_effect=lambda **kw: self.memory.registers[kw["name"]]))
        self.pc = self.frame.GetPCAddress.return_value
        self.pc.IsValid.return_value = True
        self.module = self.pc.GetModule.return_value
        self.module.GetUUIDString.return_value = points.CORE_UUID
        self.pc.GetFileAddress.side_effect = lambda: points.SITES[self.controller.mode]
        self.frame.GetThread.return_value.GetThreadID.return_value = self.memory.row["thread"]
        self.reset(branch="v5")

    def reset(self, *, branch):
        self.breakpoints = [Breakpoint(identifier=index + 1, owner=self, enabled=True) for index in range(3)]
        self.controller = self.build(branch=branch)
        self.location.GetBreakpoint.side_effect = lambda: self.controller.breakpoints[self.controller.mode]

    def create(self, *, debugger, text):
        self.assertIs(debugger, self.target.GetDebugger())
        self.assertIn("breakpoint set --hardware --disable -s libcccreator.dylib -a ", text)
        self.breakpoints.append(Breakpoint(identifier=len(self.breakpoints) + 1, owner=self))

    def build(self, *, branch):
        return trace.ReshapeTrace(target=self.target, core="/pinned/libcccreator.dylib",
            branch=branch, callback="parent.on_reshape_breakpoint")

    def invoke(self, *, publication=None):
        return self.controller.observe(frame=self.frame, location=self.location,
            publication=self.memory.row if publication is None else publication, read=self.memory.read)

    def v5_point(self, *, index):
        self.memory.v5(index=index)
        self.invoke()
        self.memory.v5_after(stored=False)
        self.invoke()
        self.memory.v5_after(stored=True)
        self.invoke()

    def v6_point(self, *, index, output_index, rule_count):
        self.memory.v6(index=index, output_index=output_index, rule_count=rule_count)
        self.invoke()
        self.memory.v6_after()
        self.invoke()

    def assert_failed_closed(self):
        report = self.controller.report()
        self.assertTrue(report["failed"])
        self.assertFalse(report["complete"])
        self.assertEqual(self.controller.mode, "disabled")
        self.assertTrue(all(not point.IsEnabled() for point in self.controller.breakpoints.values()))
        self.assertTrue(all(point.IsEnabled() for point in self.breakpoints[:3]))
        self.frame.EvaluateExpression.assert_not_called()
        self.frame.GetThread.return_value.GetProcess.return_value.Continue.assert_not_called()
        self.frame.GetThread.return_value.GetProcess.return_value.WriteMemory.assert_not_called()

    def test_only_selected_branch_installs_disabled_hardware_locations(self):
        for branch, names in (("v5", ("v5_x", "v5_y", "v5_store")), ("v6", ("v6_load", "v6_store"))):
            with self.subTest(branch=branch):
                self.command.reset_mock()
                self.reset(branch=branch)
                self.assertEqual(tuple(self.controller.breakpoints), names)
                self.assertFalse(self.controller.report()["complete"])
                self.assertEqual(sum(point.IsEnabled() for point in self.breakpoints), 3)
                commands = [call.kwargs["text"] for call in self.command.call_args_list]
                self.assertEqual(len(commands), len(names))
                for name in names:
                    self.assertTrue(any(f"{points.SITES[name]:#x}" in command for command in commands))
                    self.assertEqual(self.controller.breakpoints[name].callback, "parent.on_reshape_breakpoint")
        self.verify.assert_called_with(library="/pinned/libcccreator.dylib")

    def test_v5_full_106_point_pass_uses_318_callbacks_and_no_fifth_slot(self):
        self.controller.arm()
        for index in range(106):
            self.v5_point(index=index)
        report = self.controller.report()
        self.assertTrue(report["complete"])
        self.assertEqual(report["callbacks"], 318)
        self.assertEqual([row["point_index"] for row in report["events"]], list(range(106)))
        self.assertTrue(all(row["loads_verified"] and row["stores_verified"] for row in report["events"]))
        self.assertLessEqual(max(count for _, _, count in self.history), 4)
        self.assertEqual(sum(point.IsEnabled() for point in self.breakpoints), 3)
        self.assertEqual(report["identity"], self.identity)
        self.assertEqual(report["publication"], self.memory.row)
        self.assertIsNone(report["failure_context"])
        json.dumps(report, allow_nan=False)
        for key in ("renderer_consumption", "gpu_consumption_verified", "product_backend_enabled",
                "target_memory_written", "software_breakpoints_used", "unknown_stops_resumed"):
            self.assertFalse(report[key])

    def test_v6_rule_selected_indices_are_not_a_sequential_106_point_sweep(self):
        self.reset(branch="v6")
        self.controller.arm()
        indices = (77, 74, 77, 0, 105)
        for output_index, index in enumerate(indices):
            self.v6_point(index=index, output_index=output_index, rule_count=len(indices))
        report = self.controller.report()
        self.assertTrue(report["complete"])
        self.assertEqual(report["callbacks"], 10)
        self.assertEqual([row["point_index"] for row in report["events"]], list(indices))
        self.assertEqual([row["output_index"] for row in report["events"]], list(range(5)))
        self.assertLessEqual(max(count for _, _, count in self.history), 4)

    def test_v6_maximum_rule_count_is_bounded_and_completes(self):
        self.reset(branch="v6")
        self.controller.arm()
        for index in range(256):
            self.v6_point(index=index % 106, output_index=index, rule_count=256)
        report = self.controller.report()
        self.assertTrue(report["complete"])
        self.assertEqual(report["callbacks"], 512)
        self.assertEqual(len(report["events"]), 256)

    def test_partial_load_and_store_evidence_cannot_pass(self):
        self.controller.arm()
        self.memory.v5()
        self.invoke()
        self.assertFalse(self.controller.report()["complete"])
        self.memory.v5_after(stored=False)
        self.invoke()
        self.assertFalse(self.controller.report()["complete"])
        self.controller.disable()
        self.assertFalse(self.controller.report()["complete"])
        with self.assertRaisesRegex(ValueError, "rearmed"):
            self.controller.arm()

    def test_arm_is_not_reentrant_and_completed_points_cannot_restart(self):
        self.controller.arm()
        with self.assertRaisesRegex(ValueError, "rearmed"):
            self.controller.arm()
        self.v5_point(index=0)
        self.controller.disable()
        with self.assertRaisesRegex(ValueError, "rearmed"):
            self.controller.arm()
        self.assertFalse(self.controller.report()["complete"])
        self.assertEqual(len(self.controller.events), 1)

    def test_unknown_rotation_mode_disables_owned_points_without_touching_parent(self):
        self.controller.arm()
        with self.assertRaises(KeyError):
            self.controller.switch(mode="foreign")
        self.assertEqual(self.controller.mode, "disabled")
        self.assertTrue(all(not point.IsEnabled() for point in self.controller.breakpoints.values()))
        self.assertTrue(all(point.IsEnabled() for point in self.breakpoints[:3]))
        self.assertFalse(self.controller.report()["complete"])

    def test_invalid_branch_and_unverified_library_do_not_create_breakpoints(self):
        for branch in (None, "v4", "V5", "v5_x", True):
            before = len(self.breakpoints)
            with self.subTest(branch=branch), self.assertRaisesRegex(ValueError, "explicit"):
                self.build(branch=branch)
            self.assertEqual(len(self.breakpoints), before)
        self.verify.side_effect = ValueError("hash mismatch")
        with self.assertRaisesRegex(ValueError, "hash"):
            self.build(branch="v5")
        self.assertEqual(len(self.breakpoints), before)

    def test_creation_failure_disables_already_created_branch_breakpoints(self):
        def fail_second(**kwargs):
            if len(self.breakpoints) == 4:
                raise ValueError("creation failure")
            self.create(**kwargs)
        self.breakpoints = self.breakpoints[:3]
        self.command.side_effect = fail_second
        with self.assertRaisesRegex(ValueError, "creation failure"):
            self.build(branch="v5")
        self.assertFalse(self.breakpoints[-1].IsEnabled())
        self.assertTrue(all(point.IsEnabled() for point in self.breakpoints[:3]))

    def test_creation_must_add_exactly_one_disabled_hardware_breakpoint(self):
        for failure in ("missing", "software", "enabled"):
            with self.subTest(failure=failure):
                self.breakpoints = self.breakpoints[:3]
                def create_bad(**kwargs):
                    if failure != "missing":
                        self.create(**kwargs)
                        self.breakpoints[-1].hardware = failure != "software"
                        self.breakpoints[-1].enabled = failure == "enabled"
                self.command.side_effect = create_bad
                with self.assertRaisesRegex(ValueError, "hardware breakpoint"):
                    self.build(branch="v5")
                self.assertTrue(all(not point.IsEnabled() for point in self.breakpoints[3:]))

    def test_preoccupied_fourth_slot_and_active_software_breakpoints_are_rejected(self):
        for change in ("occupied", "software"):
            self.reset(branch="v5")
            if change == "occupied":
                self.breakpoints.append(Breakpoint(identifier=99, owner=self, enabled=True))
            else:
                self.breakpoints[0].hardware = False
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, "unavailable"):
                self.controller.arm()
            self.assertEqual(self.controller.mode, "disabled")
            self.assertTrue(all(not point.IsEnabled() for point in self.controller.breakpoints.values()))

    def test_slot_rotation_disables_previous_location_before_enabling_next(self):
        self.controller.arm()
        self.memory.v5()
        self.history.clear()
        self.invoke()
        x = self.controller.breakpoints["v5_x"].GetID()
        y = self.controller.breakpoints["v5_y"].GetID()
        x_disabled = next(i for i, (identifier, enabled, _) in enumerate(self.history) if identifier == x and not enabled)
        y_enabled = next(i for i, (identifier, enabled, _) in enumerate(self.history) if identifier == y and enabled)
        self.assertLess(x_disabled, y_enabled)
        self.assertLessEqual(max(count for _, _, count in self.history), 4)

    def test_inventory_limit_is_checked_before_enumeration(self):
        self.target.GetNumBreakpoints.side_effect = lambda: 17
        self.target.GetBreakpointAtIndex.reset_mock()
        with self.assertRaisesRegex(ValueError, "inventory"):
            self.controller.arm()
        self.target.GetBreakpointAtIndex.assert_not_called()
        self.assertEqual(self.controller.mode, "disabled")

    def test_foreign_disabled_or_wrong_branch_breakpoint_fails_closed(self):
        for kind in ("foreign", "disabled", "branch"):
            self.reset(branch="v5")
            self.controller.arm()
            self.memory.v5()
            point = self.controller.breakpoints["v5_x"]
            if kind == "foreign":
                self.location.GetBreakpoint.side_effect = lambda: self.breakpoints[0]
            elif kind == "disabled":
                point.SetEnabled(False)
            else:
                self.location.GetBreakpoint.side_effect = lambda: self.controller.breakpoints["v5_store"]
            with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, "identity"):
                self.invoke()
            self.assert_failed_closed()

    def test_uuid_pc_thread_and_hardware_scope_are_pinned(self):
        cases = ((self.pc, "IsValid", False), (self.pc, "GetFileAddress", points.SITES["v5_x"] + 4),
            (self.module, "GetUUIDString", "foreign"),
            (self.frame.GetThread.return_value, "GetThreadID", self.memory.row["thread"] + 1))
        for target, method, value in cases:
            self.reset(branch="v5")
            self.controller.arm()
            self.memory.v5()
            with self.subTest(method=method), mock.patch.object(target, method, return_value=value), \
                    self.assertRaisesRegex(ValueError, "scope"):
                self.invoke()
            self.assert_failed_closed()
        self.reset(branch="v5")
        self.controller.arm()
        self.memory.v5()
        self.controller.breakpoints["v5_x"].hardware = False
        with self.assertRaisesRegex(ValueError, "scope"):
            self.invoke()
        self.assert_failed_closed()

    def test_publication_binding_graph_thread_and_flags_cannot_change_within_pass(self):
        for key in self.memory.row:
            self.reset(branch="v5")
            self.controller.arm()
            self.memory.v5()
            self.invoke()
            self.memory.v5_after(stored=False)
            value = self.memory.row[key]
            changed = (not value) if type(value) is bool else (value + 8 if type(value) is int else "foreign")
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "publication changed|scope"):
                self.invoke(publication=self.memory.row | {key: changed})
            self.assert_failed_closed()

    def test_v5_first_point_cannot_skip_to_one(self):
        self.controller.arm()
        self.memory.v5(index=1)
        with self.assertRaisesRegex(ValueError, "skipped or repeated"):
            self.invoke()
        self.assert_failed_closed()

    def test_v5_repeated_point_cannot_count_as_progress(self):
        self.controller.arm()
        self.v5_point(index=0)
        self.memory.v5(index=0)
        with self.assertRaisesRegex(ValueError, "skipped or repeated"):
            self.invoke()
        self.assertEqual(len(self.controller.events), 1)
        self.assert_failed_closed()

    def test_v6_rule_order_and_end_must_stay_pinned(self):
        for output_index, rule_count in ((0, 3), (2, 3), (1, 4)):
            self.reset(branch="v6")
            self.controller.arm()
            self.v6_point(index=74, output_index=0, rule_count=3)
            self.memory.v6(index=77, output_index=output_index, rule_count=rule_count)
            with self.subTest(output_index=output_index, rule_count=rule_count), \
                    self.assertRaisesRegex(ValueError, "skipped or repeated"):
                self.invoke()
            self.assert_failed_closed()

    def test_callback_ceiling_is_enforced_before_reading_memory(self):
        self.controller.arm()
        self.memory.v5()
        self.controller.callbacks = 767
        self.invoke()
        self.assertEqual(self.controller.callbacks, 768)
        self.memory.reads.clear()
        with self.assertRaisesRegex(ValueError, "budget"):
            self.invoke()
        self.assertEqual(self.memory.reads, [])
        self.assert_failed_closed()

    def test_unarmed_late_and_failed_callbacks_never_resume_or_pass(self):
        with self.assertRaisesRegex(ValueError, "scope"):
            self.invoke()
        self.assert_failed_closed()
        self.reset(branch="v6")
        self.controller.arm()
        self.v6_point(index=74, output_index=0, rule_count=1)
        with self.assertRaisesRegex(ValueError, "rearmed"):
            self.controller.arm()
        with self.assertRaisesRegex(ValueError, "scope"):
            self.invoke()
        self.assert_failed_closed()
        with self.assertRaisesRegex(ValueError, "scope"):
            self.invoke()
        with self.assertRaisesRegex(ValueError, "rearmed"):
            self.controller.arm()

    def test_diagnostic_register_failure_does_not_replace_original_error(self):
        self.controller.arm()
        self.memory.v5()
        self.memory.registers["x12"] += 8
        self.diagnostics.side_effect = RuntimeError("unavailable register")
        with self.assertRaisesRegex(ValueError, "X load mismatch"):
            self.invoke()
        context = self.controller.report()["failure_context"]
        self.assertEqual(context["stage"], "v5_x")
        self.assertEqual(len(context["registers"]), 9)
        self.assertTrue(all(value is None for value in context["registers"].values()))
        json.dumps(context, allow_nan=False)
        self.assert_failed_closed()

    def test_failed_store_preserves_bounded_diagnostics_but_not_completed_event(self):
        self.controller.arm()
        self.memory.v5()
        self.invoke()
        self.memory.v5_after(stored=False)
        self.invoke()
        self.memory.v5_after(stored=True)
        self.memory.memory[self.memory.destination] ^= 1
        with self.assertRaisesRegex(ValueError, "stored conversion"):
            self.invoke()
        report = self.controller.report()
        self.assertEqual(report["events"], [])
        self.assertEqual(report["failure_context"]["stage"], "v5_store")
        self.assertEqual(report["failure_context"]["pending"]["point_index"], 0)
        self.assertEqual(report["failure_context"]["registers"]["x12"], self.memory.row["owned_points"])
        self.assertLess(len(json.dumps(report)), 8192)
        self.assert_failed_closed()


class ReshapeDebuggerReportTests(unittest.TestCase):
    def setUp(self):
        self.harness = debugger_fixtures.LauncherDiagnosticsTests()
        self.addCleanup(self.harness.doCleanups)
        self.harness.setUp()
        self.constructor = self.enterContext(mock.patch.object(trace, "ReshapeTrace"))
        self.controller = self.constructor.return_value
        self.controller.report.return_value = dict(complete=False, failed=False, failure_context=None,
            events=[], renderer_consumption=False, gpu_consumption_verified=False,
            product_backend_enabled=False)

    def configure(self, *, branch="v5", exited=True):
        self.harness.config.update(trace_reshape_points=branch, cold_frame=True, core="/pinned/core")
        self.harness.config_path.write_text(json.dumps(self.harness.config))
        if exited:
            self.harness.fixture.process.GetState.return_value = 10
            self.harness.fixture.process.GetExitStatus.return_value = 0

    def test_incomplete_trace_cannot_be_a_successful_debugger_report(self):
        self.configure()
        report = self.harness.run_launcher()
        self.assertFalse(report["passed"])
        self.assertIn("incomplete reshape", report["failures"][0])
        self.assertFalse(report["reshape_trace"]["complete"])
        self.constructor.assert_called_once_with(target=self.harness.fixture.target, core="/pinned/core",
            branch="v5", callback="face_live_bridge_lldb.on_reshape_breakpoint")

    def test_completed_trace_is_diagnostic_success_not_renderer_acceptance(self):
        self.configure(branch="v6")
        self.controller.report.return_value["complete"] = True
        report = self.harness.run_launcher()
        self.assertTrue(report["passed"])
        self.assertEqual(self.constructor.call_args.kwargs["branch"], "v6")
        for key in ("renderer_consumption", "gpu_consumption_verified", "product_backend_enabled"):
            self.assertFalse(report["reshape_trace"][key])
        self.harness.fixture.process.Continue.assert_not_called()
        self.harness.fixture.process.Kill.assert_not_called()

    def test_unknown_stop_is_captured_then_killed_even_with_completed_point_trace(self):
        self.configure(exited=False)
        self.controller.report.return_value["complete"] = True
        report = self.harness.run_launcher()
        self.assertFalse(report["passed"])
        self.assertTrue(report["reshape_trace"]["complete"])
        self.assertEqual(report["unexpected_stop_policy"], "capture-then-kill-never-resume")
        self.assertTrue(report["unexpected_stops"])
        self.harness.fixture.process.Kill.assert_called_once()
        self.harness.fixture.process.Continue.assert_not_called()
        self.harness.fixture.process.StepInstruction.assert_not_called()

    def test_default_debugger_configuration_never_constructs_reshape_trace(self):
        self.configure(branch=None)
        report = self.harness.run_launcher()
        self.assertTrue(report["passed"])
        self.constructor.assert_not_called()
        self.assertNotIn("reshape_trace", report)


if __name__ == "__main__":
    unittest.main()
