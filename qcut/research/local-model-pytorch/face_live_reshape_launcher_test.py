"""Explicit reshape publication cannot satisfy renderer acceptance."""
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
import face_live_reshape_points as points


class ReshapeLauncherTests(fixtures.BundleFixture, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.frames = self.frames[:1]
        self.write_manifest()
        for name in ("runtime", "package", "models"):
            (self.root / name).mkdir()
        self.args = argparse.Namespace(runtime=self.root / "runtime", package=self.root / "package",
            root=self.root / "models", manifest=self.manifest, out=self.root / "prepared", timeout=2,
            execute_native=False, lease=None, single_frame=True, cold_frame=True,
            publish_reshape_candidate=True)

    run_preparation = fixtures.LauncherTests.run_preparation

    def test_incompatible_scopes_rejected_before_preparation(self):
        cases = [dict(single_frame=False), dict(cold_frame=False), dict(static_controls=True),
                 dict(extra_root=Path("/unused/extra"))]
        cases.extend({key: True} for key in ("trace_makeup_system", "publish_makeup_candidate",
            "stage_makeup_render", "trace_makeup_points", "rotate_makeup_points",
            "consume_makeup_candidate", "trace_extra_stages", "trace_extra_model"))
        with mock.patch.object(probe.sequence, "fresh_output") as fresh:
            for overrides in cases:
                args = argparse.Namespace(**(vars(self.args) | overrides))
                with self.subTest(overrides=overrides), self.assertRaisesRegex(ValueError, "exclusive cold"):
                    probe.run(args=args)
            fresh.assert_not_called()

    def test_prepare_and_replay_keep_research_scope_without_native_success(self):
        result, native = self.run_preparation()
        native.assert_not_called()
        self.assertTrue(result["prepared"])
        self.assertTrue(result["reshape_publication_research"])
        for key in ("passed", "live_checks_completed", "product_backend_registered",
                    "bounded_native_dependent_rgba_parity", "makeup_publication_research"):
            self.assertFalse(result[key])
        command = shlex.split(result["command"])
        self.assertEqual(command.count("--publish-reshape-candidate"), 1)
        self.assertNotIn("--publish-makeup-candidate", command)

    def test_switch_defaults_off_and_requires_explicit_cli_opt_in(self):
        required = ["probe", "--runtime", "/r", "--package", "/p", "--root", "/m",
                    "--manifest", "/manifest", "--out", "/out"]
        response = dict(passed=False, prepared=True, completed=True, phase="prepare", failures=[])
        for enabled in (False, True):
            flags = ["--publish-reshape-candidate"] if enabled else []
            with self.subTest(enabled=enabled), mock.patch("sys.argv", required + flags), \
                    mock.patch.object(probe, "run", return_value=response) as run, mock.patch("builtins.print"):
                self.assertEqual(probe.main(), 0)
            self.assertIs(run.call_args.kwargs["args"].publish_reshape_candidate, enabled)

    def test_host_only_flag_and_publication_gate_are_not_bypassed(self):
        (self.out / "live").mkdir(parents=True)
        scope = mock.Mock()
        with mock.patch.object(probe.sequence, "bounded_bytes", return_value=b"{}"), \
                mock.patch.object(probe.audit, "protocol", return_value={}), \
                mock.patch.object(probe.audit, "callbacks") as callbacks, \
                mock.patch.object(probe.audit, "render_outputs") as renders:
            with self.assertRaisesRegex(ValueError, "reshape publication alone"):
                probe.execute(args=self.args, out=self.out, frames=[], dimensions=(8, 8),
                    requests=dict(baseline=[], live=[]), models=mock.Mock(), guard=mock.Mock(), scope=scope,
                    report=dict(cold_frame_audit=True, manifest_sha256="a" * 64))
        callbacks.assert_not_called()
        renders.assert_not_called()
        config = json.loads((self.out / "lldb-config.json").read_text())
        self.assertEqual(config["environment"]["QCUT_FACE_LIVE_RESHAPE_PUBLISH"], "1")
        self.assertNotIn("QCUT_FACE_LIVE_MAKEUP_PUBLISH", config["environment"])
        worker = scope.spawn.call_args_list[1].kwargs
        self.assertNotIn("QCUT_FACE_LIVE_RESHAPE_PUBLISH", worker["environment"])
        self.assertNotIn("--publish-reshape-candidate", worker["command"])


class ReshapePointLauncherTests(fixtures.BundleFixture, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.frames = self.frames[:1]
        self.write_manifest()
        for name in ("runtime", "package", "models"):
            (self.root / name).mkdir()
        self.args = argparse.Namespace(runtime=self.root / "runtime", package=self.root / "package",
            root=self.root / "models", manifest=self.manifest, out=self.root / "prepared", timeout=2,
            execute_native=False, lease=None, single_frame=True, cold_frame=True,
            publish_reshape_candidate=True, trace_reshape_points="v5")

    run_preparation = fixtures.LauncherTests.run_preparation

    def test_explicit_branch_is_forwarded_exactly_once_without_native_success(self):
        for branch in ("v5", "v6"):
            self.args.trace_reshape_points = branch
            self.args.out = self.root / ("prepared-" + branch)
            result, native = self.run_preparation()
            with self.subTest(branch=branch):
                native.assert_not_called()
                self.assertEqual(result["reshape_point_diagnostics"], branch)
                command = shlex.split(result["command"])
                self.assertEqual(command.count("--trace-reshape-points"), 1)
                self.assertEqual(command[command.index("--trace-reshape-points") + 1], branch)
                self.assertEqual(command.count("--publish-reshape-candidate"), 1)
                for key in ("passed", "live_checks_completed", "native_execution_performed",
                        "product_backend_registered", "bounded_native_dependent_rgba_parity"):
                    self.assertFalse(result[key])

    def test_default_does_not_request_reshape_points_or_publication(self):
        self.args.trace_reshape_points = None
        self.args.publish_reshape_candidate = False
        result, native = self.run_preparation()
        native.assert_not_called()
        self.assertIsNone(result["reshape_point_diagnostics"])
        self.assertFalse(result["reshape_publication_research"])
        self.assertNotIn("--trace-reshape-points", shlex.split(result["command"]))
        self.assertNotIn("--publish-reshape-candidate", shlex.split(result["command"]))

    def test_cli_default_and_each_explicit_branch_are_parsed(self):
        required = ["probe", "--runtime", "/r", "--package", "/p", "--root", "/m",
                    "--manifest", "/manifest", "--out", "/out"]
        response = dict(passed=False, prepared=True, completed=True, phase="prepare", failures=[])
        for branch in (None, "v5", "v6"):
            flags = ["--trace-reshape-points", branch] if branch else []
            with self.subTest(branch=branch), mock.patch("sys.argv", required + flags), \
                    mock.patch.object(probe, "run", return_value=response) as run, mock.patch("builtins.print"):
                self.assertEqual(probe.main(), 0)
            self.assertEqual(run.call_args.kwargs["args"].trace_reshape_points, branch)
        with mock.patch("sys.argv", required + ["--trace-reshape-points", "v7"]), \
                mock.patch.object(probe, "run") as run, mock.patch("sys.stderr"), \
                self.assertRaises(SystemExit) as caught:
            probe.main()
        self.assertEqual(caught.exception.code, 2)
        run.assert_not_called()

    def test_all_incompatible_modes_fail_before_preparation(self):
        cases = [dict(single_frame=False), dict(cold_frame=False), dict(static_controls=True),
            dict(extra_root=Path("/unused/extra")), dict(publish_reshape_candidate=False),
            dict(trace_reshape_points="v7")]
        cases.extend({key: True} for key in ("trace_face_readers", "trace_mesh_points", "trace_makeup_system",
            "publish_makeup_candidate", "stage_makeup_render", "trace_makeup_points", "rotate_makeup_points",
            "consume_makeup_candidate", "trace_extra_stages", "trace_extra_model"))
        with mock.patch.object(probe.sequence, "fresh_output") as fresh:
            for branch in ("v5", "v6"):
                for overrides in cases:
                    args = argparse.Namespace(**(vars(self.args) | dict(trace_reshape_points=branch) | overrides))
                    with self.subTest(branch=branch, overrides=overrides), \
                            self.assertRaisesRegex(ValueError, "exclusive"):
                        probe.run(args=args)
            fresh.assert_not_called()

    def test_branch_reaches_debugger_config_but_never_worker_or_acceptance_gate(self):
        for branch in (None, "v5", "v6"):
            out = self.out / (branch or "default")
            (out / "live").mkdir(parents=True)
            self.args.trace_reshape_points = branch
            scope = mock.Mock()
            with self.subTest(branch=branch), \
                    mock.patch.object(probe.sequence, "bounded_bytes", return_value=b"{}"), \
                    mock.patch.object(probe.audit, "protocol", return_value={}), \
                    mock.patch.object(probe.audit, "callbacks") as callbacks, \
                    mock.patch.object(probe.audit, "render_outputs") as renders, \
                    self.assertRaisesRegex(ValueError, "reshape publication alone"):
                probe.execute(args=self.args, out=out, frames=[], dimensions=(8, 8),
                    requests=dict(baseline=[], live=[]), models=mock.Mock(), guard=mock.Mock(), scope=scope,
                    report=dict(cold_frame_audit=True, manifest_sha256="a" * 64))
            callbacks.assert_not_called()
            renders.assert_not_called()
            config = json.loads((out / "lldb-config.json").read_text())
            self.assertEqual(config["trace_reshape_points"], branch)
            self.assertEqual(config["environment"]["QCUT_FACE_LIVE_RESHAPE_PUBLISH"], "1")
            worker = scope.spawn.call_args_list[1].kwargs
            self.assertNotIn("--trace-reshape-points", worker["command"])
            self.assertNotIn("QCUT_FACE_LIVE_RESHAPE_PUBLISH", worker["environment"])

    def test_debugger_rejects_slot_conflicts_before_creating_a_target(self):
        for branch in ("v5", "v6"):
            for overrides in (dict(cold_frame=False), dict(trace_reshape_points="v7"),
                    dict(trace_face_readers=True), dict(trace_makeup_points=True),
                    dict(trace_mesh_points=True), dict(trace_extra_stages=True)):
                with self.subTest(branch=branch, overrides=overrides), tempfile.TemporaryDirectory() as temporary:
                    path, report = Path(temporary) / "config.json", Path(temporary) / "report.json"
                    path.write_text(json.dumps(dict(trace_reshape_points=branch, cold_frame=True,
                        report=str(report)) | overrides))
                    debugger = mock.Mock()
                    with mock.patch.dict("sys.modules", {"lldb": mock.Mock()}), mock.patch("builtins.print"):
                        bridge.run(debugger=debugger, config_path=path)
                    debugger.CreateTarget.assert_not_called()
                    self.assertFalse(json.loads(report.read_text())["passed"])
                    self.assertIn("exclusive cold", json.loads(report.read_text())["failures"][0])


class ReshapeCallbackTests(unittest.TestCase):
    def setUp(self):
        self.state = mock.Mock(started=0, index=1, failures=[], config=dict(report="/tmp/reshape/live/observer.json"))
        self.frame, self.location = mock.Mock(), mock.Mock()
        self.enterContext(mock.patch.object(bridge, "STATE", self.state))
        self.clock = self.enterContext(mock.patch.object(bridge.time, "monotonic", return_value=1))
        self.publication = self.enterContext(mock.patch.object(points, "publication", return_value=dict(binding_id=2)))

    def invoke(self):
        return bridge.on_reshape_breakpoint(self.frame, self.location, {})

    def test_valid_callback_reads_final_publication_and_hands_off_readonly(self):
        self.assertFalse(self.invoke())
        self.publication.assert_called_once_with(path=Path("/tmp/reshape/live/records.jsonl"), prediction=1)
        self.state.reshape.observe.assert_called_once_with(frame=self.frame, location=self.location,
            publication=dict(binding_id=2), read=self.state.read)
        self.state.process.Continue.assert_not_called()
        self.state.process.WriteMemory.assert_not_called()
        self.frame.EvaluateExpression.assert_not_called()

    def test_invalid_prediction_or_timeout_stops_before_reading_publication(self):
        for index, elapsed in ((0, 1), (2, 1), (-1, 1), (1, 240.001)):
            self.state.index, self.clock.return_value = index, elapsed
            with self.subTest(index=index, elapsed=elapsed):
                self.assertTrue(self.invoke())
        self.assertEqual(len(self.state.failures), 4)
        self.publication.assert_not_called()
        self.state.reshape.observe.assert_not_called()
        self.state.process.Continue.assert_not_called()

    def test_exact_deadline_remains_accepted(self):
        self.clock.return_value = 240
        self.assertFalse(self.invoke())
        self.state.reshape.observe.assert_called_once()

    def test_publication_and_observer_errors_stop_without_resuming(self):
        self.publication.side_effect = ValueError("publication identity")
        self.assertTrue(self.invoke())
        self.state.reshape.observe.assert_not_called()
        self.publication.side_effect = None
        self.state.reshape.observe.side_effect = ValueError("unknown stop")
        self.assertTrue(self.invoke())
        self.assertEqual(self.state.failures, ["ValueError: publication identity", "ValueError: unknown stop"])
        self.state.process.Continue.assert_not_called()
        self.state.process.StepInstruction.assert_not_called()


if __name__ == "__main__":
    unittest.main()
