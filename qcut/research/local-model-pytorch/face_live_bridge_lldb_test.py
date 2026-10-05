"""Bounded read-only stop diagnostics; no debugger or native launch required."""
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

import face_live_bridge_lldb as probe
from face_live_bridge_lldb import process_diagnostics


def diagnostics(*, process):
    return process_diagnostics(process=process, exited_state=10, no_stop_reason=1)


class StopFixture:
    def process(self, *, reason=5):
        frame = mock.Mock()
        frame.GetPC.return_value = 4096
        frame.GetFunctionName.return_value = "native_function"
        thread = mock.Mock()
        thread.GetStopReason.return_value = reason
        thread.GetThreadID.return_value = 7
        thread.GetStopDescription.return_value = "EXC_BAD_ACCESS"
        thread.GetNumFrames.return_value = 2
        thread.GetFrameAtIndex.return_value = frame
        process = mock.Mock()
        process.GetProcessID.return_value = 123
        process.GetState.return_value = 5
        process.GetExitStatus.return_value = -1
        process.GetNumThreads.return_value = 1
        process.GetThreadAtIndex.return_value = thread
        frame.GetThread.return_value = thread
        return process, thread, frame

    def rich_stop(self):
        process, thread, frame = self.process(reason=6)
        process.IsValid.return_value = True
        process.GetStopID.return_value = 120
        thread.GetProcess.return_value = process
        thread.GetNumFrames.return_value = 1
        thread.GetStopDescription.return_value = "EXC_BREAKPOINT (code=1, subcode=0x1000)"
        thread.GetStopReasonDataCount.return_value = 1
        thread.GetStopReasonDataAtIndex.return_value = 6
        target, point, location, address, module = [mock.Mock() for _ in range(5)]
        address.IsValid.return_value = True
        address.GetLoadAddress.return_value = 4096
        address.GetFileAddress.return_value = 0x2c4dac
        address.GetModule.return_value = module
        module.GetUUIDString.return_value = "pinned-test-uuid"
        module.GetFileSpec.return_value.GetFilename.return_value = "liblens.dylib"
        frame.GetPCAddress.return_value = address
        target.GetNumBreakpoints.return_value = 1
        target.GetBreakpointAtIndex.return_value = point
        point.GetNumLocations.return_value = 1
        point.GetLocationAtIndex.return_value = location
        point.GetID.return_value = 1
        point.IsHardware.return_value = True
        point.IsEnabled.return_value = True
        point.GetHitCount.return_value = 59
        location.GetID.return_value = 1
        location.GetBreakpoint.return_value = point
        location.IsEnabled.return_value = True
        location.IsResolved.return_value = True
        location.GetAddress.return_value = address
        location.GetHitCount.return_value = 59
        observer = probe.Observer(target=target, config={})
        observer.process = process
        observer.read = mock.Mock(return_value=bytes.fromhex("1f2003d5"))
        observer.callback_tail = [dict(thread=7, pc=4096, stop_id=119, disposition="return-false")]
        return SimpleNamespace(process=process, thread=thread, frame=frame, target=target, observer=observer,
                               point=point, location=location, address=address, module=module)

    def rich_diagnostics(self, *, fixture):
        with mock.patch.object(probe, "register", return_value=0):
            return process_diagnostics(process=fixture.process, exited_state=10, no_stop_reason=1,
                                       target=fixture.target, observer=fixture.observer)


class StopDiagnosticsTests(StopFixture, unittest.TestCase):
    def test_preserves_original_stop_before_cleanup_kill(self):
        process, thread, frame = self.process()
        result = diagnostics(process=process)
        self.assertEqual(result["state"], 5)
        self.assertEqual(result["exit_status"], -1)
        self.assertEqual(result["unexpected_stops"], [dict(thread=7, reason=5,
            description="EXC_BAD_ACCESS", frames=[dict(pc=4096, symbol="native_function")] * 2)])
        thread.GetStopDescription.assert_called_once_with(1024)
        process.Kill.assert_not_called()
        process.Continue.assert_not_called()
        frame.EvaluateExpression.assert_not_called()

    def test_bounded_threads_frames_and_symbol(self):
        process, thread, frame = self.process()
        process.GetNumThreads.return_value = 10000
        thread.GetNumFrames.return_value = 10000
        frame.GetFunctionName.return_value = "x" * 2000
        result = diagnostics(process=process)
        self.assertEqual(len(result["unexpected_stops"]), 8)
        self.assertEqual(process.GetThreadAtIndex.call_count, 8)
        for row in result["unexpected_stops"]:
            self.assertEqual(len(row["frames"]), 8)
            self.assertEqual(len(row["frames"][0]["symbol"]), 512)

    def test_no_stop_does_not_read_stack_and_missing_symbol_is_safe(self):
        process, thread, frame = self.process(reason=1)
        self.assertEqual(diagnostics(process=process)["unexpected_stops"], [])
        thread.GetFrameAtIndex.assert_not_called()
        thread.GetStopReason.return_value = 5
        frame.GetFunctionName.return_value = None
        self.assertEqual(diagnostics(process=process)["unexpected_stops"][0]["frames"][0]["symbol"], "")

    def test_exited_process_never_reports_invalid_final_thread_frames(self):
        process, thread, _ = self.process()
        process.GetState.return_value = 10
        self.assertEqual(diagnostics(process=process)["unexpected_stops"], [])
        process.GetNumThreads.assert_not_called()
        thread.GetFrameAtIndex.assert_not_called()


