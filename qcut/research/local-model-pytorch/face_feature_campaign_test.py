"""CPU-only orchestration tests; subprocess execution is replaced by test doubles."""
import argparse
import copy
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

from face_alignment_replay import LockedFiles
import face_feature_campaign as campaign
import face_feature_campaign_plan as plan


class CampaignTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.manifest = self.root / "manifest.json"
        frames = [dict(image="test.png", timestamp=index / 30, parameters={"intensity": 1}) for index in range(7)]
        self.manifest.write_text(json.dumps(dict(version=1, frames=frames)))
        self.case = dict(id="portrait-00-eye", feature="eye", input_kind="synthetic-seven-frame-controls",
                         manifest=str(self.manifest), spec=dict(hostPackage="/runtime/Cache/effect/card/version",
                         parameters=dict(active={"face_adjust_eye": [dict(id=-1, intensity=.4)]})))
        self.paths = {key: "/tools/" + key for key in ("warp_python", "ort_python", "models_root", "runtime")}
        self.args = argparse.Namespace(gpu_granted=True, source_frozen=True, stage_timeout=20, deadline=60,
                                       out=self.root / "run", plan=self.root / "plan.json", plan_sha256="a" * 64)

    def commands(self):
        return campaign.commands(paths=self.paths, case=self.case, directory=self.root / "case", stage_timeout=20, deadline=60)

    def test_seven_stages_are_ordered_and_whitelisted(self):
        commands = self.commands()
        self.assertEqual(tuple(commands), campaign.STAGES)
        for command in commands.values():
            self.assertEqual(command[1:3], ["-B", "-u"])
            self.assertTrue(Path(command[3]).is_relative_to(plan.SCRIPT_ROOT))
            self.assertTrue(Path(command[3]).is_file())
            self.assertNotIn("--diagnostic", command)
            self.assertNotIn("--independent-160-sampling", command)

    def test_profile_reports_propagate_fresh_absolute_paths(self):
        command = self.commands()["preprocess"]
        for key, stage in (("--sequence-replay", "replay"), ("--sequence-render", "render")):
            self.assertEqual(command[command.index(key) + 1], str(self.root / f"case/temporal/campaign-00/{stage}/report.json"))

    def test_parameters_remain_single_json_argument(self):
        command = self.commands()["baseline"]
        self.assertEqual(json.loads(command[command.index("--parameters") + 1]), self.case["spec"]["parameters"]["active"])

    def test_owned_replay_not_temporal_used_for_render_and_audit(self):
        for stage in ("owned-render", "owned-audit", "owned-export"):
            command = self.commands()[stage]
            self.assertEqual(command[command.index("--candidate") + 1], str(self.root / "case/owned-replay/replay.json"))

    def test_grants_are_required_before_output_or_subprocess(self):
        for field in ("gpu_granted", "source_frozen"):
            args = copy.copy(self.args)
            setattr(args, field, False)
            with self.subTest(field=field), patch.object(campaign.driver, "execute") as execute:
                with self.assertRaisesRegex(ValueError, "GPU grant"):
                    campaign.run(args=args)
                execute.assert_not_called()
                self.assertFalse(args.out.exists())

    def test_epoch_failure_prevents_subprocess(self):
        stage = dict(name="baseline", status="pending")
        with patch.object(plan, "verify_epoch", side_effect=ValueError("drift")), patch.object(campaign.driver, "execute") as execute:
            with self.assertRaisesRegex(ValueError, "drift"):
                campaign.stage_run(stage=stage, command=["unused"], directory=self.root, plan={},
                                   deadline=time.monotonic() + 5, timeout=1, locked=LockedFiles())
            execute.assert_not_called()
        self.assertEqual(stage["status"], "failed")

    def test_nonzero_and_timeout_never_pass(self):
        for error in (None, TimeoutError("expired")):
            stage = dict(name="baseline", status="pending")
            with self.subTest(error=error), patch.object(plan, "verify_epoch"), patch.object(campaign.driver, "execute", return_value=2, side_effect=error):
                with self.assertRaises((ValueError, TimeoutError)):
                    campaign.stage_run(stage=stage, command=["unused"], directory=self.root, plan={},
                        deadline=time.monotonic() + 5, timeout=1, locked=LockedFiles())
            self.assertNotEqual(stage["status"], "passed")

    def test_after_stage_drift_is_rejected(self):
        stage = dict(name="baseline", status="pending")
        with patch.object(plan, "verify_epoch", side_effect=[None, ValueError("drift")]), patch.object(campaign.driver, "execute", return_value=0):
            with self.assertRaisesRegex(ValueError, "drift"):
                campaign.stage_run(stage=stage, command=["unused"], directory=self.root, plan={},
                    deadline=time.monotonic() + 5, timeout=1, locked=LockedFiles())
        self.assertEqual(stage["returncode"], 0)
        self.assertEqual(stage["status"], "failed")

    def test_failed_case_retained_next_case_attempted_no_native_only_parity(self):
        other = dict(self.case, id="portrait-01-eye")
        value = dict(paths=self.paths, cases=[self.case, other], trees=[], dependencies=[])
        def failed_stage(**kwargs):
            stage = kwargs["stage"]
            stage.update(status="failed", returncode=1)
            raise ValueError("profile unsupported")
        with patch.object(campaign.sequence, "PRIVATE", self.root), patch.object(plan, "load", return_value=value), \
                patch.object(plan, "verify_epoch"), patch.object(campaign, "stage_run", side_effect=failed_stage), \
                patch.object(campaign, "export_pngs") as export:
            report = campaign.run(args=self.args)
        export.assert_not_called()
        self.assertFalse(report["passed"])
        self.assertTrue(report["completed"])
        self.assertEqual(report["counts"]["candidate_parity_cases"], 0)
        self.assertEqual(report["counts"]["stage_skipped"], 12)
        self.assertEqual(report["counts"]["wrapper_commands_executed"], 2)
        self.assertTrue((self.args.out / "report.json").is_file())

    def test_native_success_alone_is_not_counted(self):
        cases = [dict(candidate_parity=False, stages=[dict(name="baseline", status="passed", returncode=0)])]
        counts = campaign.summarize(cases=cases)
        self.assertEqual(counts["candidate_parity_cases"], 0)
        self.assertNotIn("accepted_frames", counts)

    def test_elapsed_budgets_are_bounded(self):
        for field, value in (("deadline", 0), ("deadline", 14401), ("stage_timeout", True), ("stage_timeout", 3601)):
            args = copy.copy(self.args)
            setattr(args, field, value)
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                campaign.run(args=args)


if __name__ == "__main__":
    unittest.main()
