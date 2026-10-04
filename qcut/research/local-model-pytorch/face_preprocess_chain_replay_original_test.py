"""CPU-only original-frame chain wiring and fail-closed producer proof tests."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from face_alignment_replay import LockedFiles
import face_full_frame_owned_test as owned_tests
import face_preprocess_chain_replay as chain
import face_preprocess_chain_replay_test as replay_tests
from face_preprocess_chain_replay_test import encoded, sha


class OriginalReplayTests(unittest.TestCase):
    def setUp(self):
        self.fixture = replay_tests.ReplayRunTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        fixture = self.fixture
        fixture.args.original_frames = True
        self.proof = dict(algorithm="staged-q11", sampling_cases=[dict(prediction=0)],
                          initialization_sampling_cases=[dict(prediction=20)])
        self.builder = patch.object(chain.original, "build_inputs",
            return_value=(fixture.inputs, fixture.seeds, self.proof)).start()
        for size, values in ((120, fixture.inputs), (160, fixture.seeds)):
            fixture.model["model_outputs"][str(size)]["cases"] = [dict(inference=key[1], passed=True,
                input_source="replacement_inputs", replacement_input_sha256=sha(data=value.tobytes()))
                for key, value in values.items()]

    def test_original_maps_feed_onnx_then_owned_point_producer(self):
        fixture = self.fixture
        report = chain.run(args=fixture.args)
        fixture.build_120.assert_not_called()
        fixture.build_160.assert_not_called()
        self.builder.assert_called_once()
        self.assertIs(fixture.onnx.call_args.kwargs["replacement_inputs"], fixture.inputs)
        self.assertIs(fixture.onnx.call_args.kwargs["initialization_inputs"], fixture.seeds)
        self.assertEqual(fixture.producer.call_args.kwargs["model"], fixture.model)
        self.assertEqual(fixture.producer.call_args.kwargs["directory"], fixture.out / "onnx")
        self.assertEqual(json.loads((fixture.out / "replay.json").read_bytes()), {"synthetic": "owned points"})
        self.assertEqual(report["profile"], "original-rgba-owned-chain-v1")
        self.assertEqual(report["preprocessing"], self.proof)
        for key, value in chain.original_claims(completed=True).items():
            self.assertIs(report[key], value)
        for key in ("full_render_verified", "native_render_performed", "native_final_point_input_used",
                    "captured_tensor_input_used", "product_parity_verified"):
            self.assertIs(report[key], False)
        self.assertIs(report["cpu_only"], True)

    def test_native_input_claim_is_rejected_before_owned_points(self):
        self.fixture.model["model_outputs"]["160"]["cases"][0]["input_source"] = "captured_tensor"
        with self.assertRaisesRegex(ValueError, "input identity"):
            chain.run(args=self.fixture.args)
        self.fixture.producer.assert_not_called()
        self.assertFalse((self.fixture.out / "replay.json").exists())

    def test_wrong_replacement_hash_is_rejected_before_owned_points(self):
        self.fixture.model["model_outputs"]["120"]["cases"][0]["replacement_input_sha256"] = "a" * 64
        with self.assertRaisesRegex(ValueError, "input identity"):
            chain.run(args=self.fixture.args)
        self.fixture.producer.assert_not_called()

    def test_failed_original_sampler_never_falls_back_to_legacy(self):
        self.builder.side_effect = ValueError("unsupported original dimensions")
        with self.assertRaisesRegex(ValueError, "unsupported original"):
            chain.run(args=self.fixture.args)
        self.fixture.build_120.assert_not_called()
        self.fixture.build_160.assert_not_called()
        self.fixture.onnx.assert_not_called()
        self.assertIs(self.fixture.saved()["independent_full_frame_preprocessing"], False)

    def test_last_guard_revokes_original_acceptance(self):
        with patch.object(self.fixture.locked, "verify", side_effect=ValueError("late source mutation")):
            with self.assertRaisesRegex(ValueError, "late source mutation"):
                chain.run(args=self.fixture.args)
        report = self.fixture.saved()
        for key in ("passed", "completed", "original_rgba_input_used", "independent_full_frame_preprocessing"):
            self.assertIs(report[key], False)

    def test_legacy_default_never_calls_original_builder(self):
        del self.fixture.args.original_frames
        report = chain.run(args=self.fixture.args)
        self.builder.assert_not_called()
        self.fixture.build_120.assert_called_once()
        self.fixture.build_160.assert_called_once()
        self.assertEqual(report["profile"], "actual-preprocess-owned-chain-v1")
        self.assertIs(report["native_algorithm_rgba_required"], True)
        self.assertIs(report["independent_full_frame_preprocessing"], False)
        self.assertNotIn("preprocessing", report)


class OriginalProofTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.raw = self.root / "original.rgba"
        self.raw.write_bytes(b"pinned synthetic original")
        self.inputs = {(120, 0): np.zeros((1, 120, 120, 3), np.int16)}
        self.seeds = {(160, 0): np.zeros((1, 160, 160, 3), np.int8)}
        self.proof = dict(source_frames=[dict(path=str(self.raw), original_rgba_sha256=sha(data=self.raw.read_bytes()))],
                          request=[0, 640, 480, 2560, 0], observations=[dict(prediction=0, algorithm_exact=True)],
                          sampling_cases=[dict(prediction=0)], initialization_sampling_cases=[dict(prediction=0)])
        self.model = dict(passed=True, capture_sha256="c" * 64, native_inference_called=False, native_analysis_bypassed=False,
                          independent_120_sampling_input_used=True, independent_160_sampling_input_used=True,
                          model_outputs={str(size): dict(cases=[dict(inference=0, passed=True,
                              replacement_input_sha256=sha(data=values[(size, 0)].tobytes()), input_source="replacement_inputs")])
                              for size, values in ((120, self.inputs), (160, self.seeds))})
        self.path = self.root / "onnx/report.json"
        self.path.parent.mkdir()
        self.evidence = dict(chain.original_claims(completed=True), failures=[], capture_sha256="c" * 64,
                             preprocessing=deepcopy(self.proof), sampling_cases=self.proof["sampling_cases"],
                             initialization_sampling_cases=self.proof["initialization_sampling_cases"])
        self.persist()
        self.addCleanup(patch.stopall)
        patch.object(chain.original, "build_inputs", side_effect=self.build).start()

    def build(self, *, context, locked):
        locked.read(path=self.raw, maximum=1024, expected=sha(data=b"pinned synthetic original"))
        return self.inputs, self.seeds, deepcopy(self.proof)

    def persist(self):
        self.path.write_bytes(encoded(value=self.model))
        self.evidence.update(model_report_sha256=sha(data=self.path.read_bytes()),
            fixture_sha256={str(path): sha(data=path.read_bytes()) for path in (self.raw, self.path)})

    def verify(self, *, locked=None):
        return chain.verify_original_inputs(evidence=self.evidence, context={}, directory=self.root,
                                             locked=locked if locked is not None else LockedFiles())

    def test_recomputed_maps_and_all_fixtures_are_pinned(self):
        locked = LockedFiles()
        inputs, seeds, proof = self.verify(locked=locked)
        self.assertIs(inputs, self.inputs)
        self.assertIs(seeds, self.seeds)
        self.assertEqual(proof, self.proof)
        self.assertEqual(locked.files, self.evidence["fixture_sha256"])
        locked.verify()

    def test_missing_original_or_model_fixture_is_not_silently_added(self):
        for path in (self.raw, self.path):
            self.persist()
            self.evidence["fixture_sha256"].pop(str(path))
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, "fixture missing"):
                self.verify()

    def test_extra_caller_fixture_does_not_satisfy_missing_original(self):
        locked = LockedFiles()
        locked.read(path=self.raw)
        self.evidence["fixture_sha256"].pop(str(self.raw))
        with self.assertRaisesRegex(ValueError, "fixture missing"):
            self.verify(locked=locked)

    def test_proof_order_dimensions_and_json_types_must_match_recomputation(self):
        for mutate in (lambda proof: proof["request"].__setitem__(1, 640.0),
                       lambda proof: proof["source_frames"][0].update(original_rgba_sha256="b" * 64),
                       lambda proof: proof["observations"][0].update(algorithm_exact=1),
                       lambda proof: proof["sampling_cases"].append(dict(prediction=1))):
            self.evidence["preprocessing"] = deepcopy(self.proof)
            mutate(self.evidence["preprocessing"])
            with self.subTest(mutate=mutate), self.assertRaisesRegex(ValueError, "recomputed evidence"):
                self.verify()

    def test_original_flags_reject_missing_and_truthy_equivalents(self):
        for key, expected in chain.original_claims(completed=True).items():
            for value in (None, int(expected), not expected):
                self.evidence[key] = value
                with self.subTest(key=key, value=value), self.assertRaisesRegex(ValueError, "producer/oracle claims"):
                    self.verify()
            self.evidence[key] = expected

    def test_onnx_capture_or_input_producer_cannot_be_swapped(self):
        original = deepcopy(self.model)
        for key, value in (("capture_sha256", "d" * 64), ("passed", 1), ("native_inference_called", True)):
            self.model = dict(original, **{key: value})
            self.persist()
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "bound to this capture"):
                self.verify()
        self.model = deepcopy(original)
        self.model["model_outputs"]["160"]["cases"][0]["input_source"] = "captured_tensor"
        self.persist()
        with self.assertRaisesRegex(ValueError, "input identity"):
            self.verify()

    def test_mutated_original_bytes_are_not_used(self):
        self.raw.write_bytes(b"changed original")
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            self.verify()

    def test_source_names_are_explicit_bounded_and_include_both_producers(self):
        self.assertEqual(chain.source_names(), chain.SOURCE_NAMES)
        names = chain.source_names(original_frames=True)
        self.assertEqual(len(names), len(set(names)))
        self.assertTrue(set(chain.SOURCE_NAMES) < set(names))
        for name in ("face_full_frame_owned.py", "face_full_frame_owned_inputs.py", "face_full_frame_quantization.py"):
            self.assertIn(name, names)
        for value in (1, None, "true"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                chain.profile(original_frames=value)


class RealSamplerRoutingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.template, cls.context_template = owned_tests.fixture()

    def setUp(self):
        self.context = deepcopy(self.context_template)
        self.files = dict(self.template.files)
        self.locked = owned_tests.MemoryLocked(files=self.files)
        self.addCleanup(patch.stopall)
        patch.object(owned_tests.owned, "regular_path", side_effect=lambda *, path: path).start()
        patch.object(owned_tests.chain.parity, "bounded_bytes", side_effect=lambda *, path, limit: self.files[path]).start()
        patch.object(chain, "build_120", side_effect=AssertionError("legacy 120 producer")).start()
        patch.object(chain, "build_160", side_effect=AssertionError("legacy 160 producer")).start()
        patch.object(owned_tests.chain, "algorithm_frame", side_effect=AssertionError("native algorithm producer")).start()

    def test_chain_routes_original_pixels_through_both_real_cpu_samplers(self):
        inputs, seeds, proof = chain.sampling_inputs(context=self.context, locked=self.locked, original_frames=True)
        self.assertEqual(len(proof["source_frames"]), 7)
        self.assertEqual(len(proof["observations"]), 26)
        self.assertTrue(all(item["algorithm_exact"] for item in proof["observations"]))
        self.assertEqual(set(seeds), {(160, 0), (160, 1)})
        for values in (inputs, seeds):
            self.assertTrue(values)
            self.assertTrue(all(not value.flags.writeable for value in values.values()))
        model = dict(independent_120_sampling_input_used=True, independent_160_sampling_input_used=True,
            model_outputs={str(size): dict(cases=[dict(inference=key[1], passed=True, input_source="replacement_inputs",
                replacement_input_sha256=sha(data=value.tobytes())) for key, value in values.items()])
                for size, values in ((120, inputs), (160, seeds))})
        chain.original.model_input_proof(model=model, inputs=inputs, seeds=seeds)
        self.locked.verify()

    def test_real_sampler_route_keeps_requested_dimension_gate(self):
        self.context["snapshots"][0]["request"][1] = 320
        with self.assertRaisesRegex(ValueError, "640x480"):
            chain.sampling_inputs(context=self.context, locked=self.locked, original_frames=True)


if __name__ == "__main__":
    unittest.main()