class DetailedDiagnosticsTests(StopFixture, unittest.TestCase):
    def test_entry_trap_records_logical_hardware_match_not_permission_to_resume(self):
        fixture = self.rich_stop()
        result = self.rich_diagnostics(fixture=fixture)
        detail = result["unexpected_stops"][0]["detail"]
        self.assertEqual(detail["hardware_matches"], [dict(breakpoint=1, location=1)])
        self.assertEqual(detail["signature"], "arm64-address-trap-form")
        self.assertEqual(detail["reason_data"], [6])
        self.assertEqual(detail["mach_description"]["subcode"], 4096)
        self.assertIn("not raw", detail["mach_description"]["source"])
        self.assertEqual(detail["address"]["uuid"], "pinned-test-uuid")
        self.assertEqual(detail["address"]["file_address"], 0x2c4dac)
        self.assertEqual(detail["last_callback_relation"], dict(same_thread=True, same_pc=True,
                                                               same_stop_id=False, callback_returned_false=True))
        self.assertFalse(detail["instruction"]["arm64_brk"])
        self.assertTrue(detail["instruction"]["software_traps_may_be_removed"])
        self.assertFalse(detail["automatic_resume_allowed"])
        self.assertEqual(detail["cause"], "unresolved-unexpected-stop")
        self.assertFalse(result["breakpoints"]["physical_debug_register_state_verified"])
        fixture.observer.read.assert_called_once_with(address=4096, size=4)
        fixture.process.Continue.assert_not_called()
        fixture.process.Kill.assert_not_called()
        fixture.frame.EvaluateExpression.assert_not_called()

    def test_poll_step_signature_remains_unresolved_and_has_no_entry_match(self):
        fixture = self.rich_stop()
        fixture.frame.GetPC.return_value = 8192
        fixture.frame.GetFunctionName.return_value = "poll"
        fixture.thread.GetStopDescription.return_value = "EXC_BREAKPOINT (code=1, subcode=0x0)"
        fixture.thread.GetStopReasonDataCount.return_value = 3
        fixture.thread.GetStopReasonDataAtIndex.side_effect = [6, 1, 0]
        result = self.rich_diagnostics(fixture=fixture)
        detail = result["unexpected_stops"][0]["detail"]
        self.assertEqual(detail["reason_data"], [6, 1, 0])
        self.assertEqual(detail["signature"], "arm64-step-form")
        self.assertEqual(detail["hardware_matches"], [])
        self.assertFalse(detail["last_callback_relation"]["same_pc"])
        self.assertFalse(detail["automatic_resume_allowed"])
        self.assertEqual(result["unexpected_stop_policy"], "capture-then-kill-never-resume")
        fixture.process.Continue.assert_not_called()

    def test_brk_instruction_is_not_assumed_harmless_from_matching_address(self):
        fixture = self.rich_stop()
        fixture.observer.read.return_value = bytes.fromhex("000020d4")
        detail = self.rich_diagnostics(fixture=fixture)["unexpected_stops"][0]["detail"]
        self.assertTrue(detail["instruction"]["arm64_brk"])
        self.assertFalse(detail["automatic_resume_allowed"])

    def test_disabled_software_unresolved_or_wrong_image_does_not_match(self):
        for case in ("disabled", "software", "unresolved", "disabled-location", "wrong-image", "wrong-offset", "no-uuid"):
            fixture = self.rich_stop()
            if case == "disabled":
                fixture.point.IsEnabled.return_value = False
            if case == "software":
                fixture.point.IsHardware.return_value = False
            if case == "unresolved":
                fixture.location.IsResolved.return_value = False
            if case == "disabled-location":
                fixture.location.IsEnabled.return_value = False
            if case in ("wrong-image", "wrong-offset"):
                other = mock.Mock()
                other.IsValid.return_value = True
                other.GetLoadAddress.return_value = 4096
                other.GetFileAddress.return_value = 0x2c4dac if case == "wrong-image" else 0x1234
                other.GetModule.return_value.GetUUIDString.return_value = "other" if case == "wrong-image" else "pinned-test-uuid"
                other.GetModule.return_value.GetFileSpec.return_value.GetFilename.return_value = "same-name.dylib"
                fixture.location.GetAddress.return_value = other
            if case == "no-uuid":
                fixture.module.GetUUIDString.return_value = None
            with self.subTest(case=case):
                detail = self.rich_diagnostics(fixture=fixture)["unexpected_stops"][0]["detail"]
                self.assertEqual(detail["hardware_matches"], [])

    def test_inventory_and_reason_data_are_bounded(self):
        fixture = self.rich_stop()
        fixture.target.GetNumBreakpoints.return_value = 1000
        fixture.point.GetNumLocations.return_value = 1000
        fixture.thread.GetStopReasonDataCount.return_value = 1000
        result = self.rich_diagnostics(fixture=fixture)
        self.assertEqual(len(result["breakpoints"]["entries"]), 16)
        self.assertTrue(result["breakpoints"]["truncated"])
        fixture.target.GetBreakpointAtIndex.assert_called()
        self.assertEqual(fixture.target.GetBreakpointAtIndex.call_count, 16)
        self.assertEqual(fixture.point.GetLocationAtIndex.call_count, 128)
        detail = result["unexpected_stops"][0]["detail"]
        self.assertEqual(len(detail["reason_data"]), 16)
        self.assertTrue(detail["reason_data_truncated"])

    def test_optional_register_instruction_or_module_failures_preserve_stop(self):
        fixture = self.rich_stop()
        fixture.observer.read.side_effect = ValueError("unreadable")
        fixture.frame.GetPCAddress.side_effect = ValueError("unresolved module")
        with mock.patch.object(probe, "register", side_effect=ValueError("register unavailable")):
            result = process_diagnostics(process=fixture.process, exited_state=10, no_stop_reason=1,
                                         target=fixture.target, observer=fixture.observer)
        detail = result["unexpected_stops"][0]["detail"]
        self.assertEqual(result["unexpected_stops"][0]["reason"], 6)
        self.assertIn("unavailable", detail["address"])
        self.assertIn("unavailable", detail["instruction"])
        self.assertEqual(len(detail["registers"]), 5)
        self.assertTrue(all("unavailable" in value for value in detail["registers"].values()))

    def test_no_stack_or_short_instruction_does_not_invent_instruction(self):
        fixture = self.rich_stop()
        fixture.thread.GetNumFrames.return_value = 0
        result = self.rich_diagnostics(fixture=fixture)
        self.assertNotIn("instruction", result["unexpected_stops"][0]["detail"])
        fixture.observer.read.assert_not_called()
        fixture.thread.GetNumFrames.return_value = 1
        fixture.observer.read.return_value = b"xx"
        detail = self.rich_diagnostics(fixture=fixture)["unexpected_stops"][0]["detail"]
        self.assertIn("short", detail["instruction"]["unavailable"])

    def test_unaligned_or_invalid_pc_never_reads_instruction(self):
        for pc in (0, 4095, 4097, 2**64 - 1):
            fixture = self.rich_stop()
            fixture.frame.GetPC.return_value = pc
            with self.subTest(pc=pc):
                detail = self.rich_diagnostics(fixture=fixture)["unexpected_stops"][0]["detail"]
                self.assertNotIn("instruction", detail)
                fixture.observer.read.assert_not_called()

    def test_description_parsing_never_guesses_other_exceptions_or_partial_strings(self):
        for description in ("EXC_BAD_ACCESS (code=1, subcode=0x0)", "EXC_BREAKPOINT (code=1)",
                            "EXC_BREAKPOINT (code=1, subcode=0x0) trailing", "x" * 5000):
            fixture = self.rich_stop()
            fixture.thread.GetStopDescription.return_value = description
            with self.subTest(description=description[:30]):
                row = self.rich_diagnostics(fixture=fixture)["unexpected_stops"][0]
                self.assertNotIn("signature", row["detail"])
                self.assertLessEqual(len(row["description"]), 1024)
        fixture.thread.GetStopReason.return_value = 3
        fixture.thread.GetStopDescription.return_value = "EXC_BREAKPOINT (code=1, subcode=0x0)"
        self.assertNotIn("signature", self.rich_diagnostics(fixture=fixture)["unexpected_stops"][0]["detail"])

    def test_reason_api_failure_does_not_erase_original_description(self):
        fixture = self.rich_stop()
        fixture.thread.GetStopReasonDataCount.side_effect = RuntimeError("no API data")
        row = self.rich_diagnostics(fixture=fixture)["unexpected_stops"][0]
        self.assertEqual(row["description"], "EXC_BREAKPOINT (code=1, subcode=0x1000)")
        self.assertIn("no API data", row["detail"]["unavailable"])

    def test_callback_tail_tracks_return_false_without_claiming_resume(self):
        fixture = self.rich_stop()
        fixture.observer.callback_tail = []
        fixture.observer.handle = mock.Mock()
        with mock.patch.object(probe, "STATE", fixture.observer):
            for _ in range(20):
                self.assertFalse(probe.on_breakpoint(fixture.frame, fixture.location, {}))
        self.assertEqual(len(fixture.observer.callback_tail), 16)
        self.assertTrue(all(row["disposition"] == "return-false" for row in fixture.observer.callback_tail))
        self.assertEqual(fixture.observer.callback_tail[-1]["stop_id"], 120)
        fixture.process.Continue.assert_not_called()
        fixture.process.Kill.assert_not_called()

    def test_callback_failure_remains_a_stop_and_records_disposition(self):
        fixture = self.rich_stop()
        fixture.observer.handle = mock.Mock(side_effect=ValueError("inference association failed"))
        with mock.patch.object(probe, "STATE", fixture.observer):
            self.assertTrue(probe.on_breakpoint(fixture.frame, fixture.location, {}))
        self.assertEqual(fixture.observer.callback_tail[-1]["disposition"], "return-true-error")
        self.assertEqual(fixture.observer.failures, ["ValueError: inference association failed"])
        fixture.process.Continue.assert_not_called()

    def test_callback_diagnostic_failure_does_not_skip_normal_callback(self):
        fixture = self.rich_stop()
        fixture.process.GetStopID.side_effect = ValueError("metadata unavailable")
        fixture.observer.handle = mock.Mock()
        with mock.patch.object(probe, "STATE", fixture.observer):
            self.assertFalse(probe.on_breakpoint(fixture.frame, fixture.location, {}))
        fixture.observer.handle.assert_called_once()
        self.assertIn("metadata unavailable", fixture.observer.callback_tail[-1]["unavailable"])
        self.assertEqual(fixture.observer.failures, [])


