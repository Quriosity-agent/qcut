"""Static job boundary tests; native execution is deliberately mocked."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from face_live_bridge_audit import STAGES
from face_live_bridge_bundle import write_json
import face_live_candidate_job as job


class StaticJobTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.input = bytes([1, 2, 3, 255]) * 4
        self.output = bytes([3, 2, 1, 255]) * 4
        (self.directory / "input.rgba").write_bytes(self.input)
        self.request = dict(requestId="unit-static", requestFingerprint="b" * 64,
            inputSha256=hashlib.sha256(self.input).hexdigest(), sourceKey="unit-source", frameNumber=22,
            timestampSeconds=42.5, width=2, height=2, parameters=dict(eye=50), backendVersion="unit")
        self.request_path = self.directory / "request.json"
        write_json(path=self.request_path, value=self.request)
        self.args = argparse.Namespace(request=self.request_path, runtime=Path("unused-runtime"),
            package=Path("unused-package"), root=Path("unused-models"), lease="unit-no-native", timeout=1)
        self.report = dict(passed=True, live_callback_handoff_verified=True, dependencies_unchanged=True,
            cleanup=dict(completed=True), failures=[], frames=[dict()],
            input_frames=[dict(input_sha256=self.request["inputSha256"])],
            artifacts={"live/frame-00.rgba": dict(sha256=hashlib.sha256(self.output).hexdigest())})

    def native(self, *, args):
        self.assertTrue(args.single_frame)
        self.assertTrue(args.execute_native)
        self.assertTrue(args.stable_host)
        manifest = json.loads(args.manifest.read_text())
        self.assertEqual(len(manifest["frames"]), 1)
        self.assertEqual(manifest["frames"][0]["timestamp"], 0)
        directory = args.out / "live"
        directory.mkdir(parents=True)
        (directory / "frame-00.rgba").write_bytes(self.output)
        (directory / "worker.jsonl").write_text(json.dumps(dict(result=dict(
            stage_timings_ms={name: 0.25 for name in STAGES}))) + "\n")
        return copy.deepcopy(self.report)

    def execute(self):
        with mock.patch.object(job, "run", side_effect=self.native):
            return job.run_job(args=self.args)

    def test_current_pixels_and_identity_survive_static_reset(self):
        result = self.execute()
        self.assertEqual(result["sourceKey"], self.request["sourceKey"])
        self.assertEqual(result["frameNumber"], 22)
        self.assertEqual(result["timestampSeconds"], 42.5)
        self.assertFalse(result["temporal_sequence_acceptance"])
        self.assertFalse(result["native_baseline_used_as_output"])
        self.assertEqual((self.directory / "candidate.rgba").read_bytes(), self.output)
        self.assertEqual(result["outputSha256"], hashlib.sha256(self.output).hexdigest())
        metrics = {row["id"]: row for row in result["stageMetrics"]}
        self.assertEqual(len(metrics), 10)
        self.assertEqual(metrics["decode"]["durationMs"], 0.5)
        self.assertIsNone(metrics["detection"]["durationMs"])
        self.assertEqual(metrics["detection"]["unavailableReason"], "native-stage-not-instrumented")

    def test_previous_artifacts_cannot_be_reused(self):
        (self.directory / "result.json").write_text("historical")
        with mock.patch.object(job, "run") as native, self.assertRaisesRegex(ValueError, "fresh job"):
            job.run_job(args=self.args)
        native.assert_not_called()

    def test_dynamic_card_dependencies_reach_the_native_audit(self):
        self.args.additional_packages = [self.directory / "explicit-card"]
        native = self.native

        def guarded(*, args):
            self.assertEqual(args.additional_packages, self.args.additional_packages)
            return native(args=args)

        with mock.patch.object(job, "run", side_effect=guarded):
            result = job.run_job(args=self.args)
        self.assertFalse(result["native_baseline_used_as_output"])

    def test_wrong_input_hash_rejected_before_native(self):
        (self.directory / "input.rgba").write_bytes(bytes(len(self.input)))
        with mock.patch.object(job, "run") as native, self.assertRaisesRegex(ValueError, "hash mismatch"):
            job.run_job(args=self.args)
        native.assert_not_called()

    def test_wrong_output_hash_is_not_replaced_by_baseline(self):
        self.report["artifacts"]["live/frame-00.rgba"]["sha256"] = "f" * 64
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            self.execute()
        self.assertFalse((self.directory / "candidate.rgba").exists())

    def test_failed_parity_never_returns_candidate_pixels(self):
        self.report["passed"] = False
        self.report["failures"] = [dict(error="pixel difference")]
        with self.assertRaisesRegex(ValueError, "pixel difference"):
            self.execute()
        self.assertFalse((self.directory / "candidate.rgba").exists())

    def test_different_render_input_cannot_attest_request(self):
        self.report["input_frames"][0]["input_sha256"] = "f" * 64
        with self.assertRaisesRegex(ValueError, "differs from requested"):
            self.execute()

    def test_original_request_mutation_during_native_rejected(self):
        native = self.native

        def mutate(*, args):
            report = native(args=args)
            self.request_path.write_text("{}")
            return report

        with mock.patch.object(job, "run", side_effect=mutate), self.assertRaises(ValueError):
            job.run_job(args=self.args)
        self.assertFalse((self.directory / "candidate.rgba").exists())


if __name__ == "__main__":
    unittest.main()
