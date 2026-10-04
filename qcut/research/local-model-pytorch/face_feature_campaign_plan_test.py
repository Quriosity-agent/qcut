"""CPU fixtures, catalog/package semantics and immutable guard checks."""
import json
import copy
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

from face_alignment_replay import LockedFiles
import face_feature_campaign_plan as plan


class PlanTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()

    def test_selection_rejects_unknown_duplicate_empty_and_unbounded(self):
        for values in ([], ["eye", "eye"], ["bogus"], list(plan.FEATURES) * 4, None):
            with self.subTest(values=values), self.assertRaises(ValueError):
                plan.selection(values=values)

    def test_all_six_features_supported(self):
        self.assertEqual(plan.selection(values=list(plan.FEATURES)), list(plan.FEATURES))

    def test_parent_provider_tracking_and_resolver_sources_are_bound(self):
        self.assertTrue({"provider.ts", "tracking-scope-pool.ts", "package-resolver.ts"}.issubset(
            {source.name for source in plan.CATALOG_SOURCES}))

    def test_product_builders_preserve_scalar_vector_dynamic_package_protocols(self):
        bun = shutil.which("bun")
        self.assertIsNotNone(bun, "bun required for actual product catalog CPU test")
        runtime = self.root / "runtime with spaces"
        choices = plan.catalog(runtime=runtime, bun=Path(bun))
        for name in ("eye", "nose", "mouth", "jaw"):
            row = choices[name]
            for level, factor in (("active", 1), ("half", .5), ("zero", 0)):
                parameters = row["parameters"][level]
                self.assertEqual(parameters[row["key"]], [dict(id=-1, intensity=row["value"] / 100 * factor)])
                self.assertTrue(all(entry[0]["intensity"] == 0 for key, entry in parameters.items() if key != row["key"]))
        self.assertEqual(choices["jaw"]["runtimePackage"], "jawline")
        self.assertEqual(choices["skin"]["parameters"], dict(active=dict(intensity=.5), half=dict(intensity=.25), zero=dict(intensity=0)))
        makeup = choices["makeup"]
        self.assertEqual(len(makeup["packages"]), 2)
        self.assertNotEqual(*makeup["packages"])
        for level in ("active", "half", "zero"):
            self.assertEqual(makeup["parameters"][level][makeup["key"]][0]["path"], makeup["packages"][1])

    def test_image_and_control_manifest_are_preserved_except_feature(self):
        image = self.root / "image.png"
        Image.new("RGB", (1448, 1086)).save(image)
        frames = [dict(image="image.png", timestamp=index / 30, parameters=dict(intensity=1 if change else 0),
                       expect_change=change, label=str(index)) for index, change in enumerate(plan.CONTROL_CHANGE)]
        template = self.root / "template.json"
        template.write_text(json.dumps(dict(version=1, frames=frames)))
        before = template.read_bytes()
        locked = LockedFiles()
        spec = dict(parameters=dict(active=dict(intensity=.8), half=dict(intensity=.4), zero=dict(intensity=0)))
        result = plan.materialize(template=template, feature=spec, locked=locked)
        self.assertEqual([row["parameters"]["intensity"] for row in result["frames"]], [.8, .8, .8, .8, .8, 0, .4])
        self.assertEqual([row["expect_change"] for row in result["frames"]], plan.CONTROL_CHANGE)
        self.assertEqual(template.read_bytes(), before)
        self.assertIn(str(image), locked.files)
        frames[1]["timestamp"] = 0
        template.write_text(json.dumps(dict(version=1, frames=frames)))
        with self.assertRaisesRegex(ValueError, "increasing"):
            plan.materialize(template=template, feature=spec, locked=LockedFiles())

    def test_wrong_profile_never_becomes_seven_frame_evidence(self):
        template = self.root / "template.json"
        for frames in ([], [dict(image="x", timestamp=0, parameters={})] * 7):
            template.write_text(json.dumps(dict(version=1, frames=frames)))
            with self.assertRaises(ValueError):
                plan.materialize(template=template, feature={}, locked=LockedFiles())

    def test_asset_hash_or_identity_drift_is_rejected(self):
        source = self.root / "asset"
        source.write_bytes(b"original")
        value = dict(locked_files={str(source): plan.driver.file_fingerprint(path=source)}, trees=[], libraries={})
        plan.verify_epoch(plan=value)
        source.write_bytes(b"changed!")
        with self.assertRaisesRegex(ValueError, "changed"):
            plan.verify_epoch(plan=value)

    def test_new_source_and_modified_source_are_rejected(self):
        source = self.root / "source.py"
        source.write_text("x = 1\n")
        guard = plan.driver.TreeGuard(root=self.root, source=True)
        value = dict(locked_files={}, libraries={}, trees=[dict(root=str(self.root), source=True, files=guard.files)])
        plan.verify_epoch(plan=value)
        (self.root / "new.py").write_text("x = 2\n")
        with self.assertRaisesRegex(ValueError, "epoch changed"):
            plan.verify_epoch(plan=value)

    def test_invalid_plan_hash_precedes_reads(self):
        for sha in (None, "", "abc", "A" * 64):
            with self.subTest(sha=sha), self.assertRaises(ValueError):
                plan.load(path=self.root / "missing", expected_sha256=sha)

    def test_plan_tampering_fails_hash_before_native_execution(self):
        path = self.root / "plan.json"
        path.write_text('{"format":"face-feature-campaign-plan-v1"}')
        with self.assertRaises(ValueError):
            plan.load(path=path, expected_sha256="a" * 64)

    def test_write_json_never_rewrites_old_evidence(self):
        path = self.root / "report.json"
        plan.write_json(path=path, value={"passed": False})
        with self.assertRaises(FileExistsError):
            plan.write_json(path=path, value={"passed": True})
        self.assertFalse(json.loads(path.read_bytes())["passed"])


class CacheResolutionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.runtime = self.root / "runtime with spaces"
        self.private = self.runtime / "Cache/effect"
        self.cache = self.root / "explicit effect cache"
        self.private.mkdir(parents=True)
        self.cache.mkdir()
        bun = shutil.which("bun")
        self.assertIsNotNone(bun)
        self.bun = Path(bun)
        self.catalog = plan.catalog(runtime=self.runtime, bun=self.bun)

    def package(self, *, feature="jaw", root=None, index=0, version=None):
        binding = self.catalog[feature]["packageBindings"][index]
        package = (root or self.cache) / binding["resourceId"] / (version or binding["version"])
        package.mkdir(parents=True)
        (package / "algorithmConfig.json").write_text("{}")
        return package

    def resolved(self, *, cache=True):
        return plan.catalog(runtime=self.runtime, bun=self.bun, effect_cache_root=self.cache if cache else None)

    def frozen(self, *, feature="jaw"):
        spec = self.resolved()[feature]
        guards = [plan.driver.TreeGuard(root=Path(name)) for name in spec["packages"]]
        return dict(format="face-feature-campaign-plan-v2", paths=dict(runtime=str(self.runtime), effect_cache_root=str(self.cache)),
            cases=[dict(spec=spec)], package_roots=plan.root_identities(specs=[spec]), locked_files={}, libraries={},
            trees=[dict(root=str(guard.root), source=False, files=guard.files) for guard in guards])

    def test_private_pinned_package_preferred_over_explicit_cache(self):
        private = self.package(root=self.private)
        self.package()
        spec = self.resolved()["jaw"]
        self.assertEqual(spec["hostPackage"], str(private))
        self.assertEqual(spec["packageBindings"][0]["source"], "private")
        self.assertEqual(spec["parameters"], self.catalog["jaw"]["parameters"])

    def test_explicit_fallback_exact_version_and_no_implicit_cache(self):
        package = self.package()
        without_cache = self.resolved(cache=False)["jaw"]
        self.assertFalse(without_cache["packageBindings"][0]["available"])
        with self.assertRaisesRegex(ValueError, "missing pinned"):
            plan.validate_bindings(spec=without_cache, runtime=self.runtime, require_available=True)
        spec = self.resolved()["jaw"]
        self.assertEqual(spec["hostPackage"], str(package))
        plan.validate_bindings(spec=spec, runtime=self.runtime, effect_cache_root=self.cache, require_available=True)

    def test_other_versions_are_not_substituted(self):
        self.package(version="0" * 32)
        spec = self.resolved()["jaw"]
        self.assertFalse(spec["packageBindings"][0]["available"])
        with self.assertRaisesRegex(ValueError, "missing pinned"):
            plan.validate_bindings(spec=spec, runtime=self.runtime, effect_cache_root=self.cache, require_available=True)

    def test_missing_packages_remain_unavailable(self):
        spec = self.resolved()["jaw"]
        with self.assertRaisesRegex(ValueError, "missing pinned package"):
            plan.validate_bindings(spec=spec, runtime=self.runtime, effect_cache_root=self.cache, require_available=True)

    def test_dynamic_card_fallback_keeps_private_makeup_host(self):
        host = self.package(feature="makeup", root=self.private)
        card = self.package(feature="makeup", index=1)
        spec = self.resolved()["makeup"]
        self.assertEqual(spec["packages"], [str(host), str(card)])
        self.assertEqual(spec["hostPackage"], str(host))
        self.assertEqual([row["source"] for row in spec["packageBindings"]], ["private", "effect-cache"])
        for level in ("active", "half", "zero"):
            self.assertEqual(spec["parameters"][level][spec["key"]][0]["path"], str(card))
        plan.verify_epoch(plan=self.frozen(feature="makeup"))

    def test_relative_nonexistent_and_symlink_config_roots_rejected(self):
        alias = self.root / "alias"
        alias.symlink_to(self.cache, target_is_directory=True)
        for root in (Path("relative"), self.root / "missing", alias):
            with self.subTest(root=root), self.assertRaises(ValueError):
                plan.catalog(runtime=self.runtime, bun=self.bun, effect_cache_root=root)

    def test_case_insensitive_directory_spelling_is_not_a_symlink(self):
        self.package()
        alias = self.cache.with_name(self.cache.name.upper())
        if not alias.is_dir():
            self.skipTest("case-sensitive filesystem")
        spec = plan.catalog(runtime=self.runtime, bun=self.bun, effect_cache_root=alias)["jaw"]
        self.assertEqual(spec["packageBindings"][0]["root"], str(alias))
        self.assertTrue(spec["packageBindings"][0]["available"])

    def test_symlink_package_and_resource_ancestor_rejected(self):
        binding = self.catalog["jaw"]["packageBindings"][0]
        outside = self.root / "outside"
        outside.mkdir()
        for component in ("resource", "version"):
            root = self.root / component
            root.mkdir()
            if component == "resource":
                (outside / binding["version"]).mkdir()
                (root / binding["resourceId"]).symlink_to(outside, target_is_directory=True)
            else:
                (root / binding["resourceId"]).mkdir()
                (root / binding["resourceId"] / binding["version"]).symlink_to(outside, target_is_directory=True)
            with self.subTest(component=component), self.assertRaises(subprocess.CalledProcessError):
                plan.catalog(runtime=self.runtime, bun=self.bun, effect_cache_root=root)

    def test_unsafe_private_package_cannot_silently_fallback(self):
        cached = self.package()
        binding = self.catalog["jaw"]["packageBindings"][0]
        (self.private / binding["resourceId"]).mkdir()
        (self.private / binding["resourceId"] / binding["version"]).symlink_to(cached, target_is_directory=True)
        with self.assertRaises(subprocess.CalledProcessError):
            self.resolved()

    def test_package_internal_file_escape_rejected_by_unchanged_treeguard(self):
        package = self.package()
        outside = self.root / "outside-file"
        outside.write_text("outside")
        (package / "escape").symlink_to(outside)
        with self.assertRaisesRegex(ValueError, "escapes tree"):
            self.frozen()

    def test_package_internal_directory_alias_rejected_by_unchanged_treeguard(self):
        package = self.package()
        (package / "directory").mkdir()
        (package / "alias").symlink_to(package / "directory", target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "symlink directory"):
            self.frozen()

    def test_cached_package_mutation_invalidates_epoch(self):
        package = self.package()
        frozen = self.frozen()
        plan.verify_epoch(plan=frozen)
        (package / "algorithmConfig.json").write_text('{"changed": true}')
        with self.assertRaisesRegex(ValueError, "epoch changed"):
            plan.verify_epoch(plan=frozen)

    def test_cache_root_replacement_with_same_files_invalidates_identity(self):
        self.package()
        frozen = self.frozen()
        old = self.root / "old-cache"
        self.cache.rename(old)
        self.cache.mkdir()
        for resource in old.iterdir():
            resource.rename(self.cache / resource.name)
        with self.assertRaisesRegex(ValueError, "root identity changed"):
            plan.verify_epoch(plan=frozen)

    def test_cache_root_symlink_swap_invalidates_epoch(self):
        self.package()
        frozen = self.frozen()
        old = self.root / "old-cache"
        self.cache.rename(old)
        self.cache.symlink_to(old, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "without symlinks"):
            plan.verify_epoch(plan=frozen)

    def test_new_private_pinned_package_invalidates_cached_resolution(self):
        self.package()
        frozen = self.frozen()
        self.package(root=self.private)
        with self.assertRaisesRegex(ValueError, "private-first"):
            plan.verify_epoch(plan=frozen)

    def test_binding_traversal_or_unconfigured_root_rejected(self):
        self.package()
        spec = self.resolved()["jaw"]
        for key, value in (("resourceId", "../escape"), ("version", "../escape"),
                           ("root", str(self.root)), ("available", 1), ("source", "discovered")):
            changed = copy.deepcopy(spec)
            changed["packageBindings"][0][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                plan.validate_bindings(spec=changed, runtime=self.runtime, effect_cache_root=self.cache, require_available=True)


if __name__ == "__main__":
    unittest.main()
