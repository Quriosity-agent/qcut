import copy
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import algorithm_frame as frame
import alignment_decode as decoder
import alignment_infer as inference
import alignment_sampling as sampling
import alignment_sequence as sequence
import alignment_temporal as temporal
from alignment_sequence_run import face_packet


def affine():
    return np.array([[1, 0, 0], [0, 1, 0]], np.float32)


def heads(*, size):
    result = {name: np.ones((1, 1, 1, count), np.float32) for name, count in inference.channels(size=size).items()}
    result["fc_landmark_s1"] = np.linspace(10, 20, 212, dtype=np.float32).reshape(1, 1, 1, 212)
    return result


def face():
    return {"identity": (0, 4096, 0), "mode": "seed-160", "forward": affine(), "inverse": affine(),
            "order": np.arange(106), "mean": np.zeros((106, 2), np.float32),
            "smoothing": [dict(width=32, height=32, escale=10, alpha=.2)] * 2,
            "initialization": {"call": {"format": 0, "orientation": 0, "target": [160, 160],
                "flags": [1, 0, 0], "rect": {"values": [0, 0, 32, 32]}, "expansion": 1.0}, "inverse": affine()}}


def core():
    models = {size: Mock(infer=Mock(return_value=heads(size=size))) for size in (120, 160)}
    with patch.object(sequence, "Stage1", side_effect=lambda **kwargs: models[kwargs["size"]]):
        return sequence.Sequence(model_root=Path("unused"))


class AlgorithmFrameTests(unittest.TestCase):
    def test_identity_is_exact_for_every_channel_and_no_mutation(self):
        pixels = np.random.default_rng(27).integers(0, 256, (37, 51, 4), np.uint8)
        before = pixels.copy()
        np.testing.assert_array_equal(frame.resize_rgba(frame=pixels, size=(51, 37)), pixels)
        np.testing.assert_array_equal(pixels, before)

    def test_constant_singleton_edges_and_channel_independence(self):
        source = np.array([[[7, 91, 209, 23]]], np.uint8)
        resized = frame.resize_rgba(frame=source, size=(31, 19))
        np.testing.assert_array_equal(resized, np.broadcast_to(source, resized.shape))
        source = np.random.default_rng(11).integers(0, 256, (23, 29, 4), np.uint8)
        changed = source.copy()
        changed[:, :, 3] = 0
        np.testing.assert_array_equal(frame.resize_rgba(frame=source, size=(17, 13))[:, :, :3],
                                      frame.resize_rgba(frame=changed, size=(17, 13))[:, :, :3])

    def test_invalid_budget_types_and_sampler_options(self):
        rgba = np.zeros((3, 3, 4), np.uint8)
        for size in ([2, 2], (True, 2), (0, 2), (4097, 2), (2.5, 2)):
            with self.subTest(size=size), self.assertRaises(ValueError):
                frame.resize_rgba(frame=rgba, size=size)
        for bad in (rgba.astype(float), rgba[:, :, :3], rgba[:0]):
            with self.assertRaises(ValueError):
                frame.resize_rgba(frame=bad, size=(2, 2))


