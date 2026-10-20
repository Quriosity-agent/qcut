import copy
import hashlib
import importlib.util
import json
import shutil
import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image


SPEC = importlib.util.spec_from_file_location("body_video_close_report", Path(__file__).parents[1] / "body-video-close-report.py")
REPORT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REPORT)
OPERATIONS = REPORT.OPERATIONS


def operation_record():
    record = {"schemaVersion": 2, "status": "passed", "frames": 3,
              "checks": {name: True for name in OPERATIONS.REQUIRED_CHECKS}, "preEncodeStages": {}}
    for stage in OPERATIONS.COMPLETE_STAGES:
        values = [f'{index}-{"edited" if stage == "parameter-changed" else "baseline"}'.encode()
                  for index in range(3)]
        record["preEncodeStages"][stage] = [{"frame": index, "rgbaSha256": hashlib.sha256(value).hexdigest()}
                                            for index, value in enumerate(values)]
        record[stage] = {"decodedFrameDigests": [hashlib.md5(value).hexdigest() for value in values]}
    record["parameterChange"] = {"control": "body_adjust_SlimBody", "from": 40, "to": 55,
                                  "changedFrames": [0, 1, 2]}
    record["cancelled"] = {"capturedFrames": 1, "pendingAtCancel": {
        "cancelled": True, "sequenceRequest": {"requestId": "a", "frame": 1, "enteredAt": 100},
        "activeSequenceRequests": [{"frame": 1}], "pending": [{"frame": 1, "pid": 10, "startedAt": 101}],
    }}
    record["workerKilled"] = {"error": None, "inFlightRequest": {"pid": 10, "frame": 1},
                              "observation": {"spawned": [10, 20], "exited": [10]}}
    return record


