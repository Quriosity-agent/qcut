"""Original RGBA + explicit geometry dependencies -> owned ordinary Base 106 points.

Detector decisions, private decode tables and reset signals remain caller
inputs. The owned-transform route derives the crop inverse from its rectangle
and tracking matrices from its own 160 seed and 120 history.
An owned Extra106 refinement may replace fresh-photo tracking input between
the seed prediction and the reset prediction; filter history is retained.
"""
import copy
import hashlib

import numpy as np

from algorithm_frame import resize_rgba
from align160_prepare import prepare_bgr
from alignment_decode import decode, normalized
from alignment_infer import Stage1
from alignment_sampling import signed_input
from alignment_temporal import initialize, initialize_base, update, update_base
from alignment_transform import points106, update_transform

FACE_KEYS = {"identity", "mode", "forward", "inverse", "order", "mean", "smoothing", "initialization"}
OWNED_FACE_KEYS = (FACE_KEYS - {"forward", "inverse"}) | {"tracking_smoothing"}


def owned_transform(*, face):
    return isinstance(face, dict) and set(face) == OWNED_FACE_KEYS


def parameters(*, face):
    if not isinstance(face, dict) or set(face) not in (FACE_KEYS, OWNED_FACE_KEYS):
        raise ValueError("explicit geometry fields required; native point/oracle fields prohibited")
    identity = face["identity"]
    if (not isinstance(identity, tuple) or len(identity) != 3
            or any(type(value) is not int or not 0 <= value < 2**53 for value in identity)
            or face["mode"] not in ("seed-160", "reset-120", "update")):
        raise ValueError("typed face identity and explicit lifecycle mode required")
    profile = face["smoothing"]
    if (not isinstance(profile, list) or len(profile) != 2
            or any(not isinstance(row, dict) or set(row) != {"width", "height", "escale", "alpha"} for row in profile)
            or profile[0]["width"] != profile[1]["width"] or profile[0]["height"] != profile[1]["height"]):
        raise ValueError("two explicit compatible Base smoothing parameters required")
    return profile


def tracking_parameters(*, face):
    profile = face["tracking_smoothing"]
    if (not isinstance(profile, dict) or set(profile) != {"width", "height", "escale", "alpha"}
            or any(profile[key] != face["smoothing"][0][key] for key in ("width", "height"))):
        raise ValueError("explicit compatible tracking filter parameters required")
    return profile


