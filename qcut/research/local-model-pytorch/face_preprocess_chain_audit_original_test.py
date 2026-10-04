"""CPU original-frame audit wiring; no native process or inference is started."""
import argparse
import json
import unittest
from unittest.mock import patch

from face_alignment_replay import LockedFiles
import face_preprocess_chain_audit as audit
import face_preprocess_chain_audit_test as audit_tests
import face_preprocess_chain_replay_original_test as original_tests
from face_preprocess_chain_replay_test import encoded, sha


class OriginalAuditRunTests(unittest.TestCase):
    def setUp(self):
        self.fixture = original_tests.OriginalProofTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        fixture = self.fixture
        self.capture, self.render = fixture.root / "capture", fixture.root / "render"
        self.capture.mkdir()
        self.render.mkdir()
        (self.capture / "report.json").write_bytes(b"synthetic capture")
        (self.render / "report.json").write_bytes(b"synthetic render evidence")
        self.value, self.cases = dict(synthetic="owned points"), []
        self.path = fixture.root / "replay.json"
        self.path.write_bytes(encoded(value=self.value))
        fixture.model["capture_sha256"] = sha(data=(self.capture / "report.json").read_bytes())
        fixture.persist()
        fixture.evidence.update(capture=str(self.capture), capture_sha256=fixture.model["capture_sha256"],
            native_caller_parameters_required=True, native_smoothing_initialization_required=True,
            native_inference_called=False, native_160_sampling_input_required=False, diagnostic_only=False,
            manifest_frames=7, owned_smoothing_seed_predictions=[0, 20], native_smoothing_seed_predictions=[], cases=self.cases,
            source_sha256=audit.chain.sources(names=audit.chain.ORIGINAL_SOURCE_NAMES, locked=LockedFiles()))
        self.report_path = self.path.with_name("report.json")
        self.report_path.write_bytes(encoded(value=fixture.evidence))
        self.args = argparse.Namespace(capture=self.capture, candidate=self.path, render=self.render,
                                       root=fixture.root, out=fixture.root / "audit", original_frames=True)
        patch.object(audit.chain.sequence, "PRIVATE", fixture.root).start()
        self.context = dict(root=self.capture, evidence={}, associations=[])
        patch.object(audit.capture, "load", side_effect=self.load_capture).start()
        self.candidate = patch.object(audit.chain_render, "load_candidate", side_effect=self.load_candidate).start()
        self.heads = patch.object(audit, "model_heads", return_value=fixture.model).start()
        self.points = patch.object(audit.chain, "produce", return_value=(self.value, self.cases)).start()
        self.pixels = patch.object(audit, "render_pixels", side_effect=self.load_render).start()
        self.legacy120 = patch.object(audit.chain, "build_120", side_effect=AssertionError("legacy sampler used")).start()
        self.legacy160 = patch.object(audit.chain, "build_160", side_effect=AssertionError("legacy sampler used")).start()
        self.native = patch.object(audit.chain_render.render, "render_host", side_effect=AssertionError("native launch forbidden")).start()
        self.inference = patch.object(audit.parity, "run", side_effect=AssertionError("audit inference forbidden")).start()

    def load_capture(self, *, root, locked):
        locked.read(path=root / "report.json")
        return self.context

    def load_candidate(self, *, path, locked, **kwargs):
        locked.read(path=path)
        return self.value, b"synthetic binary"

    def load_render(self, *, directory, locked, **kwargs):
        locked.read(path=directory / "report.json")
        return []

    def saved(self):
        return json.loads((self.args.out / "report.json").read_bytes())

    def test_cpu_audit_recomputes_original_inputs_heads_points_and_render_evidence(self):
        report = audit.run(args=self.args)
        self.assertTrue(self.candidate.call_args.kwargs["original_frames"])
        self.assertTrue(self.pixels.call_args.kwargs["original_frames"])
        self.assertEqual(set(self.heads.call_args.kwargs["inputs"]), {(120, 0), (160, 0)})
        self.assertIs(self.heads.call_args.kwargs["inputs"][(120, 0)], self.fixture.inputs[(120, 0)])
        self.assertIs(self.points.call_args.kwargs["model"], self.fixture.model)
        self.assertEqual(report["profile"], audit.chain.profile(stage="audit", original_frames=True))
        self.assertEqual(report["preprocessing"], self.fixture.proof)
        for key, value in audit.chain.original_claims(completed=True).items():
            self.assertIs(report[key], value)
        self.assertNotIn("algorithm-rgba", report["native_dependencies"])
        self.assertIn("effect-renderer", report["native_dependencies"])
        for key in ("native_execution_performed", "inference_performed", "product_parity_verified"):
            self.assertIs(report[key], False)
        self.native.assert_not_called()
        self.inference.assert_not_called()
        self.legacy120.assert_not_called()
        self.legacy160.assert_not_called()

    def test_missing_original_fixture_stops_before_heads_and_pixel_acceptance(self):
        self.fixture.evidence["fixture_sha256"].pop(str(self.fixture.raw))
        self.report_path.write_bytes(encoded(value=self.fixture.evidence))
        with self.assertRaisesRegex(ValueError, "fixture missing"):
            audit.run(args=self.args)
        self.heads.assert_not_called()
        self.pixels.assert_not_called()
        self.assertIs(self.saved()["passed"], False)

    def test_changed_source_inventory_stops_before_model_audit(self):
        self.fixture.evidence["source_sha256"].pop("local-model-pytorch/face_full_frame_quantization.py")
        self.report_path.write_bytes(encoded(value=self.fixture.evidence))
        with self.assertRaisesRegex(ValueError, "source inventory"):
            audit.run(args=self.args)
        self.heads.assert_not_called()

    def test_recomputed_points_must_still_equal_candidate(self):
        self.points.return_value = (dict(synthetic="different points"), self.cases)
        with self.assertRaisesRegex(ValueError, "owned normalized replay"):
            audit.run(args=self.args)
        self.pixels.assert_not_called()

    def test_late_original_mutation_revokes_completed_audit(self):
        def mutate(**kwargs):
            result = self.load_render(**kwargs)
            self.fixture.raw.write_bytes(b"changed after audit")
            return result
        self.pixels.side_effect = mutate
        with self.assertRaisesRegex(ValueError, "hash mismatch|changed between reads"):
            audit.run(args=self.args)
        report = self.saved()
        for key in ("passed", "completed", "pixel_parity_verified", "independent_full_frame_preprocessing", "original_rgba_input_used"):
            self.assertIs(report[key], False)


