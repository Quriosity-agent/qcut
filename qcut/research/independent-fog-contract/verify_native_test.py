import copy
import json
from pathlib import Path
import tempfile
import unittest

from verify_native import CORE_SHA256, CORE_UUID, PACKAGE_SHA256, cases, digest, passes


class ReferenceValidationTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        references = []
        for index, strength in enumerate((0, 0.37, 0.5, 1)):
            path = root / f"{index}.rgba"
            path.write_bytes(bytes([index, 0, 0, 255]) * 2)
            references.append({"intensity": strength, "path": str(path), "sha256": digest(path)})
        self.manifest = {
            "core_sha256": CORE_SHA256, "core_uuid": CORE_UUID,
            "package_identity": {"sha256": PACKAGE_SHA256},
            "results": dict.fromkeys(("all_fixed_time_order_process_equal",
                "all_changing_strength_matches_fresh_child", "zero_intensity_identity",
                "all_alpha_opaque", "all_fixed_strengths_distinct"), True),
            "fixtures": [{"name": "synthetic", "width": 2, "height": 1,
                "input": references[0]["path"], "input_sha256": references[0]["sha256"],
                "references": references}],
        }

    def test_complete_reference(self):
        self.assertEqual(len(cases(json.loads(json.dumps(self.manifest)))), 4)

    def test_each_native_gate_is_required(self):
        for flag in self.manifest["results"]:
            with self.subTest(flag=flag):
                manifest = copy.deepcopy(self.manifest)
                manifest["results"][flag] = False
                with self.assertRaises(ValueError):
                    cases(manifest)

    def test_binary_and_package_identity(self):
        for key in ("core_sha256", "core_uuid", "package_identity"):
            with self.subTest(key=key):
                manifest = copy.deepcopy(self.manifest)
                manifest[key] = {"sha256": "wrong"} if key == "package_identity" else "wrong"
                with self.assertRaises(ValueError):
                    cases(manifest)

    def test_tampered_pixels_even_when_flags_pass(self):
        path = Path(self.manifest["fixtures"][0]["references"][1]["path"])
        path.write_bytes(bytes([99, 0, 0, 255]) * 2)
        with self.assertRaisesRegex(ValueError, "reference bytes"):
            cases(self.manifest)

    def test_missing_duplicate_and_colliding_strengths(self):
        for mode in ("missing", "duplicate", "identity"):
            with self.subTest(mode=mode):
                manifest = copy.deepcopy(self.manifest)
                refs = manifest["fixtures"][0]["references"]
                if mode == "missing":
                    refs.pop()
                elif mode == "duplicate":
                    refs.append(refs[0])
                else:
                    refs[1] = {**refs[0], "intensity": 0.37}
                with self.assertRaises(ValueError):
                    cases(manifest)

    def test_zero_reference_must_equal_input(self):
        refs = self.manifest["fixtures"][0]["references"]
        refs[0] = {**refs[1], "intensity": 0}
        with self.assertRaisesRegex(ValueError, "zero intensity"):
            cases(self.manifest)

    def test_metadata_validation(self):
        for name, value in (("name", "../escape"), ("width", True), ("height", 0), ("references", [])):
            with self.subTest(name=name):
                manifest = copy.deepcopy(self.manifest)
                manifest["fixtures"][0][name] = value
                with self.assertRaises(ValueError):
                    cases(manifest)
        self.manifest["fixtures"] = []
        with self.assertRaisesRegex(ValueError, "empty"):
            cases(self.manifest)

    def test_nonfinite_and_boolean_intensity(self):
        for value in (True, float("nan"), float("inf"), -1, 1.1):
            with self.subTest(value=value):
                manifest = copy.deepcopy(self.manifest)
                manifest["fixtures"][0]["references"][0]["intensity"] = value
                with self.assertRaises(ValueError):
                    cases(manifest)

    def test_transparent_pixels_with_matching_hash(self):
        reference = self.manifest["fixtures"][0]["references"][1]
        path = Path(reference["path"])
        path.write_bytes(bytes([1, 0, 0, 254]) * 2)
        reference["sha256"] = digest(path)
        with self.assertRaisesRegex(ValueError, "opaque"):
            cases(self.manifest)

    def test_zero_cpu_is_strict_and_nonzero_tolerance_is_bounded(self):
        metrics = {"rgb_mae": 0.01, "rgb_max": 1, "alpha_max": 0}
        self.assertFalse(passes(metrics, True, 0, False))
        self.assertTrue(passes(metrics, True, 0.37, False))
        self.assertFalse(passes(metrics, False, 0.37, False))
        for key, value in (("rgb_mae", 0.251), ("rgb_max", 5), ("alpha_max", 1)):
            self.assertFalse(passes({**metrics, key: value}, True, 1, False))


if __name__ == "__main__":
    unittest.main()