class Sequence:
    def __init__(self, *, model_root, models=None):
        self.models = ({size: Stage1(size=size, model=model_root / f"face-align-{size}.onnx") for size in (120, 160)}
                       if models is None else models.copy())
        if set(self.models) != {120, 160}:
            raise ValueError("both alignment models required")
        self.index = -1
        self.state = None
        self.identity = None
        self.profile = None
        self.decode_profile = None
        self.seen = set()
        self.transform = None
        self.tracking_state = None
        self.tracking_points = None
        self.tracking_profile = None

    def tracked_transform(self, *, points, face, initialize_filter):
        profile = tracking_parameters(face=face)
        state = self.tracking_state
        if initialize_filter:
            state = initialize(points=points, **profile)
        if state is None:
            raise ValueError("owned tracking filter initialization required")
        filtered, state = update(state=state, points=points, optimized=False)
        transform, refreshed = update_transform(state=None if initialize_filter else self.transform,
                                                points=filtered, mean=face["mean"])
        return transform, state, filtered, refreshed

    def refine_tracking(self, *, points):
        if self.index != 0 or self.tracking_points is None or self.tracking_state is None:
            raise ValueError('Extra refinement requires fresh owned seed tracking history')
        self.tracking_points = points106(points=points).copy()

    def process(self, *, rgba, size, index, face, discarded_forward=None, discarded_tracking=False):
        if type(index) is not int or index != self.index + 1:
            raise ValueError("contiguous prediction indices required")
        algorithm = resize_rgba(frame=rgba, size=size)
        if type(discarded_tracking) is not bool:
            raise ValueError("typed discarded tracking decision required")
        result = {"algorithm": algorithm, "heads": {}, "tensors": {}, "points": None,
                  "normalized": None, "seed": None, "stage1": None, "tracked": None,
                  "forward": None, "inverse": None, "tracking_filtered": None,
                  "transform_refreshed": None, "owned_tracking_transform": False, "seed_crop": None,
                  "native_seed_inverse_used": False, "tracking_filter_state": None}
        if face is None:
            if discarded_tracking:
                if (discarded_forward is not None or self.transform is None or self.state is None
                        or self.tracking_profile is None or self.decode_profile[0] != size):
                    raise ValueError("rejected tracking requires same-resolution owned history")
                transform, tracking_state, filtered, refreshed = self.tracked_transform(points=self.tracking_points,
                    face=self.tracking_profile, initialize_filter=False)
                discarded_forward = transform.forward
                result.update(forward=transform.forward.copy(), inverse=transform.inverse.copy(),
                              tracking_filtered=filtered, transform_refreshed=refreshed, owned_tracking_transform=True,
                              tracking_filter_state=tracking_state)
            if discarded_forward is not None:
                tensor = signed_input(frame=algorithm, forward=discarded_forward)
                result["tensors"][120] = tensor
                result["heads"][120] = self.models[120].infer(tensor=tensor)
            self.state, self.identity, self.profile, self.decode_profile, self.index = None, None, None, None, index
            self.transform, self.tracking_state, self.tracking_points, self.tracking_profile = None, None, None, None
            return result
        if discarded_forward is not None or discarded_tracking:
            raise ValueError("discarded inference cannot carry an accepted face")
        profile = parameters(face=face)
        mode, identity = face["mode"], face["identity"]
        own_transform = owned_transform(face=face)
        track_profile = tracking_parameters(face=face) if own_transform else None
        if not isinstance(face["order"], np.ndarray) or not isinstance(face["mean"], np.ndarray):
            raise ValueError("typed decode tables required")
        decode_profile = (size, str(face["order"].dtype), face["order"].tobytes(),
                          str(face["mean"].dtype), face["mean"].tobytes(), own_transform)
        if (self.state is not None and (identity != self.identity or profile != self.profile)
                or self.state is not None and decode_profile != self.decode_profile
                or self.state is None and identity in self.seen
                or mode == "update" and self.state is None
                or mode == "seed-160" and self.state is not None
                or own_transform and self.state is not None and track_profile != self.tracking_profile["tracking_smoothing"]):
            raise ValueError("unobserved identity/parameter/initialization transition")
        if mode == "seed-160":
            init = face["initialization"]
            expected_fields = {"call"} if own_transform else {"call", "inverse"}
            if not isinstance(init, dict) or set(init) != expected_fields:
                raise ValueError("explicit detection crop and compatible initialization fields required")
            bgr = np.ascontiguousarray(algorithm[:, :, :3][:, :, ::-1])
            prepared = prepare_bgr(source=bgr, call=init["call"])
            result["seed_crop"] = {"rect": prepared["post_crop_rect"], "resize": prepared["resize"],
                                   "forward": prepared["forward"].copy(), "inverse": prepared["inverse"].copy()}
            result["native_seed_inverse_used"] = "inverse" in init
            result["tensors"][160] = prepared["tensor"]
            heads = self.models[160].infer(tensor=result["tensors"][160])
            result["heads"][160] = heads
            _, result["seed"] = decode(raw=heads["fc_landmark_s1"].reshape(106, 2), order=face["order"],
                                      inverse=init.get("inverse", prepared["inverse"]), size=160)
        elif face["initialization"] is not None:
            raise ValueError("unexpected initialization geometry")
        transform, tracking_state = None, None
        if own_transform:
            previous = result["seed"] if mode == "seed-160" else self.tracking_points
            transform, tracking_state, filtered, refreshed = self.tracked_transform(points=previous,
                face=face, initialize_filter=mode == "seed-160")
            forward, inverse = transform.forward, transform.inverse
            result.update(tracking_filtered=filtered, transform_refreshed=refreshed, owned_tracking_transform=True,
                          tracking_filter_state=tracking_state)
        else:
            forward, inverse = face["forward"], face["inverse"]
        result.update(forward=forward.copy(), inverse=inverse.copy())
        tensor = signed_input(frame=algorithm, forward=forward)
        heads = self.models[120].infer(tensor=tensor)
        result["tensors"][120], result["heads"][120] = tensor, heads
        stage, tracked = decode(raw=heads["fc_landmark_s1"].reshape(106, 2), order=face["order"],
                                inverse=inverse, size=120, mean=face["mean"])
        state = self.state
        if mode in ("seed-160", "reset-120"):
            state = initialize_base(points=result["seed"] if mode == "seed-160" else tracked,
                width=profile[0]["width"], height=profile[0]["height"],
                escales=tuple(row["escale"] for row in profile), alphas=tuple(row["alpha"] for row in profile))
        points = tracked.copy()
        if mode != "reset-120":
            points, state = update_base(state=state, points=tracked, optimized=False)
        result.update(stage1=stage, tracked=tracked, points=points, normalized=normalized(points=points, size=size))
        self.state, self.identity, self.profile, self.index = state, identity, copy.deepcopy(profile), index
        self.decode_profile = decode_profile
        self.transform, self.tracking_state = transform, tracking_state
        self.tracking_points = tracked.copy() if own_transform else None
        self.tracking_profile = copy.deepcopy(face) if own_transform else None
        self.seen.add(identity)
        return result


def describe(*, result):
    return {"algorithm_sha256": hashlib.sha256(result["algorithm"].tobytes()).hexdigest(),
            "tensor_sha256": {str(size): hashlib.sha256(value.tobytes()).hexdigest() for size, value in result["tensors"].items()},
            "head_sha256": {str(size): {name: hashlib.sha256(value.tobytes()).hexdigest() for name, value in heads.items()}
                            for size, heads in result["heads"].items()},
            "native_algorithm_pixels_used": False, "native_point_input_used": False,
            "captured_tensor_input_used": False, "native_geometry_dependencies_required": True,
            "native_tracking_matrices_used": not result["owned_tracking_transform"] and bool(result["heads"]),
            "owned_tracking_transform": result["owned_tracking_transform"],
            "native_seed_inverse_used": result["native_seed_inverse_used"],
            "native_product_parity_verified": False}
