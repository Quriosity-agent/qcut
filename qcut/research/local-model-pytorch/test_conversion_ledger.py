import json
from pathlib import Path
import tempfile
import unittest

from conversion_ledger import build_ledger
from espresso_archive import sha256


class LedgerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.prior = self.root / "prior.json"
        self.prior.write_text(json.dumps({"format": "qcut-private-conversion-progress", "records": [
            {"sha256": "a" * 64, "source": "synthetic", "status": "unsupported"}]}))
        self.artifact = self.root / "model.pt"
        self.artifact.write_bytes(b"synthetic fixture, not deserialized")

    def tearDown(self):
        self.temp.cleanup()

    def entry(self, **fields):
        return {"source_sha256": "a" * 64, "artifact": str(self.artifact), "artifact_sha256": sha256(path=self.artifact),
                "status": "native-parity-passed", "cases": [{"passed": True}], **fields}

    def report(self, *, name="report", **fields):
        path = self.root / f"{name}.json"
        path.write_text(json.dumps(fields))
        return path

    def test_multiple_subnetworks_one_asset_one_bundle(self):
        path = self.report(networks=[self.entry(network_id="head-a"), self.entry(network_id="head-b")])
        result = build_ledger(prior=self.prior, reports=[path])
        self.assertEqual(result["sources_with_verified_networks"], 1)
        self.assertEqual(result["verified_network_versions"], 2)
        self.assertEqual(result["verified_bundle_hashes"], 1)
        self.assertEqual(result["assets"][0]["whole_asset_coverage"], "not-inferred-from-subnet-results")

    def test_partial_network_is_not_whole_asset_success(self):
        path = self.report(networks=[self.entry(network_id="a"), self.entry(network_id="b", status="native-parity-failed", cases=[{"passed": False}])])
        result = build_ledger(prior=self.prior, reports=[path])
        self.assertEqual(result["verified_network_versions"], 1)
        self.assertEqual(result["unverified_network_versions"], 1)

    def test_backend_failure_is_retained_when_cpu_passes(self):
        failed = self.report(name="old", **self.entry(status="native-parity-failed", cases=[{"passed": False}], verification_scope="default backend"))
        passed = self.report(name="new", **self.entry(verification_scope="forced CPU"))
        result = build_ledger(prior=self.prior, reports=[failed, passed])
        self.assertEqual(result["verified_network_versions"], 1)
        self.assertEqual(len(result["networks"][0]["history"]), 2)
        self.assertTrue(result["networks"][0]["has_nonpassing_evidence"])

    def test_repeated_report_does_not_duplicate_network(self):
        path = self.report(**self.entry())
        result = build_ledger(prior=self.prior, reports=[path, path])
        self.assertEqual(result["verified_network_versions"], 1)
        self.assertEqual(len(result["networks"][0]["history"]), 1)

    def test_native_scope_and_transform_are_retained(self):
        fields = {"backend": {"forced_cpu": True}, "scope": "tensor parity only", "schema": {"data": [1, 3, 32, 32]},
                  "original_graph_unchanged": False, "original_topology_unchanged": True,
                  "graph_transform": "pinned native FP16 expansion", "fp16_decoder_proof": {"passed": True}}
        path = self.report(**self.entry(**fields))
        result = build_ledger(prior=self.prior, reports=[path])
        history = result["networks"][0]["history"][0]
        for key, value in fields.items():
            self.assertEqual(history[key], value)

    def test_failure_without_bundle_is_recorded(self):
        path = self.report(source_sha256="a" * 64, status="native-blocked", network_id="head")
        result = build_ledger(prior=self.prior, reports=[path])
        self.assertEqual(result["unverified_network_versions"], 1)
        self.assertEqual(result["verified_bundle_hashes"], 0)

    def test_verified_entry_needs_nonempty_native_evidence(self):
        for cases in ([], [{"passed": False}], [{"passed": True}, {"passed": False}]):
            path = self.report(**self.entry(cases=cases))
            with self.assertRaises(ValueError):
                build_ledger(prior=self.prior, reports=[path])

    def test_artifact_digest_is_checked(self):
        path = self.report(**self.entry())
        self.artifact.write_bytes(b"changed")
        with self.assertRaises(ValueError):
            build_ledger(prior=self.prior, reports=[path])

    def test_prior_success_is_rechecked_against_native_evidence(self):
        proof = self.report(**self.entry(cases=[{"passed": False}]))
        self.prior.write_text(json.dumps({"format": "qcut-private-conversion-progress", "records": [{
            "sha256": "a" * 64, "status": "native-parity-passed", "artifact": str(self.artifact),
            "artifact_sha256": sha256(path=self.artifact), "verification_report": str(proof)}]}))
        with self.assertRaises(ValueError):
            build_ledger(prior=self.prior)

    def test_prior_source_identity_cannot_change(self):
        proof = self.report(**self.entry(source_sha256="b" * 64))
        self.prior.write_text(json.dumps({"format": "qcut-private-conversion-progress", "records": [{
            "sha256": "a" * 64, "status": "native-parity-passed", "artifact": str(self.artifact),
            "artifact_sha256": sha256(path=self.artifact), "verification_report": str(proof)}]}))
        with self.assertRaises(ValueError):
            build_ledger(prior=self.prior)

    def test_duplicate_network_identity_rejected(self):
        path = self.report(networks=[self.entry(), self.entry()])
        with self.assertRaises(ValueError):
            build_ledger(prior=self.prior, reports=[path])

    def test_stable_network_identifier(self):
        path = self.report(**self.entry(network_id="../escape"))
        with self.assertRaises(ValueError):
            build_ledger(prior=self.prior, reports=[path])

    def test_source_identity_not_artifact_count(self):
        path = self.report(networks=[self.entry(source_sha256="a" * 64), self.entry(source_sha256="b" * 64)])
        result = build_ledger(prior=self.prior, reports=[path])
        self.assertEqual(result["sources_with_verified_networks"], 2)
        self.assertEqual(result["verified_network_versions"], 2)
        self.assertEqual(result["verified_bundle_hashes"], 1)


if __name__ == "__main__":
    unittest.main()
