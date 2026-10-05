"""Owned Extra-160 sampling/head/primary mapping with explicit native geometry.

Only the measured ordinary Extra mode is accepted. Geometry includes the native
inner-filter-derived crop; no native coordinates, sampled tensor or result is an
input. Temporal acceptance and the remaining native dependencies stay unchanged.
"""
import hashlib
import json

import numpy as np

from face_alignment_sampling import signed_input, inverse_forward
from face_host_geometry_replay import map_double
from face_live_candidate_contract import array, fields

PROFILE = dict(extra_mode=1, smooth_type=0, optimized=False, secondary_warp=False, suppressed=False)


def validate_geometry(*, geometry):
    fields(value=geometry, names=("schema", "profile", "forward", "inverse",
                                  "stage2_forward", "stage2_inverse", "primary_mean"))
    if geometry["schema"] != "face-live-extra-geometry-v1":
        raise ValueError("explicit Extra geometry schema required")
    fields(value=geometry["profile"], names=PROFILE)
    if any(type(geometry["profile"][key]) is not type(value) or geometry["profile"][key] != value
           for key, value in PROFILE.items()):
        raise ValueError("unsupported Extra refinement profile")
    matrices = {key: array(value=geometry[key], shape=(2, 3))
                for key in ("forward", "inverse", "stage2_forward", "stage2_inverse")}
    for matrix in matrices.values():
        inverse_forward(forward=matrix)
    mean = array(value=geometry["primary_mean"], shape=(212,)).reshape(106, 2)
    return matrices, mean


class ExtraRefinement:
    def __init__(self, *, models):
        self.models = models

    def refine(self, *, rgba, geometry):
        matrices, mean = validate_geometry(geometry=geometry)
        values = signed_input(frame=rgba, forward=matrices["forward"], size=(160, 160))
        raw = self.models.infer(values=values)
        if (type(raw) is not np.ndarray or raw.dtype != np.float32 or raw.shape != (240, 2)
                or not np.isfinite(raw).all()):
            raise ValueError("fresh finite Extra 240-pair head required")
        decoded = (raw[:106].astype(np.float64) + mean.astype(np.float64) / 256 * 160).astype(np.float32)
        primary = map_double(points=decoded, inverse=matrices["inverse"])
        # Both rounded intermediate matrices are observable; collapsing the affine changes bits.
        primary = map_double(points=primary, inverse=matrices["stage2_forward"])
        primary = map_double(points=primary, inverse=matrices["stage2_inverse"])
        self.models.verify()
        receipt = dict(schema="face-live-extra-refinement-v1", backend_version=self.models.version,
            geometry_sha256=hashlib.sha256(json.dumps(geometry, sort_keys=True, allow_nan=False).encode()).hexdigest(),
            algorithm_rgba_sha256=hashlib.sha256(rgba.tobytes()).hexdigest(),
            input_tensor_sha256=hashlib.sha256(values.tobytes()).hexdigest(),
            head_sha256=hashlib.sha256(raw.tobytes()).hexdigest(), primary_sha256=hashlib.sha256(primary.tobytes()).hexdigest(),
            head_shape=[240, 2], sampling="owned-from-algorithm-rgba", geometry="native-live-extra-transforms-and-mean",
            captured_tensor_input_used=False, native_final_point_input_used=False, product_parity_verified=False)
        return primary, receipt
