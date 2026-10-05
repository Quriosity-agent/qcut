"""CPU-only Extra geometry and arithmetic contracts; no native or model loading."""
from __future__ import annotations

import copy
import hashlib
import json
import unittest
from unittest import mock

import numpy as np

import face_live_extra_refinement as refinement


def geometry_fixture():
    identity = [[1, 0, 0], [0, 1, 0]]
    return dict(schema="face-live-extra-geometry-v1", profile=dict(refinement.PROFILE),
                forward=copy.deepcopy(identity), inverse=copy.deepcopy(identity),
                stage2_forward=copy.deepcopy(identity), stage2_inverse=copy.deepcopy(identity),
                primary_mean=[0] * 212)


def pixel_fixture():
    y, x = np.indices((180, 190))
    return np.stack((x % 256, y % 256, (3 * x + 5 * y) % 256,
                     np.full_like(x, 255)), axis=-1).astype(np.uint8)


def reference_map(*, points, matrix):
    matrix = np.asarray(matrix, np.float32).astype(np.float64)
    result = np.empty((106, 2), np.float32)
    for index in range(106):
        for axis in range(2):
            x = np.float64(points[index, 0]) * matrix[axis, 0]
            y = np.float64(points[index, 1]) * matrix[axis, 1]
            result[index, axis] = np.float32((x + y) + matrix[axis, 2])
    return result


def fake_models(*, raw=None):
    models = mock.Mock()
    models.version = "extra-test-model-v1"
    models.infer.return_value = np.full((240, 2), 30, np.float32) if raw is None else raw
    return models


class ExtraGeometryTests(unittest.TestCase):
    def test_valid_geometry_is_detached_float32(self):
        geometry = geometry_fixture()
        matrices, mean = refinement.validate_geometry(geometry=geometry)
        self.assertEqual(set(matrices), {"forward", "inverse", "stage2_forward", "stage2_inverse"})
        for matrix in matrices.values():
            self.assertEqual(matrix.shape, (2, 3))
            self.assertEqual(matrix.dtype, np.float32)
            matrix[:] = 99
        mean[:] = 99
        self.assertEqual(geometry, geometry_fixture())

    def test_schema_and_envelope_are_exact(self):
        for invalid in (None, [], "face-live-extra-geometry-v1", False):
            with self.subTest(envelope=invalid), self.assertRaises(ValueError):
                refinement.validate_geometry(geometry=invalid)
        for invalid in (None, False, 1, [], {}, "face-live-extra-geometry-v2"):
            geometry = geometry_fixture()
            geometry["schema"] = invalid
            with self.subTest(schema=invalid), self.assertRaises(ValueError):
                refinement.validate_geometry(geometry=geometry)
        for missing in geometry_fixture():
            geometry = {key: value for key, value in geometry_fixture().items() if key != missing}
            with self.subTest(missing=missing), self.assertRaises(ValueError):
                refinement.validate_geometry(geometry=geometry)

    def test_profile_values_and_types_are_strict(self):
        for key, expected in refinement.PROFILE.items():
            invalids = (0, 1, None, "false", not expected) if type(expected) is bool else (
                bool(expected), float(expected), expected + 1, None, str(expected))
            for invalid in invalids:
                geometry = geometry_fixture()
                geometry["profile"][key] = invalid
                with self.subTest(key=key, invalid=invalid), self.assertRaises(ValueError):
                    refinement.validate_geometry(geometry=geometry)
            geometry = geometry_fixture()
            geometry["profile"].pop(key)
            with self.subTest(missing=key), self.assertRaises(ValueError):
                refinement.validate_geometry(geometry=geometry)
        for invalid in (None, [], True):
            geometry = geometry_fixture()
            geometry["profile"] = invalid
            with self.subTest(profile=invalid), self.assertRaises(ValueError):
                refinement.validate_geometry(geometry=geometry)

    def test_native_points_pixels_and_replay_channels_are_rejected(self):
        for location in ("geometry", "profile"):
            for key in ("native_points", "points", "nativepixels", "native_pixels", "cropblob",
                        "crop_blob", "tensor", "raw240", "replay_path", "native_result"):
                geometry = geometry_fixture()
                target = geometry if location == "geometry" else geometry["profile"]
                target[key] = []
                models = fake_models()
                with self.subTest(location=location, key=key), self.assertRaises(ValueError):
                    refinement.ExtraRefinement(models=models).refine(rgba=pixel_fixture(), geometry=geometry)
                models.infer.assert_not_called()

    def test_all_four_matrices_must_be_finite_bounded_and_nonsingular(self):
        invalids = ([], [[1, 0], [0, 1]], [[1, 2, 0], [2, 4, 0]],
                    [[1, 0, 0], [0, 1e-10, 0]], [[True, 0, 0], [0, 1, 0]],
                    [[1, 0, float("nan")], [0, 1, 0]], [[1, 0, float("inf")], [0, 1, 0]],
                    [[1, 0, 32769], [0, 1, 0]], np.eye(2, 3, dtype=np.float32))
        for key in ("forward", "inverse", "stage2_forward", "stage2_inverse"):
            for index, invalid in enumerate(invalids):
                geometry = geometry_fixture()
                geometry[key] = invalid
                with self.subTest(key=key, case=index), self.assertRaises(ValueError):
                    refinement.validate_geometry(geometry=geometry)

    def test_mean_requires_exact_finite_numeric_212_list(self):
        invalids = ([0] * 211, [0] * 213, [[0, 0]] * 106, np.zeros(212, np.float32),
                    [False] + [0] * 211, ["0"] + [0] * 211,
                    [float("nan")] + [0] * 211, [float("inf")] + [0] * 211,
                    [32769] + [0] * 211)
        for index, invalid in enumerate(invalids):
            geometry = geometry_fixture()
            geometry["primary_mean"] = invalid
            with self.subTest(case=index), self.assertRaises(ValueError):
                refinement.validate_geometry(geometry=geometry)


