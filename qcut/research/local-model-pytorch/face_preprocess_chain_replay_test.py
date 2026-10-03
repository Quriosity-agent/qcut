"""Synthetic CPU contracts; ONNX execution and native dependencies stay mocked."""
import argparse
from copy import deepcopy
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import numpy as np

from face_alignment_replay import LockedFiles
import face_host_geometry_sequence_replay as geometry
import face_preprocess_chain_replay as chain


def sha(*, data):
    return hashlib.sha256(data).hexdigest()


def encoded(*, value):
    return json.dumps(value, allow_nan=False).encode() + b"\n"


class LandmarkHeadTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name).resolve()
        self.item = dict(size=120, inference=7, network="synthetic-network")
        self.association = dict(inferences=[self.item])
        self.inventory = dict(networks={self.item["network"]: dict(graph_sha256="a" * 64)})
        self.model = dict(model_outputs={str(size): dict(graph_sha256="a" * 64) for size in (120, 160)})
        self.locked = Mock(wraps=LockedFiles())
        self.save(value=np.arange(212, dtype=np.float32).reshape(1, 1, 1, 212))

    def save(self, *, value):
        stream = io.BytesIO()
        np.save(stream, value, allow_pickle=False)
        self.path = self.directory / f"size-{self.item['size']}-infer-{self.item['inference']:03d}-fc_landmark_s1.npy"
        self.path.write_bytes(stream.getvalue())

    def head(self, *, size=120):
        return chain.landmark_head(size=size, association=self.association, inventory=self.inventory,
                                   model=self.model, directory=self.directory, locked=self.locked)

    def test_exact_head_shape_dtype_and_hash_bound_read(self):
        head, item = self.head()
        self.assertIs(item, self.item)
        np.testing.assert_array_equal(head, np.arange(212, dtype=np.float32).reshape(106, 2))
        self.locked.read.assert_called_once_with(path=self.path, maximum=1024**2)
        self.locked.array.assert_called_once_with(path=self.path, shape=(1, 1, 1, 212), dtype="float32",
                                                  expected=sha(data=self.path.read_bytes()))

    def test_160_profile_and_inference_endpoints(self):
        for inference in (0, 128):
            with self.subTest(inference=inference):
                self.item.update(size=160, inference=inference)
                self.save(value=np.zeros((1, 1, 1, 212), np.float32))
                self.assertEqual(self.head(size=160)[0].shape, (106, 2))

    def test_no_matching_profile_never_reads_or_falls_back(self):
        self.assertEqual(self.head(size=160), (None, None))
        self.locked.read.assert_not_called()
        self.locked.array.assert_not_called()

    def test_other_profile_does_not_change_selected_inference(self):
        self.association["inferences"].append(dict(size=160, inference=99, network="other"))
        self.assertIs(self.head()[1], self.item)

    def test_size_requires_supported_exact_integer(self):
        for size in (True, 120.0, "160", 0, 119, 161, None):
            with self.subTest(size=size), self.assertRaises(ValueError):
                self.head(size=size)
        self.locked.read.assert_not_called()

    def test_duplicate_selected_inference_is_rejected_before_io(self):
        self.association["inferences"].append(deepcopy(self.item))
        with self.assertRaisesRegex(ValueError, "one landmark inference"):
            self.head()
        self.locked.read.assert_not_called()

    def test_inference_requires_bounded_exact_integer(self):
        for inference in (-1, 129, True, 7.0, "7", None):
            with self.subTest(inference=inference), self.assertRaises(ValueError):
                self.item["inference"] = inference
                self.head()
        self.locked.read.assert_not_called()

    def test_network_graph_must_match_selected_onnx_profile(self):
        self.model["model_outputs"]["120"]["graph_sha256"] = "b" * 64
        with self.assertRaisesRegex(ValueError, "differs from ONNX profile"):
            self.head()
        self.locked.read.assert_not_called()

    def test_missing_network_or_model_profile_fails_closed(self):
        for mapping in (self.inventory["networks"], self.model["model_outputs"]):
            saved = deepcopy(mapping)
            mapping.clear()
            with self.subTest(mapping=saved), self.assertRaises(KeyError):
                self.head()
            mapping.update(saved)
        self.locked.read.assert_not_called()

    def test_head_requires_exact_shape_float32_and_finite_values(self):
        invalid = [np.zeros((106, 2), np.float32), np.zeros((1, 1, 1, 211), np.float32),
                   np.zeros((1, 1, 1, 212), np.float64), np.zeros((1, 1, 1, 212), np.int16)]
        for number in (np.nan, np.inf, -np.inf):
            value = np.zeros((1, 1, 1, 212), np.float32)
            value[0, 0, 0, 17] = number
            invalid.append(value)
        for index, value in enumerate(invalid):
            with self.subTest(index=index):
                self.locked = Mock(wraps=LockedFiles())
                self.save(value=value)
                with self.assertRaisesRegex(ValueError, "array contract mismatch"):
                    self.head()

    def test_missing_truncated_and_oversized_arrays_fail_closed(self):
        for data in (None, b"not-npy", b"x" * (1024**2 + 1)):
            with self.subTest(size=None if data is None else len(data)):
                self.locked = Mock(wraps=LockedFiles())
                if data is None:
                    self.path.unlink()
                else:
                    self.path.write_bytes(data)
                with self.assertRaises((ValueError, FileNotFoundError)):
                    self.head()


