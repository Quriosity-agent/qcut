"""Native mesh observations stay separate from candidate consumption proof."""
import argparse
import json
import tempfile
from pathlib import Path
import unittest
from unittest import mock

import face_live_bridge_lldb as bridge
import face_live_bridge_probe as probe
import face_live_bridge_probe_test as fixtures


class MeshLauncherTests(fixtures.BundleFixture, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.frames = self.frames[:1]
        self.write_manifest()
        for name in ("runtime", "package", "models"):
            (self.root / name).mkdir()
        self.args = argparse.Namespace(runtime=self.root / "runtime", package=self.root / "package",
            root=self.root / "models", manifest=self.manifest, out=self.root / "prepared", timeout=2,
            execute_native=False, lease=None, single_frame=True, cold_frame=True,
            trace_makeup_system=True, publish_makeup_candidate=True, stage_makeup_render=True,
            trace_mesh_points=True)

    run_preparation = fixtures.LauncherTests.run_preparation

    def test_conflicts_are_rejected_before_preparation(self):
        cases = [dict(single_frame=False), dict(cold_frame=False), dict(stage_makeup_render=False)]
        cases.extend({key: True} for key in ("trace_face_readers", "trace_makeup_points",
            "rotate_makeup_points", "consume_makeup_candidate", "trace_extra_stages",
            "trace_extra_model", "publish_reshape_candidate"))
        with mock.patch.object(probe.sequence, "fresh_output") as fresh:
            for overrides in cases:
                args = argparse.Namespace(**(vars(self.args) | overrides))
                with self.subTest(overrides=overrides), self.assertRaisesRegex(ValueError, "exclusive cold"):
                    probe.run(args=args)
            fresh.assert_not_called()

    def test_prepare_does_not_claim_native_or_candidate_success(self):
        result, native = self.run_preparation()
        native.assert_not_called()
        self.assertTrue(result["mesh_copy_diagnostics"])
        self.assertIn("--trace-mesh-points", result["command"])
        for key in ("passed", "live_checks_completed", "native_execution_performed",
                    "product_backend_registered", "bounded_native_dependent_rgba_parity"):
            self.assertFalse(result[key])

    def test_config_is_explicit_and_publication_gate_still_rejects_mesh_only(self):
        (self.out / "live").mkdir(parents=True)
        scope = mock.Mock()
        with mock.patch.object(probe.sequence, "bounded_bytes", return_value=b"{}"), \
                mock.patch.object(probe.audit, "protocol", return_value={}), \
                mock.patch.object(probe.audit, "render_outputs") as renders:
            with self.assertRaisesRegex(ValueError, "publication alone"):
                probe.execute(args=self.args, out=self.out, frames=[], dimensions=(8, 8),
                    requests=dict(baseline=[], live=[]), models=mock.Mock(), guard=mock.Mock(), scope=scope,
                    report=dict(cold_frame_audit=True, manifest_sha256="a" * 64))
        renders.assert_not_called()
        config = json.loads((self.out / "lldb-config.json").read_text())
        self.assertTrue(config["trace_mesh_points"])
        self.assertTrue(config["cold_frame"])
        self.assertFalse(config["trace_makeup_points"])
        self.assertNotIn("--trace-mesh-points", scope.spawn.call_args_list[1].kwargs["command"])

    def test_debugger_rejects_nonexclusive_slot_before_target_creation(self):
        for overrides in (dict(cold_frame=False), dict(trace_face_readers=True),
                          dict(trace_makeup_points=True), dict(trace_extra_stages=True)):
            with self.subTest(overrides=overrides), tempfile.TemporaryDirectory() as temporary:
                path, report = Path(temporary) / "config.json", Path(temporary) / "report.json"
                path.write_text(json.dumps(dict(trace_mesh_points=True, cold_frame=True,
                    report=str(report)) | overrides))
                debugger = mock.Mock()
                with mock.patch.dict("sys.modules", {"lldb": mock.Mock()}), mock.patch("builtins.print"):
                    bridge.run(debugger=debugger, config_path=path)
                debugger.CreateTarget.assert_not_called()
                self.assertIn("exclusive cold", json.loads(report.read_text())["failures"][0])

    def test_callback_preserves_readonly_scope_and_stops_on_failure(self):
        frame, location = mock.Mock(), mock.Mock()
        state = mock.Mock(started=0, index=1, mesh_callbacks=0, failures=[])
        with mock.patch.object(bridge, "STATE", state), mock.patch.object(bridge.time, "monotonic", return_value=1):
            self.assertFalse(bridge.on_mesh_breakpoint(frame, location, {}))
            state.mesh.observe.assert_called_once_with(frame=frame, location=location, prediction=1,
                timestamp_us=0, face_id=0, read=state.read)
            state.mesh.observe.side_effect = ValueError("mesh mismatch")
            self.assertTrue(bridge.on_mesh_breakpoint(frame, location, {}))
        self.assertEqual(state.failures, ["ValueError: mesh mismatch"])
        state.process.Continue.assert_not_called()
        frame.EvaluateExpression.assert_not_called()

    def test_callback_budget_and_prediction_are_bounded(self):
        for index, count, elapsed in ((0, 0, 1), (1, 12, 1), (1, 0, 241)):
            state = mock.Mock(started=0, index=index, mesh_callbacks=count, failures=[])
            with self.subTest(index=index, count=count), mock.patch.object(bridge, "STATE", state), \
                    mock.patch.object(bridge.time, "monotonic", return_value=elapsed):
                self.assertTrue(bridge.on_mesh_breakpoint(mock.Mock(), mock.Mock(), {}))
            state.mesh.observe.assert_not_called()


if __name__ == "__main__":
    unittest.main()
