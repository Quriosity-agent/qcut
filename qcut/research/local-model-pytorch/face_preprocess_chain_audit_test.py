"""Synthetic CPU-only audits; no original evidence, SDK or GPU is touched."""
import argparse
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from face_alignment_replay import LockedFiles
import face_preprocess_chain_audit as audit


def encoded(*, value):
    return json.dumps(value, allow_nan=False).encode() + b"\n"


class TemporaryProfile(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.source_root = self.root / "research"
        self.source_root.mkdir()
        self.addCleanup(patch.stopall)
        patch.object(audit.chain_render.render, "SOURCE_ROOT", self.source_root).start()

    def write(self, *, path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return audit.digest(data=data)

    def sources(self, *, names):
        return {"local-model-pytorch/" + name: self.write(path=self.source_root / "local-model-pytorch" / name,
            data=("synthetic source " + name).encode()) for name in names}


class IdentityTests(TemporaryProfile):
    def test_json_identity_rejects_bool_integer_and_float_integer_equivalence(self):
        for actual, expected in ((True, 1), (False, 0), (1.0, 1), ({"x": 1}, {"x": True})):
            with self.subTest(actual=actual, expected=expected), self.assertRaises(ValueError):
                audit.same(actual=actual, expected=expected, label="typed evidence")

    def test_json_identity_ignores_object_key_order_but_not_array_order(self):
        audit.same(actual={"a": 1, "b": 2}, expected={"b": 2, "a": 1}, label="object")
        with self.assertRaises(ValueError):
            audit.same(actual=[1, 2], expected=[2, 1], label="array")

    def test_flags_reject_truthy_falsey_and_recorded_failures(self):
        for key, values in (("accepted", (False, 1, "true", None)), ("forbidden", (True, 0, "false", None))):
            for value in values:
                evidence = dict(accepted=True, forbidden=False, failures=[])
                evidence[key] = value
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    audit.flags(evidence=evidence,
                                positive=("accepted",), negative=("forbidden",))

    def test_failures_must_be_an_empty_list(self):
        for value in (None, {}, False, ["old failure"]):
            with self.subTest(value=value), self.assertRaises(ValueError):
                audit.flags(evidence=dict(failures=value))

    def test_fixture_inventory_rejects_invalid_size_paths_and_hashes(self):
        path = self.root / "fixture.bin"
        identity = self.write(path=path, data=b"locked bytes")
        invalid = ({}, [], {"relative.bin": identity}, {str(path): None}, {str(path): True},
                   {str(path): "b" * 64}, {str(self.root / "missing"): identity},
                   {str(self.root / "../fixture.bin"): identity}, {"/x\0y": identity},
                   {f"/fixture-{index}": identity for index in range(4097)})
        for values in invalid:
            with self.subTest(values=str(values)[:80]), self.assertRaises((ValueError, FileNotFoundError)):
                audit.fixtures(evidence=dict(fixture_sha256=values), locked=LockedFiles())

    def test_every_fixture_is_read_and_final_guard_detects_late_mutation(self):
        paths = [self.root / f"{index}.bin" for index in range(3)]
        values = {str(path): self.write(path=path, data=str(index).encode()) for index, path in enumerate(paths)}
        locked = LockedFiles()
        audit.fixtures(evidence=dict(fixture_sha256=values), locked=locked)
        self.assertEqual(locked.files, values)
        paths[-1].write_bytes(b"mutated")
        with self.assertRaises(ValueError):
            locked.verify()

    def test_complete_source_set_cannot_be_replaced_with_unrelated_source(self):
        values = self.sources(names=("one.py", "two.py"))
        for bad in ({}, {"local-model-pytorch/one.py": values["local-model-pytorch/one.py"]},
                    {"../one.py": "a" * 64}, {str(self.root / "one.py"): "a" * 64}):
            with self.subTest(values=bad), self.assertRaises(ValueError):
                audit.declared_sources(evidence=dict(source_sha256=bad), expected=values, locked=LockedFiles())
        audit.declared_sources(evidence=dict(source_sha256=values), expected=values, locked=LockedFiles())

    def test_source_symlink_escape_is_rejected_even_with_matching_hash(self):
        values = self.sources(names=("one.py",))
        source = self.source_root / "local-model-pytorch/one.py"
        outside = self.root / "outside.py"
        outside.write_bytes(source.read_bytes())
        source.unlink()
        source.symlink_to(outside)
        with self.assertRaises(ValueError):
            audit.declared_sources(evidence=dict(source_sha256=values), expected=values, locked=LockedFiles())


class ModelTests(TemporaryProfile):
    def setUp(self):
        super().setUp()
        self.directory, self.model_root = self.root / "candidate", self.root / "models"
        self.names = ["fc_landmark_s1", "fc_visible", "prob", "fc_yaw", "fc_pitch"]
        self.graph = dict(layers=[dict(op="InnerProduct", outputs=self.names)],
                          shapes={name: (1, 1, 1, 1) for name in self.names},
                          descriptors={name: dict(type=4, fraction=0) for name in self.names})
        patch.object(audit, "analyze", return_value=self.graph).start()
        patch.object(audit.parity, "validate_graph").start()
        self.inputs, networks, model_outputs, models, artifacts = {}, {}, {}, {}, {}
        self.report = dict(passed=True, independent_120_sampling_input_used=True, independent_160_sampling_input_used=True,
                           native_inference_called=False, native_analysis_bypassed=False, full_frame_geometry_independent=False,
                           failures=[], expected_comparisons=7, capture_sha256="c" * 64, head_comparisons=135,
                           source_sha256={name: value for name, value in zip(audit.MODEL_SOURCES,
                               self.sources(names=audit.MODEL_SOURCES).values(), strict=True)}, model_outputs=model_outputs)
        for size, count in ((120, 25), (160, 2)):
            graph_hash = self.write(path=self.root / f"graph-{size}.json", data=str(size).encode())
            artifact = f"align-{size}/artifacts/model.onnx"
            artifacts[artifact] = self.write(path=self.model_root / artifact, data=f"synthetic model {size}".encode())
            models[str(size)] = dict(graph_sha256=graph_hash, terminal_names=self.names,
                                    cases={"recorded-face": {"input_sha256": {"data": "a" * 64}}})
            network = dict(graph_sha256=graph_hash, graph_path=str(self.root / f"graph-{size}.json"),
                           successful_inferences=list(range(count)), inputs=[], outputs=[])
            networks[str(size)] = network
            cases = []
            for inference in range(count):
                values = np.zeros((1, size, size, 3), np.int16 if size == 120 else np.int8)
                self.inputs[(size, inference)] = values
                identity = audit.digest(data=values.tobytes())
                network["inputs"].append(dict(inference=inference, name="data", dims_nwhc=[1, size, size, 3], raw=[2 if size == 120 else 1, 6], sha256=identity))
                checks = {}
                for name in self.names:
                    output = np.ones((1, 1, 1, 1), np.float32)
                    source = self.root / f"native-{size}-{inference}-{name}.bin"
                    network["outputs"].append(dict(name=name, inference=inference, dims_nwhc=[1, 1, 1, 1], raw=[4, 0],
                        path=str(source), sha256=self.write(path=source, data=output.tobytes())))
                    output_path = self.directory / "onnx" / f"size-{size}-infer-{inference:03d}-{name}.npy"
                    output_path.parent.mkdir(parents=True, exist_ok=True)
                    np.save(output_path, output)
                    checks[name] = audit.comparisons(graph=self.graph)[name](actual=output, expected=output,
                        descriptor=self.graph["descriptors"][name], raw=[4, 0])
                cases.append(dict(inference=inference, passed=True, checks=checks, actual_input_sha256=identity,
                    replacement_input_sha256=identity, input_source="replacement_inputs"))
            model_outputs[str(size)] = dict(graph_sha256=graph_hash, onnx_sha256=artifacts[artifact], successful_inferences=count, cases=cases)
        self.context = dict(evidence={"captures": {"networks": networks}})
        exported = dict(passed=True, native_oracle_sha256=audit.parity.espresso_oracle.RUNTIME_SHA256,
            float_policies={name: list(value) for name, value in audit.parity.FLOAT_LIMITS.items()}, networks=models, artifacts=artifacts)
        self.report["export_summary_sha256"] = self.write(path=self.model_root / "summary.json", data=encoded(value=exported))
        self.evidence = dict(capture_sha256="c" * 64, head_comparisons=135)
        self.persist()

    def persist(self):
        self.evidence["model_report_sha256"] = self.write(path=self.directory / "onnx/report.json", data=encoded(value=self.report))

    def load(self):
        return audit.model_heads(directory=self.directory, model_root=self.model_root, context=self.context,
                                 evidence=self.evidence, inputs=self.inputs, locked=LockedFiles())

    def test_all_135_heads_recomputed_with_original_gates(self):
        self.assertEqual(self.load(), self.report)

    def test_model_report_hash_cannot_be_missing_invalid_or_mismatched(self):
        for value in (None, False, "invalid", "f" * 64):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.evidence["model_report_sha256"] = value
                self.load()

    def test_truthy_model_acceptance_is_rejected(self):
        self.report["passed"] = 1
        self.persist()
        with self.assertRaises(ValueError):
            self.load()

    def test_model_capture_and_export_linkage_are_not_recomputed(self):
        for key in ("capture_sha256", "export_summary_sha256"):
            old = self.report[key]
            self.report[key] = "f" * 64
            self.persist()
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.load()
            self.report[key] = old

    def test_loosened_gate_even_with_passed_true_is_rejected(self):
        self.report["model_outputs"]["120"]["cases"][0]["checks"]["fc_landmark_s1"]["atol"] = 1.0
        self.persist()
        with self.assertRaisesRegex(ValueError, "original head gates"):
            self.load()

    def test_numpy_head_value_mutation_fails_original_gate(self):
        path = self.directory / "onnx/size-120-infer-000-fc_landmark_s1.npy"
        np.save(path, np.full((1, 1, 1, 1), 2, np.float32))
        with self.assertRaisesRegex(ValueError, "numerical head gate"):
            self.load()

    def test_missing_head_duplicate_inference_and_noninteger_counts_rejected(self):
        original = deepcopy(self.report)
        changes = (lambda: self.report["model_outputs"]["120"]["cases"][0]["checks"].pop("prob"),
                   lambda: self.report["model_outputs"]["120"]["cases"][0].update(inference=True),
                   lambda: self.report["model_outputs"]["160"].update(successful_inferences=2.0),
                   lambda: self.report.update(head_comparisons=135.0))
        for change in changes:
            self.report = deepcopy(original)
            change()
            self.persist()
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.load()

    def test_owned_input_hash_and_producer_cannot_be_replaced_by_capture(self):
        case = self.report["model_outputs"]["160"]["cases"][0]
        case["input_source"] = "captured_tensor"
        self.persist()
        with self.assertRaisesRegex(ValueError, "input producer"):
            self.load()


class RenderTests(TemporaryProfile):
    def setUp(self):
        super().setUp()
        self.directory = self.root / "render"
        self.directory.mkdir()
        self.capture_root = self.root / "capture"
        self.host = self.root / "host.bin"
        self.path = self.root / "candidate/replay.json"
        self.value = dict(version=1, coordinate_space=audit.chain.consumer.COORDINATE_SPACE,
                          width=1448, height=1086, image_sha256="a" * 64, frames=[])
        for index in range(24):
            timestamp = 0 if index < 10 else (index - 10) // 2 * 1000
            faces = [] if index in (16, 17) else [dict(id=int(index >= 18), points=[[0.25, 0.75] for _ in range(106)])]
            self.value["frames"].append(dict(timestamp_us=timestamp, faces=faces))
        self.payload = audit.chain.consumer.validate_replay(value=self.value, width=1448, height=1086,
            image_hash="a" * 64, maximum_timestamp_us=audit.chain.consumer.REPLAY_TIME_LIMIT_US)
        self.context = dict(root=self.capture_root, runtime=self.root / "runtime", package=self.root / "package", host=self.host, frames=[])
        self.locked = LockedFiles()
        for path, data in ((self.capture_root / "report.json", b"capture"), (self.path, encoded(value=self.value)), (self.host, b"host")):
            self.write(path=path, data=data)
            self.locked.read(path=path)
        self.write(path=self.directory / "replay.bin", data=self.payload)
        self.evidence = dict(profile="actual-preprocess-owned-chain-render-v1", passed=True, completed=True,
            external_replay_verified=True, pixel_parity_verified=True, native_analysis_bypassed=False,
            independent_inference_verified=False, product_parity_verified=False, arbitrary_frame_backend_connected=False,
            failures=[], capture=str(self.capture_root), candidate=str(self.path), capture_sha256=self.locked.files[str(self.capture_root / "report.json")],
            replay_sha256=self.locked.files[str(self.path)], runtime=str(self.context["runtime"]), package=str(self.context["package"]),
            host_sha256=self.locked.files[str(self.host)], width=1448, height=1086, warmup_requests_per_host=6, seeks_per_request=2,
            source_sha256=self.sources(names=(*audit.chain.SOURCE_NAMES, "face_preprocess_chain_render.py")))
        # Tiny RGBA fixtures exercise the same CPU metrics without allocating 43 MiB per test.
        patch.object(audit, "frame_metrics", side_effect=lambda **kwargs: audit.chain_render.render.sequence.frame_difference(
            actual=kwargs["actual"], reference=kwargs["reference"], width=2, height=2)[0]).start()
        self.metrics = []
        for index in range(7):
            changed = index not in (3, 5)
            source = bytes([0, 0, 0, 255] * 4)
            actual = bytes([1 if changed else 0, 0, 0, 255] * 4)
            path = self.capture_root / f"input-{index:02d}.rgba"
            self.write(path=path, data=source)
            self.write(path=self.capture_root / "baseline" / f"frame-{index:02d}.rgba", data=actual)
            self.write(path=self.directory / f"frame-{index:02d}.rgba", data=actual)
            self.context["frames"].append(dict(input=path, timestamp=index / 1000, expect_change=changed, label=str(index)))
            self.metrics.append(dict(index=index, baseline_sha256=audit.digest(data=actual),
                versus_input=audit.frame_metrics(actual=actual, reference=source), **audit.frame_metrics(actual=actual, reference=actual)))
        self.evidence["frames"] = [{key: value for key, value in frame.items() if key != "input"} for frame in self.context["frames"]]
        self.evidence["comparisons"] = self.metrics
        trace, cursor, requests = b"", 0, []
        for index in range(13):
            begin = len(trace)
            count = 0 if index == 0 else 2
            for frame in self.value["frames"][cursor:cursor + count]:
                conversion = dict(event="owned_face_conversion", raw_clone_verified=True, original_restored=False,
                    native_analysis_bypassed=False, eye_shift=0, faces=len(frame["faces"]), external_points=True,
                    source_points_unchanged=True, owned_points_isolated=True, timestamp_us=frame["timestamp_us"], faces_applied=frame["faces"])
                trace += encoded(value=conversion) + encoded(value=dict(event="owned_face_restored", original_restored=True, gpu_complete=True))
            frame_index = 0 if index < 6 else index - 6
            requests.append(dict(request_id=f"warmup-{index}" if index < 6 else f"frame-{frame_index:02d}", passed=True,
                timestamp=self.context["frames"][frame_index]["timestamp"], owned_face_conversions=count,
                owned_record_span=[begin, len(trace)], **({} if index < 6 else {"sha256": self.metrics[frame_index]["sha256"]})))
            cursor += count
        protocol = audit.chain_render.render.protocol(frames=self.context["frames"])
        entry = dict(name="candidate", requests=requests, owned_face_conversions=24, owned_face_restorations=24,
                     reader_error=None, protocol_rows=protocol,
                     records_sha256=self.write(path=self.directory / "records.jsonl", data=trace),
                     host_log_sha256=self.write(path=self.directory / "host.log", data="\n".join(protocol).encode()))
        self.evidence["runs"] = [entry]
        self.persist()

    def persist(self):
        self.evidence["fixture_sha256"] = {str(path): audit.digest(data=path.read_bytes()) for path in self.directory.iterdir() if path.name != "report.json"}
        self.write(path=self.directory / "report.json", data=encoded(value=self.evidence))

    def load(self):
        return audit.render_pixels(directory=self.directory, context=self.context, value=self.value, payload=self.payload,
                                   path=self.path, locked=self.locked)

    def test_exact_pixels_and_live_effect_controls_are_recomputed(self):
        before = {path: (path.stat().st_mtime_ns, path.read_bytes()) for path in self.directory.iterdir()}
        self.assertEqual(self.load(), self.metrics)
        self.assertEqual(before, {path: (path.stat().st_mtime_ns, path.read_bytes()) for path in self.directory.iterdir()})

    def test_render_flags_reject_truthy_and_falsey_nonbooleans(self):
        for key, value in (("passed", 1), ("pixel_parity_verified", "true"), ("native_analysis_bypassed", 0), ("product_parity_verified", None)):
            old = self.evidence[key]
            self.evidence[key] = value
            self.persist()
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.load()
            self.evidence[key] = old

    def test_render_capture_replay_and_host_linkages_are_exact(self):
        for key in ("capture_sha256", "replay_sha256", "host_sha256", "candidate", "capture"):
            old = self.evidence[key]
            self.evidence[key] = "f" * 64
            self.persist()
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.load()
            self.evidence[key] = old

    def test_no_effect_falsepositive_is_rejected_even_when_baseline_is_same(self):
        source = self.context["frames"][0]["input"].read_bytes()
        self.write(path=self.directory / "frame-00.rgba", data=source)
        self.write(path=self.capture_root / "baseline/frame-00.rgba", data=source)
        self.persist()
        with self.assertRaisesRegex(ValueError, "nonzero effect"):
            self.load()

    def test_no_face_and_zero_effect_controls_cannot_be_modified(self):
        for index in (3, 5):
            with self.subTest(index=index):
                path = self.directory / f"frame-{index:02d}.rgba"
                baseline = self.capture_root / "baseline" / path.name
                original = path.read_bytes()
                path.write_bytes(bytes([1, 0, 0, 255] * 4))
                baseline.write_bytes(path.read_bytes())
                self.persist()
                with self.assertRaisesRegex(ValueError, "zero-effect control"):
                    self.load()
                path.write_bytes(original)
                baseline.write_bytes(original)
                self.locked = LockedFiles()
                for fixture in (self.path, self.capture_root / "report.json", self.host):
                    self.locked.read(path=fixture)

    def test_changed_pixels_cannot_be_hidden_by_report_equal_true(self):
        self.write(path=self.directory / "frame-00.rgba", data=bytes([2, 0, 0, 255] * 4))
        self.persist()
        with self.assertRaisesRegex(ValueError, "zero delta"):
            self.load()

    def test_pixel_metrics_do_not_accept_bool_in_place_of_integer(self):
        self.evidence["comparisons"][0]["changed_pixels"] = False
        self.persist()
        with self.assertRaisesRegex(ValueError, "pixel metrics"):
            self.load()

    def test_late_binary_replay_replacement_is_rejected(self):
        (self.directory / "replay.bin").write_bytes(b"invalid replacement")
        with self.assertRaises(ValueError):
            self.load()

    def test_conversion_point_mutation_is_rejected(self):
        path = self.directory / "records.jsonl"
        rows = [json.loads(line) for line in path.read_bytes().splitlines()]
        rows[0]["faces_applied"][0]["points"][0][0] = 0.5
        identity = self.write(path=path, data=b"".join(encoded(value=row) for row in rows))
        self.evidence["runs"][0]["records_sha256"] = identity
        self.persist()
        with self.assertRaisesRegex(RuntimeError, "clone coordinates"):
            self.load()

    def test_unordered_requests_are_rejected(self):
        self.evidence["runs"][0]["requests"][0]["request_id"] = "frame-00"
        self.persist()
        with self.assertRaisesRegex(ValueError, "request order"):
            self.load()

    def test_per_request_record_spans_cannot_skip_or_duplicate_conversions(self):
        self.evidence["runs"][0]["requests"][1]["owned_record_span"][0] = True
        self.persist()
        with self.assertRaisesRegex(ValueError, "record spans"):
            self.load()


class GuardTests(TemporaryProfile):
    def test_run_revokes_success_when_final_file_guard_fails(self):
        patch.object(audit.chain.sequence, "PRIVATE", self.root).start()
        capture_root, render_root, models = (self.root / name for name in ("capture", "render", "models"))
        for directory in (capture_root, render_root, models):
            directory.mkdir()
        path, fixture = self.root / "candidate/replay.json", self.root / "fixture.bin"
        value = {"frames": []}
        evidence = dict(native_algorithm_rgba_required=True, native_caller_parameters_required=True,
            native_smoothing_initialization_required=True, native_inference_called=False,
            native_160_sampling_input_required=False, independent_full_frame_preprocessing=False,
            diagnostic_only=False, failures=[], capture=str(capture_root), manifest_frames=7,
            owned_smoothing_seed_predictions=[0, 20], native_smoothing_seed_predictions=[],
            sampling_cases=[], initialization_sampling_cases=[], cases=[],
            source_sha256=self.sources(names=audit.chain.SOURCE_NAMES),
            fixture_sha256={str(fixture): self.write(path=fixture, data=b"original")})
        self.write(path=capture_root / "report.json", data=b"capture")
        self.write(path=path, data=encoded(value=value))
        self.write(path=path.with_name("report.json"), data=encoded(value=evidence))
        self.write(path=path.parent / "onnx/report.json", data=b"model report")
        self.write(path=render_root / "report.json", data=b"render report")

        def load_capture(*, root, locked):
            locked.read(path=root / "report.json")
            return dict(root=root, evidence={}, associations=[])

        def load_candidate(*, path, context, locked):
            locked.read(path=path)
            return value, b"payload"

        def model_heads(*, directory, locked, **kwargs):
            locked.read(path=directory / "onnx/report.json")
            return {}

        def render_pixels(*, directory, locked, **kwargs):
            locked.read(path=directory / "report.json")
            fixture.write_bytes(b"changed after all stages passed")
            return []

        patch.object(audit.capture, "load", side_effect=load_capture).start()
        patch.object(audit.chain_render, "load_candidate", side_effect=load_candidate).start()
        patch.object(audit.chain, "build_120", return_value=({}, [])).start()
        patch.object(audit.chain, "build_160", return_value=({}, [])).start()
        patch.object(audit, "model_heads", side_effect=model_heads).start()
        patch.object(audit.chain, "produce", return_value=(value, [])).start()
        patch.object(audit, "render_pixels", side_effect=render_pixels).start()
        out = self.root / "fresh-audit"
        with self.assertRaises(ValueError):
            audit.run(args=argparse.Namespace(capture=capture_root, candidate=path, render=render_root, root=models, out=out))
        saved = json.loads((out / "report.json").read_bytes())
        source = Path(audit.__file__).resolve()
        self.assertEqual(saved["source_sha256"]["local-model-pytorch/face_preprocess_chain_audit.py"],
                         audit.digest(data=source.read_bytes()))
        self.assertEqual(saved["fixture_sha256"][str(source)], saved["source_sha256"]["local-model-pytorch/face_preprocess_chain_audit.py"])
        for key in ("passed", "completed", "geometry_exact", "final_consumer_parity", "pixel_parity_verified", "external_replay_verified"):
            self.assertIs(saved[key], False)
        self.assertIn("guard ValueError", saved["failures"][-1])

    def test_final_guard_revokes_every_acceptance_flag(self):
        fixture = self.root / "fixture.bin"
        self.write(path=fixture, data=b"original")
        locked = LockedFiles()
        locked.read(path=fixture)
        fixture.write_bytes(b"changed")
        report = dict(passed=True, completed=True, geometry_exact=True, final_consumer_parity=True,
                      pixel_parity_verified=True, external_replay_verified=True, failures=[])
        with self.assertRaises(ValueError):
            audit.chain.finish(out=self.root, report=report, locked=locked)
        saved = json.loads((self.root / "report.json").read_bytes())
        for key in ("passed", "completed", "geometry_exact", "final_consumer_parity", "pixel_parity_verified", "external_replay_verified"):
            self.assertIs(saved[key], False)
        self.assertIn("guard ValueError", saved["failures"][0])

    def test_primary_failure_survives_a_simultaneous_guard_failure(self):
        fixture = self.root / "fixture.bin"
        self.write(path=fixture, data=b"original")
        locked = LockedFiles()
        locked.read(path=fixture)
        report = dict(passed=False, completed=False, failures=["primary"])
        with self.assertRaisesRegex(RuntimeError, "primary"):
            try:
                fixture.write_bytes(b"changed")
                raise RuntimeError("primary")
            finally:
                audit.chain.finish(out=self.root, report=report, locked=locked)
        self.assertEqual(report["failures"][0], "primary")
        self.assertEqual(len(report["failures"]), 2)

    def test_fresh_output_rejects_existing_evidence_directory(self):
        patch.object(audit.chain.sequence, "PRIVATE", self.root).start()
        out = self.root / "existing"
        out.mkdir()
        with self.assertRaises(FileExistsError):
            audit.run(args=argparse.Namespace(out=out))


if __name__ == "__main__":
    unittest.main()