class OriginalRenderAuditTests(unittest.TestCase):
    def setUp(self):
        self.fixture = audit_tests.RenderTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        fixture = self.fixture
        fixture.evidence.update(audit.chain.original_claims(completed=True),
            profile=audit.chain.profile(stage="render", original_frames=True),
            source_sha256=fixture.sources(names=(*audit.chain.ORIGINAL_SOURCE_NAMES, "face_preprocess_chain_render.py")))
        producer = fixture.path.with_name("report.json")
        producer.write_bytes(b"synthetic original-frame producer")
        fixture.locked.read(path=producer)
        fixture.evidence["candidate_report_sha256"] = sha(data=producer.read_bytes())
        fixture.persist()

    def load(self):
        fixture = self.fixture
        return audit.render_pixels(directory=fixture.directory, context=fixture.context, value=fixture.value,
                                   payload=fixture.payload, path=fixture.path, locked=fixture.locked, original_frames=True)

    def test_original_render_keeps_exact_events_requests_and_pixel_gates(self):
        self.assertEqual(self.load(), self.fixture.metrics)

    def test_original_render_requires_same_producer_report(self):
        self.fixture.evidence["candidate_report_sha256"] = "e" * 64
        self.fixture.persist()
        with self.assertRaisesRegex(ValueError, "producer report linkage"):
            self.load()

    def test_legacy_render_cannot_be_substituted(self):
        self.fixture.evidence["profile"] = audit.chain.profile(stage="render")
        self.fixture.persist()
        with self.assertRaisesRegex(ValueError, "actual render report"):
            self.load()

    def test_native_algorithm_producer_claim_is_rejected(self):
        self.fixture.evidence["native_algorithm_rgba_input_used"] = True
        self.fixture.persist()
        with self.assertRaisesRegex(ValueError, "native_algorithm_rgba_input_used"):
            self.load()

    def test_one_pixel_mismatch_is_not_relaxed_for_original_mode(self):
        path = self.fixture.directory / "frame-00.rgba"
        data = bytearray(path.read_bytes())
        data[0] += 1
        path.write_bytes(bytes(data))
        self.fixture.persist()
        with self.assertRaisesRegex(ValueError, "exact zero delta"):
            self.load()


if __name__ == "__main__":
    unittest.main()