class ProduceTests(unittest.TestCase):
    def setUp(self):
        self.points = np.tile(np.array([10, 15], np.float32), (106, 1))
        self.snapshots, self.associations, frames = [], [], []
        for index in range(26):
            active, identity = index not in (18, 19), int(index >= 20)
            face = dict(active=active, id=identity, stage1=self.points.T.tolist(), tracked=self.points.T.tolist())
            self.snapshots.append(dict(index=index, faces=[face], request=[0, 64, 48, 256, 0]))
            self.associations.append(dict(prediction=index, inferences=[]))
            if index >= 2:
                faces = [dict(id=identity, points=[[0.15625, 0.6875] for _ in range(106)])] if active else []
                frames.append(dict(timestamp_us=index * 1000, faces=faces))
        self.context = dict(native=dict(version=1, width=1448, height=1086,
                                       coordinate_space=chain.consumer.COORDINATE_SPACE,
                                       image_sha256="a" * 64, frames=frames), evidence=dict(captures={}),
                            snapshots=self.snapshots, associations=self.associations)
        self.seeds = {0, 20}
        self.state = None
        self.temporal = Mock()
        self.temporal.apply.side_effect = self.smooth
        self.addCleanup(patch.stopall)
        self.temporal_factory = patch.object(chain, "TemporalReplay", return_value=self.temporal).start()
        self.head_mock = patch.object(chain, "landmark_head", side_effect=self.head).start()
        self.seed_mock = patch.object(chain, "decode_seed", side_effect=lambda **kw: (kw["raw"].copy(), dict(passed=True))).start()
        patch.object(geometry, "initialized_warp", side_effect=lambda **kw: kw["snapshot"]["faces"][0]).start()
        patch.object(geometry, "decode_actual", side_effect=lambda **kw: (kw["raw"].copy(), kw["raw"].copy())).start()
        patch.object(chain, "output_layers", return_value={}).start()

    def head(self, *, size, association, **unused):
        index = association["prediction"]
        available = index not in (18, 19) if size == 120 else index in self.seeds
        return (self.points.copy(), dict(inference=index, network="own-head")) if available else (None, None)

    def smooth(self, *, snapshot, points, initialization_seed):
        if points is None:
            if initialization_seed is not None:
                raise ValueError("no-face seed")
            self.state = None
            return None, dict(native_seed_used=False, owned_seed_used=False)
        identity = snapshot["faces"][0]["id"]
        needs_seed = self.state != identity
        if needs_seed and initialization_seed is None:
            raise ValueError("native fallback forbidden")
        self.state = identity
        return points.copy(), dict(native_seed_used=False, owned_seed_used=needs_seed)

    def produce(self):
        return chain.produce(context=self.context, model={}, directory=Path("/synthetic/onnx"), locked=Mock())

    def test_owns_two_lifecycle_seeds_and_exact_normalized_frames(self):
        original = deepcopy(self.context["native"])
        candidate, cases = self.produce()
        self.assertEqual(candidate, original)
        self.assertEqual(self.context["native"], original)
        self.assertIsNot(candidate["frames"], self.context["native"]["frames"])
        self.temporal_factory.assert_called_once_with(owned_initialization=True)
        self.assertEqual(len(cases), 26)
        self.assertEqual([row["prediction"] for row in cases if "owned_initialization" in row], [0, 20])
        self.assertEqual([call.kwargs["snapshot"]["index"] for call in self.seed_mock.call_args_list], [0, 20])
        for call in self.temporal.apply.call_args_list:
            index = call.kwargs["snapshot"]["index"]
            if index in self.seeds:
                np.testing.assert_array_equal(call.kwargs["initialization_seed"], self.points)
            else:
                self.assertIsNone(call.kwargs["initialization_seed"])
        self.assertTrue(all(check["tolerance"] == 0 and check["exact"]
                            for case in cases for check in case["checks"].values()))

    def test_no_face_clears_state_and_publishes_no_stale_points(self):
        candidate, cases = self.produce()
        for index in (18, 19):
            self.assertEqual(candidate["frames"][index - 2]["faces"], [])
            self.assertEqual(cases[index]["published_faces"], 0)
            self.assertIsNone(self.temporal.apply.call_args_list[index].kwargs["points"])
        self.assertEqual(candidate["frames"][20 - 2]["faces"][0]["id"], 1)

    def test_missing_seed_never_uses_native_fallback(self):
        for prediction in (0, 20):
            with self.subTest(prediction=prediction):
                self.state, self.seeds = None, {0, 20} - {prediction}
                with self.assertRaisesRegex(ValueError, "native fallback forbidden"):
                    self.produce()

    def test_wrong_seed_lifecycle_is_rejected(self):
        for seeds in ({0, 21}, {0, 19, 20}, {0, 1, 20}):
            with self.subTest(seeds=seeds):
                self.state, self.seeds = None, seeds
                with self.assertRaises(ValueError):
                    self.produce()

    def test_active_face_without_head_cannot_reuse_previous_points(self):
        original = self.head
        self.head_mock.side_effect = lambda **kw: (None, None) if kw["size"] == 120 and kw["association"]["prediction"] == 3 else original(**kw)
        with self.assertRaisesRegex(ValueError, "do not publish cached points"):
            self.produce()

    def test_normalized_comparison_does_not_relax_one_value(self):
        self.context["native"]["frames"][0]["faces"][0]["points"][0][0] += 0.000001
        with self.assertRaisesRegex(RuntimeError, "no fitting or tolerance relaxation"):
            self.produce()

    def test_wrong_native_face_id_or_stale_no_face_payload_is_rejected(self):
        original = deepcopy(self.context["native"])
        for index in (0, 16):
            with self.subTest(index=index):
                self.state = None
                self.context["native"] = deepcopy(original)
                self.context["native"]["frames"][index]["faces"] = [dict(id=99, points=[[0.15625, 0.6875]] * 106)]
                with self.assertRaisesRegex(ValueError, "face (ID|count) mismatch"):
                    self.produce()

    def test_prediction_association_and_conversion_counts_fail_closed(self):
        for field in ("snapshots", "associations"):
            original = self.context[field]
            self.context[field] = original[:-1]
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.state = None
                self.produce()
            self.context[field] = original
        self.context["native"]["frames"].pop()
        with self.assertRaises(IndexError):
            self.state = None
            self.produce()

    def test_matching_but_short_lifecycle_is_not_accepted(self):
        self.context["snapshots"] = self.snapshots[:-1]
        self.context["associations"] = self.associations[:-1]
        with self.assertRaisesRegex(ValueError, "all exact conversion points"):
            self.produce()

    def test_out_of_bounds_points_are_not_clipped(self):
        self.points[:, 0] = 65
        with self.assertRaisesRegex(ValueError, "clipping prohibited"):
            self.produce()

    def test_native_seed_claim_and_wrong_owned_seed_claim_fail_closed(self):
        for field in ("native_seed_used", "owned_seed_used"):
            original = self.smooth
            def altered(**kw):
                points, proof = original(**kw)
                proof[field] = True
                return points, proof
            self.temporal.apply.side_effect = altered
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "owned lifecycle seeds"):
                self.state = None
                self.produce()


class FinishTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.out = Path(temporary.name).resolve()
        self.report = dict(passed=False, failures=["producer failed"])
        self.locked = Mock(files={"/synthetic/input": "a" * 64})

    def test_successful_guard_persists_failed_report_and_fixture_identities(self):
        chain.finish(out=self.out, report=self.report, locked=self.locked)
        self.locked.verify.assert_called_once_with()
        self.assertEqual(json.loads((self.out / "report.json").read_bytes()), self.report)
        self.assertEqual(self.report["fixture_sha256"], self.locked.files)

    def test_guard_failure_revokes_pass_and_preserves_report(self):
        self.report["passed"] = True
        self.locked.verify.side_effect = RuntimeError("input mutated")
        with self.assertRaisesRegex(RuntimeError, "input mutated"):
            chain.finish(out=self.out, report=self.report, locked=self.locked)
        saved = json.loads((self.out / "report.json").read_bytes())
        self.assertIs(saved["passed"], False)
        self.assertEqual(saved["failures"], ["producer failed", "guard RuntimeError: input mutated"])

    def test_guard_does_not_replace_active_producer_exception(self):
        self.locked.verify.side_effect = ValueError("guard failed")
        with self.assertRaisesRegex(RuntimeError, "original producer"):
            try:
                raise RuntimeError("original producer")
            finally:
                chain.finish(out=self.out, report=self.report, locked=self.locked)
        self.assertIn("guard ValueError: guard failed", self.report["failures"])


class ReplayRunTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name).resolve()
        self.capture, self.models, self.out = (root / name for name in ("capture", "models", "out"))
        for directory in (self.capture, self.models, self.out):
            directory.mkdir()
        (self.capture / "report.json").write_bytes(b'{"synthetic":true}\n')
        summary = b"synthetic exported model summary\n"
        (self.models / "summary.json").write_bytes(summary)
        outputs = {}
        for size in (120, 160):
            artifact = self.models / f"align-{size}/artifacts/model.onnx"
            artifact.parent.mkdir(parents=True)
            artifact.write_bytes(f"synthetic artifact {size}".encode())
            outputs[str(size)] = dict(onnx_sha256=sha(data=artifact.read_bytes()), graph_sha256="a" * 64)
        self.model = dict(passed=True, independent_120_sampling_input_used=True,
                          independent_160_sampling_input_used=True, head_comparisons=52,
                          capture_sha256=sha(data=(self.capture / "report.json").read_bytes()),
                          export_summary_sha256=sha(data=summary), model_outputs=outputs)
        self.disk_model = None
        self.context = dict(evidence=dict(captures={"networks": {}}), associations=[])
        self.inputs, self.seeds = {(120, 0): np.zeros(1, np.int16)}, {(160, 0): np.zeros(1, np.int8)}
        self.locked = LockedFiles()
        self.addCleanup(patch.stopall)
        patch.object(chain, "LockedFiles", return_value=self.locked).start()
        patch.object(chain.sequence, "fresh_output", return_value=self.out).start()
        patch.object(chain.capture, "load", side_effect=self.load).start()
        patch.object(chain, "sources", return_value={"synthetic.py": "a" * 64}).start()
        self.build_120 = patch.object(chain, "build_120", return_value=(self.inputs, [])).start()
        self.build_160 = patch.object(chain, "build_160", return_value=(self.seeds, [])).start()
        self.onnx = patch.object(chain.parity, "run", side_effect=self.execute).start()
        self.no_torch = patch.object(chain.parity, "no_torch").start()
        self.producer = patch.object(chain, "produce", return_value=({"synthetic": "owned points"}, [])).start()
        self.inventory = patch.object(chain.models, "inventory", return_value=self.context["evidence"]["captures"]).start()
        self.args = argparse.Namespace(capture=self.capture, root=self.models, out=self.out)

    def load(self, *, root, locked):
        locked.read(path=root / "report.json")
        return self.context

    def execute(self, **kwargs):
        directory = kwargs["args"].out
        directory.mkdir()
        (directory / "report.json").write_bytes(encoded(value=self.model if self.disk_model is None else self.disk_model))
        return deepcopy(self.model)

    def saved(self):
        return json.loads((self.out / "report.json").read_bytes())

    def reject(self, *, message):
        with self.assertRaises((ValueError, RuntimeError, KeyError, FileNotFoundError)) as error:
            chain.run(args=self.args)
        self.assertIn(message, str(error.exception))
        report = self.saved()
        for field in ("passed", "completed", "geometry_exact", "final_consumer_parity", "product_parity_verified"):
            self.assertIs(report[field], False)
        self.assertTrue(report["failures"])
        self.producer.assert_not_called()
        return report

    def test_success_locks_model_report_summary_and_both_artifacts(self):
        report = chain.run(args=self.args)
        self.assertIs(report["passed"], True)
        self.assertEqual(report, self.saved())
        self.assertEqual(report["model_report_sha256"], sha(data=(self.out / "onnx/report.json").read_bytes()))
        for path in [self.models / "summary.json", *(self.models / f"align-{size}/artifacts/model.onnx" for size in (120, 160))]:
            self.assertEqual(report["fixture_sha256"][str(path)], sha(data=path.read_bytes()))
        call = self.onnx.call_args.kwargs
        self.assertIs(call["replacement_inputs"], self.inputs)
        self.assertIs(call["initialization_inputs"], self.seeds)
        self.assertEqual(call["expected_comparisons"], 7)
        self.assertEqual(self.no_torch.call_count, 2)
        for field in ("native_inference_called", "native_analysis_bypassed", "captured_tensor_input_used",
                      "native_final_point_input_used", "arbitrary_frame_backend_connected", "product_parity_verified"):
            self.assertIs(report[field], False)
        self.assertIs(report["native_algorithm_rgba_required"], True)
        self.assertIs(report["native_caller_parameters_required"], True)

    def test_missing_independent_120_flag_fails_closed(self):
        self.model.pop("independent_120_sampling_input_used")
        self.reject(message="both independently generated")

    def test_missing_independent_160_flag_fails_closed(self):
        self.model.pop("independent_160_sampling_input_used")
        self.reject(message="both independently generated")

    def test_truthy_nonboolean_success_is_not_accepted(self):
        self.model["passed"] = 1
        self.reject(message="both independently generated")

    def test_wrong_capture_identity_fails_closed(self):
        self.model["capture_sha256"] = "b" * 64
        self.reject(message="both independently generated")

    def test_independent_120_flag_must_be_boolean_not_integer(self):
        self.model["independent_120_sampling_input_used"] = 1
        self.reject(message="both independently generated")

    def test_independent_160_flag_must_be_boolean_not_string(self):
        self.model["independent_160_sampling_input_used"] = "true"
        self.reject(message="both independently generated")

    def test_returned_and_disk_onnx_reports_must_be_identical(self):
        self.disk_model = dict(self.model, head_comparisons=53)
        self.reject(message="differs from returned result")

    def test_missing_onnx_report_is_not_reconstructed(self):
        (self.out / "onnx").mkdir()
        self.onnx.side_effect = lambda **unused: deepcopy(self.model)
        self.reject(message="report.json")

    def test_model_summary_hash_mismatch_fails_before_producing_points(self):
        self.model["export_summary_sha256"] = "b" * 64
        self.reject(message="hash mismatch: summary.json")

    def test_missing_model_summary_hash_is_not_inferred(self):
        self.model.pop("export_summary_sha256")
        self.reject(message="export_summary_sha256")

    def test_model_artifact_hash_mismatch_fails_before_producing_points(self):
        self.model["model_outputs"]["160"]["onnx_sha256"] = "b" * 64
        self.reject(message="hash mismatch: model.onnx")

    def test_missing_model_artifact_fails_closed(self):
        (self.models / "align-120/artifacts/model.onnx").unlink()
        self.reject(message="model.onnx")

    def test_invalid_artifact_hash_is_not_treated_as_unlocked_read(self):
        self.model["model_outputs"]["120"]["onnx_sha256"] = "invalid"
        self.reject(message="SHA-256 identity required")

    def test_null_model_summary_hash_is_not_an_optional_identity(self):
        self.model["export_summary_sha256"] = None
        self.reject(message="SHA-256 identity required")

    def test_null_artifact_hash_is_not_an_optional_identity(self):
        self.model["model_outputs"]["160"]["onnx_sha256"] = None
        self.reject(message="SHA-256 identity required")

    def test_duplicate_disk_onnx_report_fields_are_rejected(self):
        def invalid_report(**kwargs):
            kwargs["args"].out.mkdir()
            (kwargs["args"].out / "report.json").write_bytes(b'{"passed":true,"passed":true}')
            return deepcopy(self.model)
        self.onnx.side_effect = invalid_report
        self.reject(message="duplicate JSON field")

    def test_onnx_exception_is_recorded_without_native_fallback(self):
        self.onnx.side_effect = RuntimeError("synthetic ONNX failure")
        self.reject(message="synthetic ONNX failure")

    def test_inventory_mutation_invalidates_generated_replay(self):
        self.inventory.return_value = {"networks": {"unexpected": {}}}
        with self.assertRaisesRegex(RuntimeError, "inventory mutated"):
            chain.run(args=self.args)
        report = self.saved()
        self.assertIs(report["passed"], False)
        self.assertIs(report["final_consumer_parity"], False)
        self.assertIn(str(self.out / "replay.json"), report["fixture_sha256"])


if __name__ == "__main__":
    unittest.main()
