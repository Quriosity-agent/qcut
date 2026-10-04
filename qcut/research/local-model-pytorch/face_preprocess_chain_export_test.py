"""Portable-package CPU tests using synthetic evidence and a mocked capture loader."""
import argparse
from copy import deepcopy
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

from face_alignment_replay import LockedFiles
import face_preprocess_chain_export as export


def encoded(*, value):
    return json.dumps(value, allow_nan=False).encode() + b"\n"


class CopyTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.source, self.target = self.root / "source.bin", self.root / "target.bin"
        self.source.write_bytes(b"exact\x00\xff bytes\r\n")
        self.identity = export.digest(data=self.source.read_bytes())

    def test_copy_preserves_bytes_and_locks_both_identities(self):
        locked = LockedFiles()
        before = self.source.stat().st_mtime_ns
        result = export.copy_bytes(source=self.source, target=self.target, locked=locked, expected=self.identity)
        self.assertEqual(result, self.identity)
        self.assertEqual(self.target.read_bytes(), self.source.read_bytes())
        self.assertEqual(locked.files, {str(self.source): self.identity, str(self.target): self.identity})
        self.assertEqual(self.source.stat().st_mtime_ns, before)
        locked.verify()

    def test_explicit_invalid_or_mismatched_sha_fails_before_copy(self):
        for identity in (False, "", "invalid", "F" * 64, "f" * 64):
            with self.subTest(identity=identity), self.assertRaises(ValueError):
                export.copy_bytes(source=self.source, target=self.target, locked=LockedFiles(), expected=identity)
            self.assertFalse(self.target.exists())

    def test_size_bound_and_empty_source_fail_before_copy(self):
        with self.assertRaises(ValueError):
            export.copy_bytes(source=self.source, target=self.target, locked=LockedFiles(), maximum=1, expected=self.identity)
        self.assertFalse(self.target.exists())
        self.source.write_bytes(b"")
        with self.assertRaises(ValueError):
            export.copy_bytes(source=self.source, target=self.target, locked=LockedFiles())
        self.assertFalse(self.target.exists())

    def test_changed_source_is_not_rehashed_into_acceptance(self):
        locked = LockedFiles()
        locked.read(path=self.source)
        self.source.write_bytes(b"modified source")
        with self.assertRaises(ValueError):
            export.copy_bytes(source=self.source, target=self.target, locked=locked)
        self.assertFalse(self.target.exists())

    def test_late_target_mutation_is_caught_by_final_file_guard(self):
        locked = LockedFiles()
        export.copy_bytes(source=self.source, target=self.target, locked=locked, expected=self.identity)
        self.target.write_bytes(b"modified target")
        with self.assertRaises(ValueError):
            locked.verify()

    def test_existing_target_is_rejected_without_overwrite(self):
        self.target.write_bytes(b"existing target")
        with self.assertRaises(FileExistsError):
            export.copy_bytes(source=self.source, target=self.target, locked=LockedFiles(), expected=self.identity)
        self.assertEqual(self.target.read_bytes(), b"existing target")

    def test_target_symlink_cannot_overwrite_an_outside_file(self):
        outside = self.root / "outside.bin"
        outside.write_bytes(b"outside user data")
        self.target.symlink_to(outside)
        with self.assertRaises(FileExistsError):
            export.copy_bytes(source=self.source, target=self.target, locked=LockedFiles(), expected=self.identity)
        self.assertTrue(self.target.is_symlink())
        self.assertEqual(outside.read_bytes(), b"outside user data")


class SourceTests(unittest.TestCase):
    def test_merge_deduplicates_equal_hashes_and_sorts_names(self):
        result = export.merge_sources(groups=[{"z.py": "a" * 64, "a.py": "b" * 64}, {"z.py": "a" * 64}])
        self.assertEqual(list(result), ["a.py", "z.py"])
        self.assertEqual(len(result), 2)

    def test_contradictory_source_hashes_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "conflicting source hashes"):
            export.merge_sources(groups=[{"a.py": "a" * 64}, {"a.py": "b" * 64}])


class ExportTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.addCleanup(patch.stopall)
        patch.object(export.chain.sequence, "PRIVATE", self.root).start()
        patch.object(export.probe, "PRIVATE", self.root).start()
        self.capture_root, self.candidate_root, self.render_root, self.models, self.original, self.original_audit = (
            self.root / name for name in ("capture", "candidate", "render", "models", "original", "original-audit"))
        for directory in (self.capture_root, self.candidate_root, self.render_root, self.models, self.original, self.original_audit):
            directory.mkdir()
        self.proof_path, self.candidate = self.root / "audit.json", self.candidate_root / "replay.json"
        self.source_root = self.root / "research"
        self.source_root.mkdir()
        patch.object(export.audit.chain_render.render, "SOURCE_ROOT", self.source_root).start()
        self.fixture_paths = set()
        self.run_index = 0
        old_sources = {}
        for index in range(44):
            name = f"local-model-pytorch/synthetic-old-{index:02d}.py"
            old_sources[name] = self.write(path=self.source_root / name, data=f"old source {index}".encode())
        model_sources = {}
        for name in export.audit.MODEL_SOURCES:
            source = Path(export.__file__).with_name(name)
            identity = self.write(path=self.source_root / "local-model-pytorch" / name, data=source.read_bytes())
            model_sources[name] = identity
        old_sources.update({"local-model-pytorch/" + name: model_sources[name] for name in export.audit.MODEL_SOURCES[:6]})
        new_sources = export.chain.sources(names=(*export.chain.SOURCE_NAMES, "face_preprocess_chain_render.py"), locked=LockedFiles())
        for name, expected in new_sources.items():
            source = Path(export.__file__).with_name(Path(name).name)
            self.assertEqual(self.write(path=self.source_root / name, data=source.read_bytes()), expected)
        old_items = list(old_sources.items())
        self.old_sources = old_sources
        self.reports = dict(capture={"synthetic": True},
            candidate={"source_sha256": {name: expected for name, expected in new_sources.items() if Path(name).name in export.chain.SOURCE_NAMES}},
            render={"source_sha256": new_sources, "comparisons": []},
            model={"source_sha256": model_sources}, summary={"passed": True, "synthetic": "export summary"},
            originalCapture={"source_sha256": dict(old_items[:20]), "frames": [], "manifest": str(self.root / "manifest.json")},
            originalReplay={"source_sha256": dict(old_items[20:40])},
            originalRender={"source_sha256": dict(old_items[40:])},
            originalAudit={"passed": True, "source_count": 50})
        self.files = dict(capture=self.capture_root / "report.json", candidate=self.candidate_root / "report.json",
            render=self.render_root / "report.json", model=self.candidate_root / "onnx/report.json", summary=self.models / "summary.json",
            originalCapture=self.original / "report.json", originalReplay=self.root / export.probe.OLD_REPORTS["sequence_replay"] / "report.json",
            originalRender=self.root / export.probe.OLD_REPORTS["sequence_render"] / "report.json", originalAudit=self.original_audit / "report.json")
        self.context = dict(original=self.original, evidence={"audit": str(self.original_audit)}, frames=[])
        for index in range(7):
            png = io.BytesIO()
            Image.new("RGBA", (2, 2), (index, 8, 16, 255)).save(png, format="PNG")
            image = self.root / "images" / f"input-{index:02d}.png"
            image_hash = self.write(path=image, data=png.getvalue())
            original = bytes([index, 8, 16, 255] * 4)
            processed = bytes([index + 1, 8, 16, 255] * 4)
            original_hash = self.write(path=self.original / f"input-{index:02d}.rgba", data=original)
            native_hash = self.write(path=self.capture_root / "baseline" / f"frame-{index:02d}.rgba", data=processed)
            candidate_hash = self.write(path=self.render_root / f"frame-{index:02d}.rgba", data=processed)
            self.context["frames"].append(dict(image=str(image), timestamp=index / 30, label=str(index)))
            self.reports["originalCapture"]["frames"].append(dict(image_sha256=image_hash, input_rgba_sha256=original_hash))
            self.reports["render"]["comparisons"].append(dict(baseline_sha256=native_hash, sha256=candidate_hash))
        self.manifest = self.root / "manifest.json"
        self.write(path=self.manifest, data=encoded(value={"synthetic": True, "frames": self.context["frames"]}))
        self.write(path=self.candidate, data=encoded(value={"synthetic": True, "normalized_conversions": 24}))
        self.model_files = [self.models / f"align-{size}/artifacts/model.onnx" for size in (120, 160)]
        for path in self.model_files:
            self.write(path=path, data=b"private synthetic ONNX bytes")
        self.runtime_file = self.root / "runtime/Frameworks/liblens.dylib"
        self.write(path=self.runtime_file, data=b"private synthetic runtime bytes")
        auditor_source = Path(export.audit.__file__).resolve()
        auditor_hash = self.write(path=self.source_root / "local-model-pytorch/face_preprocess_chain_audit.py",
                                 data=auditor_source.read_bytes())
        self.proof = dict(profile="actual-preprocess-owned-chain-audit-v1", passed=True, completed=True,
            geometry_exact=True, final_consumer_parity=True, pixel_parity_verified=True, external_replay_verified=True,
            fixed_profile_only=True, native_execution_performed=False, inference_performed=False,
            product_parity_verified=False, arbitrary_frame_backend_connected=False, independent_full_frame_preprocessing=False,
            failures=[], head_comparisons=135, normalized_conversions=24, capture=str(self.capture_root),
            candidate=str(self.candidate), render=str(self.render_root),
            source_sha256={"local-model-pytorch/face_preprocess_chain_audit.py": auditor_hash})
        self.fixture_paths.add(auditor_source)
        self.persist()
        self.loader = patch.object(export.capture, "load", side_effect=self.load_capture).start()

    def write(self, *, path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        self.fixture_paths.add(path)
        return export.digest(data=data)

    def persist(self):
        self.reports["model"]["export_summary_sha256"] = export.digest(data=encoded(value=self.reports["summary"]))
        for name, path in self.files.items():
            self.write(path=path, data=encoded(value=self.reports[name]))
        for name, field in (("capture", "capture_sha256"), ("candidate", "candidate_report_sha256"),
                            ("render", "render_report_sha256"), ("model", "model_report_sha256")):
            self.proof[field] = export.digest(data=self.files[name].read_bytes())
        self.proof["replay_sha256"] = export.digest(data=self.candidate.read_bytes())
        self.proof["fixture_sha256"] = {str(path): export.digest(data=path.read_bytes()) for path in sorted(self.fixture_paths)}
        self.proof_path.write_bytes(encoded(value=self.proof))

    def load_capture(self, *, root, locked):
        self.assertEqual(root, self.capture_root)
        locked.read(path=root / "report.json")
        for name, expected in self.old_sources.items():
            locked.read(path=self.source_root / name, expected=expected)
        return deepcopy(self.context)

    def run_export(self, **overrides):
        self.run_index += 1
        self.out = self.root / f"package-{self.run_index:03d}"
        values = dict(capture=self.capture_root, candidate=self.candidate, render=self.render_root,
                      root=self.models, audit=self.proof_path, out=self.out)
        values.update(overrides)
        return export.run(args=argparse.Namespace(**values))

    def rejected(self, **overrides):
        with self.assertRaises((ValueError, KeyError, FileNotFoundError)):
            self.run_export(**overrides)
        saved = json.loads((self.out / "report.json").read_bytes())
        self.assertIs(saved["passed"], False)
        self.assertIs(saved["completed"], False)
        self.assertTrue(saved["failures"])

    def test_explicit_fresh_profile_is_exported_without_historical_paths(self):
        paths = {"sequence_replay": self.root / "fresh-replay/report.json",
                 "sequence_render": self.root / "fresh-render/report.json"}
        self.files.update(originalReplay=paths["sequence_replay"], originalRender=paths["sequence_render"])
        self.persist()
        self.context["evidence"].update(profile_reports={key: str(path) for key, path in paths.items()},
            fixture_sha256={str(path): export.digest(data=path.read_bytes()) for path in paths.values()})
        with patch.object(export.probe, "OLD_REPORTS", {key: "missing-history-" + key for key in paths}):
            report = self.run_export()
        self.assertTrue(report["passed"])
        self.assertEqual((self.out / "reports/original-replay.json").read_bytes(), paths["sequence_replay"].read_bytes())
        self.assertEqual((self.out / "reports/original-render.json").read_bytes(), paths["sequence_render"].read_bytes())

    def test_unbound_explicit_profile_is_not_exported(self):
        self.context["evidence"]["profile_reports"] = {key: "/unbound/report.json" for key in export.probe.OLD_REPORTS}
        self.rejected()

    def test_complete_package_is_portable_byte_exact_and_excludes_private_models_runtime(self):
        before = {path: (path.stat().st_mtime_ns, path.read_bytes()) for path in self.fixture_paths}
        report = self.run_export()
        self.assertIs(report["passed"], True)
        self.assertIs(report["completed"], True)
        self.assertIs(report["diagnostic_only"], True)
        self.assertIs(report["arbitrary_frame_backend_connected"], False)
        self.assertIs(report["product_parity_verified"], False)
        self.assertEqual(report["source_count"], 63)
        self.assertEqual(report["frames"], 7)
        self.loader.assert_called_once()
        self.assertEqual(before, {path: (path.stat().st_mtime_ns, path.read_bytes()) for path in self.fixture_paths})
        package = json.loads((self.out / "index.json").read_bytes())
        self.assertEqual(package["format"], "qcut-beauty-lab-owned-chain-v1")
        self.assertEqual(report["index_sha256"], export.digest(data=(self.out / "index.json").read_bytes()))
        self.assertEqual(len(package["source_sha256"]), 63)
        cleanup_source = Path(export.__file__).with_name("face_native_process.py")
        self.assertEqual(package["source_sha256"]["local-model-pytorch/face_native_process.py"],
                         export.digest(data=cleanup_source.read_bytes()))
        self.assertEqual(list(package["source_sha256"]), sorted(package["source_sha256"]))
        self.assertTrue(all(not Path(name).is_absolute() and ".." not in Path(name).parts for name in package["source_sha256"]))
        expected_files = {"index.json", "report.json", "manifest.json", "replay.json"}
        for key, path in self.files.items():
            name = {"originalCapture": "original-capture", "originalReplay": "original-replay",
                    "originalRender": "original-render", "originalAudit": "original-audit"}.get(key, key)
            relative = f"reports/{name}.json"
            expected_files.add(relative)
            self.assertEqual((self.out / relative).read_bytes(), path.read_bytes())
            self.assertEqual(package["reports"][key], export.digest(data=path.read_bytes()))
        for index, row in enumerate(package["frames"]):
            self.assertEqual(row["index"], index)
            for kind, source, field in (("input", Path(self.context["frames"][index]["image"]), "input_png_sha256"),
                                      ("native", self.capture_root / f"baseline/frame-{index:02d}.rgba", "native_rgba_sha256"),
                                      ("candidate", self.render_root / f"frame-{index:02d}.rgba", "candidate_rgba_sha256")):
                relative = f"frames/{kind}-{index:02d}.{'png' if kind == 'input' else 'rgba'}"
                expected_files.add(relative)
                self.assertEqual((self.out / relative).read_bytes(), source.read_bytes())
                self.assertEqual(row[field], export.digest(data=source.read_bytes()))
            self.assertEqual(row["input_rgba_sha256"], self.reports["originalCapture"]["frames"][index]["input_rgba_sha256"])
        for source, name, field in ((self.manifest, "manifest.json", "manifest_sha256"), (self.candidate, "replay.json", "replay_sha256")):
            self.assertEqual((self.out / name).read_bytes(), source.read_bytes())
            self.assertEqual(package[field], export.digest(data=source.read_bytes()))
        actual_files = {str(path.relative_to(self.out)) for path in self.out.rglob("*") if path.is_file()}
        self.assertEqual(actual_files, expected_files)
        self.assertFalse(any(path.suffix in (".onnx", ".dylib", ".pt", ".bin") for path in self.out.rglob("*")))

    def test_existing_output_is_rejected_without_overwriting_saved_package(self):
        existing = self.root / "existing-package"
        existing.mkdir()
        marker = existing / "index.json"
        marker.write_bytes(b"existing user package")
        with self.assertRaises(FileExistsError):
            self.run_export(out=existing)
        self.assertEqual(marker.read_bytes(), b"existing user package")
        self.loader.assert_not_called()

    def test_output_outside_private_root_is_rejected(self):
        with self.assertRaises(ValueError):
            self.run_export(out=self.root.parent / "outside-private-package")
        self.loader.assert_not_called()

    def test_every_positive_flag_requires_exact_true(self):
        for key in ("passed", "completed", "geometry_exact", "final_consumer_parity", "pixel_parity_verified", "external_replay_verified", "fixed_profile_only"):
            for value in (None, False, 1, "true"):
                self.proof[key] = value
                self.persist()
                with self.subTest(key=key, value=value):
                    self.rejected()
            self.proof[key] = True
        self.loader.assert_not_called()

    def test_every_forbidden_flag_requires_exact_false(self):
        for key in ("native_execution_performed", "inference_performed", "product_parity_verified", "arbitrary_frame_backend_connected", "independent_full_frame_preprocessing"):
            for value in (None, True, 0, "false"):
                self.proof[key] = value
                self.persist()
                with self.subTest(key=key, value=value):
                    self.rejected()
            self.proof[key] = False
        self.loader.assert_not_called()

    def test_wrong_profile_and_audit_failures_are_rejected_before_loading_capture(self):
        for key, value in (("profile", "diagnostic-only"), ("failures", ["failed original gate"]), ("failures", {})):
            old = deepcopy(self.proof[key])
            self.proof[key] = value
            self.persist()
            with self.subTest(key=key, value=value):
                self.rejected()
            self.proof[key] = old
        self.loader.assert_not_called()

    def test_typed_head_and_conversion_counts_cannot_be_relaxed(self):
        for key, values in (("head_comparisons", (134, 135.0, True)), ("normalized_conversions", (23, 24.0, True))):
            old = self.proof[key]
            for value in values:
                self.proof[key] = value
                self.persist()
                with self.subTest(key=key, value=value):
                    self.rejected()
            self.proof[key] = old

    def test_capture_candidate_and_render_path_stamps_must_match_arguments(self):
        for key in ("capture", "candidate", "render"):
            old = self.proof[key]
            self.proof[key] = str(self.root / "wrong-target")
            self.persist()
            with self.subTest(key=key):
                self.rejected()
            self.proof[key] = old
        self.loader.assert_not_called()

    def test_missing_audit_path_and_nonfinite_or_duplicate_audit_json_are_rejected(self):
        self.rejected(audit=self.root / "missing-audit.json")
        for data in (b'{"passed":true,"passed":true}', b'{"passed":NaN}', b'{"passed":1e999}'):
            self.proof_path.write_bytes(data)
            with self.subTest(data=data):
                self.rejected()

    def test_linked_report_and_replay_hashes_cannot_be_replaced(self):
        for key in ("capture_sha256", "candidate_report_sha256", "render_report_sha256", "model_report_sha256", "replay_sha256"):
            old = self.proof[key]
            for value in ("f" * 64, "invalid", None, False):
                self.persist()
                self.proof[key] = value
                self.proof_path.write_bytes(encoded(value=self.proof))
                with self.subTest(key=key, value=value):
                    self.rejected()
            self.proof[key] = old

    def test_fixture_path_hash_and_late_mutation_are_not_rehashed_into_acceptance(self):
        for values in ({}, {"relative": "a" * 64}, {str(self.runtime_file): "f" * 64}, {str(self.runtime_file): None}):
            self.persist()
            self.proof["fixture_sha256"] = values
            self.proof_path.write_bytes(encoded(value=self.proof))
            with self.subTest(values=values):
                self.rejected()
        self.persist()
        self.runtime_file.write_bytes(b"runtime changed since audit")
        self.rejected()

    def test_all_declared_fixtures_are_checked_even_when_not_copied(self):
        source = self.root / "additional-locked-fixture.bin"
        self.write(path=source, data=b"original unused fixture")
        self.persist()
        source.write_bytes(b"mutated unused fixture")
        self.rejected()
        self.loader.assert_not_called()

    def test_full_1615_fixture_inventory_is_locked_without_packaging_fixture_bytes(self):
        count = 0
        while len(self.fixture_paths) < 1615:
            self.write(path=self.root / "private-fixtures" / f"locked-{count:04d}.bin", data=f"private fixture {count}".encode())
            count += 1
        self.persist()
        report = self.run_export()
        self.assertEqual(len(self.proof["fixture_sha256"]), 1615)
        self.assertIs(report["passed"], True)
        for path, expected in self.proof["fixture_sha256"].items():
            self.assertEqual(report["fixture_sha256"][path], expected)
        self.assertFalse((self.out / "private-fixtures").exists())
        self.assertEqual(report["source_count"], 63)

    def test_original_source_union_requires_exact_50_entries(self):
        for count in (49, 51):
            original = deepcopy(self.reports)
            if count == 49:
                self.reports["originalCapture"]["source_sha256"].pop(next(iter(self.reports["originalCapture"]["source_sha256"])))
            else:
                self.reports["originalCapture"]["source_sha256"]["local-model-pytorch/extra-old.py"] = "a" * 64
            self.persist()
            with self.subTest(count=count):
                self.rejected()
            self.reports = original

    def test_source_hash_contradiction_between_original_and_candidate_fails(self):
        name = next(iter(self.old_sources))
        self.reports["candidate"]["source_sha256"][name] = "f" * 64
        self.persist()
        self.rejected()

    def test_model_prefixed_source_hash_contradiction_fails(self):
        name = export.audit.MODEL_SOURCES[0]
        self.reports["model"]["source_sha256"][name] = "f" * 64
        self.persist()
        self.rejected()

    def test_image_native_and_candidate_copy_hashes_must_match_original_reports(self):
        for key, field in (("originalCapture", "image_sha256"), ("render", "baseline_sha256"), ("render", "sha256")):
            rows = self.reports[key]["frames" if key == "originalCapture" else "comparisons"]
            old = rows[0][field]
            rows[0][field] = "f" * 64
            self.persist()
            with self.subTest(key=key, field=field):
                self.rejected()
            rows[0][field] = old

    def test_late_source_mutation_revokes_success_in_final_export_report(self):
        original = export.chain.sources
        fixture = self.source_root / next(iter(self.old_sources))

        def mutate(*, names, locked):
            result = original(names=names, locked=locked)
            if names == ("face_preprocess_chain_export.py",):
                fixture.write_bytes(b"changed after successful package copy")
            return result

        with patch.object(export.chain, "sources", side_effect=mutate):
            self.rejected()
        saved = json.loads((self.out / "report.json").read_bytes())
        self.assertIn("guard ValueError", saved["failures"][-1])
        self.assertIs(saved["arbitrary_frame_backend_connected"], False)

    def test_late_destination_mutation_revokes_success_in_final_export_report(self):
        original = export.chain.sources

        def mutate(*, names, locked):
            result = original(names=names, locked=locked)
            if names == ("face_preprocess_chain_export.py",):
                (self.out / "frames/candidate-00.rgba").write_bytes(b"modified after copy")
            return result

        with patch.object(export.chain, "sources", side_effect=mutate):
            self.rejected()
        self.assertIn("guard ValueError", json.loads((self.out / "report.json").read_bytes())["failures"][-1])

    def test_model_root_must_be_bound_to_audited_export_summary(self):
        other = self.root / "other-model-root"
        other.mkdir()
        (other / "summary.json").write_bytes(encoded(value={"passed": True, "different-model": True}))
        self.rejected(root=other)

    def test_current_auditor_source_must_match_its_declared_source_identity(self):
        self.proof["source_sha256"]["local-model-pytorch/face_preprocess_chain_audit.py"] = "f" * 64
        self.persist()
        self.rejected()


if __name__ == "__main__":
    unittest.main()