class OperationEvidenceTests(unittest.TestCase):
    def test_complete_schema_two_checks_each_plane_and_shows_parameter_change(self):
        result = OPERATIONS.summarize(record=operation_record())
        self.assertEqual(result["status"], "passed")
        self.assertTrue(result["full_frame_evidence_complete"])
        self.assertEqual(result["parameter_change"]["changed_frame_count"], 3)
        changed = next(row for row in result["stages"] if row["stage"] == "parameter-changed")
        self.assertEqual(changed["pre_encode_sha256"]["different_frames"], 3)
        self.assertEqual(changed["decoded_md5"]["different_frames"], 3)
        page = OPERATIONS.render(summary=result)
        self.assertIn("总态：通过", page)
        self.assertIn("记录受影响 3 帧", page)
        self.assertIn("不重新解码", page)

    def test_failed_or_running_record_cannot_pass_when_partial_checks_pass(self):
        for status in ("failed", "running", None):
            with self.subTest(status=status):
                record = {"schemaVersion": 2, "status": status, "frames": 3,
                          "checks": {"first_check": True}, "failure": "<failed>" if status == "failed" else None}
                result = OPERATIONS.summarize(record=record)
                self.assertNotEqual(result["status"], "passed")
                page = OPERATIONS.render(summary=result)
                self.assertNotIn("总态：通过", page)
                if status == "failed":
                    self.assertIn("&lt;failed&gt;", page)

    def test_missing_incomplete_unordered_and_invalid_hash_records_cannot_pass(self):
        for defect in ("missing-stage", "truncated-sha", "unordered-sha", "invalid-sha", "missing-decoded", "empty-checks"):
            with self.subTest(defect=defect):
                record = operation_record()
                rows = record["preEncodeStages"]["after-cancel"]
                if defect == "missing-stage":
                    record["preEncodeStages"].pop("worker-killed")
                elif defect == "truncated-sha":
                    rows.pop()
                elif defect == "unordered-sha":
                    rows[0], rows[1] = rows[1], rows[0]
                elif defect == "invalid-sha":
                    rows[0]["rgbaSha256"] = "not-a-digest"
                elif defect == "missing-decoded":
                    record.pop("worker-killed")
                else:
                    record["checks"] = {}
                self.assertEqual(OPERATIONS.summarize(record=record)["status"], "incomplete")

    def test_changed_pixel_or_decoded_frame_fails_despite_passed_record(self):
        for plane in ("pre_encode", "decoded", "unchanged-edit", "false-check"):
            with self.subTest(plane=plane):
                record = operation_record()
                if plane == "pre_encode":
                    record["preEncodeStages"]["after-cancel"][1]["rgbaSha256"] = "f" * 64
                elif plane == "decoded":
                    record["after-restart"]["decodedFrameDigests"][2] = "f" * 32
                elif plane == "unchanged-edit":
                    record["preEncodeStages"]["parameter-changed"] = copy.deepcopy(record["preEncodeStages"]["sequential"])
                else:
                    record["checks"]["cancel"] = False
                self.assertEqual(OPERATIONS.summarize(record=record)["status"], "failed")

    def test_full_hashes_cannot_replace_required_checks_or_recovery_observations(self):
        for defect in ("one-check", "missing-cancel", "invalid-cancel", "missing-kill", "not-exited",
                       "no-replacement", "only-older-worker", "missing-export-result", "export-error"):
            with self.subTest(defect=defect):
                record = operation_record()
                if defect == "one-check":
                    record["checks"] = {"sequential_preview_export_identical": True}
                elif defect == "missing-cancel":
                    record.pop("cancelled")
                elif defect == "invalid-cancel":
                    record["cancelled"]["pendingAtCancel"]["pending"] = []
                elif defect == "missing-kill":
                    record.pop("workerKilled")
                elif defect == "not-exited":
                    record["workerKilled"]["observation"]["exited"] = []
                elif defect == "no-replacement":
                    record["workerKilled"]["observation"]["spawned"] = [10]
                elif defect == "only-older-worker":
                    record["workerKilled"]["observation"]["spawned"] = [20, 10]
                elif defect == "missing-export-result":
                    record["workerKilled"].pop("error")
                else:
                    record["workerKilled"]["error"] = "export failed"
                result = OPERATIONS.summarize(record=record)
                self.assertTrue(result["full_frame_evidence_complete"])
                self.assertEqual(result["status"], "failed" if defect == "export-error" else "incomplete")
                self.assertNotIn("总态：通过", OPERATIONS.render(summary=result))

    def test_schema_one_explicit_pass_is_not_rejected_for_new_schema_two_fields(self):
        record = {"schemaVersion": 1, "status": "passed", "checks": {"cache_cleared_identical": True}}
        result = OPERATIONS.summarize(record=record)
        self.assertEqual(result["status"], "passed")
        self.assertEqual(result["missing_required_checks"], [])

    def test_actual_cancel_and_kill_are_distinguished_from_pre_click_observations(self):
        record = operation_record()
        record["cancelled"] = {"inFlightRequest": {"frame": 1, "pid": 10}, "capturedFrames": 1}
        self.assertFalse(OPERATIONS.summarize(record=record)["cancel"]["recorded"])
        record["cancelled"]["pendingAtCancel"] = {
            "cancelled": True, "sequenceRequest": {"requestId": "a", "frame": 1, "enteredAt": 100},
            "activeSequenceRequests": [{"frame": 1}],
            "pending": [{"frame": 1, "pid": 10, "startedAt": 101}],
        }
        record["workerKilled"] = {"error": None, "inFlightRequest": {"pid": 10, "frame": 1},
                                  "observation": {"spawned": [10, 20], "exited": [10],
                                                  "resumptions": [{"frame": 1, "resumed": "restored"}]}}
        result = OPERATIONS.summarize(record=record)
        self.assertTrue(result["cancel"]["pending_frame_verified"])
        self.assertEqual(result["worker_kill"]["replacement_pids"], [20])
        self.assertTrue(result["worker_kill"]["killed_pid_exited"])
        record["cancelled"]["pendingAtCancel"]["pending"] = []
        self.assertFalse(OPERATIONS.summarize(record=record)["cancel"]["pending_frame_verified"])

    @unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg required for actual export verification")
    def test_actual_exports_fill_missing_recorded_digests_without_mutating_source(self):
        record = operation_record()
        for stage in OPERATIONS.COMPLETE_STAGES:
            record[stage].pop("decodedFrameDigests")
        original = copy.deepcopy(record)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for edited in (False, True):
                filename = root / ("edited.mp4" if edited else "baseline.mp4")
                pixels = b"".join(bytes([index * 40 + (20 if edited else 0), 50, 90]) * (16 * 16)
                                  for index in range(3))
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
                                "-s", "16x16", "-r", "30", "-i", "pipe:0", "-c:v", "libx264",
                                "-pix_fmt", "yuv420p", str(filename)], input=pixels, check=True, timeout=20)
            for stage in OPERATIONS.COMPLETE_STAGES:
                shutil.copyfile(root / ("edited.mp4" if stage == "parameter-changed" else "baseline.mp4"),
                                root / f"export-{stage}.mp4")
            verified = OPERATIONS.verify_decoded_exports(record=record, directory=root)
            summary = OPERATIONS.summarize(record=record, verified_videos=verified)
            self.assertEqual(summary["status"], "passed")
            self.assertEqual(len(verified["worker-killed"]["decodedFrameDigests"]), 3)
            self.assertIsNone(verified["worker-killed"]["matches_recorded"])
            self.assertIn("从实际导出复核", OPERATIONS.render(summary=summary))
            self.assertEqual(record, original)
            (root / "export-worker-killed.mp4").write_bytes(b"corrupt")
            failed = OPERATIONS.verify_decoded_exports(record=record, directory=root)
            self.assertEqual(OPERATIONS.summarize(record=record, verified_videos=failed)["status"], "failed")

    def test_legacy_checks_remain_visible_without_inventing_overall_acceptance(self):
        result = OPERATIONS.summarize(record={"checks": {"cache_cleared_identical": True}})
        page = OPERATIONS.render(summary=result)
        self.assertEqual(result["status"], "unknown")
        self.assertIn("cache_cleared_identical：通过", page)
        self.assertIn("未声明总态", page)
        self.assertFalse(result["cancel"]["recorded"])
        self.assertFalse(result["worker_kill"]["recorded"])


