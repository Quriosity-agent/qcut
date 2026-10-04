"""Stage diagnostic launcher wiring and exact private snapshot inventory."""
import argparse
import json
from pathlib import Path
import unittest
from unittest import mock

import face_live_bridge_probe as probe
from face_live_bridge_probe_test import BundleFixture


class StageLauncherTests(BundleFixture, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.args = argparse.Namespace(runtime=self.root, package=self.root, root=self.root, timeout=2)

    def test_stage_diagnostics_require_exact_private_inventory_and_preserve_failure(self):
        self.args.consume_makeup_candidate = self.args.trace_stages = True
        for inventory in ("complete", "missing", "extra"):
            out = self.out / inventory
            (out / "live").mkdir(parents=True)
            scope = mock.Mock()

            def write_snapshots(**kwargs):
                if "companions" not in kwargs:
                    return {}
                for owner in ("native", "candidate"):
                    directory = out / "live" / f"{owner}-stages"
                    for prediction in range(2):
                        if inventory == "missing" and owner == "candidate" and prediction == 1:
                            continue
                        (directory / f"{owner}-{prediction}.json").write_text("{}")
                if inventory == "extra":
                    (out / "live/native-stages/unexpected.json").write_text("{}")
                return {}

            scope.wait.side_effect = write_snapshots
            report = dict(cold_frame_audit=True, manifest_sha256="a" * 64)
            with self.subTest(inventory=inventory), \
                    mock.patch.object(probe.sequence, "bounded_bytes", return_value=b"{}"), \
                    mock.patch.object(probe.audit, "json_lines", return_value=[]), \
                    mock.patch.object(probe.makeup_audit, "audit", return_value={}), \
                    mock.patch.object(probe.audit, "protocol", return_value={}), \
                    mock.patch.object(probe.audit, "inference", return_value=dict(seed_predictions=[0], owned_point_groups=2)), \
                    mock.patch.object(probe.audit, "validate_audits", return_value={}), \
                    mock.patch.object(probe.stage_audit, "audit", return_value=dict(diagnostic=True)) as stage, \
                    mock.patch.object(probe.audit, "render_outputs", return_value=[dict(equal=False)]):
                error = "zero-tolerance" if inventory == "complete" else "exact cold stage diagnostic inventory"
                with self.assertRaisesRegex(ValueError, error):
                    probe.execute(args=self.args, out=out, frames=[], dimensions=(8, 8),
                        requests=dict(baseline=[], live=[]), models=mock.Mock(), guard=mock.Mock(),
                        scope=scope, report=report)
            if inventory == "complete":
                stage.assert_called_once()
                self.assertEqual(report["stage_audit"], dict(diagnostic=True))
            else:
                stage.assert_not_called()
                self.assertNotIn("stage_audit", report)
            self.assertNotIn("live_checks_completed", report)
            config = json.loads((out / "lldb-config.json").read_text())
            self.assertEqual(config["environment"]["QCUT_FACE_LIVE_STAGE_DIR"], str(out / "live/native-stages"))



if __name__ == "__main__":
    unittest.main()
