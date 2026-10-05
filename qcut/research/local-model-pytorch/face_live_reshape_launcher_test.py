"""Explicit reshape publication cannot satisfy renderer acceptance."""
import argparse
import json
from pathlib import Path
import shlex
import unittest
from unittest import mock

import face_live_bridge_probe as probe
import face_live_bridge_probe_test as fixtures


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


if __name__ == "__main__":
    unittest.main()