class ExtraRefinementTests(unittest.TestCase):
    def assert_bits_equal(self, *, actual, expected):
        self.assertEqual(actual.dtype, np.float32)
        np.testing.assert_array_equal(actual.view(np.uint32), expected.view(np.uint32))

    def test_sampling_uses_supplied_rgba_bgr_channels_and_geometry(self):
        rgba, geometry, models = pixel_fixture(), geometry_fixture(), fake_models()
        geometry["forward"] = [[1, 0, -5], [0, 1, -7]]
        refinement.ExtraRefinement(models=models).refine(rgba=rgba, geometry=geometry)
        sampled = models.infer.call_args.kwargs["values"]
        expected = rgba[7:167, 5:165, :3][:, :, ::-1].astype(np.int16) - 128
        self.assertEqual(sampled.dtype, np.int16)
        np.testing.assert_array_equal(sampled, expected[None])

    def test_new_pixels_change_tensor_and_alpha_does_not_feed_model(self):
        rgba, geometry, models = pixel_fixture(), geometry_fixture(), fake_models()
        refiner = refinement.ExtraRefinement(models=models)
        _, first = refiner.refine(rgba=rgba, geometry=geometry)
        first_input = models.infer.call_args.kwargs["values"].copy()
        changed = rgba.copy()
        changed[0, 0, 0] ^= 1
        _, second = refiner.refine(rgba=changed, geometry=geometry)
        self.assertNotEqual(first["input_tensor_sha256"], second["input_tensor_sha256"])
        alpha_only = rgba.copy()
        alpha_only[:, :, 3] = 0
        _, third = refiner.refine(rgba=alpha_only, geometry=geometry)
        np.testing.assert_array_equal(models.infer.call_args.kwargs["values"], first_input)
        self.assertEqual(first["input_tensor_sha256"], third["input_tensor_sha256"])
        self.assertNotEqual(first["algorithm_rgba_sha256"], third["algorithm_rgba_sha256"])

    def test_raw_requires_all_240_finite_float32_pairs(self):
        invalids = [None, [], np.zeros((106, 2), np.float32), np.zeros((240, 1, 1, 2), np.float32),
                    np.zeros((2, 240), np.float32), np.zeros((240, 2), np.float64),
                    np.zeros((240, 2), np.int16)]
        for value in (float("nan"), float("inf"), -float("inf")):
            raw = np.zeros((240, 2), np.float32)
            raw[-1, -1] = value
            invalids.append(raw)
        for index, raw in enumerate(invalids):
            models = fake_models()
            models.infer.return_value = raw
            with self.subTest(case=index), self.assertRaisesRegex(ValueError, "finite Extra 240-pair"):
                refinement.ExtraRefinement(models=models).refine(rgba=pixel_fixture(), geometry=geometry_fixture())
            models.verify.assert_not_called()

    def test_decode_uses_double_intermediate_then_one_float32_rounding(self):
        rng = np.random.default_rng(419)
        raw = rng.uniform(-3, 3, (240, 2)).astype(np.float32)
        mean = rng.uniform(0, 256, (106, 2)).astype(np.float32)
        geometry = geometry_fixture()
        geometry["primary_mean"] = mean.reshape(-1).tolist()
        expected = np.asarray([[np.float32(float(raw[i, axis]) + float(mean[i, axis]) / 256 * 160)
                                for axis in range(2)] for i in range(106)], np.float32)
        early_float32 = raw[:106] + mean / np.float32(256) * np.float32(160)
        self.assertTrue(np.any(expected.view(np.uint32) != early_float32.view(np.uint32)))
        actual, _ = refinement.ExtraRefinement(models=fake_models(raw=raw)).refine(
            rgba=pixel_fixture(), geometry=geometry)
        self.assert_bits_equal(actual=actual, expected=expected)

    def test_first106_order_is_preserved_and_tail_is_not_mapped(self):
        raw = np.arange(480, dtype=np.float32).reshape(240, 2) / np.float32(8)
        first, _ = refinement.ExtraRefinement(models=fake_models(raw=raw)).refine(
            rgba=pixel_fixture(), geometry=geometry_fixture())
        self.assert_bits_equal(actual=first, expected=raw[:106])
        changed = raw.copy()
        changed[106:] = 999
        second, _ = refinement.ExtraRefinement(models=fake_models(raw=changed)).refine(
            rgba=pixel_fixture(), geometry=geometry_fixture())
        self.assert_bits_equal(actual=second, expected=first)

    def test_separate_affine_roundtrips_cannot_be_dropped_or_collapsed(self):
        raw = np.random.default_rng(71).uniform(20, 120, (240, 2)).astype(np.float32)
        geometry = geometry_fixture()
        geometry["inverse"] = [[0.85, 0.04, 2.125], [-0.02, 1.05, 4.75]]
        geometry["stage2_forward"] = [[1.1, 0.03, 17.25], [-0.07, 0.91, 23.125]]
        forward = np.vstack((np.asarray(geometry["stage2_forward"], np.float32).astype(np.float64), [0, 0, 1]))
        geometry["stage2_inverse"] = np.linalg.inv(forward)[:2].astype(np.float32).tolist()
        stages = [raw[:106].copy()]
        for key in ("inverse", "stage2_forward", "stage2_inverse"):
            stages.append(reference_map(points=stages[-1], matrix=geometry[key]))
        combined = np.eye(3)
        for key in ("inverse", "stage2_forward", "stage2_inverse"):
            matrix = np.vstack((np.asarray(geometry[key], np.float32).astype(np.float64), [0, 0, 1]))
            combined = matrix @ combined
        collapsed = reference_map(points=raw[:106], matrix=combined[:2])
        self.assertTrue(np.any(stages[-1].view(np.uint32) != stages[1].view(np.uint32)))
        self.assertTrue(np.any(stages[-1].view(np.uint32) != collapsed.view(np.uint32)))
        with mock.patch.object(refinement, "map_double", wraps=refinement.map_double) as mapper:
            actual, _ = refinement.ExtraRefinement(models=fake_models(raw=raw)).refine(
                rgba=pixel_fixture(), geometry=geometry)
        self.assertEqual(mapper.call_count, 3)
        for index, (call, key) in enumerate(zip(mapper.call_args_list,
                ("inverse", "stage2_forward", "stage2_inverse"), strict=True)):
            self.assert_bits_equal(actual=call.kwargs["points"], expected=stages[index])
            np.testing.assert_array_equal(call.kwargs["inverse"], np.asarray(geometry[key], np.float32))
        self.assert_bits_equal(actual=actual, expected=stages[-1])

    def test_receipt_binds_fresh_values_and_verify_runs_after_inference(self):
        rgba, geometry, models = pixel_fixture(), geometry_fixture(), fake_models()
        actual, receipt = refinement.ExtraRefinement(models=models).refine(rgba=rgba, geometry=geometry)
        self.assertEqual([call[0] for call in models.method_calls], ["infer", "verify"])
        tensors = dict(algorithm_rgba_sha256=rgba, input_tensor_sha256=models.infer.call_args.kwargs["values"],
                       head_sha256=models.infer.return_value, primary_sha256=actual)
        for key, value in tensors.items():
            self.assertEqual(receipt[key], hashlib.sha256(value.tobytes()).hexdigest())
        encoded = json.dumps(geometry, sort_keys=True, allow_nan=False).encode()
        self.assertEqual(receipt["geometry_sha256"], hashlib.sha256(encoded).hexdigest())
        self.assertEqual(receipt["schema"], "face-live-extra-refinement-v1")
        self.assertEqual(receipt["backend_version"], models.version)
        self.assertEqual(receipt["head_shape"], [240, 2])
        self.assertEqual(receipt["sampling"], "owned-from-algorithm-rgba")
        self.assertEqual(receipt["geometry"], "native-live-extra-transforms-and-mean")
        for key in ("captured_tensor_input_used", "native_final_point_input_used", "product_parity_verified"):
            self.assertIs(receipt[key], False)
        json.dumps(receipt, allow_nan=False)

    def test_infer_or_verify_failure_returns_no_receipt(self):
        for phase in ("infer", "verify"):
            models = fake_models()
            getattr(models, phase).side_effect = RuntimeError(phase + " failed")
            with self.subTest(phase=phase), self.assertRaisesRegex(RuntimeError, phase + " failed"):
                refinement.ExtraRefinement(models=models).refine(rgba=pixel_fixture(), geometry=geometry_fixture())
            if phase == "infer":
                models.verify.assert_not_called()

    def test_caller_geometry_rgba_and_model_output_remain_unchanged(self):
        rgba, geometry = pixel_fixture(), geometry_fixture()
        raw = np.arange(480, dtype=np.float32).reshape(240, 2)
        raw_before, rgba_before, geometry_before = raw.copy(), rgba.copy(), copy.deepcopy(geometry)
        raw.setflags(write=False)
        rgba.setflags(write=False)
        actual, _ = refinement.ExtraRefinement(models=fake_models(raw=raw)).refine(rgba=rgba, geometry=geometry)
        actual[:] = -1
        self.assertEqual(geometry, geometry_before)
        np.testing.assert_array_equal(raw, raw_before)
        np.testing.assert_array_equal(rgba, rgba_before)
        matrices, mean = refinement.validate_geometry(geometry=geometry)
        geometry["inverse"][0][0] = 99
        geometry["primary_mean"][0] = 99
        self.assertEqual(matrices["inverse"][0, 0], 1)
        self.assertEqual(mean[0, 0], 0)


if __name__ == "__main__":
    unittest.main()
