"""Independent dynamic decode gates; synthetic geometry only, no native calls."""
from copy import deepcopy
import unittest
from unittest.mock import patch

import numpy as np

from face_host_geometry_contract_test import geometry_row
import face_host_geometry_sequence_replay as replay


def decoded_fixture():
    row = geometry_row()
    points = np.full((106, 2), 0.234375, np.float32)
    row["faces"][0].update(stage1=points.T.tolist(), tracked=points.T.tolist())
    native = dict(timestamp_us=0, faces=[dict(id=1, points=replay.normalized(points=points, request=row["request"]).tolist())])
    return row, np.zeros((106, 2), np.float32), native


class DecodeTests(unittest.TestCase):
    def test_active_stage_tracked_and_normalized_points_are_exact(self):
        row, raw, native = decoded_fixture()
        before = deepcopy(row)
        case, faces = replay.decode_case(snapshot=row, raw=raw, native_frame=native)
        self.assertEqual(set(case["checks"]), {"stage1", "tracked", "normalized"})
        self.assertTrue(all(check["exact"] for check in case["checks"].values()))
        self.assertEqual(faces, native["faces"])
        self.assertEqual(row, before)

    def test_inactive_inference_and_idle_never_publish_stale_points(self):
        row, raw, _ = decoded_fixture()
        row["faces"][0]["active"] = False
        for value in (raw, None):
            with self.subTest(idle=value is None):
                case, faces = replay.decode_case(snapshot=row, raw=value, native_frame=dict(timestamp_us=0, faces=[]))
                self.assertEqual(faces, [])
                self.assertEqual(case["idle"], value is None)
                self.assertNotIn("normalized", case["checks"])

    def test_active_idle_and_multiple_faces_are_not_guessed(self):
        row, raw, native = decoded_fixture()
        with self.assertRaisesRegex(ValueError, "state reuse"):
            replay.decode_case(snapshot=row, raw=None, native_frame=native)
        row["faces"].append(deepcopy(row["faces"][0]))
        with self.assertRaisesRegex(ValueError, "multi-face"):
            replay.decode_case(snapshot=row, raw=raw, native_frame=native)

    def test_changed_stage_tracked_normalized_and_identity_fail_closed(self):
        for target in ("stage1", "tracked", "normalized", "id", "bool_id", "count"):
            row, raw, native = decoded_fixture()
            if target in ("stage1", "tracked"):
                row["faces"][0][target][0][0] += 0.001
            elif target == "normalized":
                native["faces"][0]["points"][0][0] += 0.001
            elif target in ("id", "bool_id"):
                native["faces"][0]["id"] = True if target == "bool_id" else 2
            else:
                native["faces"] = []
            with self.subTest(target=target), self.assertRaises((ValueError, RuntimeError)):
                replay.decode_case(snapshot=row, raw=raw, native_frame=native)

    def test_recovery_preserves_new_face_id(self):
        row, raw, native = decoded_fixture()
        row["faces"][0]["id"] = 2
        native["faces"][0]["id"] = 2
        _, faces = replay.decode_case(snapshot=row, raw=raw, native_frame=native)
        self.assertEqual(faces[0]["id"], 2)

    def test_diagnostics_preserve_error_without_correcting_or_passing_it(self):
        row, raw, native = decoded_fixture()
        native["faces"][0]["points"][0][0] += 0.001
        case, faces = replay.decode_case(snapshot=row, raw=raw, native_frame=native, require_exact=False)
        self.assertFalse(case["checks"]["normalized"]["within"])
        self.assertNotEqual(faces, native["faces"])
        with self.assertRaisesRegex(RuntimeError, "no fitting"):
            replay.decode_case(snapshot=row, raw=raw, native_frame=native)
        with self.assertRaisesRegex(ValueError, "typed"):
            replay.decode_case(snapshot=row, raw=raw, require_exact=1)


class DynamicContractTests(unittest.TestCase):
    def fixture(self):
        rows = ["QCUT\tREADY\t1", *(f"QCUT\tRESULT\twarmup-{i}\t0" for i in range(6)), "QCUT\tRESULT\tframe-00\t0"]
        runs = [dict(name=name, protocol_rows=rows.copy(), reader_error=None,
                     owned_face_conversions=12, owned_face_restorations=12) for name in ("baseline", "observed")]
        return dict(frames=[{}], geometry_observer_only=True, observer_pixel_parity_verified=True,
                    per_prediction_inference_association_verified=True, warmup_requests_per_host=6,
                    seeks_per_request=2, predictions=14, runs=runs)

    def test_count_is_explicit_not_inferred_from_arbitrary_comparisons(self):
        with patch.object(replay.parity, "validate_capture") as validate:
            evidence = self.fixture()
            self.assertEqual(replay.validate_dynamic(evidence=evidence), 1)
            validate.assert_called_once_with(captured=evidence, expected_comparisons=1)

    def test_wrong_counts_flags_protocol_and_restore_fail(self):
        for target in ("warmup_requests_per_host", "seeks_per_request", "predictions", "geometry_observer_only",
                       "observer_pixel_parity_verified", "per_prediction_inference_association_verified", "frames", "runs"):
            evidence = self.fixture()
            evidence[target] = [] if target in ("frames", "runs") else False
            with self.subTest(target=target), patch.object(replay.parity, "validate_capture"), self.assertRaises(ValueError):
                replay.validate_dynamic(evidence=evidence)
        for target, value in (("protocol_rows", []), ("reader_error", "late failure"),
                              ("owned_face_conversions", 11), ("owned_face_restorations", 11)):
            evidence = self.fixture()
            evidence["runs"][1][target] = value
            with self.subTest(target=target), patch.object(replay.parity, "validate_capture"), self.assertRaises(ValueError):
                replay.validate_dynamic(evidence=evidence)


if __name__ == "__main__":
    unittest.main()
