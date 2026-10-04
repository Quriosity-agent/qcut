"""Explicit original-frame renderer contracts; all native calls are mocked."""
import argparse
from copy import deepcopy
import json
import unittest
from unittest.mock import patch

import numpy as np

from face_alignment_replay import LockedFiles
import face_preprocess_chain_render as render
import face_preprocess_chain_render_test as render_tests
import face_preprocess_chain_replay_test as replay_tests


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
        self.onnx = fixture.candidate / "onnx"
        self.onnx.mkdir()
        self.model = dict(source_sha256={}, model_outputs={})
        for name in render.MODEL_SOURCES:
            path = fixture.source_root / "local-model-pytorch" / name
            path.write_bytes(("synthetic " + name).encode())
            self.model["source_sha256"][name] = render_tests.sha(data=path.read_bytes())
        self.heads = []
        for size, count in ((120, 25), (160, 2)):
            self.model["model_outputs"][str(size)] = dict(
                graph_sha256="a" * 64, cases=[dict(inference=index) for index in range(count)])
            for index in range(count):
                path = self.onnx / f"size-{size}-infer-{index:03d}-fc_landmark_s1.npy"
                np.save(path, np.zeros((1, 1, 1, 212), np.float32), allow_pickle=False)
                fixture.evidence["fixture_sha256"][str(path)] = render_tests.sha(data=path.read_bytes())
                self.heads.append(path)
        self.cases = [dict(prediction=0, owned_seed_used=True)]
        fixture.evidence["cases"] = deepcopy(self.cases)
        self.real_producer = render.chain.produce
        self.producer = patch.object(render.chain, "produce", return_value=(deepcopy(fixture.value), self.cases)).start()
        self.persist_model()

    def persist_model(self):
        fixture = self.fixture
        path = self.onnx / "report.json"
        path.write_bytes(render_tests.encoded(value=self.model))
        identity = render_tests.sha(data=path.read_bytes())
        fixture.evidence.update(model_report_sha256=identity)
        fixture.evidence["fixture_sha256"][str(path)] = identity
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
        self.producer.assert_called_once()
        call = self.producer.call_args.kwargs
        self.assertIs(call["context"], self.fixture.context)
        self.assertEqual(call["directory"], self.onnx)
        self.assertEqual(call["model"], self.model)
        for path in self.heads:
            self.assertEqual(call["locked"].files[str(path)], self.fixture.evidence["fixture_sha256"][str(path)])

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

    def test_omitted_head_identity_is_not_backfilled_even_if_file_exists(self):
        for path in (self.heads[0], self.heads[-1]):
            with self.subTest(path=path.name):
                identity = self.fixture.evidence["fixture_sha256"].pop(str(path))
                self.fixture.persist()
                with self.assertRaises(ValueError):
                    self.load()
                self.fixture.evidence["fixture_sha256"][str(path)] = identity
        self.producer.assert_not_called()

    def test_missing_heads_and_fixture_entries_cannot_publish_oracle_points(self):
        for path in self.heads:
            path.unlink()
            self.fixture.evidence["fixture_sha256"].pop(str(path))
        self.fixture.persist()
        self.assert_rejected_before_native(error=ValueError)
        self.producer.assert_not_called()

    def test_missing_or_changed_head_fails_even_when_replay_matches_oracle(self):
        for path in (self.heads[0], self.heads[-1]):
            raw = path.read_bytes()
            for data in (None, b"changed head"):
                with self.subTest(path=path.name, data=data):
                    if data is None:
                        path.unlink()
                    else:
                        path.write_bytes(data)
                    with self.assertRaises((ValueError, FileNotFoundError)):
                        self.load()
                    path.write_bytes(raw)
        self.producer.assert_not_called()

    def test_rehashed_heads_still_require_exact_shape_dtype_and_finite_values(self):
        invalid = [np.zeros((106, 2), np.float32), np.zeros((1, 1, 1, 212), np.float64)]
        for value in (np.nan, np.inf, -np.inf):
            invalid.append(np.full((1, 1, 1, 212), value, np.float32))
        for path in (self.heads[0], self.heads[-1]):
            raw = path.read_bytes()
            for values in invalid:
                with self.subTest(path=path.name, dtype=values.dtype, shape=values.shape):
                    np.save(path, values, allow_pickle=False)
                    self.fixture.evidence["fixture_sha256"][str(path)] = render_tests.sha(data=path.read_bytes())
                    self.fixture.persist()
                    with self.assertRaisesRegex(ValueError, "array contract mismatch"):
                        self.load()
            path.write_bytes(raw)
            self.fixture.evidence["fixture_sha256"][str(path)] = render_tests.sha(data=raw)
        self.producer.assert_not_called()

    def test_model_source_inventory_and_current_hashes_are_required(self):
        name = render.MODEL_SOURCES[0]
        expected = self.model["source_sha256"].pop(name)
        self.persist_model()
        with self.assertRaisesRegex(ValueError, "complete model source inventory"):
            self.load()
        self.model["source_sha256"][name] = expected
        self.persist_model()
        (self.fixture.source_root / "local-model-pytorch" / name).write_bytes(b"changed model source")
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            self.load()
        self.producer.assert_not_called()

    def test_oracle_matching_replay_must_equal_reconstructed_points_before_native(self):
        produced = deepcopy(self.fixture.value)
        produced["frames"][0]["faces"][0]["points"][0][0] += 0.00001
        self.producer.return_value = (produced, self.cases)
        self.assert_rejected_before_native(error=ValueError, message="owned normalized replay")

    def test_recomputed_cases_must_match_including_boolean_types(self):
        for cases in ([], [dict(prediction=0, owned_seed_used=1)], [dict(prediction=1, owned_seed_used=True)]):
            with self.subTest(cases=cases):
                self.fixture.evidence["cases"] = cases
                self.fixture.persist()
                with self.assertRaisesRegex(ValueError, "owned geometry/smoothing"):
                    self.load()

    def test_head_mutation_during_reconstruction_is_rejected_before_native(self):
        def mutate(**kwargs):
            self.heads[0].write_bytes(b"mutated after point reconstruction")
            return deepcopy(self.fixture.value), self.cases
        self.producer.side_effect = mutate
        self.assert_rejected_before_native(error=ValueError, message="hash mismatch|changed between reads")

    def assert_rejected_before_native(self, *, error, message=None):
        fixture = self.fixture
        out = fixture.root / "render-output"
        out.mkdir()
        args = argparse.Namespace(capture=fixture.capture, candidate=fixture.path, out=out, original_frames=True)
        with patch.object(render.sequence, "fresh_output", return_value=out), \
                patch.object(render.capture, "load", side_effect=lambda **kw: (
                    kw["locked"].read(path=fixture.capture_report), fixture.context)[1]), \
                patch.object(render.render, "render_host") as native:
            with self.assertRaisesRegex(error, message or ".*"):
                render.run(args=args)
            native.assert_not_called()
        self.assertFalse((out / "replay.bin").exists())
        self.assertIs(json.loads((out / "report.json").read_bytes())["passed"], False)

    def test_actual_producer_reads_fresh_heads_instead_of_candidate_points(self):
        geometry = replay_tests.ProduceTests()
        real_head = render.chain.landmark_head
        geometry.setUp()
        self.addCleanup(geometry.doCleanups)
        fixture = self.fixture
        geometry.context["root"] = fixture.capture
        geometry.context["evidence"]["captures"] = dict(networks={
            str(size): dict(graph_sha256="a" * 64) for size in (120, 160)})
        counters = {120: 0, 160: 0}
        for snapshot, association in zip(geometry.snapshots, geometry.associations, strict=True):
            for size in (120, 160):
                if (size == 120 and snapshot["index"] not in (18, 19)) or (size == 160 and snapshot["index"] in (0, 20)):
                    index = counters[size]
                    counters[size] += 1
                    association["inferences"].append(dict(size=size, inference=index, network=str(size)))
                    path = self.onnx / f"size-{size}-infer-{index:03d}-fc_landmark_s1.npy"
                    np.save(path, geometry.points.reshape(1, 1, 1, 212), allow_pickle=False)
                    fixture.evidence["fixture_sha256"][str(path)] = render_tests.sha(data=path.read_bytes())
        fixture.context = geometry.context
        fixture.value = deepcopy(geometry.context["native"])
        with patch.object(render.chain, "landmark_head", side_effect=real_head), \
                patch.object(render.chain, "produce", side_effect=self.real_producer):
            _, fixture.evidence["cases"] = self.real_producer(
                context=fixture.context, model=self.model, directory=self.onnx, locked=LockedFiles())
            geometry.state = None
            fixture.persist()
            self.assertEqual(self.load()[0], fixture.value)
            changed = geometry.points.copy()
            changed[0, 0] += 1
            np.save(self.heads[0], changed.reshape(1, 1, 1, 212), allow_pickle=False)
            fixture.evidence["fixture_sha256"][str(self.heads[0])] = render_tests.sha(data=self.heads[0].read_bytes())
            fixture.persist()
            geometry.state = None
            self.assert_rejected_before_native(error=RuntimeError, message="dynamic geometry gate failed")


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
