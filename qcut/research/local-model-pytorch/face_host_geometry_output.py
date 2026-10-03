"""Locate native post-tracking changes without correcting owned predictions."""
from __future__ import annotations

import numpy as np

from face_alignment_replay import point_difference
from face_host_geometry_contract import validate_snapshot
from face_host_geometry_replay import first_points, normalized


def output_layers(*, snapshot, native_frame=None):
    validate_snapshot(row=snapshot)
    returned = snapshot.get("returned_result")
    if returned is None:
        raise ValueError("actual returned result observation required")
    active = [face for face in snapshot["faces"] if face["active"]]
    if len(active) > 1:
        raise ValueError("returned multi-face identity association is unresolved")
    if returned["count"] != len(active):
        raise ValueError("returned and active native face counts disagree")
    result = dict(returned_faces=len(active), tracked_to_returned=[], returned_to_consumer=[])
    if native_frame is not None:
        if (not isinstance(native_frame, dict) or not isinstance(native_frame.get("faces"), list) or
                len(native_frame["faces"]) != len(active)):
            raise ValueError("returned and consumer native face counts disagree")
    for index, face in enumerate(active):
        points = np.asarray(returned["faces"][index]["points_xy"], np.float32).reshape(106, 2)
        result["tracked_to_returned"].append(point_difference(
            actual=first_points(value=face["tracked"]), expected=points, tolerance=0))
        if native_frame is not None:
            reference = native_frame["faces"][index]
            if not isinstance(reference, dict) or type(reference.get("id")) is not int or reference["id"] != face["id"]:
                raise ValueError("returned single-face consumer identity disagrees")
            result["returned_to_consumer"].append(point_difference(
                actual=normalized(points=points, request=snapshot["request"]),
                expected=np.asarray(reference.get("points"), np.float32), tolerance=0))
    result.update(consumer_observed=native_frame is not None,
                  post_tracking_changed=any(not check["exact"] for check in result["tracked_to_returned"]),
                  returned_to_consumer_exact=(all(check["exact"] for check in result["returned_to_consumer"])
                                              if native_frame is not None else None))
    return result
