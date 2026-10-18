"""Persistent geometry contracts using synthetic points and owned-reference goldens."""

import dataclasses
import hashlib
import json
import sys
import unittest

import numpy as np

from test_body_composition import synthetic_inputs


def moving_inputs(*, frame, scenario="status"):
    inputs = synthetic_inputs()
    move = np.array(
        [np.sin(frame * 0.14) * 0.025, np.cos(frame * 0.13) * 0.01 - 0.01],
        np.float32,
    )
    for key in ("coords", "faces"):
        inputs[key] = np.float32(inputs[key] + move)
    inputs["rectangles"][:, :2] = np.float32(inputs["rectangles"][:, :2] + move)
    target = 0.35
    if scenario == "status":
        target = (
            0.35 if frame < 15 else 0.7 if frame < 30 else -0.25 if frame < 45 else 0.35
        )
        if 8 <= frame < 15:
            inputs["visibility"][[2, 3, 9, 12]] = 0
        if 18 <= frame < 48:
            inputs["coords"][[2, 5]] = inputs["coords"][[5, 2]]
    return inputs, target


def serialized_state(value):
    if dataclasses.is_dataclass(value):
        return serialized_state(dataclasses.asdict(value))
    if isinstance(value, np.ndarray):
        return {
            "dtype": value.dtype.str,
            "shape": value.shape,
            "hex": value.tobytes().hex(),
        }
    if isinstance(value, np.generic):
        return serialized_state(value.item())
    if isinstance(value, dict):
        return {key: serialized_state(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [serialized_state(item) for item in value]
    if isinstance(value, float):
        return value.hex()
    return value


def update_digest(*, digest, result, engine):
    digest.update(result["positions"].tobytes())
    digest.update(result["status"]["bone_records"].tobytes())
    digest.update(
        json.dumps(serialized_state(result["states"]), sort_keys=True).encode()
    )
    for raw, bounds in (
        (engine.ortho_geometry.last_raw, engine.ortho_geometry.bounds),
        (engine.widen_history.history.raw, engine.widen_history.history.bounds),
    ):
        digest.update(raw.tobytes())
        digest.update(np.asarray(bounds, np.int32).tobytes())


@unittest.skipUnless(
    sys.platform == "darwin", "accepted geometry uses macOS float32 libm"
)
class PersistentComposition(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from body_composition import PersistentCombinedBody

        cls.engine = PersistentCombinedBody

    def test_mode_must_be_an_explicit_integer_profile(self):
        for mode in (-1, 0, 3, True, np.bool_(False), 1.0, "1", None):
            with self.subTest(mode=mode), self.assertRaises(ValueError):
                self.engine(mode=mode)

    def test_cold_zero_controls_are_identity_across_frames(self):
        engine = self.engine()
        for frame in range(5):
            inputs, _ = moving_inputs(frame=frame)
            result = engine.update(**inputs, targets={})
            np.testing.assert_array_equal(result["positions"], result["base"])

    def test_sixty_frame_reference_covers_status_intensity_and_cached_shoulders(self):
        # Frozen from Desktop PersistentCombined on these invented points only.
        expected = "5aabaaba929c270246e42dff5f6d44449c2a6894c63311686e18cc0d89806699"
        engine = self.engine(mode=1)
        digest = hashlib.sha256()
        blocked = swapped = transitions = 0
        for frame in range(60):
            inputs, target = moving_inputs(frame=frame)
            result = engine.update(**inputs, targets=target)
            update_digest(digest=digest, result=result, engine=engine)
            blocked += bool(result["status"]["status48"])
            swapped += bool(result["status"]["status50"])
            transitions += bool(np.any(result["status"]["transition"]))
        self.assertEqual(digest.hexdigest(), expected)
        self.assertGreater(blocked, 0)
        self.assertGreaterEqual(swapped, 12)
        self.assertGreater(transitions, 0)
        self.assertEqual(engine.frame, 60)

    def test_mode_one_refreshes_leg_anchors_and_mode_two_holds_them(self):
        states = {}
        for mode in (1, 2):
            engine = self.engine(mode=mode)
            first = engine.update(**synthetic_inputs(), targets={"LongLeg": 0.35})
            moved = synthetic_inputs()
            moved["coords"][:, 1] -= np.float32(0.02)
            second = engine.update(**moved, targets={"LongLeg": 0.35})
            states[mode] = [
                (result["states"]["LongLeg"].end, result["states"]["LongLeg"].pivot)
                for result in (first, second)
            ]
        self.assertEqual(*states[2])
        self.assertNotEqual(*states[1])

    def test_omitted_active_controls_decay_instead_of_resetting(self):
        engine = self.engine()
        first = engine.update(**synthetic_inputs(), targets={"SmallHead": 0.7})
        second = engine.update(**synthetic_inputs(), targets={"SlimArm": 0.2})
        self.assertGreater(second["states"]["SmallHead"]["intensity"], 0)
        self.assertLess(
            second["states"]["SmallHead"]["intensity"],
            first["states"]["SmallHead"]["intensity"],
        )
        self.assertFalse(np.array_equal(second["positions"], second["base"]))

    def test_no_joints_frame_decays_then_recovers_without_nonfinite_geometry(self):
        engine = self.engine()
        first = engine.update(**synthetic_inputs(), targets=0.35)
        missing = synthetic_inputs()
        missing.update(
            visibility=np.zeros(18, np.uint8), faces=None, rectangles=None, rolls=None
        )
        previous = first["states"]["SmallHead"]["intensity"]
        for _ in range(4):
            result = engine.update(**missing, targets=0.35)
            self.assertTrue(np.isfinite(result["positions"]).all())
            self.assertLess(result["states"]["SmallHead"]["intensity"], previous)
            previous = result["states"]["SmallHead"]["intensity"]
        recovered = engine.update(**synthetic_inputs(), targets=0.35)
        self.assertTrue(np.isfinite(recovered["positions"]).all())
        self.assertGreater(recovered["states"]["SmallHead"]["intensity"], previous)
        self.assertEqual(engine.frame, 6)

    def test_reset_clears_anchors_grids_and_counter_phases(self):
        engine = self.engine(mode=2)
        for frame in range(20):
            inputs, _ = moving_inputs(frame=frame, scenario="motion")
            engine.update(**inputs, targets=0.35)
        self.assertGreater(engine.widen_history.history.counter.value, 0)
        engine.reset()
        self.assertEqual(engine.frame, 0)
        self.assertIsNone(engine.states)
        self.assertEqual(engine.ortho_geometry.counter, 0)
        self.assertEqual(engine.widen_history.history.counter.value, 0)
        actual = engine.update(**synthetic_inputs(), targets=0.35)
        expected = self.engine(mode=2).update(**synthetic_inputs(), targets=0.35)
        np.testing.assert_array_equal(actual["positions"], expected["positions"])
        self.assertEqual(
            serialized_state(actual["states"]), serialized_state(expected["states"])
        )

    def test_size_change_and_bad_inputs_do_not_advance_history(self):
        engine, reference = self.engine(), self.engine()
        for current in (engine, reference):
            current.update(**synthetic_inputs(), targets=0.35)
        for replacement in ({"width": 1080}, {"coords": np.full((18, 2), np.nan)}):
            with self.assertRaises(ValueError):
                engine.update(**{**synthetic_inputs(), **replacement}, targets=0.35)
        with self.assertRaises(ValueError):
            engine.update(**synthetic_inputs(), targets={"unknown": 1})
        self.assertEqual(engine.frame, 1)
        actual = engine.update(**synthetic_inputs(), targets=0.35)
        expected = reference.update(**synthetic_inputs(), targets=0.35)
        np.testing.assert_array_equal(actual["positions"], expected["positions"])
        engine.reset()
        result = engine.update(
            **{**synthetic_inputs(), "width": 1080, "height": 1920}, targets=0.35
        )
        self.assertTrue(np.isfinite(result["positions"]).all())

    def test_interleaved_streams_have_independent_shoulder_counters(self):
        isolated = self.engine()
        for frame in range(20):
            inputs, target = moving_inputs(frame=frame, scenario="motion")
            expected = isolated.update(**inputs, targets=target)
        active, unrelated = self.engine(), self.engine()
        for frame in range(20):
            inputs, target = moving_inputs(frame=frame, scenario="motion")
            unrelated.update(**inputs, targets=0.7)
            actual = active.update(**inputs, targets=target)
        np.testing.assert_array_equal(actual["positions"], expected["positions"])
        np.testing.assert_array_equal(
            active.widen_history.history.raw, isolated.widen_history.history.raw
        )
        self.assertEqual(
            active.widen_history.history.bounds, isolated.widen_history.history.bounds
        )
        self.assertEqual(
            active.widen_history.history.counter.value,
            isolated.widen_history.history.counter.value,
        )

    def test_returned_state_snapshot_cannot_change_following_frame(self):
        engine, reference = self.engine(), self.engine()
        first = engine.update(**synthetic_inputs(), targets=0.35)
        reference.update(**synthetic_inputs(), targets=0.35)
        for part in ("OrthoShoulder", "WidenShoulder", "SmallHead"):
            first["states"][part]["intensity"] = 99
        actual = engine.update(**synthetic_inputs(), targets=0.35)
        expected = reference.update(**synthetic_inputs(), targets=0.35)
        np.testing.assert_array_equal(actual["positions"], expected["positions"])


if __name__ == "__main__":
    unittest.main()
