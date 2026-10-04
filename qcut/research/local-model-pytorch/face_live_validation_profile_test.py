"""Fresh report paths retain the original hash and 50-source gates."""
import argparse
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import ANY, patch

from face_alignment_replay import LockedFiles
import face_preprocess_probe as probe
import face_full_frame_stack_probe as stack


class ProfileTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.capture, self.audit = self.root / "capture", self.root / "audit"
        self.capture.mkdir()
        self.audit.mkdir()
        self.paths = {"capture": self.capture / "report.json",
                      "sequence_replay": self.root / "fresh-replay.json",
                      "sequence_render": self.root / "fresh-render.json"}
        self.reports = {key: {"role": key} for key in self.paths}
        for key, path in self.paths.items():
            path.write_text(json.dumps(self.reports[key]))
        self.guard = dict(passed=True, source_count=50, report_sha256={
            key: probe.digest(data=path.read_bytes()) for key, path in self.paths.items()})
        self.persist()

    def persist(self):
        (self.audit / "report.json").write_text(json.dumps(self.guard))

    def lock(self, *, locked=None):
        return probe.lock_profile(capture=self.capture, audit=self.audit,
            sequence_replay=self.paths["sequence_replay"], sequence_render=self.paths["sequence_render"],
            locked=locked or LockedFiles())

    def test_explicit_paths_are_resolved_without_reading_historical_reports(self):
        with patch.object(probe, "PRIVATE", self.root / "missing-history"):
            paths = probe.profile_report_paths(sequence_replay=self.paths["sequence_replay"],
                                               sequence_render=self.paths["sequence_render"])
            self.assertEqual(paths, {key: path for key, path in self.paths.items() if key != "capture"})
            with patch.object(probe, "source_hashes", side_effect=RuntimeError("source gate reached")) as sources:
                with self.assertRaisesRegex(RuntimeError, "source gate reached"):
                    self.lock()
                sources.assert_called_once_with(reports=list(self.reports.values()))

    def test_omitted_paths_preserve_historical_profile(self):
        self.assertEqual(probe.profile_report_paths(), {
            key: probe.PRIVATE / name / "report.json" for key, name in probe.OLD_REPORTS.items()})

    def test_one_explicit_path_cannot_fall_back_to_history(self):
        for key in ("sequence_replay", "sequence_render"):
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "both explicit"):
                probe.profile_report_paths(**{key: self.paths[key]})

    def test_missing_explicit_path_cannot_fall_back_to_history(self):
        with self.assertRaises(FileNotFoundError):
            probe.profile_report_paths(sequence_replay=self.root / "missing",
                                       sequence_render=self.paths["sequence_render"])

    def test_each_report_is_bound_to_its_audit_hash(self):
        for key, path in self.paths.items():
            original = path.read_bytes()
            path.write_bytes(original + b" ")
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "hash mismatch"):
                self.lock()
            path.write_bytes(original)

    def test_swapped_fresh_report_roles_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            probe.lock_profile(capture=self.capture, audit=self.audit, locked=LockedFiles(),
                sequence_replay=self.paths["sequence_render"], sequence_render=self.paths["sequence_replay"])

    def test_missing_null_empty_and_malformed_audit_hashes_are_rejected(self):
        for key in self.paths:
            original = self.guard["report_sha256"][key]
            for value in (None, "", False, "g" * 64, "A" * 64):
                self.guard["report_sha256"][key] = value
                self.persist()
                with self.subTest(key=key, value=value), self.assertRaisesRegex(ValueError, "audit-bound"):
                    self.lock()
            self.guard["report_sha256"].pop(key)
            self.persist()
            with self.assertRaisesRegex(ValueError, "audit-bound"):
                self.lock()
            self.guard["report_sha256"][key] = original

    def test_exact_typed_50_source_audit_gate_is_preserved(self):
        for value in (49, 51, True, 50.0, "50", None):
            self.guard["source_count"] = value
            self.persist()
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "50-source"):
                self.lock()

    def test_failed_audit_is_rejected(self):
        self.guard["passed"] = False
        self.persist()
        with self.assertRaisesRegex(ValueError, "50-source"):
            self.lock()

    def test_actual_source_union_must_still_have_50_members(self):
        for count in (0, 49, 51):
            with patch.object(probe, "source_hashes", return_value={str(i): "a" * 64 for i in range(count)}):
                with self.subTest(count=count), self.assertRaisesRegex(ValueError, "source union"):
                    self.lock()

    def test_current_source_hash_mismatch_is_not_rewritten(self):
        sources = {"local-model-pytorch/face_preprocess_probe.py": "0" * 64}
        sources.update({f"synthetic-{index}": "a" * 64 for index in range(49)})
        with patch.object(probe, "source_hashes", return_value=sources):
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                self.lock()

    def test_report_mutation_after_read_is_caught_by_file_guard(self):
        locked = LockedFiles()
        with patch.object(probe, "source_hashes", side_effect=RuntimeError("source gate reached")):
            with self.assertRaisesRegex(RuntimeError, "source gate reached"):
                self.lock(locked=locked)
        self.paths["sequence_replay"].write_text("{}")
        with self.assertRaises(ValueError):
            locked.verify()

    def test_evidence_explicit_paths_require_both_hash_bound_fixtures(self):
        paths = {key: str(path) for key, path in self.paths.items() if key != "capture"}
        fixtures = {path: self.guard["report_sha256"][key] for key, path in paths.items()}
        evidence = dict(profile_reports=paths, fixture_sha256=fixtures)
        self.assertEqual(probe.profile_report_arguments(evidence=evidence),
                         {key: Path(path) for key, path in paths.items()})
        for invalid in (None, {}, {"sequence_replay": paths["sequence_replay"]},
                        {**paths, "sequence_replay": "relative.json"}, {**paths, "unexpected": "x"}):
            with self.subTest(invalid=invalid), self.assertRaisesRegex(ValueError, "hash-bound"):
                probe.profile_report_arguments(evidence=dict(evidence, profile_reports=invalid))
        for invalid in (None, {}, {path: None for path in fixtures}, {path: "" for path in fixtures}):
            with self.subTest(invalid=invalid), self.assertRaisesRegex(ValueError, "hash-bound"):
                probe.profile_report_arguments(evidence=dict(evidence, fixture_sha256=invalid))

    def test_historical_capture_without_explicit_paths_retains_default(self):
        self.assertEqual(probe.profile_report_arguments(evidence={}), {})

    def test_stack_probe_forwards_explicit_paths_before_native_launch(self):
        paths = {key: path for key, path in self.paths.items() if key != "capture"}
        evidence = dict(audit=str(self.audit), profile_reports={key: str(path) for key, path in paths.items()},
                        fixture_sha256={str(path): self.guard["report_sha256"][key] for key, path in paths.items()})
        with patch.object(stack.sequence, "PRIVATE", self.root), \
                patch.object(stack.capture, "load", return_value=dict(original=self.capture, evidence=evidence)), \
                patch.object(stack.probe, "lock_profile", side_effect=RuntimeError("profile gate reached")) as profile, \
                patch.object(stack.probe, "bounded_process") as native:
            with self.assertRaisesRegex(RuntimeError, "profile gate reached"):
                stack.run(args=argparse.Namespace(capture=self.capture, out=self.root / "stack"))
            profile.assert_called_once_with(capture=self.capture, audit=self.audit, locked=ANY, **paths)
            native.assert_not_called()


if __name__ == "__main__":
    unittest.main()