class DecodeSamplingTests(unittest.TestCase):
    def test_reorder_is_scatter_and_160_never_adds_mean(self):
        raw = np.arange(212, dtype=np.float32).reshape(106, 2)
        order = np.arange(106)[::-1]
        stage, mapped = decoder.decode(raw=raw, order=order, inverse=affine(), size=160)
        np.testing.assert_array_equal(stage, raw[::-1])
        np.testing.assert_array_equal(mapped, stage)
        with self.assertRaises(ValueError):
            decoder.decode(raw=raw, order=order, inverse=affine(), size=160, mean=raw)
        with self.assertRaises(ValueError):
            decoder.decode(raw=raw, order=np.zeros(106, int), inverse=affine(), size=160)

    def test_120_residual_scale_and_float_precision_survive_decode(self):
        raw = np.full((106, 2), .12345678, np.float32)
        mean = np.full((106, 2), 256, np.float32)
        stage, points = decoder.decode(raw=raw, order=np.arange(106), inverse=affine(), size=120, mean=mean)
        np.testing.assert_array_equal(stage, np.full((106, 2), np.float32(120.12345678), np.float32))
        np.testing.assert_array_equal(points, stage)
        self.assertNotEqual(float(points[0, 0]), round(float(points[0, 0]), 2))
        with self.assertRaises(ValueError):
            decoder.decode(raw=raw, order=np.arange(106), inverse=affine(), size=120)

    def test_mapping_bounds_singular_and_nonfinite_fail(self):
        points = np.full((106, 2), 3, np.float32)
        for matrix in (np.zeros((2, 3), np.float32), affine().astype(float), np.full((2, 3), np.nan, np.float32)):
            with self.assertRaises(ValueError):
                decoder.map_affine(points=points, inverse=matrix)
        with self.assertRaises(ValueError):
            decoder.normalized(points=np.full((106, 2), 200, np.float32), size=(100, 100))

    def test_normalization_flips_y_without_clipping(self):
        points = np.tile(np.array([[25, 30]], np.float32), (106, 1))
        np.testing.assert_array_equal(decoder.normalized(points=points, size=(100, 120)),
                                      np.tile(np.array([[.25, .7500000596046448]], np.float32), (106, 1)))

    def test_affine_sampler_bgr_padding_signed_type_and_negative_rounding(self):
        rgba = np.full((2, 2, 4), [10, 20, 30, 255], np.uint8)
        pixels = sampling.sample_bgr(frame=rgba, forward=affine(), size=(3, 3))
        np.testing.assert_array_equal(pixels[:2, :2], np.tile([30, 20, 10], (2, 2, 1)))
        np.testing.assert_array_equal(pixels[2], np.zeros((3, 3), np.uint8))
        signed = sampling.signed_input(frame=rgba, forward=affine())
        self.assertEqual(signed.dtype, np.int16)
        self.assertEqual(int(signed[0, 2, 2, 0]), -128)
        np.testing.assert_array_equal(sampling.quantize(values=np.array([-.5, .5, 1.5, -1.5], np.float32)), [0, 1, 2, -1])


