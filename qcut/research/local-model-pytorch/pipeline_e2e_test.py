"""Synthetic pipeline contracts; no private models, graphs, or media required."""
import pathlib
import hashlib
import json
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from pipeline_e2e_media import decode, encode_and_verify
from pipeline_e2e_profiles import (PROFILES, compare_outputs, initial_state, next_state,
                                   normalized_frame, prepare_inputs, validate_outputs, visualization)
from pipeline_e2e_run import backend_predictor, private_output, replay, run_sequence, verified_artifact, verify_profile_identity
from pipeline_e2e_stress import descendant_rss


class PipelineProfilesTest(unittest.TestCase):
    def frame(self, *, profile, count=1):
        shape = (count, profile.height, profile.width, 3)
        return np.zeros(shape, np.uint8)

    def test_tflite_metadata_normalization(self):
        profile = PROFILES["tflite"]
        frames = self.frame(profile=profile)
        values = prepare_inputs(profile=profile, frames=frames, index=0, state={})
        self.assertEqual(values["image"].shape, (1, 256, 256, 3))
        self.assertTrue(np.all(values["image"] == -1))

    def test_bgr_is_explicit(self):
        frame = np.array([[[255, 128, 0]]], np.uint8)
        tensor = normalized_frame(frame=frame, bgr=True)
        np.testing.assert_array_equal(tensor[0, :, 0, 0], np.array([0, 128 / 255, 1], np.float32))

    def test_uint8_only(self):
        with self.assertRaises(ValueError):
            normalized_frame(frame=np.zeros((4, 4, 3), np.float32))

    def test_tracking_preserves_int16_and_shift(self):
        profile = PROFILES["tracking-backbone"]
        frames = self.frame(profile=profile) + 255
        data = prepare_inputs(profile=profile, frames=frames, index=0, state={})["data"]
        self.assertEqual(data.dtype, np.int16)
        self.assertTrue(np.all(data == 64))

    def test_temporal_state_does_not_alias_outputs(self):
        profile = PROFILES["video-object"]
        state = initial_state(profile=profile)
        values = prepare_inputs(profile=profile, frames=self.frame(profile=profile), index=0, state=state)
        output = np.ones_like(state["prev_mask"])
        new = next_state(profile=profile, inputs=values, outputs={"nn_3": output})
        output.fill(0)
        self.assertTrue(np.all(new["prev_mask"] == 1))
        self.assertTrue(np.all(state["prev_mask"] == 0))

    def test_invalid_recurrent_shape_rejected(self):
        with self.assertRaises(ValueError):
            next_state(profile=PROFILES["video-object"], inputs={"data": np.zeros((1, 3, 2, 2))},
                       outputs={"nn_3": np.zeros((1, 2, 2, 2), np.float32)})

    def test_shot_edge_replication(self):
        profile = PROFILES["shot"]
        frames = self.frame(profile=profile, count=2)
        frames[1].fill(255)
        values = prepare_inputs(profile=profile, frames=frames, index=0, state={})["frames"]
        self.assertEqual(values.shape, (7, 3, 96, 96))
        self.assertTrue(np.all(values[:4] == 0))
        self.assertTrue(np.all(values[4:] == 1))

    def test_invalid_frame_shape_and_index(self):
        for index in (-1, 1):
            with self.assertRaises(ValueError):
                prepare_inputs(profile=PROFILES["skin"], frames=np.zeros((1, 2, 2, 3), np.uint8), index=index, state={})
        with self.assertRaises(ValueError):
            prepare_inputs(profile=PROFILES["skin"], frames=np.zeros((1, 2, 2, 3), np.uint8), index=0, state={})

    def test_integer_one_lsb_is_failure(self):
        result = compare_outputs(actual={"x": np.array([1], np.int16)}, expected={"x": np.array([0], np.int16)})
        self.assertFalse(result["x"]["passed"])

    def test_float_tolerance_fixed(self):
        expected = {"x": np.zeros(1, np.float32)}
        self.assertTrue(compare_outputs(actual={"x": np.array([0.00005], np.float32)}, expected=expected)["x"]["passed"])
        self.assertFalse(compare_outputs(actual={"x": np.array([0.0002], np.float32)}, expected=expected)["x"]["passed"])

    def test_all_output_names_and_shapes_required(self):
        with self.assertRaises(ValueError):
            compare_outputs(actual={"a": np.zeros(1, np.float32)}, expected={"b": np.zeros(1, np.float32)})
        with self.assertRaises(ValueError):
            compare_outputs(actual={"a": np.zeros(2, np.float32)}, expected={"a": np.zeros(1, np.float32)})

    def test_empty_nonfinite_dtype_rejected(self):
        for outputs in ({}, {"x": np.array([np.nan], np.float32)}, {"x": np.array([], np.float32)},
                        {"x": np.array([1], np.int32)}):
            with self.assertRaises(ValueError):
                validate_outputs(outputs=outputs)

    def test_tflite_softmax_before_alpha(self):
        result, _ = visualization(profile=PROFILES["tflite"], outputs={"logits": np.zeros((1, 2, 2, 6), np.float32)})
        self.assertEqual(result.shape, (180, 320, 3))
        self.assertTrue(np.all(np.abs(result.astype(float) - 255 * 5 / 6) < 1))

    def test_generic_projection_is_not_semantic(self):
        result, description = visualization(profile=PROFILES["c73"], outputs={"Sigmoid_271": np.zeros((1, 73, 1, 1), np.float32)})
        self.assertIn("no semantic labels", description)
        self.assertFalse(result.any())

    def test_new_vision_profiles_original_shapes(self):
        for name, height, width in (("clip2m", 224, 224), ("clip30m", 224, 224), ("normal", 400, 224)):
            profile = PROFILES[name]
            frames = self.frame(profile=profile)
            values = prepare_inputs(profile=profile, frames=frames, index=0, state={})
            self.assertEqual(values["data"].shape, (1, 3, height, width))
            self.assertEqual(values["data"].dtype, np.float32)

    def test_clip_projection_is_only_diagnostic(self):
        embedding = np.linspace(-1, 1, 128, dtype=np.float32).reshape(1, 128, 1, 1)
        for name in ("clip2m", "clip30m"):
            result, description = visualization(profile=PROFILES[name], outputs={"v_projector": embedding})
            self.assertEqual(result.shape, (180, 320, 3))
            self.assertIn("not image quality", description)
            self.assertTrue(np.ptp(result) > 0)

    def test_normal_projection_has_no_geometry_claim(self):
        tensor = np.ones((1, 3, 400, 224), np.float32)
        result, description = visualization(profile=PROFILES["normal"], outputs={"up3.2": tensor})
        self.assertEqual(result.shape, (180, 320, 3))
        self.assertIn("not calibrated", description)

    def test_replay_independent_state(self):
        profile = PROFILES["video-object"]
        frames = self.frame(profile=profile, count=4)
        def predictor(inputs):
            return {"nn_3": inputs["prev_mask"] + 1}
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory)
            for index, scalar in enumerate((1, 2, 1, 2)):
                np.savez(path / f"outputs-{index:04d}.npz", nn_3=np.full((1, 1, 256, 256), scalar, np.float32))
            result = replay(frames=frames, profile=profile, predictor=predictor, output=path, reset_indices=[0, 2])
        self.assertTrue(result["passed"])
        self.assertEqual(len(result["cases"]), 4)

    def test_continuous_stress_does_not_reset_midpoint(self):
        profile = PROFILES["video-object"]
        frames = self.frame(profile=profile, count=4)
        def predictor(inputs):
            return {"nn_3": inputs["prev_mask"] + np.float32(0.1)}
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory)
            report = {}
            run_sequence(frames=frames, profile=profile, predictor=predictor, output=path,
                         report=report, reset_policy="start-only")
            with np.load(path / "outputs-0003.npz") as archive:
                np.testing.assert_allclose(archive["nn_3"], np.float32(0.4))
        self.assertEqual(report["reset_indices"], [0])

    def test_invalid_reset_policy_rejected(self):
        with self.assertRaises(ValueError):
            run_sequence(frames=np.zeros((1, 2, 2, 3), np.uint8), profile=PROFILES["skin"], predictor=None,
                         output=pathlib.Path("unused"), report={}, reset_policy="unknown")


