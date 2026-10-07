from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import alignment_assets as assets
import alignment_transform as transform
from alignment_sequence import OWNED_FACE_KEYS
from alignment_sequence_run import face_packet
from test_alignment_chain import core, face, heads


def seed():
    points = np.random.default_rng(460).uniform(1, 150, (106, 2)).astype(np.float32)
    points[[55, 58]] = [0, 0]
    points[[84, 90]] = [100, 0]
    return points


def owned_face():
    packet = face()
    packet.pop("forward")
    packet.pop("inverse")
    packet["initialization"].pop("inverse")
    packet["mean"] = heads(size=160)["fc_landmark_s1"].reshape(106, 2) / np.float32(120) * np.float32(256)
    packet["tracking_smoothing"] = dict(width=32, height=32, escale=3, alpha=.2)
    return packet


def owned_core():
    engine = core()
    engine.models[120].infer.return_value["fc_landmark_s1"].fill(0)
    return engine


class TransformTests(unittest.TestCase):
    def test_similarity_rotation_scale_translation_and_all_points_contribute(self):
        source = seed()
        linear = np.array([[.8, -.3], [.3, .8]], np.float64)
        target = (source.astype(np.float64) @ linear.T + [20, -11]).astype(np.float32)
        forward, inverse = transform.fit(source=source, target=target)
        np.testing.assert_allclose(forward, np.c_[linear, [20, -11]], atol=8e-5, rtol=0)
        homogeneous = np.vstack((forward, [0, 0, 1]))
        np.testing.assert_allclose(inverse, np.linalg.inv(homogeneous)[:2], atol=8e-5, rtol=0)
        changed = target.copy()
        changed[105] += [30, -20]
        other, _ = transform.fit(source=source, target=changed)
        self.assertFalse(np.array_equal(forward, other))

    def test_gate_nextafter_threshold_nonanchors_pair_cancel_and_tiny_span(self):
        cached = seed()
        for amount, expected in ((0, False), (4, False), (np.nextafter(np.float32(5), np.float32(0)), False),
                                 (5, True), (np.nextafter(np.float32(5), np.float32(10)), True), (-5, True)):
            points = cached + np.array([0, amount], np.float32)
            self.assertEqual(transform.needs_refresh(points=points, cached=cached), expected)
        changed = cached.copy()
        changed[105] += [100, 0]
        self.assertFalse(transform.needs_refresh(points=changed, cached=cached))
        changed = cached.copy()
        changed[55, 1], changed[58, 1] = 24, -24
        self.assertFalse(transform.needs_refresh(points=changed, cached=cached))
        self.assertTrue(transform.needs_refresh(points=cached, cached=None))
        tiny = cached.copy()
        tiny[[84, 90]] = [0, 0]
        self.assertTrue(transform.needs_refresh(points=tiny, cached=tiny))

    def test_fit_cache_remains_at_last_fit_and_owns_inputs(self):
        points = seed()
        mean = points.copy()
        state, refreshed = transform.update_transform(state=None, points=points, mean=mean)
        self.assertTrue(refreshed)
        before = state.source.copy()
        moved = points + np.array([0, 4], np.float32)
        second, refreshed = transform.update_transform(state=state, points=moved, mean=mean)
        self.assertFalse(refreshed)
        self.assertIs(second, state)
        moved = points + np.array([0, 6], np.float32)
        third, refreshed = transform.update_transform(state=state, points=moved, mean=mean)
        self.assertTrue(refreshed)
        points.fill(0)
        np.testing.assert_array_equal(state.source, before)
        self.assertFalse(third.source.flags.writeable)
        with self.assertRaises(ValueError):
            transform.update_transform(state=third, points=moved, mean=mean + 1)

    def test_degenerate_nonfinite_wrong_type_range_and_threshold_rejected(self):
        points = seed()
        for bad in (points.astype(float), points[:105], points * np.nan, points * np.float32(1e6)):
            with self.assertRaises(ValueError):
                transform.fit(source=bad, target=points)
        with self.assertRaises(ValueError):
            transform.fit(source=np.ones((106, 2), np.float32), target=points)
        with self.assertRaises(ValueError):
            transform.fit(source=points, target=np.ones((106, 2), np.float32))
        for value in (True, -1, 1.1, float("nan"), "0.1"):
            with self.assertRaises(ValueError):
                transform.needs_refresh(points=points, cached=None, threshold=value)
        with self.assertRaises(ValueError):
            transform.target_points(mean=points * np.float32(-1))

    def test_double_inverse_differs_from_sampling_rounding(self):
        from alignment_sampling import inverse_forward
        forward = np.random.default_rng(59).uniform(.01, 2, (2, 3)).astype(np.float32)
        mapped = transform.inverse_mapping(forward=forward)
        self.assertFalse(np.array_equal(mapped, inverse_forward(forward=forward)))
        expected = np.linalg.inv(np.vstack((forward.astype(np.float64), [0, 0, 1])))[:2]
        np.testing.assert_allclose(mapped, expected, atol=3e-5, rtol=0)