class TemporalSequenceTests(unittest.TestCase):
    def setUp(self):
        self.rgba = np.full((32, 32, 4), 128, np.uint8)

    def test_seed_then_history_update_and_no_face_clears(self):
        engine = core()
        packet = face()
        first = engine.process(rgba=self.rgba, size=(32, 32), index=0, face=packet)
        self.assertIsNotNone(first["seed"])
        self.assertEqual(set(first["heads"]), {120, 160})
        packet.update(mode="update", initialization=None)
        second = engine.process(rgba=self.rgba, size=(32, 32), index=1, face=packet)
        self.assertEqual(set(second["heads"]), {120})
        cleared = engine.process(rgba=self.rgba, size=(32, 32), index=2, face=None, discarded_forward=affine())
        self.assertIsNone(cleared["points"])
        self.assertEqual(set(cleared["heads"]), {120})
        self.assertIsNone(engine.state)
        packet.update(mode="seed-160", initialization=face()["initialization"])
        with self.assertRaises(ValueError):
            engine.process(rgba=self.rgba, size=(32, 32), index=3, face=packet)
        packet["identity"] = (0, 4096, 1)
        engine.process(rgba=self.rgba, size=(32, 32), index=3, face=packet)

    def test_failed_inference_and_normalization_do_not_commit(self):
        engine = core()
        engine.models[120].infer.side_effect = ValueError("inference failure")
        with self.assertRaises(ValueError):
            engine.process(rgba=self.rgba, size=(32, 32), index=0, face=face())
        self.assertEqual(engine.index, -1)
        self.assertIsNone(engine.state)
        engine.models[120].infer.side_effect = None
        bad = face()
        bad["mean"].fill(32768)
        with self.assertRaises(ValueError):
            engine.process(rgba=self.rgba, size=(32, 32), index=0, face=bad)
        self.assertEqual(engine.index, -1)
        engine.process(rgba=self.rgba, size=(32, 32), index=0, face=face())

    def test_native_oracle_fields_order_and_parameter_changes_are_rejected(self):
        engine = core()
        packet = face()
        packet["current_xy"] = np.zeros((106, 2))
        with self.assertRaises(ValueError):
            engine.process(rgba=self.rgba, size=(32, 32), index=0, face=packet)
        engine.process(rgba=self.rgba, size=(32, 32), index=0, face=face())
        with self.assertRaises(ValueError):
            engine.process(rgba=self.rgba, size=(32, 32), index=0, face=None)
        changed = face()
        changed.update(mode="update", initialization=None)
        changed["smoothing"][0]["alpha"] = .9
        with self.assertRaises(ValueError):
            engine.process(rgba=self.rgba, size=(32, 32), index=1, face=changed)

    def test_parameters_and_history_are_owned_and_readonly(self):
        engine = core()
        packet = face()
        engine.process(rgba=self.rgba, size=(32, 32), index=0, face=packet)
        packet["smoothing"][0]["alpha"] = .9
        self.assertEqual(engine.profile[0]["alpha"], .2)
        self.assertFalse(engine.state.first33.current.flags.writeable)
        with self.assertRaises(ValueError):
            engine.state.first33.current[0] = 0

    def test_decode_tables_and_resolution_cannot_change_inside_history(self):
        engine = core()
        engine.process(rgba=self.rgba, size=(32, 32), index=0, face=face())
        for kind in ("mean", "order", "size"):
            packet = face()
            packet.update(mode="update", initialization=None)
            size = (32, 32)
            if kind == "mean":
                packet["mean"].fill(1)
            if kind == "order":
                packet["order"] = packet["order"][::-1].copy()
            if kind == "size":
                size = (31, 32)
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                engine.process(rgba=self.rgba, size=size, index=1, face=packet)
            self.assertEqual(engine.index, 0)

    def test_zero_scale_bypasses_filter_and_invalid_size_throws(self):
        points = np.ones((106, 2), np.float32)
        state = temporal.initialize_base(points=points, width=32, height=32, escales=(0, 0), alphas=(.2, .2))
        actual, _ = temporal.update_base(state=state, points=points * 2, optimized=False)
        np.testing.assert_array_equal(actual, points * 2)
        with self.assertRaises(ValueError):
            temporal.update_base(state=state, points=points[:105], optimized=False)

    def test_json_face_packet_restores_typed_dependencies_and_rejects_oracles(self):
        packet = face()
        value = {key: val.tolist() if isinstance(val, np.ndarray) else val for key, val in packet.items()}
        value["initialization"] = {"call": packet["initialization"]["call"], "inverse": affine().tolist()}
        restored = face_packet(value=value)
        self.assertEqual(restored["forward"].dtype, np.float32)
        value["points"] = [[0, 0]] * 106
        with self.assertRaises(ValueError):
            face_packet(value=value)


class TrackingInferenceTests(unittest.TestCase):
    def test_tracking_prob_schema_and_fixed_gate_catches_corruption(self):
        values = heads(size=120)
        self.assertEqual(values["prob"].shape[-1], 3)
        checks = inference.compare_heads(actual=values, expected=copy.deepcopy(values), size=120)
        self.assertEqual(sum(row["elements"] for row in checks.values()), 323)
        other = copy.deepcopy(values)
        other["fc_landmark_s1"][0, 0, 0, 2] += .1
        self.assertFalse(inference.compare_heads(actual=other, expected=values, size=120)["fc_landmark_s1"]["passed"])

    def test_tracking_requires_int16_in_signed_byte_range(self):
        engine = inference.Stage1.__new__(inference.Stage1)
        engine.size = 120
        engine.model = Mock()
        engine.channels = inference.channels(size=120)
        for bad in (np.zeros((1, 120, 120, 3), np.int8), np.full((1, 120, 120, 3), -129, np.int16),
                    np.full((1, 120, 120, 3), 128, np.int16), np.zeros((1, 160, 160, 3), np.int16)):
            with self.assertRaises(ValueError):
                engine.infer(tensor=bad)
        engine.model.read_bytes.assert_not_called()


if __name__ == "__main__":
    unittest.main()
