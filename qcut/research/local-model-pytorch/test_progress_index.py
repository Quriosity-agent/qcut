import json
import pathlib
import tempfile
import unittest

from espresso_archive import sha256
from progress_index import consolidate, passed_cases


class ProgressTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.artifact = self.root / "model.pt"
        self.artifact.write_bytes(b"synthetic artifact; no deserialization")
        self.digest = "a" * 64
        self.baseline = self.root / "base.json"
        self.baseline.write_text(json.dumps({"models": [{"sha256": self.digest, "status": "unsupported", "source": "test.model"}]}))

    def tearDown(self):
        self.temp.cleanup()

    def supplement(self, **fields):
        report = {"source_sha256": self.digest, "status": "native-parity-passed", "artifact": str(self.artifact),
                  "sha256": sha256(path=self.artifact), "native": [{"passed": True}], **fields}
        path = self.root / "supplement.json"
        path.write_text(json.dumps(report))
        return path

    def test_verified_upgrade(self):
        report = consolidate(baseline=self.baseline, supplements=[self.supplement()])
        self.assertEqual(report["verified_network_assets"], 1)
        self.assertEqual(report["unique_artifacts"], 1)
        self.assertEqual(report["additional_assets"], 0)

    def test_baseline_requires_native_evidence(self):
        for verification in ([], [{"passed": False}]):
            with self.subTest(verification=verification):
                self.baseline.write_text(json.dumps({"models": [{"sha256": self.digest, "status": "native-parity-passed",
                    "artifact": str(self.artifact), "artifact_sha256": sha256(path=self.artifact), "verification": verification}]}))
                with self.assertRaises(ValueError):
                    consolidate(baseline=self.baseline)

    def test_baseline_requires_artifact_digest(self):
        self.baseline.write_text(json.dumps({"models": [{"sha256": self.digest, "status": "native-parity-passed",
            "artifact": str(self.artifact), "verification": [{"passed": True}]}]}))
        with self.assertRaises(ValueError):
            consolidate(baseline=self.baseline)

    def test_two_networks_one_artifact(self):
        report = consolidate(baseline=self.baseline, supplements=[self.supplement(source_sha256={"first": self.digest, "second": "b" * 64})])
        self.assertEqual(report["verified_network_assets"], 2)
        self.assertEqual(report["unique_artifacts"], 1)
        self.assertEqual(report["additional_assets"], 1)

    def test_empty_native_is_not_success(self):
        with self.assertRaises(ValueError):
            consolidate(baseline=self.baseline, supplements=[self.supplement(native=[])])

    def test_failed_native_is_not_success(self):
        with self.assertRaises(ValueError):
            consolidate(baseline=self.baseline, supplements=[self.supplement(native=[{"passed": True}, {"passed": False}])])

    def test_hash_change_is_not_success(self):
        path = self.supplement()
        self.artifact.write_bytes(b"changed")
        with self.assertRaises(ValueError):
            consolidate(baseline=self.baseline, supplements=[path])

    def test_missing_artifact_is_not_success(self):
        path = self.supplement(artifact=str(self.root / "missing.pt"))
        with self.assertRaises(ValueError):
            consolidate(baseline=self.baseline, supplements=[path])

    def test_nested_cases(self):
        self.assertEqual(passed_cases(value={"frame-0": {"mask": {"passed": True}, "state": {"passed": False}}}), [True, False])

    def test_root_success_does_not_hide_nested_failure(self):
        with self.assertRaises(ValueError):
            consolidate(baseline=self.baseline, supplements=[self.supplement(native={"passed": True, "child": {"passed": False}})])

    def test_missing_artifact_hash(self):
        with self.assertRaises(ValueError):
            consolidate(baseline=self.baseline, supplements=[self.supplement(sha256=None)])

    def test_nested_artifact_schema(self):
        path = self.supplement(artifact={"path": str(self.artifact), "sha256": sha256(path=self.artifact)})
        report = consolidate(baseline=self.baseline, supplements=[path])
        self.assertEqual(report["verified_network_assets"], 1)

    def test_native_summary_and_separate_cases(self):
        path = self.supplement(native={"status": "completed"}, cases=[{"native": {"passed": True}}])
        report = consolidate(baseline=self.baseline, supplements=[path])
        self.assertEqual(report["verified_network_assets"], 1)

    def test_classification_not_a_conversion(self):
        containers = self.root / "containers.json"
        containers.write_text(json.dumps({"records": [{"sha256": self.digest, "status": "inspected", "classification": {"category": "neural-container"}}]}))
        report = consolidate(baseline=self.baseline, containers=containers)
        self.assertEqual(report["verified_network_assets"], 0)
        self.assertEqual(report["records"][0]["status"], "unsupported")

    def test_failed_candidate_does_not_count_as_verified(self):
        candidate = self.supplement(status="native-parity-failed", native=[{"passed": False}])
        report = consolidate(baseline=self.baseline, candidates=[candidate])
        self.assertEqual(report["verified_network_assets"], 0)
        self.assertEqual(report["unverified_candidate_artifacts"], 1)
        self.assertEqual(report["records"][0]["failed_native_checks"], 1)

    def test_candidate_requires_explicit_status(self):
        with self.assertRaises(ValueError):
            consolidate(baseline=self.baseline, candidates=[self.supplement(status="unknown")])

    def test_candidate_outside_baseline(self):
        candidate = self.supplement(source_sha256="c" * 64, status="native-parity-failed", native=[{"passed": False}])
        report = consolidate(baseline=self.baseline, candidates=[candidate])
        self.assertEqual(report["additional_assets"], 1)
        self.assertEqual(report["verified_network_assets"], 0)

    def test_preserve_research_shape_limit(self):
        path = self.supplement(native_graph_input_resized=True, research_side=64, original_input_shape=[1, 3, 1088, 1920])
        report = consolidate(baseline=self.baseline, supplements=[path])
        self.assertTrue(report["records"][0]["native_graph_input_resized"])
        self.assertEqual(report["records"][0]["research_side"], 64)


if __name__ == "__main__":
    unittest.main()