class LauncherDiagnosticsTests(StopFixture, unittest.TestCase):
    def setUp(self):
        private = Path(__file__).resolve().parents[2] / ".local/jianying-model-pytorch"
        temporary = tempfile.TemporaryDirectory(prefix="lldb-diagnostics-test-", dir=private)
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.fixture = self.rich_stop()
        self.fixture.target.IsValid.return_value = True
        self.fixture.target.GetTriple.return_value = "arm64-apple-macosx"
        self.fixture.target.Launch.return_value = self.fixture.process
        self.fixture.process.ReadMemory.return_value = bytes.fromhex("1f2003d5")
        self.fixture.process.Kill.side_effect = lambda: setattr(self.fixture.process.GetState, "return_value", 10)
        self.breakpoints = []
        self.fixture.target.GetNumBreakpoints.side_effect = lambda: len(self.breakpoints)
        self.fixture.target.GetBreakpointAtIndex.side_effect = self.breakpoints.__getitem__
        self.debugger = mock.Mock()
        self.debugger.CreateTarget.return_value = self.fixture.target
        self.debugger.GetVersionString.return_value = "mock LLDB test build"
        error, info = mock.Mock(), mock.Mock()
        error.Fail.return_value = False
        info.GetLaunchFlags.return_value = 7
        info.AddOpenFileAction.return_value = True
        self.lldb = SimpleNamespace(SBError=mock.Mock(return_value=error), SBLaunchInfo=mock.Mock(return_value=info),
                                    eStateExited=10, eStopReasonNone=1, eLaunchFlagDisableASLR=2)
        self.config = {key: str(self.directory / key) for key in ("host", "lens", "stdin", "stdout", "stderr")}
        self.config.update(arguments=[], environment={}, report=str(self.directory / "observer.json"))
        self.config_path = self.directory / "config.json"
        self.config_path.write_text(json.dumps(self.config))
        self.commands = []

    def command(self, *, debugger, text):
        self.commands.append(text)
        if text.startswith("breakpoint set --hardware"):
            self.breakpoints.append(self.fixture.point)
        return ""

    def run_launcher(self, *, command=None):
        with mock.patch.dict("sys.modules", {"lldb": self.lldb}), \
                mock.patch.object(probe, "command", side_effect=command or self.command), \
                mock.patch.object(probe, "register", return_value=0), mock.patch("builtins.print"):
            probe.run(debugger=self.debugger, config_path=self.config_path)
        return json.loads(Path(self.config["report"]).read_text())

    def test_unexpected_trap_captures_before_kill_and_never_resumes(self):
        report = self.run_launcher()
        self.assertFalse(report["passed"])
        self.assertEqual(report["state"], 5)
        self.assertEqual(report["exit_status"], -1)
        self.assertEqual(report["unexpected_stops"][0]["detail"]["signature"], "arm64-address-trap-form")
        self.fixture.process.Kill.assert_called_once()
        self.fixture.process.Continue.assert_not_called()
        self.fixture.process.StepInstruction.assert_not_called()
        self.assertEqual(report["debugger_version"], "mock LLDB test build")
        self.assertEqual(report["debugger_control_log"]["categories"], ["break", "step"])
        self.assertTrue(self.commands[0].startswith("log enable -f "))
        self.assertEqual(self.commands[-1], "log disable lldb break step")
        self.assertFalse(any("continue" in command or "expression" in command for command in self.commands))
        self.assertFalse(report["target_memory_written"])
        self.assertFalse(report["target_functions_evaluated"])

    def test_successful_exit_does_not_require_stop_or_memory_diagnostics(self):
        self.fixture.process.GetState.return_value = 10
        self.fixture.process.GetExitStatus.return_value = 0
        report = self.run_launcher()
        self.assertTrue(report["passed"])
        self.assertEqual(report["unexpected_stops"], [])
        self.fixture.process.ReadMemory.assert_not_called()
        self.fixture.process.Kill.assert_not_called()

    def test_instruction_read_failure_does_not_replace_primary_stop_failure(self):
        self.fixture.process.ReadMemory.side_effect = RuntimeError("instruction read unavailable")
        report = self.run_launcher()
        self.assertEqual(report["failures"], ["RuntimeError: live host stopped or failed"])
        self.assertEqual(report["unexpected_stops"][0]["reason"], 6)
        detail = report["unexpected_stops"][0]["detail"]
        self.assertIn("instruction read unavailable", detail["instruction"]["unavailable"])
        self.fixture.process.Kill.assert_called_once()
        self.fixture.process.Continue.assert_not_called()

    def test_existing_control_log_is_not_replaced_or_launched(self):
        log = self.directory / "debugger-control.log"
        log.write_text("preserve original evidence")
        report = self.run_launcher()
        self.assertFalse(report["passed"])
        self.assertIn("FileExistsError", report["failures"][0])
        self.assertEqual(log.read_text(), "preserve original evidence")
        self.fixture.target.Launch.assert_not_called()

    def test_logging_setup_failure_stops_before_launch(self):
        report = self.run_launcher(command=mock.Mock(side_effect=RuntimeError("logging unavailable")))
        self.assertFalse(report["passed"])
        self.fixture.target.Launch.assert_not_called()
        self.assertIn("logging unavailable", report["failures"][0])

    def test_logging_teardown_failure_is_not_success(self):
        self.fixture.process.GetState.return_value = 10
        self.fixture.process.GetExitStatus.return_value = 0

        def command(*, debugger, text):
            if text == "log disable lldb break step":
                raise RuntimeError("log close failed")
            return self.command(debugger=debugger, text=text)

        report = self.run_launcher(command=command)
        self.assertFalse(report["passed"])
        self.assertIn("log close failed", report["failures"][-1])

    def test_log_budget_failure_revokes_success_without_removing_log(self):
        self.fixture.process.GetState.return_value = 10
        self.fixture.process.GetExitStatus.return_value = 0

        def command(*, debugger, text):
            if text == "log disable lldb break step":
                (self.directory / "debugger-control.log").write_text("over-budget")
            return self.command(debugger=debugger, text=text)

        with mock.patch.object(probe, "CONTROL_LOG_LIMIT", 2):
            report = self.run_launcher(command=command)
        self.assertFalse(report["passed"])
        self.assertIn("exceeded", report["failures"][-1])
        self.assertEqual((self.directory / "debugger-control.log").read_text(), "over-budget")


if __name__ == "__main__":
    unittest.main()
