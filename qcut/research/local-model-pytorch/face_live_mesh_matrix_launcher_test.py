"""Explicit matrix flags and callback budgets without invoking the native host."""
import argparse
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import face_live_bridge_lldb as bridge
import face_live_bridge_probe as probe
import face_live_mesh_launcher_test as fixtures


class MatrixLauncherTests(unittest.TestCase):
    run_preparation = fixtures.MeshLauncherTests.run_preparation

    def setUp(self):
        # Reuse the asset-free launcher fixture without inheriting its test cases.
        fixtures.fixtures.BundleFixture.setUp(self)
        self.frames = self.frames[:1]
        self.write_manifest()
        for name in ("runtime", "package", "models"):
            (self.root / name).mkdir()
        self.args = argparse.Namespace(runtime=self.root / "runtime", package=self.root / "package",
            root=self.root / "models", manifest=self.manifest, out=self.root / "prepared", timeout=2,
            execute_native=False, lease=None, single_frame=True, cold_frame=True,
            trace_makeup_system=True, publish_makeup_candidate=True, stage_makeup_render=True,
            trace_mesh_points=True, trace_mesh_matrices=True)

    write_manifest = fixtures.fixtures.BundleFixture.write_manifest

    def test_matrices_require_mesh_before_any_preparation(self):
        self.args.trace_mesh_points = False
        with mock.patch.object(probe.sequence, "fresh_output") as fresh:
            with self.assertRaisesRegex(ValueError, "matrix tracing requires mesh"):
                probe.run(args=self.args)
            fresh.assert_not_called()

    def test_preparation_replays_both_flags_without_claiming_success(self):
        result, native = self.run_preparation()
        native.assert_not_called()
        self.assertTrue(result["mesh_copy_diagnostics"])
        self.assertTrue(result["mesh_matrix_diagnostics"])
        self.assertIn("--trace-mesh-points", result["command"])
        self.assertIn("--trace-mesh-matrices", result["command"])
        self.assertFalse(result["passed"])
        self.assertFalse(result["native_execution_performed"])

    def test_disabled_flag_is_explicit_in_preparation(self):
        self.args.trace_mesh_matrices = False
        result, native = self.run_preparation()
        native.assert_not_called()
        self.assertFalse(result["mesh_matrix_diagnostics"])
        self.assertNotIn("--trace-mesh-matrices", result["command"])

    def test_config_contains_matrix_flag_but_publication_still_insufficient(self):
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
        self.assertTrue(config["trace_mesh_matrices"])
        self.assertNotIn("--trace-mesh-matrices", scope.spawn.call_args_list[1].kwargs["command"])

    def test_debugger_rejects_matrix_without_mesh_before_target_creation(self):
        with tempfile.TemporaryDirectory() as temporary:
            path, report = Path(temporary) / "config.json", Path(temporary) / "report.json"
            path.write_text(json.dumps(dict(trace_mesh_matrices=True, trace_mesh_points=False, report=str(report))))
            debugger = mock.Mock()
            with mock.patch.dict("sys.modules", lldb=mock.Mock()), mock.patch("builtins.print"):
                bridge.run(debugger=debugger, config_path=path)
            debugger.CreateTarget.assert_not_called()
            self.assertIn("matrix tracing requires mesh", json.loads(report.read_text())["failures"][0])

    def test_callback_only_calls_mesh_adapter_without_extra_matrix_attribute(self):
        state = argparse.Namespace(started=0, index=1, matrix_callbacks=0, failures=[], mesh=mock.Mock())
        frame, location = mock.Mock(), mock.Mock()
        with mock.patch.object(bridge, "STATE", state), mock.patch.object(bridge.time, "monotonic", return_value=1):
            self.assertFalse(bridge.on_matrix_breakpoint(frame, location, {}))
            state.mesh.observe_matrix.assert_called_once_with(frame=frame, location=location,
                prediction=1, timestamp_us=0, face_id=0)
            state.mesh.observe_matrix.side_effect = ValueError("matrix mismatch")
            self.assertTrue(bridge.on_matrix_breakpoint(frame, location, {}))
        self.assertEqual(state.failures, ["ValueError: matrix mismatch"])
        frame.EvaluateExpression.assert_not_called()

    def test_callback_count_time_and_prediction_are_bounded(self):
        for index, count, elapsed in ((0, 0, 1), (2, 0, 1), (1, 64, 1), (1, 0, 241)):
            state = argparse.Namespace(started=0, index=index, matrix_callbacks=count, failures=[], mesh=mock.Mock())
            with self.subTest(index=index, count=count, elapsed=elapsed), mock.patch.object(bridge, "STATE", state), \
                    mock.patch.object(bridge.time, "monotonic", return_value=elapsed):
                self.assertTrue(bridge.on_matrix_breakpoint(mock.Mock(), mock.Mock(), {}))
            state.mesh.observe_matrix.assert_not_called()
            self.assertIn("budget/scope", state.failures[0])


if __name__ == "__main__":
    unittest.main()
