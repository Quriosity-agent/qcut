"""CPU preparation and launcher failure-path tests; target launch is mocked."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import json
from pathlib import Path
import socket
import tempfile
import unittest
from unittest import mock

from PIL import Image

import face_live_bridge_bundle as bundle
import face_live_bridge_probe as probe


class BundleFixture:
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="qcut-live-bundle-", dir="/tmp")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.manifest = self.root / "manifest.json"
        self.out = self.root / "out"
        self.out.mkdir()
        for index in range(2):
            Image.new("RGBA", (8, 8), (50 + 50 * index, 20, 30, 255)).save(self.root / f"image-{index}.png")
        self.frames = [dict(image=f"image-{index}.png", timestamp=index / 30,
                            parameters=dict(eye=50), expect_change=True) for index in range(2)]

    def write_manifest(self):
        self.manifest.write_text(json.dumps(dict(version=1, frames=self.frames)))


class InputAndGuardTests(BundleFixture, unittest.TestCase):
    def test_arbitrary_bounded_manifest_has_fresh_inputs_and_not_exact7_constraint(self):
        self.write_manifest()
        guard = bundle.DependencyGuard()
        frames, dimensions = bundle.prepare_inputs(manifest=self.manifest, out=self.out, guard=guard)
        self.assertEqual(dimensions, (8, 8))
        self.assertEqual(len(frames), 2)
        self.assertNotEqual(frames[0]["input_sha256"], frames[1]["input_sha256"])
        rows, text = bundle.requests(frames=frames, directory=self.out)
        self.assertEqual(len(rows), 8)
        self.assertEqual(sum(row["warmup"] for row in rows), 6)
        self.assertEqual(text.splitlines()[-1], "exit")
        self.assertNotIn("replay", text)
        guard.verify()

    def test_backward_seek_requires_new_processes(self):
        self.frames.extend([dict(self.frames[0], timestamp=0)])
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "backward seek"):
            bundle.prepare_inputs(manifest=self.manifest, out=self.out, guard=bundle.DependencyGuard())

    def test_static_audit_is_explicit_and_does_not_fabricate_distinct_frames(self):
        self.frames = self.frames[:1]
        self.write_manifest()
        frames, dimensions = bundle.prepare_inputs(manifest=self.manifest, out=self.out,
            guard=bundle.DependencyGuard(), single_frame=True)
        self.assertEqual(dimensions, (8, 8))
        self.assertEqual(len(frames), 1)
        rows, _ = bundle.requests(frames=frames, directory=self.out)
        self.assertEqual(sum(not row["warmup"] for row in rows), 1)
        self.frames.append(dict(self.frames[0]))
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "exactly one"):
            bundle.prepare_inputs(manifest=self.manifest, out=self.out,
                guard=bundle.DependencyGuard(), single_frame=True)

    def test_cold_frame_plan_has_no_repeated_input_and_scoped_host_opt_in(self):
        self.frames = self.frames[:1]
        self.write_manifest()
        frames, _ = bundle.prepare_inputs(manifest=self.manifest, out=self.out,
            guard=bundle.DependencyGuard(), single_frame=True)
        rows, command = bundle.requests(frames=frames, directory=self.out, cold_frame=True)
        self.assertEqual(len(rows), 1)
        self.assertFalse(rows[0]["warmup"])
        self.assertEqual(rows[0]["id"], "frame-00")
        self.assertNotIn("warmup-", command)
        with self.assertRaisesRegex(ValueError, "exactly one"):
            bundle.requests(frames=frames * 2, directory=self.out, cold_frame=True)
        kwargs = dict(runtime=self.root, directory=self.out, width=8, height=8,
                      live=True, socket=self.root / "private.sock", token="new", capture=self.root / "new.dylib")
        self.assertEqual(bundle.host_environment(**kwargs, cold_frame=True)["QCUT_FACE_LIVE_COLD_FRAME"], "1")
        self.assertNotIn("QCUT_FACE_LIVE_COLD_FRAME", bundle.host_environment(**kwargs))
        with self.assertRaisesRegex(ValueError, "explicit single-frame"):
            probe.run(args=argparse.Namespace(cold_frame=True, single_frame=False))
        with self.assertRaisesRegex(ValueError, "stage diagnostics require cold-frame"):
            probe.run(args=argparse.Namespace(trace_stages=True))
        with self.assertRaisesRegex(ValueError, "makeup system observation requires cold-frame"):
            probe.run(args=argparse.Namespace(trace_makeup_system=True, cold_frame=False, single_frame=True))
        with self.assertRaisesRegex(ValueError, "publication requires explicit system observation"):
            probe.run(args=argparse.Namespace(publish_makeup_candidate=True, cold_frame=True, single_frame=True))
        with self.assertRaisesRegex(ValueError, "render stages require explicit candidate publication"):
            probe.run(args=argparse.Namespace(stage_makeup_render=True, cold_frame=True, single_frame=True))
        with self.assertRaisesRegex(ValueError, "XY observation requires explicit render stages"):
            probe.run(args=argparse.Namespace(trace_makeup_points=True))
        with self.assertRaisesRegex(ValueError, "consumption requires independent XY observation"):
            probe.run(args=argparse.Namespace(consume_makeup_candidate=True))
        with self.assertRaisesRegex(ValueError, "share one hardware slot"):
            probe.run(args=argparse.Namespace(trace_makeup_points=True, trace_face_readers=True,
                stage_makeup_render=True, publish_makeup_candidate=True, trace_makeup_system=True,
                cold_frame=True, single_frame=True))

    def test_nonzero_bootstrap_and_constant_frame_claims_rejected(self):
        for case in ("bootstrap", "same"):
            self.frames[0]["timestamp"] = 1 if case == "bootstrap" else 0
            self.frames[1]["image"] = self.frames[0]["image"] if case == "same" else "image-1.png"
            self.write_manifest()
            with self.subTest(case=case), self.assertRaises(ValueError):
                bundle.prepare_inputs(manifest=self.manifest, out=self.out, guard=bundle.DependencyGuard())

    def test_static_controls_preserve_one_original_and_distinct_parameters(self):
        self.frames = [dict(self.frames[0], parameters=dict(eye=value)) for value in (20, 40)]
        self.write_manifest()
        frames, _ = bundle.prepare_inputs(manifest=self.manifest, out=self.out,
            guard=bundle.DependencyGuard(), static_controls=True)
        self.assertEqual(frames[0]["input_sha256"], frames[1]["input_sha256"])
        self.assertNotEqual(frames[0]["parameters"], frames[1]["parameters"])

    def test_static_controls_reject_changed_pixels_time_identical_parameters_and_scope_conflict(self):
        for case in ("pixels", "timestamp", "parameters", "scope"):
            self.frames = [dict(image="image-0.png", timestamp=0, parameters=dict(eye=value),
                                expect_change=True) for value in (20, 40)]
            if case == "pixels":
                self.frames[1]["image"] = "image-1.png"
            if case == "timestamp":
                self.frames[1]["timestamp"] = 1
            if case == "parameters":
                self.frames[1]["parameters"] = dict(eye=20)
            self.write_manifest()
            with self.subTest(case=case), self.assertRaises(ValueError):
                bundle.prepare_inputs(manifest=self.manifest, out=self.out,
                    guard=bundle.DependencyGuard(), static_controls=True, single_frame=case == "scope")

    def test_source_guards_include_header_and_exclude_tests(self):
        source = self.root / "sources"
        source.mkdir()
        header = source / "face_live_bridge_response.h"
        header.write_text("frozen response contract")
        test = source / "allowed_test.py"
        test.write_text("initial test")
        guard = bundle.DependencyGuard()
        guard.tree(directory=source, source=True)
        test.write_text("test changed")
        guard.verify()
        self.assertIn(str(header.resolve()), guard.evidence()["trees"][0]["files"])
        header.write_text("changed response contract")
        with self.assertRaises(ValueError):
            guard.verify()

    def test_source_tree_additions_and_original_image_mutation_rejected(self):
        source = self.root / "sources"
        source.mkdir()
        (source / "fixed.py").write_text("fixed")
        guard = bundle.DependencyGuard()
        guard.tree(directory=source, source=True)
        (source / "new.h").write_text("new")
        with self.assertRaises(ValueError):
            guard.verify()
        self.write_manifest()
        guard = bundle.DependencyGuard()
        bundle.prepare_inputs(manifest=self.manifest, out=self.out, guard=guard)
        (self.root / "image-1.png").write_bytes(b"different")
        with self.assertRaises(ValueError):
            guard.verify()

    def test_environment_discards_inherited_replay_and_dyld_values(self):
        with mock.patch.dict(bundle.os.environ, {"QCUT_FACE_REPLAY": "old", "DYLD_INSERT_LIBRARIES": "foreign",
                                              "LD_PRELOAD": "foreign", "QCUT_FACE_BIND_EYE_SHIFT": "0.02"}):
            env = bundle.host_environment(runtime=self.root, directory=self.out, width=8, height=8)
        self.assertNotIn("QCUT_FACE_REPLAY", env)
        self.assertNotIn("DYLD_INSERT_LIBRARIES", env)
        self.assertNotIn("LD_PRELOAD", env)
        live = bundle.host_environment(runtime=self.root, directory=self.out, width=8, height=8,
                    live=True, socket=self.root / "private.sock", token="new", capture=self.root / "new.dylib")
        self.assertEqual(live["DYLD_INSERT_LIBRARIES"], str(self.root / "new.dylib"))
        self.assertEqual(live["QCUT_FACE_POINT_SHIFT"], "0")

    def test_compile_commands_never_execute_host_and_keep_unused_override_local(self):
        commands = bundle.compile_commands(runtime=self.root, out=self.out)
        for command in commands.values():
            self.assertEqual(command[:2], ["xcrun", "clang++"])
        self.assertIn("-Wno-unused-function", commands["capture"])
        self.assertNotIn("-Wno-unused-function", commands["live"])
        self.assertIn("-Wl,-export_dynamic", commands["live"])

    def test_large_library_uses_streaming_identity_and_exact_pinned_sha(self):
        path = self.root / "large-library.dylib"
        fingerprint = dict(sha256="a" * 64, identity=[str(path), 1, 2, 139012160, 4])
        guard = bundle.DependencyGuard()
        with mock.patch.object(bundle, "file_fingerprint", return_value=fingerprint):
            guard.library(path=path, expected="a" * 64)
            guard.verify()
            with self.assertRaisesRegex(ValueError, "SHA256 mismatch"):
                guard.library(path=path, expected="b" * 64)
        changed = dict(fingerprint, identity=[str(path), 1, 3, 139012160, 4])
        with mock.patch.object(bundle, "file_fingerprint", return_value=changed):
            with self.assertRaisesRegex(RuntimeError, "identity changed"):
                guard.verify()


class FakeScope:
    def __init__(self, *, directory):
        self.directory = directory
        self.cleanup, self.history = dict(completed=False, failures=[]), []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.cleanup["completed"] = True

    def spawn(self, *, command, environment, stdout):
        if command[:2] != ["xcrun", "clang++"]:
            raise AssertionError("unexpected native launch from CPU preparation")
        stdout.write_text("mock compiler, no native execution\n")
        Path(command[-1]).write_bytes(b"not executable; test compiler output")
        return mock.Mock(pid=100 + len(self.history))

    def wait(self, **kwargs):
        return dict(returncode=0)

    def finish(self, **kwargs):
        pass


class LauncherTests(BundleFixture, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.write_manifest()
        for name in ("runtime", "package", "models"):
            (self.root / name).mkdir()
        self.args = argparse.Namespace(runtime=self.root / "runtime", package=self.root / "package",
            root=self.root / "models", manifest=self.manifest, out=self.root / "prepared", execute_native=False,
            lease=None, timeout=2)

    def run_preparation(self, *, execute=None, verify=None):
        def fresh(*, path):
            path.mkdir()
            return path

        models = mock.Mock(provenance=dict(models={}))
        models.verify.side_effect = verify
        with mock.patch.object(probe.sequence, "fresh_output", side_effect=fresh), \
                mock.patch.object(bundle, "lock_dependencies"), mock.patch.object(probe, "ProcessScope", FakeScope), \
                mock.patch.object(probe, "OnnxHeads", return_value=models), \
                mock.patch.object(probe, "execute", side_effect=execute) as native:
            result = probe.run(args=self.args)
        return result, native

    def test_default_prepares_only_never_claims_live_success(self):
        result, native = self.run_preparation()
        self.assertTrue(result["prepared"])
        self.assertTrue(result["completed"])
        self.assertFalse(result["passed"])
        self.assertFalse(result["native_execution_performed"])
        self.assertFalse(result["bounded_native_dependent_rgba_parity"])
        self.assertFalse(result["makeup_render_stage_research"])
        native.assert_not_called()
        self.assertTrue((self.args.out / "report.json").is_file())
        self.assertIn("live-host", result["artifacts"])

    def test_explicit_debugger_is_guarded_and_reproduced_without_native_launch(self):
        for name in ("lldb_executable", "debugserver"):
            path = self.root / (name + " with spaces")
            path.write_bytes(b"synthetic executable, not invoked")
            path.chmod(0o700)
            setattr(self.args, name, path)
        result, native = self.run_preparation()
        self.assertTrue(result["completed"])
        self.assertFalse(result["passed"])
        for name, option in (("lldb_executable", "--lldb-executable"), ("debugserver", "--debugserver")):
            self.assertIn(option, result["command"])
            self.assertIn(str(getattr(self.args, name)), result["command"])
        self.assertIn("debugger", result)
        native.assert_not_called()

    def test_invalid_explicit_debugger_fails_before_compilation_or_execution(self):
        self.args.lldb_executable = self.root / "missing-lldb"
        result, native = self.run_preparation()
        self.assertFalse(result["completed"])
        self.assertFalse(result["prepared"])
        self.assertNotIn("compile_commands", result)
        self.assertFalse(result["native_execution_performed"])
        native.assert_not_called()

    def test_explicit_debugger_command_preserves_literal_argv(self):
        path = self.root / "lldb ; literal $(command)"
        path.write_bytes(b"fixture, never executed")
        path.chmod(0o700)
        default = probe.lldb_command(config=self.out / "lldb-config.json")
        explicit = probe.lldb_command(config=self.out / "lldb-config.json", executable=path)
        self.assertEqual(default[:2], ["xcrun", "lldb"])
        self.assertEqual(explicit, [str(path.resolve()), *default[2:]])

    def test_makeup_publication_preparation_preserves_explicit_research_scope(self):
        self.frames = self.frames[:1]
        self.write_manifest()
        self.args.single_frame = self.args.cold_frame = True
        self.args.trace_makeup_system = self.args.publish_makeup_candidate = True
        self.args.stage_makeup_render = True
        self.args.trace_makeup_points = True
        self.args.rotate_makeup_points = True
        self.args.consume_makeup_candidate = True
        self.args.trace_stages = True
        result, native = self.run_preparation()
        self.assertTrue(result["prepared"])
        self.assertTrue(result["completed"])
        self.assertTrue(result["makeup_publication_research"])
        self.assertTrue(result["makeup_render_stage_research"])
        self.assertTrue(result["makeup_point_observation"])
        self.assertTrue(result["makeup_point_rotation"])
        self.assertTrue(result["makeup_consumption_research"])
        self.assertTrue(result["stage_diagnostics"])
        self.assertFalse(result["passed"])
        self.assertFalse(result["live_callback_handoff_verified"])
        self.assertFalse(result["product_backend_registered"])
        self.assertEqual(result["warmup_request_count"], 0)
        for option in ("--single-frame", "--cold-frame", "--trace-makeup-system", "--publish-makeup-candidate",
                       "--stage-makeup-render", "--trace-makeup-points", "--rotate-makeup-points",
                       "--consume-makeup-candidate", "--trace-stages"):
            self.assertIn(option, result["command"])
        native.assert_not_called()

    def test_makeup_publication_cannot_pass_from_successful_host_protocol_alone(self):
        self.args.trace_makeup_system = self.args.publish_makeup_candidate = True
        self.args.stage_makeup_render = True
        scope = mock.Mock()
        report = dict(cold_frame_audit=True, manifest_sha256="a" * 64)
        executable = self.root / "alternate lldb"
        executable.write_bytes(b"fixture, never executed")
        executable.chmod(0o700)
        report["debugger"] = dict(executable=str(executable.resolve()),
                                 environment_overrides={"LLDB_DEBUGSERVER_PATH": "/explicit/server"})
        with mock.patch.object(probe.sequence, "bounded_bytes", return_value=b""), \
                mock.patch.object(probe.audit, "protocol", return_value=dict(passed=True)), \
                mock.patch.object(probe.audit, "render_outputs") as render_outputs:
            with self.assertRaisesRegex(ValueError, "publication alone cannot establish landmark consumption"):
                probe.execute(args=self.args, out=self.out, frames=[], dimensions=(8, 8),
                    requests=dict(baseline=[], live=[]), models=mock.Mock(), guard=mock.Mock(),
                    scope=scope, report=report)
        self.assertEqual(report["phase"], "live-audit")
        self.assertNotIn("live_checks_completed", report)
        render_outputs.assert_not_called()
        baseline_env = scope.spawn.call_args_list[0].kwargs["environment"]
        self.assertNotIn("QCUT_FACE_LIVE_MAKEUP_TRACE", baseline_env)
        self.assertNotIn("QCUT_FACE_LIVE_MAKEUP_PUBLISH", baseline_env)
        self.assertNotIn("QCUT_FACE_LIVE_MAKEUP_STAGES", baseline_env)
        self.assertNotIn("LLDB_DEBUGSERVER_PATH", baseline_env)
        debugger_spawn = scope.spawn.call_args_list[-1].kwargs
        self.assertEqual(debugger_spawn["command"][0], str(executable.resolve()))
        self.assertEqual(debugger_spawn["environment"]["LLDB_DEBUGSERVER_PATH"], "/explicit/server")
        config = json.loads((self.out / "lldb-config.json").read_text())
        self.assertEqual(config["environment"]["QCUT_FACE_LIVE_MAKEUP_TRACE"], "1")
        self.assertEqual(config["environment"]["QCUT_FACE_LIVE_MAKEUP_PUBLISH"], "1")
        self.assertEqual(config["environment"]["QCUT_FACE_LIVE_MAKEUP_STAGES"], "1")

    def test_read_proof_survives_final_host_rejection_without_becoming_render_success(self):
        self.args.trace_makeup_points = True
        self.args.trace_makeup_system = self.args.publish_makeup_candidate = self.args.stage_makeup_render = True
        proof = dict(candidate_xy_reads_verified=True, renderer_consumption=False)
        report = dict(cold_frame_audit=True, manifest_sha256="a" * 64)
        with mock.patch.object(probe.sequence, "bounded_bytes", return_value=b"{}"), \
                mock.patch.object(probe.audit, "json_lines", return_value=[]), \
                mock.patch.object(probe.point_audit, "audit", return_value=proof) as audit_points, \
                mock.patch.object(probe.audit, "protocol", side_effect=[{}, ValueError("final consumption missing")]):
            with self.assertRaisesRegex(ValueError, "final consumption missing"):
                probe.execute(args=self.args, out=self.out, frames=[], dimensions=(8, 8),
                    requests=dict(baseline=[], live=[]), models=mock.Mock(), guard=mock.Mock(),
                    scope=mock.Mock(), report=report)
        audit_points.assert_called_once()
        self.assertEqual(report["makeup_point_audit"], proof)
        self.assertNotIn("live_checks_completed", report)
        config = json.loads((self.out / "lldb-config.json").read_text())
        self.assertTrue(config["trace_makeup_points"])
        self.assertFalse(config["trace_face_readers"])

    def test_makeup_consumer_difference_is_retained_without_accepting_frame(self):
        self.args.consume_makeup_candidate = self.args.trace_makeup_points = True
        self.args.trace_makeup_system = self.args.publish_makeup_candidate = self.args.stage_makeup_render = True
        proof = dict(renderer_consumption=True, product_parity_verified=False)
        difference = dict(frame=0, equal=False, changed_pixels=3970)
        report = dict(cold_frame_audit=True, manifest_sha256="a" * 64)
        with mock.patch.object(probe.sequence, "bounded_bytes", return_value=b"{}"), \
                mock.patch.object(probe.audit, "json_lines", return_value=[]), \
                mock.patch.object(probe.makeup_audit, "audit", return_value=proof) as receipt, \
                mock.patch.object(probe.audit, "protocol", return_value={}), \
                mock.patch.object(probe.audit, "inference", return_value=dict(seed_predictions=[0], owned_point_groups=2)), \
                mock.patch.object(probe.audit, "validate_audits", return_value={}), \
                mock.patch.object(probe.audit, "render_outputs", return_value=[difference]) as render:
            with self.assertRaisesRegex(ValueError, "zero-tolerance makeup render mismatch"):
                probe.execute(args=self.args, out=self.out, frames=[], dimensions=(8, 8),
                    requests=dict(baseline=[], live=[]), models=mock.Mock(), guard=mock.Mock(),
                    scope=mock.Mock(), report=report)
        receipt.assert_called_once()
        self.assertEqual(report["makeup_render_audit"], proof)
        self.assertEqual(report["frames"], [difference])
        self.assertFalse(render.call_args.kwargs["require_equal"])
        self.assertNotIn("live_checks_completed", report)
        config = json.loads((self.out / "lldb-config.json").read_text())
        self.assertEqual(config["environment"]["QCUT_FACE_LIVE_MAKEUP_CONSUME"], "1")

    def test_makeup_consumer_cannot_skip_receipt_validation(self):
        self.args.consume_makeup_candidate = self.args.trace_makeup_points = True
        report = dict(cold_frame_audit=True, manifest_sha256="a" * 64)
        with mock.patch.object(probe.sequence, "bounded_bytes", return_value=b"{}"), \
                mock.patch.object(probe.audit, "json_lines", return_value=[]), \
                mock.patch.object(probe.makeup_audit, "audit", side_effect=ValueError("bad geometry receipt")), \
                mock.patch.object(probe.audit, "protocol", return_value={}), \
                mock.patch.object(probe.audit, "render_outputs") as render:
            with self.assertRaisesRegex(ValueError, "bad geometry receipt"):
                probe.execute(args=self.args, out=self.out, frames=[], dimensions=(8, 8),
                    requests=dict(baseline=[], live=[]), models=mock.Mock(), guard=mock.Mock(),
                    scope=mock.Mock(), report=report)
        render.assert_not_called()
        self.assertNotIn("live_checks_completed", report)


    def test_stable_host_is_external_guarded_and_lease_outlives_cleanup_and_report(self):
        directory = self.root / "stable"
        directory.mkdir()
        host = directory / "live-host"
        host.write_bytes(b"signed fixture")
        self.args.stable_host = True
        closed = []

        @contextmanager
        def lease(*, audit, cleanup):
            yield directory
            self.assertTrue(cleanup["completed"])
            self.assertTrue((audit / "report.json").is_file())
            closed.append(True)

        def prepare(**kwargs):
            kwargs["guard"].locked.read(path=host)
            return dict(path=str(host), reused=True)

        with mock.patch.object(probe.host_identity, "helper_lease", side_effect=lease), \
                mock.patch.object(probe.host_identity, "prepare_host", side_effect=prepare):
            result, _ = self.run_preparation()
        self.assertTrue(result["completed"])
        self.assertNotIn("live", result["compile_commands"])
        self.assertNotIn("live-host", result["artifacts"])
        self.assertIn(str(host), result["dependencies"]["files"])
        self.assertEqual(result["host_identity"]["path"], str(host))
        self.assertIn("--stable-host", result["command"])
        self.assertEqual(closed, [True])

    def test_native_requires_explicit_lease_before_any_artifact(self):
        self.args.execute_native = True
        with self.assertRaisesRegex(ValueError, "lease"):
            probe.run(args=self.args)
        self.assertFalse(self.args.out.exists())

    def test_static_matrix_scope_and_dynamic_package_are_explicit_and_hash_guarded(self):
        self.frames = [dict(self.frames[0], parameters=dict(eye=value)) for value in (20, 40)]
        self.write_manifest()
        self.args.static_controls = True
        card = self.root / "makeup-card"
        card.mkdir()
        (card / "config.json").write_text("{}")
        self.args.additional_packages = [card]
        result, native = self.run_preparation()
        self.assertTrue(result["completed"])
        self.assertTrue(result["static_controls_audit"])
        self.assertFalse(result["single_frame_audit"])
        self.assertFalse(result["temporal_sequence_acceptance"])
        self.assertEqual(result["scope"], "static-controls-native-dependent-live-audit")
        self.assertIn("--static-controls", result["command"])
        self.assertIn("--additional-package", result["command"])
        self.assertEqual(result["additional_packages"], [str(card.resolve())])
        self.assertIn(str((card / "config.json").resolve()), result["dependencies"]["trees"][0]["files"])
        native.assert_not_called()

    def test_single_frame_preparation_reports_only_static_scope(self):
        self.frames = self.frames[:1]
        self.write_manifest()
        self.args.single_frame = True
        result, native = self.run_preparation()
        self.assertTrue(result["completed"])
        self.assertTrue(result["single_frame_audit"])
        self.assertFalse(result["temporal_sequence_acceptance"])
        self.assertFalse(result["product_backend_registered"])
        self.assertEqual(result["scope"], "single-frame-native-dependent-live-audit")
        self.assertIn("--single-frame", result["command"])
        native.assert_not_called()

    def test_timeout_retains_evidence_without_permission_bypass_or_algorithm_claim(self):
        def timeout(**kwargs):
            kwargs["report"].update(phase="live-native-lldb", native_execution_performed=True)
            raise TimeoutError("deliberate CPU-test stall")

        self.args.execute_native, self.args.lease = True, "CPU-test-mocked-no-native"
        result, native = self.run_preparation(execute=timeout)
        native.assert_called_once()
        self.assertFalse(result["passed"])
        self.assertFalse(result["completed"])
        self.assertTrue(result["cleanup"]["completed"])
        self.assertEqual(result["timeout_diagnostic"]["classification"], "native-launch-not-confirmed")
        self.assertFalse(result["timeout_diagnostic"]["permission_bypass_attempted"])
        self.assertFalse(result["timeout_diagnostic"]["algorithm_failure_inferred"])
        self.assertTrue((self.args.out / "report.json").is_file())

    def test_late_source_model_guard_failure_revokes_readiness(self):
        result, _ = self.run_preparation(verify=[None, ValueError("model source changed")])
        self.assertTrue(result["prepared"])
        self.assertFalse(result["completed"])
        self.assertFalse(result["dependencies_unchanged"])
        self.assertEqual(result["failures"][-1]["phase"], "final-provenance")

    def test_worker_readiness_uses_private_socket_without_connecting(self):
        path = self.root / "ready.stdout"
        sockpath = self.root / "worker.sock"
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
            server.bind(str(sockpath))
            sockpath.chmod(0o600)
            path.write_text(json.dumps(dict(ready=True, socket=str(sockpath), backend_version="model")) + "\n")
            self.assertTrue(probe.worker_ready(path=path, socket=sockpath))
            sockpath.chmod(0o644)
            with self.assertRaises(ValueError):
                probe.worker_ready(path=path, socket=sockpath)

    def test_lldb_command_imports_python_path_before_frozen_observer(self):
        command = probe.lldb_command(config=self.root / "config.json")
        joined = " ".join(command)
        self.assertLess(joined.index("sys.path.insert"), joined.index("command script import"))
        self.assertIn("--no-lldbinit", command)
        self.assertNotIn("/tmp/live-host", joined)


if __name__ == "__main__":
    unittest.main()
