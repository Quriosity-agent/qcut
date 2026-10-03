"""Dependency-only contract for an unconnected, single-face research core.

One packet represents one internal prediction, including setup/repeated seeks.
The host must bind algorithm RGBA, geometry and routing to that prediction.
This module cannot attest that caller-supplied data came from a live callback.
No tensors, native point vectors, replay files or native filter history enter.
"""
from __future__ import annotations

import copy
import hashlib

import numpy as np

from face_alignment_replay import valid_hash
from face_alignment_sampling import inverse_forward
from face_host_geometry_replay import map_double
from face_temporal_smoothing import initialize_base

SCHEMA = "face-live-candidate-dependencies-v1"
ROUTE = dict(config_cache_mode=0, optimized_output_bit=False, cache_counter=0,
             cache_skip_bit=True, base_output_mode_bit=False)
NATIVE_DEPENDENCIES = (
    "full-frame-to-algorithm-rgba", "detection", "tracking-geometry-and-tables",
    "identity-acceptance-reset-and-filter-parameters", "effect-rendering",
)


def fields(*, value, names):
    if type(value) is not dict or set(value) != set(names):
        raise ValueError(f"exact dependency fields required: {', '.join(sorted(names))}")


def integer(*, value, minimum=0, maximum=2**53 - 1):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError("bounded typed integer required")


def scalar(*, value, maximum):
    if type(value) not in (int, float) or not np.isfinite(value) or not 0 <= value <= maximum:
        raise ValueError("finite nonnegative numeric dependency required")


def array(*, value, shape):
    def numeric(*, item):
        if type(item) is list:
            return bool(item) and all(numeric(item=child) for child in item)
        return type(item) in (int, float) and np.isfinite(item) and abs(item) <= 32768

    if type(value) is not list or not numeric(item=value):
        raise ValueError("bounded numeric array required")
    result = np.asarray(value, np.float32)
    if result.shape != shape:
        raise ValueError(f"dependency array shape must be {shape}")
    return result


def smoothing_state(*, points, parameters):
    return initialize_base(points=points, width=parameters[0]["width"],
                           height=parameters[0]["height"],
                           escales=tuple(row["escale"] for row in parameters),
                           alphas=tuple(row["alpha"] for row in parameters))


def validate_face(*, face, width, height):
    fields(value=face, names=("id", "slot", "alignment", "mode", "forward", "inverse",
                             "tables", "smoothing", "initialization"))
    integer(value=face["id"], maximum=2**31 - 1)
    integer(value=face["slot"], maximum=9)
    integer(value=face["alignment"], minimum=1)
    if face["mode"] not in ("seed-160", "reset-120", "update"):
        raise ValueError("explicit native seed-160/reset-120/update signal required")
    inverse_forward(forward=array(value=face["forward"], shape=(2, 3)))
    zero = np.zeros((106, 2), np.float32)
    map_double(points=zero, inverse=array(value=face["inverse"], shape=(2, 3)))
    tables = face["tables"]
    fields(value=tables, names=("base", "order"))
    array(value=tables["base"], shape=(212,))
    order = tables["order"]
    if (type(order) is not list or len(order) != 106 or
            any(type(item) is not int for item in order) or sorted(order) != list(range(106))):
        raise ValueError("106-point destination permutation required")
    parameters = face["smoothing"]
    if type(parameters) is not list or len(parameters) != 2:
        raise ValueError("two native 33/73 filter parameter records required")
    for row in parameters:
        fields(value=row, names=("alpha", "escale", "scale", "width", "height"))
        scalar(value=row["alpha"], maximum=1)
        scalar(value=row["escale"], maximum=32768)
        scalar(value=row["scale"], maximum=2**20)
        integer(value=row["width"], minimum=1, maximum=4096)
        integer(value=row["height"], minimum=1, maximum=4096)
        if [row["width"], row["height"]] != [height, width]:
            raise ValueError("only observed swapped filter dimensions are supported")
    state = smoothing_state(points=zero, parameters=parameters)
    if any(part.scale != np.float32(row["scale"]) for part, row in
           zip((state.first33, state.last73), parameters, strict=True)):
        raise ValueError("native filter scale differs from owned formula")
    initialization = face["initialization"]
    if face["mode"] != "seed-160":
        if initialization is not None:
            raise ValueError("160 seed only allowed on explicit initialization")
        return
    fields(value=initialization, names=("call", "detection_inverse"))
    map_double(points=zero, inverse=array(value=initialization["detection_inverse"], shape=(2, 3)))
    call = initialization["call"]
    fields(value=call, names=("format", "orientation", "target", "flags", "rect", "expansion"))
    fields(value=call["rect"], names=("values",))
    array(value=call["rect"]["values"], shape=(4,))
    # prepare() enforces the observed crop/resize flags and dimensions.


def validate_metadata(*, packet):
    fields(value=packet, names=("schema", "source_key", "frame_number", "timestamp_us", "prediction",
                               "width", "height", "stride", "format", "orientation",
                               "rgba_sha256", "runtime_state", "face"))
    packet = copy.deepcopy(packet)
    if packet["schema"] != SCHEMA:
        raise ValueError("unsupported dependency schema")
    source = packet["source_key"]
    if type(source) is not str or not 1 <= len(source) <= 512 or "\0" in source:
        raise ValueError("bounded explicit source key required")
    for key in ("frame_number", "timestamp_us", "prediction"):
        integer(value=packet[key])
    for key in ("width", "height"):
        integer(value=packet[key], minimum=1, maximum=4096)
    integer(value=packet["stride"], minimum=4, maximum=16384)
    if (packet["stride"] != packet["width"] * 4 or
            any(type(packet[key]) is not int or packet[key] != 0 for key in ("format", "orientation"))):
        raise ValueError("packed format-0/orientation-0 algorithm RGBA required")
    if packet["stride"] * packet["height"] > 16 * 1024**2:
        raise ValueError("algorithm RGBA exceeds 16 MiB")
    if not valid_hash(value=packet["rgba_sha256"]):
        raise ValueError("explicit algorithm RGBA SHA-256 required")
    route = packet["runtime_state"]
    fields(value=route, names=ROUTE)
    if any(type(route[key]) is not type(value) or route[key] != value for key, value in ROUTE.items()):
        raise ValueError("only uncached ordinary Base routing is supported")
    if packet["face"] is not None:
        validate_face(face=packet["face"], width=packet["width"], height=packet["height"])
    return packet


def validate(*, packet, rgba):
    packet = validate_metadata(packet=packet)
    if (type(rgba) is not np.ndarray or rgba.dtype != np.uint8 or
            rgba.shape != (packet["height"], packet["width"], 4) or rgba.nbytes > 16 * 1024**2):
        raise ValueError("bounded uint8 algorithm RGBA required")
    pixels = rgba.copy(order="C")
    if hashlib.sha256(pixels.tobytes()).hexdigest() != packet["rgba_sha256"]:
        raise ValueError("algorithm RGBA does not match dependency packet")
    return packet, pixels
