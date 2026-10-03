"""CPU fixtures, catalog/package semantics and immutable guard checks."""
import json
from pathlib import Path
import shutil
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


if __name__ == "__main__":
    unittest.main()