class PipelineSafetyTest(unittest.TestCase):
    def test_rss_counts_only_process_tree(self):
        rows = [(5, 3, 500), (1, 0, 100), (3, 2, 300), (2, 1, 200), (9, 1, 900)]
        self.assertEqual(descendant_rss(root_pid=2, rows=rows), 1000 * 1024)
        self.assertEqual(descendant_rss(root_pid=99, rows=rows), 0)

    def test_historical_native_status_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            model, native, ledger = root / "model.pt", root / "native.json", root / "ledger.json"
            model.write_bytes(b"synthetic artifact, not a torch bundle")
            native.write_text("{\"synthetic\": true}\n")
            item = {"verified": True, "status": "recorded-native-parity-passed", "native_checks": 1,
                    "failed_native_checks": 0, "report": str(native),
                    "report_sha256": hashlib.sha256(native.read_bytes()).hexdigest(),
                    "artifact": {"artifact_sha256": hashlib.sha256(model.read_bytes()).hexdigest()}}
            ledger.write_text(json.dumps({"networks": [{"source_sha256": "synthetic", "network_id": "main", "history": [item]}]}))
            with patch("pipeline_e2e_run.PRIVATE", root):
                result = verified_artifact(model=model, ledger=ledger)
                self.assertEqual(result["evidence"][0]["status"], "recorded-native-parity-passed")
                native.write_text("changed")
                with self.assertRaises(ValueError):
                    verified_artifact(model=model, ledger=ledger)

    def test_unverified_bundle_not_admitted(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            model, ledger = root / "model.pt", root / "ledger.json"
            model.write_bytes(b"synthetic artifact")
            ledger.write_text(json.dumps({"networks": []}))
            with patch("pipeline_e2e_run.PRIVATE", root), self.assertRaises(ValueError):
                verified_artifact(model=model, ledger=ledger)

    def test_same_shape_vision_models_cannot_swap_profiles(self):
        from vision_batch_profiles import PROFILES as VISION_PROFILES
        validation = {"evidence": [{"source_sha256": VISION_PROFILES["clip2m"]["source_sha256"]}]}
        verify_profile_identity(profile=PROFILES["clip2m"], validation=validation)
        with self.assertRaises(ValueError):
            verify_profile_identity(profile=PROFILES["clip30m"], validation=validation)

    def test_decode_rejects_empty_invalid_and_oversized(self):
        for frames, fps, start in ((0, 4, 0), (601, 4, 0), (1, float("nan"), 0), (1, 4, -1), (600, 4, 0)):
            with self.assertRaises(ValueError):
                decode(video=pathlib.Path("unused"), width=1920, height=1088, fps=fps,
                       frames=frames, start=start, log=pathlib.Path("unused"))

    def test_decode_empty_or_partial_bytes_rejected(self):
        for raw in (b"", b"1234"):
            with patch("pipeline_e2e_media.command", return_value=raw), self.assertRaises(ValueError):
                decode(video=pathlib.Path("unused"), width=2, height=2, fps=4,
                       frames=1, start=0, log=pathlib.Path("unused"))

    def test_encode_rejects_shape_mismatch(self):
        with self.assertRaises(ValueError):
            encode_and_verify(original=np.zeros((1, 2, 2, 3), np.uint8), response=np.zeros((1, 4, 4, 3), np.uint8),
                              fps=4, output=pathlib.Path("unused"))

    def test_private_output_boundary_and_existing_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            with patch("pipeline_e2e_run.PRIVATE", root):
                with self.assertRaises(ValueError):
                    private_output(path=root)
                private_output(path=root / "case")
                with self.assertRaises(FileExistsError):
                    private_output(path=root / "case")

    def test_unapproved_backend_and_ignored_contract(self):
        for backend, contract in (("unknown", None), ("onnx", None), ("pytorch", pathlib.Path("contract.json"))):
            with self.assertRaises(ValueError):
                backend_predictor(backend=backend, model=pathlib.Path("unused"), profile=PROFILES["skin"],
                                  contract=contract, threads=2)


if __name__ == "__main__":
    unittest.main()
