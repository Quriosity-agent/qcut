"""Owned 160 seed decode, negative baseline and no-reference-correction controls."""
from copy import deepcopy
import unittest

import numpy as np

from face_host_geometry_smoothing_test import states
from face_host_geometry_contract_test import geometry_row
from face_temporal_smoothing_replay_test import initialized, observed
import face_host_initialization as initialization
import face_temporal_smoothing as math
import face_temporal_smoothing_replay as replay


def fixture():
    raw = np.arange(212, dtype=np.float32).reshape(106, 2) / np.float32(4)
    row = geometry_row()
    face = row["faces"][0]
    face["detection_inverse"] = [[1.5, 0, 10], [0, 1.5, 20]]
    face["smoothing"] = states()
    expected = (raw.astype(np.float64) * 1.5 + [10, 20]).astype(np.float32)
    for state, part in zip(face["smoothing"], (expected[:33], expected[33:]), strict=True):
        state["previous_xy"] = part.reshape(-1).tolist()
    return raw, row, expected


class InitializationTests(unittest.TestCase):
    def test_absolute_detection_coordinates_not_residual_mean_addition(self):
        raw, row, expected = fixture()
        before = deepcopy(row)
        seed, proof = initialization.decode_seed(raw=raw, snapshot=row)
        np.testing.assert_array_equal(seed, expected)
        self.assertTrue(proof["check"]["exact"])
        self.assertFalse(proof["native_point_seed_used"])
        self.assertTrue(proof["native_detection_geometry_required"])
        self.assertEqual(row, before)
        row["tables"]["base"] = [2.5] * 212
        repeated, _ = initialization.decode_seed(raw=raw, snapshot=row)
        np.testing.assert_array_equal(seed, repeated)

    def test_scatter_order_precedes_backmap(self):
        raw, row, _ = fixture()
        row["tables"]["order"] = list(range(105, -1, -1))
        expected = (raw[::-1].astype(np.float64) * 1.5 + [10, 20]).astype(np.float32)
        for state, part in zip(row["faces"][0]["smoothing"], (expected[:33], expected[33:]), strict=True):
            state["previous_xy"] = part.reshape(-1).tolist()
        seed, _ = initialization.decode_seed(raw=raw, snapshot=row)
        np.testing.assert_array_equal(seed, expected)

    def test_changed_native_reference_is_not_used_to_correct_candidate(self):
        raw, row, _ = fixture()
        row["faces"][0]["smoothing"][0]["previous_xy"][0] += 0.1
        with self.assertRaisesRegex(RuntimeError, "no native seed correction"):
            initialization.decode_seed(raw=raw, snapshot=row)

    def test_invalid_raw_matrices_and_ambiguous_faces_reject(self):
        raw, row, _ = fixture()
        for value in (None, raw.astype(np.float64), raw[:33], np.full((106, 2), np.nan, np.float32),
                      np.full((106, 2), 32769, np.float32)):
            with self.subTest(value=type(value).__name__), self.assertRaises(ValueError):
                initialization.decode_seed(raw=value, snapshot=row)
        for variant in ("absent", "multi", "first", "history", "singular"):
            _, row, _ = fixture()
            if variant == "absent":
                row["faces"][0]["active"] = False
            elif variant == "multi":
                row["faces"].append(dict(deepcopy(row["faces"][0]), slot=1, alignment=69632, id=2))
            elif variant == "first":
                row["faces"][0]["smoothing"][0]["first"] = True
            elif variant == "history":
                row["faces"][0]["smoothing"][0]["previous_xy"] = []
            else:
                row["faces"][0]["detection_inverse"] = [[0, 0, 0], [0, 0, 0]]
            with self.subTest(variant=variant), self.assertRaises(ValueError):
                initialization.decode_seed(raw=raw, snapshot=row)


class OwnedSeedReplayTests(unittest.TestCase):
    def test_owned_seed_updates_then_continues_without_reusing_native_seed(self):
        points = np.ones((106, 2), np.float32)
        seed = np.zeros_like(points)
        state = initialized(points=seed)
        owner = replay.TemporalReplay(owned_initialization=True)
        for index in range(3):
            expected, state = math.update_base(state=state, points=points * (index + 1), optimized=False)
            row = observed(index=index, points=points, state=state)
            result, evidence = owner.apply(snapshot=row, points=points * (index + 1),
                                           initialization_seed=seed if index == 0 else None)
            np.testing.assert_array_equal(result, expected)
            self.assertFalse(evidence["native_seed_used"])
            self.assertEqual(evidence["owned_seed_used"], index == 0)

    def test_missing_owned_seed_never_falls_back_to_native(self):
        points = np.ones((106, 2), np.float32)
        _, state = math.update_base(state=initialized(points=points * 0), points=points, optimized=False)
        row = observed(index=0, points=points, state=state)
        owner = replay.TemporalReplay(owned_initialization=True)
        with self.assertRaisesRegex(ValueError, "fallback forbidden"):
            owner.apply(snapshot=row, points=points)
        self.assertEqual(owner.index, -1)

    def test_wrong_seed_and_undeclared_seed_fail_without_state_advance(self):
        points = np.ones((106, 2), np.float32)
        _, state = math.update_base(state=initialized(points=points * 0), points=points, optimized=False)
        row = observed(index=0, points=points, state=state)
        for mode, value in ((True, points), (True, points.astype(np.float64)), (False, points * 0)):
            owner = replay.TemporalReplay(owned_initialization=mode)
            with self.subTest(mode=mode), self.assertRaises((ValueError, RuntimeError)):
                owner.apply(snapshot=row, points=points, initialization_seed=value)
            self.assertEqual(owner.index, -1)

    def test_policy_types_and_seed_outside_initialization_reject(self):
        for value in (0, 1, None, "true"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                replay.TemporalReplay(owned_initialization=value)
        points = np.ones((106, 2), np.float32)
        row = observed(index=0, points=points, state=initialized(points=points))
        with self.assertRaisesRegex(ValueError, "unexpected"):
            replay.TemporalReplay(owned_initialization=True).apply(snapshot=row, points=points, initialization_seed=points)


if __name__ == "__main__":
    unittest.main()
