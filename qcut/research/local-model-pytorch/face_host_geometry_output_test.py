"""Synthetic native output boundaries; returned points never replace owned points."""
from copy import deepcopy
import unittest

import numpy as np

from face_host_geometry_contract_test import geometry_row
import face_host_geometry_output as output


def fixture():
    row = geometry_row()
    points = output.first_points(value=row["faces"][0]["tracked"])
    row["returned_result"] = dict(count=1, faces=[dict(index=0, points_xy=points.reshape(-1).tolist())])
    native = dict(faces=[dict(id=1, points=output.normalized(points=points, request=row["request"]).tolist())])
    return row, native


class OutputTests(unittest.TestCase):
    def test_all_three_layers_match_without_mutation(self):
        row, native = fixture()
        before = deepcopy((row, native))
        result = output.output_layers(snapshot=row, native_frame=native)
        self.assertFalse(result["post_tracking_changed"])
        self.assertTrue(result["returned_to_consumer_exact"])
        self.assertEqual((row, native), before)

    def test_post_tracking_change_is_measured_not_corrected(self):
        row, native = fixture()
        row["returned_result"]["faces"][0]["points_xy"][0] += 0.25
        points = np.asarray(row["returned_result"]["faces"][0]["points_xy"], np.float32).reshape(106, 2)
        native["faces"][0]["points"] = output.normalized(points=points, request=row["request"]).tolist()
        before = deepcopy(row)
        result = output.output_layers(snapshot=row, native_frame=native)
        self.assertTrue(result["post_tracking_changed"])
        self.assertEqual(result["tracked_to_returned"][0]["max_abs"], 0.25)
        self.assertTrue(result["returned_to_consumer_exact"])
        self.assertEqual(row, before)

    def test_consumer_change_is_distinguished_from_post_tracking_change(self):
        row, native = fixture()
        native["faces"][0]["points"][0][0] += 0.01
        result = output.output_layers(snapshot=row, native_frame=native)
        self.assertFalse(result["post_tracking_changed"])
        self.assertFalse(result["returned_to_consumer_exact"])

    def test_absent_consumer_is_not_claimed_exact(self):
        row, _ = fixture()
        result = output.output_layers(snapshot=row)
        self.assertFalse(result["consumer_observed"])
        self.assertIsNone(result["returned_to_consumer_exact"])

    def test_no_face_has_no_stale_point_comparisons(self):
        row, _ = fixture()
        row["faces"][0]["active"] = False
        row["returned_result"] = dict(count=0, faces=[])
        result = output.output_layers(snapshot=row, native_frame=dict(faces=[]))
        self.assertEqual(result["tracked_to_returned"], [])
        self.assertEqual(result["returned_to_consumer"], [])
        self.assertTrue(result["returned_to_consumer_exact"])

    def test_missing_output_count_multiface_and_identity_fail_closed(self):
        for target in ("absent", "count", "multiface", "consumer_count", "identity", "bool_identity", "points"):
            row, native = fixture()
            if target == "absent":
                row.pop("returned_result")
            elif target == "count":
                row["returned_result"] = dict(count=0, faces=[])
            elif target == "multiface":
                row["faces"].append(dict(deepcopy(row["faces"][0]), id=2, slot=1, alignment=73728))
            elif target == "consumer_count":
                native["faces"] = []
            elif target in ("identity", "bool_identity"):
                native["faces"][0]["id"] = True if target == "bool_identity" else 2
            else:
                native["faces"][0]["points"] = [[0.0, 0.0]]
            with self.subTest(target=target), self.assertRaises(ValueError):
                output.output_layers(snapshot=row, native_frame=native)


if __name__ == "__main__":
    unittest.main()