class BodyClosePageTests(unittest.TestCase):
    def build_fixture(self, *, root, operation_status=None, profile=True):
        evidence, output = root / "source", root / "elsewhere" / "report"
        evidence.mkdir()
        record = {"width": 64, "height": 64, "fps": 30, "sampleIndices": [0, 2],
                  "totalFrames": 3, "gitHead": "a" * 40}
        (evidence / "e2e-evidence.json").write_text(json.dumps(record))
        frames = {}
        for mode in REPORT.PASS_LABELS:
            folder = evidence / mode
            folder.mkdir()
            (folder / "export.mp4").touch()
            frames[mode] = [np.full((64, 64, 3), 10 if mode == "original" or index == 0 else 40,
                                    dtype=np.uint8) for index in range(3)]
            for index in record["sampleIndices"]:
                image = Image.fromarray(frames[mode][index])
                image.save(folder / f"export-frame-{index:06d}.png")
                if mode != "original":
                    image.save(folder / f"preview-frame-{index:06d}-composition.png")
        lock = {"source": {"path": "source.mp4", "sha256": "b" * 64},
                "timeline": {"width": 64, "height": 64, "fps": 30, "frames": 3},
                "values": {"body_adjust_SlimBody": 40, "body_adjust_StretchLeg": 30},
                "independentEngine": {"sourceManifestSha256": "c" * 64}}
        if profile:
            lock.update(nativeProfile={"name": "Bef <native>", "initialization": "frame 0"},
                        limitations=["单人受控样本", "实时播放未验收"])
        lock_path = root / "lock.json"
        lock_path.write_text(json.dumps(lock))
        operations = None
        if operation_status:
            operations = root / "operations"
            operations.mkdir()
            (operations / "e2e-evidence.json").write_text(json.dumps({
                "schemaVersion": 2, "status": operation_status, "frames": 3,
                "checks": {"first": True}, "failure": "test interrupted"}))
        with patch.object(REPORT, "frames_of", side_effect=lambda **kwargs: frames[kwargs["mode"]]), \
                patch.object(REPORT, "write_difference_video"):
            report = REPORT.build(evidence=evidence, lock=lock, invariance_dir=operations, output=output, lock_path=lock_path)
        return report, (output / "index.html").read_text()

    def test_zero_initial_frame_remains_picture_statistic_not_tracking_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            report, page = self.build_fixture(root=Path(directory), operation_status="failed")
        self.assertTrue(report["preview_export_parity"]["native"]["passed"])
        self.assertEqual(report["effect_regions"]["native"]["frames_without_effect"], [0])
        self.assertNotIn("有效跟踪", report["verdict"])
        self.assertIn("编辑器操作 失败", report["verdict"])
        self.assertIn("画面变化统计", page)
        self.assertIn("像素差分不能判定跟踪丢失", page)
        self.assertIn("Bef &lt;native&gt;", page)
        self.assertIn("实时播放未验收", page)
        self.assertIn('src="../../source/native/export.mp4"', page)
        self.assertIn('href="../../lock.json"', page)
        self.assertNotIn("总态：通过", page)

    def test_missing_optional_native_metadata_is_explicit_not_inferred(self):
        with tempfile.TemporaryDirectory() as directory:
            report, page = self.build_fixture(root=Path(directory), profile=False)
        self.assertIsNone(report["native_profile"])
        self.assertIsNone(report["limitations"])
        self.assertGreaterEqual(page.count("未记录。"), 2)
        self.assertNotIn("CoreML", page)


if __name__ == "__main__":
    unittest.main()
