"""Explicit original-frame renderer contracts; all native calls are mocked."""
import unittest
from unittest.mock import patch

from face_alignment_replay import LockedFiles
import face_preprocess_chain_render as render
import face_preprocess_chain_render_test as render_tests


class OriginalCandidateTests(unittest.TestCase):
    def setUp(self):
        self.fixture = render_tests.CandidateTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        fixture = self.fixture
        fixture.evidence.update(render.chain.original_claims(completed=True), failures=[],
                                profile=render.chain.profile(original_frames=True))
        fixture.evidence["source_sha256"] = {}
        for name in render.chain.ORIGINAL_SOURCE_NAMES:
            path = fixture.source_root / "local-model-pytorch" / name
            path.write_bytes(("synthetic " + name).encode())
            identity = render_tests.sha(data=path.read_bytes())
            fixture.evidence["source_sha256"]["local-model-pytorch/" + name] = identity
            fixture.evidence["fixture_sha256"][str(path)] = identity
        self.verifier = patch.object(render.chain, "verify_original_inputs").start()
        fixture.persist()

    def load(self, *, original_frames=True):
        fixture = self.fixture
        locked = LockedFiles()
        locked.read(path=fixture.capture_report)
        return render.load_candidate(path=fixture.path, context=fixture.context, locked=locked,
                                     original_frames=original_frames)

    def test_original_profile_recomputes_inputs_before_accepting_points(self):
        value, payload = self.load()
        self.assertEqual(value, self.fixture.value)
        self.assertTrue(payload.startswith(render.consumer.MAGIC))
        self.verifier.assert_called_once()
        self.assertIs(self.verifier.call_args.kwargs["context"], self.fixture.context)
        self.assertEqual(self.verifier.call_args.kwargs["directory"], self.fixture.candidate)

    def test_default_mode_rejects_original_profile(self):
        with self.assertRaisesRegex(ValueError, "bound to this capture"):
            self.load(original_frames=False)
        self.verifier.assert_not_called()

    def test_explicit_original_mode_rejects_legacy_profile(self):
        self.fixture.evidence["profile"] = render.chain.profile()
        self.fixture.persist()
        with self.assertRaisesRegex(ValueError, "bound to this capture"):
            self.load()
        self.verifier.assert_not_called()

    def test_source_inventory_cannot_omit_new_producer(self):
        self.fixture.evidence["source_sha256"].pop("local-model-pytorch/face_full_frame_owned.py")
        self.fixture.persist()
        with self.assertRaisesRegex(ValueError, "complete original-frame producer source"):
            self.load()
        self.verifier.assert_not_called()

    def test_changed_source_fails_before_producer_verification(self):
        path = self.fixture.source_root / "local-model-pytorch/face_full_frame_owned_inputs.py"
        path.write_bytes(b"changed source")
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            self.load()
        self.verifier.assert_not_called()

    def test_omitted_source_fixture_cannot_be_backfilled_by_current_source(self):
        path = self.fixture.source_root / "local-model-pytorch/face_full_frame_owned.py"
        self.fixture.evidence["fixture_sha256"].pop(str(path))
        self.fixture.persist()
        with self.assertRaisesRegex(ValueError, "pinned producer fixture"):
            self.load()
        self.verifier.assert_not_called()

    def test_failed_recomputation_cannot_become_diagnostic_render(self):
        self.verifier.side_effect = ValueError("original byte producer mismatch")
        self.fixture.evidence["diagnostic_only"] = True
        self.fixture.persist()
        with self.assertRaisesRegex(ValueError, "original byte producer mismatch"):
            self.load()

    def test_original_mode_keeps_exact_point_gate(self):
        self.fixture.value["frames"][0]["faces"][0]["points"][0][0] += 0.00001
        self.fixture.persist()
        with self.assertRaisesRegex(ValueError, "normalized points differ"):
            self.load()


class OriginalRenderRunTests(unittest.TestCase):
    def setUp(self):
        self.fixture = render_tests.RenderRunTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        fixture = self.fixture
        fixture.args.original_frames = True
        report_path = fixture.path.with_name("report.json")
        report_path.write_bytes(b"synthetic candidate report")
        fixture.locked.read(path=report_path)

    def test_explicit_mode_and_exact_owned_payload_reach_render_host(self):
        fixture = self.fixture
        report = render.run(args=fixture.args)
        self.assertTrue(fixture.candidate.call_args.kwargs["original_frames"])
        self.assertIs(fixture.host_run.call_args.kwargs["value"], fixture.value)
        self.assertEqual((fixture.out / "replay.bin").read_bytes(), fixture.payload)
        self.assertEqual(report["profile"], render.chain.profile(stage="render", original_frames=True))
        self.assertEqual(report["candidate_report_sha256"], fixture.locked.files[str(fixture.path.with_name("report.json"))])
        for key, value in render.chain.original_claims(completed=True).items():
            self.assertIs(report[key], value)
        self.assertIs(report["product_parity_verified"], False)

    def test_rejected_original_proof_never_starts_native_host(self):
        self.fixture.candidate.side_effect = ValueError("original fixture missing")
        with self.assertRaisesRegex(ValueError, "original fixture missing"):
            render.run(args=self.fixture.args)
        self.fixture.host_run.assert_not_called()
        self.assertIs(self.fixture.saved()["passed"], False)

    def test_guard_checks_fixtures_again_before_host_launch(self):
        fixture = self.fixture
        with patch.object(fixture.locked, "verify", side_effect=ValueError("source changed before host")):
            with self.assertRaisesRegex(ValueError, "source changed before host"):
                render.run(args=fixture.args)
        fixture.host_run.assert_not_called()
        self.assertIs(fixture.saved()["independent_full_frame_preprocessing"], False)


if __name__ == "__main__":
    unittest.main()
