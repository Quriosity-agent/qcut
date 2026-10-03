"""Self-authored fixtures for recorded ONNX replay, without Torch/native inference."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np

import espresso_oracle
import face_alignment_replay as replay
from face_render_consumer_probe import validate_replay


class ReplayTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.paths = {name: self.root / name for name in ("export", "reference", "decode", "capture")}
        for path in self.paths.values():
            path.mkdir()

    def save_json(self, *, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value))
        return espresso_oracle.sha256(path=path)

    def save_array(self, *, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        np.save(path, value)
        return espresso_oracle.sha256(path=path)

    def native_summary(self):
        return {"passed": True, "runtime_sha256": replay.LIBRARY_SHA256, "model_sha256": replay.MODEL_SHA256,
                "loaded_bytenn": {"sha256": replay.BYTENN_SHA256}}

    def bundle(self, *, size=120):
        root, reference, decode = (self.paths[name] for name in ("export", "reference", "decode"))
        directory = reference / ("case-000" if size == 120 else "seed-000")
        mean = np.full((106, 2), 128, np.float32)
        arrays = {"prepared-bgr": np.full((size, size, 3), 128, np.uint8),
                  "network-input": np.zeros((1, size, size, 3), np.int16 if size == 120 else np.int8),
                  "raw": np.zeros((106, 2), np.float32) if size == 120 else np.full((106, 2), 80, np.float32),
                  "stage1": np.full((106, 2), size / 2, np.float32),
                  "inverse": np.array([[1, 0, 10], [0, 1, 20]], np.float32),
                  "original-points": np.tile(np.array([size / 2 + 10, size / 2 + 20], np.float32), (106, 1))}
        hashes = {name: self.save_array(path=directory / f"{name}.npy", value=value) for name, value in arrays.items()}
        record = {"passed": True, "expansion": 1.5, "optimized": False, "step": 1,
                  "threshold": 0.0, "confidence": 0.0, **{name + "_sha256": value for name, value in hashes.items()}}
        image = self.root / "image.png"
        image.write_bytes(b"self-authored-source-bytes; producer needs identity, not image decoding")
        geometry = {**self.native_summary(), "portrait_sha256": espresso_oracle.sha256(path=image),
                    "scope": "synthetic controlled geometry", "cases" if size == 120 else "seeds": [record]}
        self.save_json(path=reference / "summary.json", value=geometry)
        mean_hash = self.save_array(path=decode / "original-base.npy", value=mean)
        order_hash = self.save_array(path=decode / "original-order.npy", value=np.arange(106, dtype=np.int32))
        decode_hash = self.save_json(path=decode / "summary.json", value={**self.native_summary(),
                                     "order_is_identity": True, "means": {"base": mean_hash}})
        model = root / f"align-{size}/artifacts/model.onnx"
        model.parent.mkdir(parents=True)
        model.write_bytes(b"synthetic model placeholder; fake runner only in pure tests")
        exported = {"passed": True, "native_oracle_sha256": espresso_oracle.RUNTIME_SHA256,
                    "float_policies": {key: list(value) for key, value in replay.FLOAT_LIMITS.items()},
                    "decode_tables": {"summary_sha256": decode_hash, "files": {"mean": mean_hash, "order": order_hash}},
                    "artifacts": {str(model.relative_to(root)): espresso_oracle.sha256(path=model)},
                    "networks": {"120": {}, "160": {}}}
        exported["networks"][str(size)] = {"terminal_names": list(replay.HEADS),
                                          "cases": {"recorded-face": {"alignment_gate": True}},
                                          "recorded_input": {name: hashes[name] for name in ("network-input", "prepared-bgr", "raw")},
                                          "point_reference": {name: hashes[name] for name in ("stage1", "inverse", "original-points")}}
        self.save_json(path=root / "summary.json", value=exported)
        return arrays, geometry, exported, image, record

    def capture(self, *, image, points=None):
        source = np.tile(np.array([0.35, 0.6], np.float32), (106, 1)) if points is None else points
        frames = [{"timestamp_us": time, "faces": [{"id": 7, "points": source.tolist()}]} for time in (0, 0, 33333, 33333)]
        value = {"version": 1, "coordinate_space": "normalized-bottom-left", "width": 200, "height": 200,
                 "image_sha256": espresso_oracle.sha256(path=image), "frames": frames}
        capture = self.paths["capture"]
        self.save_json(path=capture / "native-replay.json", value=value)
        rgba = capture / "control/input.rgba"
        rgba.parent.mkdir(parents=True)
        rgba.write_bytes(b"\0" * 200 * 200 * 4)
        metadata = {"passed": True, "mode": "owned-conversion", "owned_result_rendered": True,
                    "native_analysis_bypassed": False, "width": 200, "height": 200,
                    "image_sha256": value["image_sha256"], "owned_face_conversions": len(frames),
                    "input_rgba_sha256": espresso_oracle.sha256(path=rgba),
                    "source_sha256": {"synthetic-source.mm": "f" * 64}}
        self.save_json(path=capture / "control/report.json", value=metadata)
        events = []
        for frame in frames:
            events.append({"event": "algorithm_update", "timestamp_us": 9999999, "faces_before": []})
            events.append({"event": "owned_face_conversion", "timestamp_us": frame["timestamp_us"],
                           "faces_before": frame["faces"], "faces_applied": [], "raw_clone_verified": True,
                           "external_points": False, "eye_shift": 0, "native_analysis_bypassed": False,
                           "source_points_unchanged": True, "owned_points_isolated": True})
        path = capture / "control/clone-audit/records.jsonl"
        path.parent.mkdir(parents=True)
        path.write_text("\n".join(json.dumps(event) for event in events))
        return value, metadata, events

    def test_signed_profiles_and_hashed_fixture_linkage(self):
        for size in (120, 160):
            arrays, _, _, _, _ = self.bundle(size=size)
            locked = replay.LockedFiles()
            loaded, _, _ = replay.recorded_bundle(locked=locked, root=self.paths["export"], reference=self.paths["reference"],
                                                 decode_reference=self.paths["decode"], size=size)
            np.testing.assert_array_equal(loaded["network-input"], arrays["network-input"])
            self.assertGreaterEqual(len(locked.files), 11)
            locked.verify()

    def test_changed_array_fails_even_when_shape_valid(self):
        self.bundle()
        np.save(self.paths["reference"] / "case-000/raw.npy", np.ones((106, 2), np.float32))
        with self.assertRaisesRegex(ValueError, "hash"):
            replay.recorded_bundle(locked=replay.LockedFiles(), root=self.paths["export"], reference=self.paths["reference"],
                                   decode_reference=self.paths["decode"], size=120)

    def test_export_reference_linkage_mismatch(self):
        _, _, exported, _, _ = self.bundle()
        exported["networks"]["120"]["recorded_input"]["network-input"] = "f" * 64
        self.save_json(path=self.paths["export"] / "summary.json", value=exported)
        with self.assertRaisesRegex(ValueError, "linkage"):
            replay.recorded_bundle(locked=replay.LockedFiles(), root=self.paths["export"], reference=self.paths["reference"],
                                   decode_reference=self.paths["decode"], size=120)

    def test_unpassed_export_and_wrong_float_policies(self):
        _, _, exported, _, _ = self.bundle()
        for changed in ({**exported, "passed": 1}, {**exported, "float_policies": {}}):
            self.save_json(path=self.paths["export"] / "summary.json", value=changed)
            with self.assertRaisesRegex(ValueError, "export"):
                replay.recorded_bundle(locked=replay.LockedFiles(), root=self.paths["export"], reference=self.paths["reference"],
                                       decode_reference=self.paths["decode"], size=120)

    def test_selection_rejects_ambiguity_bad_threshold_and_profile(self):
        _, geometry, _, _, record = self.bundle()
        candidates = ({**geometry, "cases": []}, {**geometry, "cases": [record, record]},
                      {**geometry, "cases": [{**record, "threshold": 0}]},
                      {**geometry, "cases": [{**record, "step": True}]}, {**geometry, "cases": [record] * 65})
        for candidate in candidates:
            with self.assertRaises(ValueError):
                replay.selected_reference(summary=candidate, size=120)
        for size in (True, 121, 120.0):
            with self.assertRaises(ValueError):
                replay.selected_reference(summary=geometry, size=size)

    def test_decode_scatter_and_double_precision_mean_before_rounding(self):
        raw = np.arange(212, dtype=np.float32).reshape(106, 2) / 100
        mean = np.full((106, 2), 123.123, np.float32)
        order = np.arange(105, -1, -1, dtype=np.int32)
        inverse = np.array([[2, 0, 5], [0, 3, -2]], np.float32)
        for size in (120, 160):
            stage, original = replay.decode_stage1(raw=raw, mean=mean, order=order, inverse=inverse, size=size)
            expected = raw[::-1].copy()
            if size == 120:
                expected = (expected.astype(np.float64) + mean.astype(np.float64) / 256 * size).astype(np.float32)
            np.testing.assert_array_equal(stage, expected)
            np.testing.assert_array_equal(original, expected @ inverse[:, :2].T + inverse[:, 2])

    def test_bad_inverse_and_nonfinite_decode_rejected(self):
        parameters = {"raw": np.zeros((106, 2), np.float32), "mean": np.full((106, 2), 128, np.float32),
                      "order": np.arange(106, dtype=np.int32), "inverse": np.array([[1, 0, 0], [0, 1, 0]], np.float32), "size": 120}
        for key, value in (("inverse", np.zeros((2, 3), np.float32)), ("raw", np.full((106, 2), np.nan, np.float32)),
                           ("mean", np.full((106, 2), 257, np.float32)), ("order", np.zeros(106, np.int32)),
                           ("raw", np.zeros((106, 2), np.float64)), ("inverse", np.full((2, 3), np.inf, np.float32))):
            with self.assertRaises(ValueError):
                replay.decode_stage1(**{**parameters, key: value})

    def test_normalization_is_bottom_left_full_dimensions_and_no_fit(self):
        points = np.tile(np.array([50, 75], np.float32), (106, 1))
        result = replay.normalized_points(points=points, width=200, height=100)
        np.testing.assert_array_equal(result, np.full((106, 2), 0.25, np.float32))
        self.assertFalse(np.array_equal(result, points / [199, 99]))

    def test_normalization_rejects_out_of_frame_without_clipping(self):
        points = np.tile(np.array([50, 75], np.float32), (106, 1))
        for coordinates in ([-0.1, 75], [201, 75], [50, 101], [np.nan, 75]):
            points[0] = coordinates
            with self.assertRaises(ValueError):
                replay.normalized_points(points=points, width=200, height=100)
        for width in (0, 4097, True, 200.0):
            with self.assertRaises(ValueError):
                replay.normalized_points(points=np.zeros((106, 2), np.float32), width=width, height=100)

    def test_conversion_schedule_not_algorithm_update_and_source_before(self):
        _, geometry, _, image, _ = self.bundle()
        captured, _, _ = self.capture(image=image)
        result, evidence = replay.capture_reference(locked=replay.LockedFiles(), capture=self.paths["capture"], geometry=geometry, image=image)
        self.assertEqual(result, captured)
        self.assertTrue(evidence["stream_crosschecked"])
        self.assertEqual(evidence["source_field"], "faces_before")
        self.assertEqual([frame["timestamp_us"] for frame in result["frames"]], [0, 0, 33333, 33333])

    def test_native_json_only_marks_stream_not_crosschecked(self):
        _, geometry, _, image, _ = self.bundle()
        self.capture(image=image)
        captured, evidence = replay.capture_reference(locked=replay.LockedFiles(), capture=self.paths["capture"] / "native-replay.json",
                                                     metadata=self.paths["capture"] / "control/report.json", geometry=geometry, image=image)
        self.assertEqual(len(captured["frames"]), 4)
        self.assertFalse(evidence["stream_crosschecked"])
        self.assertFalse(evidence["explicit_runtime_identity_in_metadata"])

    def test_native_json_without_metadata_rejected(self):
        _, geometry, _, image, _ = self.bundle()
        self.capture(image=image)
        with self.assertRaisesRegex(ValueError, "capture-metadata"):
            replay.capture_reference(locked=replay.LockedFiles(), capture=self.paths["capture"] / "native-replay.json", geometry=geometry, image=image)

    def test_captured_rgba_dimensions_and_hash_rejected(self):
        _, geometry, _, image, _ = self.bundle()
        _, metadata, _ = self.capture(image=image)
        rgba = self.paths["capture"] / "control/input.rgba"
        rgba.write_bytes(b"too-short")
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            replay.capture_reference(locked=replay.LockedFiles(), capture=self.paths["capture"], geometry=geometry, image=image)
        metadata["input_rgba_sha256"] = espresso_oracle.sha256(path=rgba)
        self.save_json(path=self.paths["capture"] / "control/report.json", value=metadata)
        with self.assertRaisesRegex(ValueError, "dimensions mismatch"):
            replay.capture_reference(locked=replay.LockedFiles(), capture=self.paths["capture"], geometry=geometry, image=image)

    def test_foreign_image_and_modified_conversion_rejected(self):
        _, geometry, _, image, _ = self.bundle()
        _, _, events = self.capture(image=image)
        for key, value in (("external_points", True), ("source_points_unchanged", False),
                           ("owned_points_isolated", False), ("eye_shift", 0.01), ("timestamp_us", 1)):
            changed = copy.deepcopy(events)
            changed[1][key] = value
            (self.paths["capture"] / "control/clone-audit/records.jsonl").write_text("\n".join(json.dumps(event) for event in changed))
            with self.assertRaisesRegex(ValueError, "conversion capture"):
                replay.capture_reference(locked=replay.LockedFiles(), capture=self.paths["capture"], geometry=geometry, image=image)
        image.write_bytes(b"different image")
        with self.assertRaisesRegex(ValueError, "identical"):
            replay.capture_reference(locked=replay.LockedFiles(), capture=self.paths["capture"], geometry=geometry, image=image)

    def test_changing_identity_and_no_face_fail_instead_of_reusing_wrong_crop(self):
        _, geometry, _, image, _ = self.bundle()
        captured, _, _ = self.capture(image=image)
        for faces in ([], [{**captured["frames"][0]["faces"][0], "id": 8}]):
            candidate = copy.deepcopy(captured)
            candidate["frames"][-1]["faces"] = faces
            self.save_json(path=self.paths["capture"] / "native-replay.json", value=candidate)
            with self.assertRaisesRegex(ValueError, "crop"):
                replay.capture_reference(locked=replay.LockedFiles(), capture=self.paths["capture"] / "native-replay.json",
                                         metadata=self.paths["capture"] / "control/report.json", geometry=geometry, image=image)

    def test_disagreement_is_reported_not_corrected_to_reference(self):
        _, _, _, image, _ = self.bundle()
        captured, _, _ = self.capture(image=image)
        points = np.tile(np.array([72, 80], np.float32), (106, 1))
        generated, comparisons = replay.produce_frames(capture=captured, points=points)
        self.assertEqual(len(generated["frames"]), len(captured["frames"]))
        self.assertEqual(generated["frames"][0]["faces"][0]["id"], 7)
        self.assertNotEqual(generated["frames"][0]["faces"][0]["points"], captured["frames"][0]["faces"][0]["points"])
        self.assertAlmostEqual(comparisons[0]["pixels"]["max_abs"], 2, places=4)
        self.assertFalse(comparisons[0]["pixels"]["within"])
        self.assertEqual(len(comparisons[0]["pixels"]["signed_delta"]), 106)
        validate_replay(value=generated, width=200, height=200, image_hash=captured["image_sha256"])

    def test_locked_files_detect_replacement_same_bytes_and_symlink_retarget(self):
        source = self.root / "source"
        source.write_bytes(b"fixture")
        locked = replay.LockedFiles()
        locked.read(path=source)
        other = self.root / "other"
        other.write_bytes(b"fixture")
        other.replace(source)
        with self.assertRaisesRegex(ValueError, "changed"):
            locked.verify()
        link = self.root / "link"
        link.symlink_to(source)
        locked = replay.LockedFiles()
        locked.read(path=link)
        other.write_bytes(b"fixture")
        link.unlink()
        link.symlink_to(other)
        with self.assertRaisesRegex(ValueError, "changed"):
            locked.verify()

    def test_bounded_bytes_shapes_and_pickle_rejected(self):
        path = self.root / "data.npy"
        for value in (np.ones((105, 2), np.float32), np.ones((106, 2), np.float64),
                      np.full((106, 2), np.inf, np.float32), np.array([object()], dtype=object)):
            np.save(path, value)
            with self.assertRaises(ValueError):
                replay.LockedFiles().array(path=path, shape=(106, 2), dtype=np.float32, expected=espresso_oracle.sha256(path=path))
        with self.assertRaisesRegex(ValueError, "oversized"):
            replay.LockedFiles().read(path=path, maximum=4)

    def test_duplicate_nonfinite_json_and_hash_validation(self):
        for value in ('{"a":1,"a":2}', '{"a":NaN}', '{"a":Infinity}', '{"a":1e999}'):
            with self.assertRaises(ValueError):
                replay.strict_json(data=value)
        for value in (None, "f" * 63, "F" * 64, "g" * 64, 42):
            self.assertFalse(replay.valid_hash(value=value))
        self.assertTrue(replay.valid_hash(value="f" * 64))

    def test_missing_table_hashes_and_malformed_metadata_fail_closed(self):
        _, _, exported, _, _ = self.bundle()
        for field in ("summary_sha256", "mean", "order"):
            changed = copy.deepcopy(exported)
            target = changed["decode_tables"] if field == "summary_sha256" else changed["decode_tables"]["files"]
            target[field] = None
            self.save_json(path=self.paths["export"] / "summary.json", value=changed)
            with self.assertRaisesRegex(ValueError, "hashes"):
                replay.recorded_bundle(locked=replay.LockedFiles(), root=self.paths["export"], reference=self.paths["reference"],
                                       decode_reference=self.paths["decode"], size=120)
        for field in ("networks", "decode_tables", "artifacts"):
            self.save_json(path=self.paths["export"] / "summary.json", value={**exported, field: None})
            with self.assertRaisesRegex(ValueError, "object field"):
                replay.recorded_bundle(locked=replay.LockedFiles(), root=self.paths["export"], reference=self.paths["reference"],
                                       decode_reference=self.paths["decode"], size=120)
        with self.assertRaisesRegex(ValueError, "hash required"):
            replay.LockedFiles().array(path=self.root / "missing.npy", shape=(106, 2), dtype=np.float32, expected=None)

    def test_pure_run_writes_accepted_private_replay_and_separates_parity(self):
        arrays, _, _, image, _ = self.bundle()
        self.capture(image=image, points=np.full((106, 2), 0.5, np.float32))
        output = self.root / "out"
        with patch("espresso_oracle.private_path", side_effect=lambda *, path: Path(path)), patch.object(
                replay, "infer", return_value=(arrays["raw"], {"onnxruntime": "synthetic"})):
            report = replay.run(root=self.paths["export"], reference=self.paths["reference"], decode_reference=self.paths["decode"],
                                capture=self.paths["capture"], image=image, size=120, output=output)
        self.assertTrue(report["passed"])
        self.assertFalse(report["final_consumer_parity"])
        self.assertFalse(report["native_analysis_bypassed"])
        self.assertFalse(report["end_to_end_independence"])
        self.assertFalse(report["native_inference_called"])
        generated = json.loads((output / "replay.json").read_text())
        payload = validate_replay(value=generated, width=200, height=200, image_hash=espresso_oracle.sha256(path=image))
        self.assertEqual(hashlib.sha256(payload).hexdigest(), report["replay_binary_sha256"])
        self.assertEqual(espresso_oracle.sha256(path=output / "replay.json"), report["replay_json_sha256"])

    def test_failed_stage1_gate_does_not_publish_replay(self):
        arrays, _, _, image, _ = self.bundle()
        self.capture(image=image)
        output = self.root / "failed"
        with patch("espresso_oracle.private_path", side_effect=lambda *, path: Path(path)), patch.object(
                replay, "infer", return_value=(arrays["raw"] + np.float32(1), {})):
            report = replay.run(root=self.paths["export"], reference=self.paths["reference"], decode_reference=self.paths["decode"],
                                capture=self.paths["capture"], image=image, size=120, output=output)
        self.assertFalse(report["passed"])
        self.assertIsNone(report["replay_json"])
        self.assertFalse((output / "replay.json").exists())
        self.assertTrue((output / "report.json").is_file())

    def test_output_not_private_and_existing_output_rejected(self):
        with self.assertRaisesRegex(ValueError, "private ignored"):
            replay.run(root=self.root, reference=self.root, decode_reference=self.root, capture=self.root,
                       image=self.root, size=120, output=self.root / "public")
        with patch("espresso_oracle.private_path", side_effect=lambda *, path: Path(path)):
            with self.assertRaisesRegex(ValueError, "overwrite"):
                replay.run(root=self.root, reference=self.root, decode_reference=self.root, capture=self.root,
                           image=self.root, size=120, output=self.root)

    def test_torch_import_guard(self):
        with patch.dict(sys.modules, {"torch": object()}):
            with self.assertRaisesRegex(ValueError, "Torch"):
                replay.run(root=self.root, reference=self.root, decode_reference=self.root, capture=self.root,
                           image=self.root, size=120, output=self.root / "out")

    def fake_runner(self, *, size):
        shapes = {**replay.HEADS, "prob": 3 if size == 120 else 5}
        source = [SimpleNamespace(name="data", shape=[1, size, size, 3], type="tensor(int64)")]
        outputs = [SimpleNamespace(name=name, shape=[1, 1, 1, count], type="tensor(float)") for name, count in shapes.items()]
        values = [np.zeros((1, 1, 1, count), np.float32) for count in shapes.values()]
        runner = SimpleNamespace(get_inputs=lambda: source, get_outputs=lambda: outputs,
                                 run=lambda names, feed: values, get_providers=lambda: ["CPUExecutionProvider"])
        return runner, source, outputs, values

    def test_onnx_metadata_and_head_shapes_for_both_profiles_without_runtime(self):
        for size in (120, 160):
            runner, _, _, _ = self.fake_runner(size=size)
            with patch.dict(sys.modules, {"onnxruntime": SimpleNamespace(__version__="1.22.1"),
                                          "espresso_onnx_runtime": SimpleNamespace(session=lambda *, path: runner)}):
                raw, versions = replay.infer(model=Path("model.onnx"), size=size,
                                             inputs=np.zeros((1, size, size, 3), np.int16 if size == 120 else np.int8))
            self.assertEqual(raw.shape, (106, 2))
            self.assertEqual(versions["head_names"], list(replay.HEADS))
            self.assertEqual(versions["head_channels"]["prob"], 3 if size == 120 else 5)

    def test_onnx_wrong_metadata_and_nonfinite_values_rejected(self):
        for mutation in ("wrong_input_type", "wrong_input_shape", "wrong_head_shape", "wrong_head_name", "nan", "float64", "missing"):
            runner, source, outputs, values = self.fake_runner(size=120)
            if mutation == "wrong_input_type":
                source[0].type = "tensor(float)"
            elif mutation == "wrong_input_shape":
                source[0].shape = [1, 120, 120, 4]
            elif mutation == "wrong_head_shape":
                outputs[2].shape = [1, 1, 1, 5]
            elif mutation == "wrong_head_name":
                outputs[0].name = "unknown"
            elif mutation == "nan":
                values[0][0, 0, 0, 0] = np.nan
            elif mutation == "float64":
                values[0] = values[0].astype(np.float64)
            else:
                values.pop()
            with self.subTest(mutation=mutation), patch.dict(sys.modules, {
                    "onnxruntime": SimpleNamespace(__version__="1.22.1"),
                    "espresso_onnx_runtime": SimpleNamespace(session=lambda *, path: runner)}):
                with self.assertRaises(ValueError):
                    replay.infer(model=Path("model.onnx"), size=120, inputs=np.zeros((1, 120, 120, 3), np.int16))

    def test_onnx_runtime_version_and_signed_inputs_fail_closed(self):
        runner, _, _, _ = self.fake_runner(size=120)
        with patch.dict(sys.modules, {"onnxruntime": SimpleNamespace(__version__="1.30.0"),
                                      "espresso_onnx_runtime": SimpleNamespace(session=lambda *, path: runner)}):
            with self.assertRaisesRegex(ValueError, "1.22.1"):
                replay.infer(model=Path("model.onnx"), size=120, inputs=np.zeros((1, 120, 120, 3), np.int16))
        with patch.dict(sys.modules, {"onnxruntime": SimpleNamespace(__version__="1.22.1"),
                                      "espresso_onnx_runtime": SimpleNamespace(session=lambda *, path: runner)}):
            for value in (np.full((1, 120, 120, 3), 128, np.int16), np.zeros((1, 120, 120, 3), np.float32),
                          np.zeros((1, 120, 120, 4), np.int16)):
                with self.assertRaisesRegex(ValueError, "NHWC"):
                    replay.infer(model=Path("model.onnx"), size=120, inputs=value)


if __name__ == "__main__":
    unittest.main()
