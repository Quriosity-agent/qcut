"""CPU-only Extra diagnostic command, opt-in, and observer-report guards."""
import argparse
import json
from pathlib import Path
import shlex
import tempfile
import unittest
from unittest import mock

import face_live_bridge_lldb as bridge
import face_live_bridge_probe as probe
import face_live_bridge_probe_test as fixtures


class ExtraLauncherTests(fixtures.BundleFixture, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.frames = self.frames[:1]
        self.write_manifest()
        for name in ("runtime", "package", "models"):
            (self.root / name).mkdir()
        self.args = argparse.Namespace(runtime=self.root / "runtime", package=self.root / "package",
            root=self.root / "models", manifest=self.manifest, out=self.root / "prepared", execute_native=False,
            lease=None, timeout=2, single_frame=True, cold_frame=True, trace_stages=True,
            trace_extra_stages=True, consume_makeup_candidate=True, trace_makeup_points=True,
            stage_makeup_render=True, publish_makeup_candidate=True, trace_makeup_system=True)

    run_preparation = fixtures.LauncherTests.run_preparation

    def test_all_required_explicit_flags_are_checked_before_preparation(self):
        cases = [(dict(trace_stages=False), "paired stages and makeup consumption"),
            (dict(consume_makeup_candidate=False), "paired stages and makeup consumption"),
            (dict(cold_frame=False), "stage diagnostics require cold-frame"),
            (dict(single_frame=False), "explicit single-frame"),
            (dict(trace_makeup_points=False), "independent XY observation"),
            (dict(stage_makeup_render=False), "explicit render stages"),
            (dict(publish_makeup_candidate=False), "explicit candidate publication"),
            (dict(trace_makeup_system=False), "explicit system observation"),
            (dict(trace_face_readers=True), "share one hardware slot"),
            (dict(static_controls=True), "mutually exclusive"),
            (dict(execute_native=True), "explicit parent GPU lease")]
        with mock.patch.object(probe.sequence, "fresh_output") as fresh, \
                mock.patch.object(probe, "ProcessScope") as processes, \
                mock.patch.object(probe, "OnnxHeads") as models:
            for overrides, message in cases:
                args = argparse.Namespace(**(vars(self.args) | overrides))
                with self.subTest(overrides=overrides), self.assertRaisesRegex(ValueError, message):
                    probe.run(args=args)
            fresh.assert_not_called()
            processes.assert_not_called()
            models.assert_not_called()

    def test_preparation_reports_opt_in_and_reproducible_command_without_live_success(self):
        result, native = self.run_preparation()
        self.assertTrue(result["prepared"])
        self.assertTrue(result["completed"])
        self.assertIs(result["extra_stage_diagnostics"], True)
        self.assertIs(result["stage_diagnostics"], True)
        for key in ("passed", "native_execution_performed", "live_checks_completed",
                "product_parity_verified", "native_final_point_input_used", "captured_tensor_input_used",
                "bounded_native_dependent_rgba_parity", "product_backend_registered"):
            self.assertIs(result[key], False)
        native.assert_not_called()
        command = shlex.split(result["command"])
        for flag in ("--trace-extra-stages", "--trace-stages", "--consume-makeup-candidate",
                "--trace-makeup-points", "--stage-makeup-render", "--publish-makeup-candidate",
                "--trace-makeup-system", "--single-frame", "--cold-frame"):
            self.assertEqual(command.count(flag), 1)
        self.assertNotIn("--execute-native", command)
        self.assertNotIn("--lease", command)
        self.assertIn("--no-lldbinit", probe.lldb_command(config=self.out / "config.json"))
        self.assertEqual(command[command.index("--out") + 1], str(self.args.out) + "-rerun")

    def test_extra_trace_is_not_implied_by_other_diagnostics(self):
        self.args.trace_extra_stages = False
        result, native = self.run_preparation()
        self.assertIs(result["extra_stage_diagnostics"], False)
        self.assertNotIn("--trace-extra-stages", shlex.split(result["command"]))
        native.assert_not_called()

    def test_cli_parses_new_flag_explicitly_and_defaults_off(self):
        required = ["probe", "--runtime", "/unused/runtime", "--package", "/unused/package",
            "--root", "/unused/models", "--manifest", "/unused/manifest.json", "--out", "/unused/out"]
        response = dict(passed=False, prepared=True, completed=True, phase="prepare", failures=[])
        for extra in ([], ["--trace-extra-stages"]):
            with self.subTest(extra=extra), mock.patch("sys.argv", required + extra), \
                    mock.patch.object(probe, "run", return_value=response) as run, mock.patch("builtins.print"):
                self.assertEqual(probe.main(), 0)
            args = run.call_args.kwargs["args"]
            self.assertIs(args.trace_extra_stages, bool(extra))
            self.assertIs(args.execute_native, False)
            self.assertIsNone(args.lease)

    def test_execute_forwards_opt_in_to_debugger_not_worker(self):
        for enabled in (False, True):
            self.args.trace_extra_stages = enabled
            out = self.out / str(enabled)
            (out / "live").mkdir(parents=True)
            scope = mock.Mock()
            with self.subTest(enabled=enabled), \
                    mock.patch.object(probe.sequence, "bounded_bytes", return_value=b"{}"), \
                    mock.patch.object(probe.audit, "protocol", return_value={}), \
                    mock.patch.object(probe.audit, "json_lines", return_value=[]), \
                    mock.patch.object(probe.makeup_audit, "audit", side_effect=ValueError("mock stop after launch")):
                with self.assertRaisesRegex(ValueError, "mock stop after launch"):
                    probe.execute(args=self.args, out=out, frames=[], dimensions=(8, 8),
                        requests=dict(baseline=[], live=[]), models=mock.Mock(), guard=mock.Mock(),
                        scope=scope, report=dict(cold_frame_audit=True, manifest_sha256="a" * 64))
            config = json.loads((out / "lldb-config.json").read_text())
            self.assertIs(config["trace_extra_stages"], enabled)
            self.assertIs(config["trace_makeup_points"], True)
            commands = [call.kwargs["command"] for call in scope.spawn.call_args_list]
            self.assertEqual(len(commands), 3)
            self.assertNotIn("--trace-extra-stages", commands[1])
            self.assertEqual(commands[2], probe.lldb_command(config=out / "lldb-config.json"))

    def test_cli_extra_root_and_model_trace_are_explicit_and_default_off(self):
        required = ["probe", "--runtime", "/unused/runtime", "--package", "/unused/package",
            "--root", "/unused/models", "--manifest", "/unused/manifest.json", "--out", "/unused/out"]
        response = dict(passed=False, prepared=True, completed=True, phase="prepare", failures=[])
        for enabled in (False, True):
            extra = ["--extra-root", "/unused/extra", "--trace-extra-model", "--trace-extra-stages"] if enabled else []
            with self.subTest(enabled=enabled), mock.patch("sys.argv", required + extra), \
                    mock.patch.object(probe, "run", return_value=response) as run, mock.patch("builtins.print"):
                self.assertEqual(probe.main(), 0)
            args = run.call_args.kwargs["args"]
            self.assertEqual(args.extra_root, Path("/unused/extra") if enabled else None)
            self.assertIs(args.trace_extra_model, enabled)
            self.assertIs(args.execute_native, False)

    def test_extra_root_requires_cold_paired_consumption_before_any_preparation(self):
        cases = [dict(cold_frame=False, trace_stages=False), dict(trace_stages=False),
                 dict(consume_makeup_candidate=False), dict(single_frame=False)]
        with mock.patch.object(probe.sequence, "fresh_output") as fresh, \
                mock.patch.object(probe, "ProcessScope") as processes, \
                mock.patch.object(probe, "OnnxHeads") as models:
            for overrides in cases:
                args = argparse.Namespace(**(vars(self.args) | dict(trace_extra_stages=False,
                    extra_root=self.root / "does-not-exist") | overrides))
                with self.subTest(overrides=overrides), self.assertRaisesRegex(ValueError, "Extra refinement|cold-frame"):
                    probe.run(args=args)
            fresh.assert_not_called()
            processes.assert_not_called()
            models.assert_not_called()

    def test_model_trace_requires_boundary_trace_before_any_preparation(self):
        args = argparse.Namespace(**(vars(self.args) | dict(trace_extra_stages=False, trace_extra_model=True)))
        with mock.patch.object(probe.sequence, "fresh_output") as fresh, \
                mock.patch.object(probe, "ProcessScope") as processes, \
                mock.patch.object(probe, "OnnxHeads") as models:
            with self.assertRaisesRegex(ValueError, "Extra model diagnostics require boundary diagnostics"):
                probe.run(args=args)
            fresh.assert_not_called()
            processes.assert_not_called()
            models.assert_not_called()

    def test_execute_forwards_extra_root_and_native_switch_only_when_enabled(self):
        extra_root = self.root / "extra-models"
        extra_root.mkdir()
        for enabled in (False, True):
            args = argparse.Namespace(**(vars(self.args) | dict(
                extra_root=extra_root if enabled else None, trace_extra_model=enabled)))
            out = self.out / ("extra-enabled" if enabled else "extra-default")
            (out / "live").mkdir(parents=True)
            scope = mock.Mock()
            with self.subTest(enabled=enabled), \
                    mock.patch.object(probe.sequence, "bounded_bytes", return_value=b"{}"), \
                    mock.patch.object(probe.audit, "protocol", return_value={}), \
                    mock.patch.object(probe.audit, "json_lines", return_value=[]), \
                    mock.patch.object(probe.makeup_audit, "audit", side_effect=ValueError("stop after mocked launch")):
                with self.assertRaisesRegex(ValueError, "stop after mocked launch"):
                    probe.execute(args=args, out=out, frames=[], dimensions=(8, 8),
                        requests=dict(baseline=[], live=[]), models=mock.Mock(), guard=mock.Mock(),
                        scope=scope, report=dict(cold_frame_audit=True, manifest_sha256="a" * 64))
            commands = [call.kwargs["command"] for call in scope.spawn.call_args_list]
            self.assertEqual(len(commands), 3)
            worker_command = commands[1]
            config = json.loads((out / "lldb-config.json").read_text())
            self.assertEqual(worker_command.count("--extra-root"), int(enabled))
            self.assertIs(config["trace_extra_model"], enabled)
            self.assertNotIn("--trace-extra-model", worker_command)
            if enabled:
                self.assertEqual(worker_command[worker_command.index("--extra-root") + 1], str(extra_root.resolve()))
                self.assertEqual(config["environment"]["QCUT_FACE_LIVE_EXTRA_REFINEMENT"], "1")
            else:
                self.assertNotIn("QCUT_FACE_LIVE_EXTRA_REFINEMENT", config["environment"])


class ExtraCallbackTests(unittest.TestCase):
    def test_callback_uses_readonly_extra_observer_without_advancing_worker(self):
        frame, location = mock.Mock(), mock.Mock()
        state = mock.Mock(started=0, failures=[], index=1, events=[])
        with mock.patch.object(bridge, "STATE", state), \
                mock.patch.object(bridge.time, "monotonic", return_value=1):
            self.assertFalse(bridge.on_extra_breakpoint(frame, location, {}))
        state.extra.observe.assert_called_once_with(frame=frame, location=location, read=state.read)
        self.assertEqual(state.index, 1)
        self.assertEqual(state.events, [])
        state.handle.assert_not_called()
        frame.EvaluateExpression.assert_not_called()

    def test_callback_timeout_and_observer_rejection_stop_and_record_failure(self):
        for elapsed, failure in ((241, None), (1, ValueError("bad Extra scope"))):
            state = mock.Mock(started=0, failures=[])
            state.extra.observe.side_effect = failure
            with self.subTest(elapsed=elapsed), mock.patch.object(bridge, "STATE", state), \
                    mock.patch.object(bridge.time, "monotonic", return_value=elapsed):
                self.assertTrue(bridge.on_extra_breakpoint(mock.Mock(), mock.Mock(), {}))
            self.assertEqual(len(state.failures), 1)
            self.assertIn("budget exceeded" if elapsed == 241 else "bad Extra scope", state.failures[0])
            if elapsed == 241:
                state.extra.observe.assert_not_called()


class ExtraDebuggerReportTests(unittest.TestCase):
    def test_extra_requires_xy_and_conflicts_with_getters_before_target_creation(self):
        for xy, getters, message in ((False, False, "require the makeup XY observer"),
                                     (True, True, "share one hardware slot")):
            with self.subTest(xy=xy, getters=getters), tempfile.TemporaryDirectory() as temporary:
                path, report = Path(temporary) / "config.json", Path(temporary) / "report.json"
                path.write_text(json.dumps(dict(trace_extra_stages=True, trace_makeup_points=xy,
                    trace_face_readers=getters, report=str(report))))
                debugger = mock.Mock()
                with mock.patch.dict("sys.modules", {"lldb": mock.Mock()}), \
                        mock.patch.object(bridge, "STATE", mock.Mock()), mock.patch("builtins.print"):
                    bridge.run(debugger=debugger, config_path=path)
                debugger.CreateTarget.assert_not_called()
                result = json.loads(report.read_text())
                self.assertFalse(result["passed"])
                self.assertNotIn("events", result)
                self.assertIn(message, result["failures"][0])

    def test_incomplete_extra_report_blocks_success_even_with_zero_process_exit(self):
        for complete in (False, True):
            with self.subTest(complete=complete), tempfile.TemporaryDirectory() as temporary:
                path, report = Path(temporary) / "config.json", Path(temporary) / "report.json"
                config = dict(host="unused-host", lens="unused-lens", core="unused-core", arguments=[],
                    environment={}, trace_extra_stages=True, trace_makeup_points=True,
                    stdin="unused-in", stdout="unused-out", stderr="unused-err", report=str(report))
                path.write_text(json.dumps(config))
                debugger, target, process, state = (mock.Mock() for _ in range(4))
                lldb = mock.Mock(eStateExited=10, eStopReasonNone=1, eLaunchFlagDisableASLR=8)
                lldb.SBLaunchInfo.return_value.GetLaunchFlags.return_value = 8
                lldb.SBError.return_value.Fail.return_value = False
                debugger.CreateTarget.return_value = target
                target.IsValid.return_value = True
                target.GetTriple.return_value = "arm64-test"
                target.Launch.return_value = process
                process.GetState.return_value, process.GetExitStatus.return_value = 10, 0
                process.GetProcessID.return_value = 123
                process.GetNumThreads.return_value = 0
                state.failures, state.events, state.index, state.callbacks = [], [], 1, 6
                state.point_hits, state.point_events = 2, []
                extra = mock.Mock()
                extra.report.return_value = dict(complete=complete, events=[], product_parity_verified=False)
                breakpoints = []
                def add_breakpoint(**kwargs):
                    point = mock.Mock()
                    point.IsHardware.return_value = True
                    breakpoints.append(point)
                target.GetNumBreakpoints.side_effect = lambda: len(breakpoints)
                target.GetBreakpointAtIndex.side_effect = breakpoints.__getitem__
                with mock.patch.dict("sys.modules", {"lldb": lldb}), \
                        mock.patch.object(bridge, "STATE", None), mock.patch("builtins.print"), \
                        mock.patch.object(bridge, "Observer", return_value=state), \
                        mock.patch.object(bridge, "command", side_effect=add_breakpoint), \
                        mock.patch.object(bridge.point_trace, "install", side_effect=add_breakpoint), \
                        mock.patch.object(bridge, "ExtraTrace", return_value=extra) as constructor:
                    bridge.run(debugger=debugger, config_path=path)
                self.assertIs(constructor.call_args.kwargs["point_breakpoint"], breakpoints[-1])
                self.assertEqual(constructor.call_args.kwargs["callback"], bridge.__name__ + ".on_extra_breakpoint")
                result = json.loads(report.read_text())
                self.assertIs(result["passed"], complete)
                self.assertEqual(result["extra_trace"], extra.report.return_value)
                self.assertFalse(result["target_memory_written"])
                self.assertFalse(result["target_functions_evaluated"])
                if not complete:
                    self.assertIn("incomplete Extra call/return diagnostics", result["failures"][0])
                process.Kill.assert_not_called()


if __name__ == "__main__":
    unittest.main()
