"""Owned-history transitions and fail-closed reference checks, synthetic only."""
from copy import deepcopy
import unittest

import numpy as np

from face_host_geometry_contract_test import geometry_row
import face_temporal_smoothing as math
import face_temporal_smoothing_replay as replay


def observed(*, index, points, state, identity=1):
    row = geometry_row(index=index)
    row["runtime_state"] = dict(base_output_mode_bit=False, optimized_output_bit=False,
                               config_cache_mode=0, cache_skip_bit=True, cache_counter=0)
    face = row["faces"][0]
    face.update(id=identity, stage1=points.T.tolist(), tracked=points.T.tolist(), smoothing=[])
    for part in (state.first33, state.last73):
        face["smoothing"].append(dict(count=len(part.current), first=part.first,
            alpha=float(part.alpha), scale=float(part.scale), escale=10, width=480, height=640,
            current_xy=part.current.reshape(-1).tolist(), previous_xy=part.previous.reshape(-1).tolist(),
            delta_x=part.delta[:, 0].tolist(), delta_y=part.delta[:, 1].tolist()))
    return row


def initialized(*, points):
    return math.initialize_base(points=points, width=480, height=640,
                                escales=(10, 10), alphas=(0.2, 0.2))


class ReplayTests(unittest.TestCase):
    def test_native_seed_then_owned_history_never_copies_reference_output(self):
        owner = replay.TemporalReplay()
        state = initialized(points=np.zeros((106, 2), np.float32))
        for index in range(4):
            points = np.full((106, 2), index + 1, np.float32)
            expected, state = math.update_base(state=state, points=points, optimized=False)
            row = observed(index=index, points=points, state=state)
            before = deepcopy(row)
            result, evidence = owner.apply(snapshot=row, points=points)
            np.testing.assert_array_equal(result, expected)
            self.assertEqual(row, before)
            self.assertEqual(evidence["native_seed_used"], index == 0)
            self.assertEqual(evidence["mode"], "native-initialization-seed" if index == 0 else "owned-history-update")

    def test_first_signal_initializes_from_owned_raw_points(self):
        owner = replay.TemporalReplay()
        points = np.ones((106, 2), np.float32)
        result, evidence = owner.apply(snapshot=observed(index=0, points=points, state=initialized(points=points)), points=points)
        self.assertEqual(evidence["mode"], "owned-input-initialization")
        self.assertFalse(evidence["native_seed_used"])
        np.testing.assert_array_equal(result, points)
        points[:] = 2
        self.assertTrue((owner.state.first33.current == 1).all())

    def test_changed_reference_fails_without_advancing_or_fitting(self):
        points = np.ones((106, 2), np.float32)
        for field in ("current_xy", "delta_x", "previous_xy"):
            owner = replay.TemporalReplay()
            state = initialized(points=points)
            owner.apply(snapshot=observed(index=0, points=points, state=state), points=points)
            expected, state = math.update_base(state=state, points=points * 2, optimized=False)
            row = observed(index=1, points=points * 2, state=state)
            row["faces"][0]["smoothing"][0][field][0] += 0.01
            with self.subTest(field=field), self.assertRaisesRegex(RuntimeError, "no reference correction"):
                owner.apply(snapshot=row, points=points * 2)
            self.assertEqual(owner.index, 0)
            self.assertTrue((owner.state.first33.current == 1).all())
            self.assertFalse(np.array_equal(expected, points * 2))

    def test_no_face_resets_history_and_new_id_requires_native_seed(self):
        owner = replay.TemporalReplay()
        points = np.ones((106, 2), np.float32)
        owner.apply(snapshot=observed(index=0, points=points, state=initialized(points=points)), points=points)
        row = observed(index=1, points=points, state=initialized(points=points))
        row["faces"][0]["active"] = False
        result, evidence = owner.apply(snapshot=row, points=None)
        self.assertIsNone(result)
        self.assertEqual(evidence["mode"], "no-face")
        self.assertIsNone(owner.state)
        result, state = math.update_base(state=initialized(points=points), points=points * 2, optimized=False)
        _, evidence = owner.apply(snapshot=observed(index=2, points=points * 2, state=state, identity=2), points=points * 2)
        self.assertTrue(evidence["native_seed_used"])

    def test_reactivated_id_or_live_id_change_is_not_guessed(self):
        points = np.ones((106, 2), np.float32)
        for gone in (False, True):
            owner = replay.TemporalReplay()
            owner.apply(snapshot=observed(index=0, points=points, state=initialized(points=points)), points=points)
            if gone:
                row = observed(index=1, points=points, state=initialized(points=points))
                row["faces"][0]["active"] = False
                owner.apply(snapshot=row, points=None)
            row = observed(index=2 if gone else 1, points=points, state=initialized(points=points), identity=1 if gone else 2)
            with self.subTest(gone=gone), self.assertRaises(ValueError):
                owner.apply(snapshot=row, points=points)

    def test_wrong_route_partial_initialization_or_scale_is_rejected(self):
        points = np.ones((106, 2), np.float32)
        for variant in ("extra", "optimized", "cached", "partial", "scale", "missing", "gap"):
            row = observed(index=0, points=points, state=initialized(points=points))
            if variant in ("extra", "optimized", "cached"):
                key = {"extra": "base_output_mode_bit", "optimized": "optimized_output_bit", "cached": "config_cache_mode"}[variant]
                row["runtime_state"][key] = 1 if variant == "cached" else True
            elif variant == "partial":
                row["faces"][0]["smoothing"][0].update(first=False, delta_x=[0] * 33, delta_y=[0] * 33)
            elif variant == "scale":
                row["faces"][0]["smoothing"][0]["scale"] += 1
            elif variant == "missing":
                row["faces"][0].pop("smoothing")
            else:
                row["index"] = 1
            with self.subTest(variant=variant), self.assertRaises(ValueError):
                replay.TemporalReplay().apply(snapshot=row, points=points)

    def test_profile_changes_and_bad_owned_inputs_fail_closed(self):
        points = np.ones((106, 2), np.float32)
        owner = replay.TemporalReplay()
        owner.apply(snapshot=observed(index=0, points=points, state=initialized(points=points)), points=points)
        row = observed(index=1, points=points, state=initialized(points=points))
        row["faces"][0]["smoothing"][0]["alpha"] = 0.3
        with self.assertRaisesRegex(ValueError, "parameter transition"):
            owner.apply(snapshot=row, points=points)
        row = observed(index=0, points=points, state=initialized(points=points))
        for value in (None, points.astype(np.float64), points[:33], [[0, 0]] * 106):
            with self.subTest(value=type(value).__name__), self.assertRaises(ValueError):
                replay.TemporalReplay().apply(snapshot=row, points=value)


if __name__ == "__main__":
    unittest.main()