class OwnedSequenceTests(unittest.TestCase):
    def setUp(self):
        self.pixels = np.full((32, 32, 4), 128, np.uint8)

    def test_no_matrix_packet_then_reset_output_and_discard_inference(self):
        engine, packet = owned_core(), owned_face()
        self.assertEqual(set(packet), OWNED_FACE_KEYS)
        first = engine.process(rgba=self.pixels, size=(32, 32), index=0, face=packet)
        self.assertTrue(first["owned_tracking_transform"])
        self.assertTrue(first["transform_refreshed"])
        packet.update(mode="reset-120", initialization=None)
        engine.process(rgba=self.pixels, size=(32, 32), index=1, face=packet)
        self.assertTrue(engine.state.first33.first)
        self.assertFalse(engine.tracking_state.first)
        discarded = engine.process(rgba=self.pixels, size=(32, 32), index=2, face=None, discarded_tracking=True)
        self.assertIsNone(discarded["points"])
        self.assertEqual(set(discarded["heads"]), {120})
        self.assertTrue(discarded["owned_tracking_transform"])
        self.assertIsNone(engine.transform)
        self.assertIsNone(engine.tracking_points)
        with self.assertRaises(ValueError):
            engine.process(rgba=self.pixels, size=(32, 32), index=3, face=None, discarded_tracking=True)

    def test_failed_update_is_transactional_and_retry_uses_original_history(self):
        engine, packet = owned_core(), owned_face()
        engine.process(rgba=self.pixels, size=(32, 32), index=0, face=packet)
        state, matrix, points = engine.tracking_state, engine.transform, engine.tracking_points.copy()
        packet.update(mode="update", initialization=None)
        engine.models[120].infer.side_effect = ValueError("failure")
        with self.assertRaises(ValueError):
            engine.process(rgba=self.pixels, size=(32, 32), index=1, face=packet)
        self.assertIs(engine.tracking_state, state)
        self.assertIs(engine.transform, matrix)
        np.testing.assert_array_equal(engine.tracking_points, points)
        self.assertEqual(engine.index, 0)
        engine.models[120].infer.side_effect = None
        engine.process(rgba=self.pixels, size=(32, 32), index=1, face=packet)

    def test_owned_and_explicit_modes_cannot_mix_and_profiles_cannot_change(self):
        for change in ("explicit", "tracking", "resolution"):
            engine, packet = owned_core(), owned_face()
            engine.process(rgba=self.pixels, size=(32, 32), index=0, face=packet)
            packet.update(mode="update", initialization=None)
            if change == "explicit":
                packet.pop("tracking_smoothing")
                packet.update(forward=np.array([[1, 0, 0], [0, 1, 0]], np.float32), inverse=np.array([[1, 0, 0], [0, 1, 0]], np.float32))
            if change == "tracking":
                packet["tracking_smoothing"]["alpha"] = .9
            with self.assertRaises(ValueError):
                engine.process(rgba=self.pixels, size=(31, 32) if change == "resolution" else (32, 32), index=1, face=packet)
        bad = owned_face()
        bad["forward"] = np.zeros((2, 3), np.float32)
        with self.assertRaises(ValueError):
            owned_core().process(rgba=self.pixels, size=(32, 32), index=0, face=bad)

    def test_owned_seed_crop_has_no_inverse_and_manifest_parser_preserves_it(self):
        packet = owned_face()
        packet["mean"] *= np.float32(4)
        result = owned_core().process(rgba=self.pixels, size=(32, 32), index=0, face=packet)
        self.assertFalse(result["native_seed_inverse_used"])
        self.assertIsNotNone(result["seed_crop"])
        self.assertEqual(result["seed_crop"]["inverse"].shape, (2, 3))
        self.assertEqual(result["seed_crop"]["forward"].dtype, np.float32)
        serialized = {**packet, "order": packet["order"].tolist(), "mean": packet["mean"].tolist()}
        parsed = face_packet(value=serialized)
        self.assertEqual(set(parsed), OWNED_FACE_KEYS)
        self.assertEqual(set(parsed["initialization"]), {"call"})

    def test_owned_seed_rejects_captured_inverse_before_any_inference(self):
        engine, packet = owned_core(), owned_face()
        packet["initialization"]["inverse"] = np.array([[1, 0, 0], [0, 1, 0]], np.float32)
        with self.assertRaises(ValueError):
            engine.process(rgba=self.pixels, size=(32, 32), index=0, face=packet)
        engine.models[160].infer.assert_not_called()
        engine.models[120].infer.assert_not_called()
        self.assertEqual(engine.index, -1)

    def test_tracking_profile_is_copied_and_failure_after_decode_does_not_commit(self):
        engine, packet = owned_core(), owned_face()
        engine.process(rgba=self.pixels, size=(32, 32), index=0, face=packet)
        packet["tracking_smoothing"]["alpha"] = .9
        self.assertEqual(engine.tracking_profile["tracking_smoothing"]["alpha"], .2)
        packet = owned_face()
        packet.update(mode="update", initialization=None)
        with patch("alignment_sequence.normalized", side_effect=ValueError("out of bounds")), self.assertRaises(ValueError):
            engine.process(rgba=self.pixels, size=(32, 32), index=1, face=packet)
        self.assertEqual(engine.index, 0)


class AssetTests(unittest.TestCase):
    def test_private_asset_content_and_provenance_are_checked(self):
        values = {"order": np.arange(106, dtype=np.int32), "mean": seed(), "lens_sha256": np.asarray(assets.LENS_SHA256)}
        digest = assets.validate(values=values)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "tables.npz"
            np.savez(path, **values)
            with patch.object(assets, "CONTENT_SHA256", digest):
                loaded = assets.load_assets(path=path)
                self.assertFalse(loaded["mean"].flags.writeable)
                values["mean"][0, 0] += 1
                np.savez(path, **values)
                with self.assertRaises(ValueError):
                    assets.load_assets(path=path)
            values["lens_sha256"] = np.asarray("0" * 64)
            with self.assertRaises(ValueError):
                assets.validate(values=values)


if __name__ == "__main__":
    unittest.main()
