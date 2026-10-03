"""Strict typed report metrics shared by temporal evidence audits."""
from __future__ import annotations

import math

from face_alignment_replay import valid_hash
from face_host_geometry_contract import integer


def require(*, condition, message):
    if not condition:
        raise ValueError(message)


def flag(*, row, key):
    value = row.get(key)
    require(condition=type(value) is bool, message=f"typed flag required: {key}")
    return value


def count(*, row, key, expected=None, maximum=4096):
    value = integer(value=row.get(key), maximum=maximum)
    require(condition=expected is None or value == expected, message=f"count mismatch: {key}")
    return value


def number(*, value, maximum=65536):
    require(condition=type(value) in (int, float) and 0 <= value <= maximum and math.isfinite(value),
            message="bounded finite nonnegative number required")
    return value


def hash_value(*, value):
    require(condition=valid_hash(value=value), message="lowercase SHA256 required")
    return value


def rows(*, value, length):
    require(condition=isinstance(value, list) and len(value) == length and all(isinstance(row, dict) for row in value),
            message="bounded ordered report objects required")
    return value


def metric(*, value):
    require(condition=isinstance(value, dict), message="point stage metric required")
    exact, within = (flag(row=value, key=key) for key in ("exact", "within"))
    errors = [number(value=value.get(key)) for key in ("max_abs", "mean_l2", "max_l2")]
    count(row=value, key="worst_point_index", maximum=105)
    require(condition=number(value=value.get("tolerance")) == 0 and within == exact
            and exact == all(error == 0 for error in errors), message="strict zero-tolerance metric required")
    return exact, errors[0]


def pixels(*, row, width, height):
    equal = flag(row=row, key="equal")
    changed = count(row=row, key="changed_pixels", maximum=width * height)
    delta = count(row=row, key="max_delta", maximum=255)
    hash_value(value=row.get("sha256"))
    bbox = row.get("bbox")
    if equal:
        require(condition=changed == delta == 0 and bbox is None, message="exact pixel metrics disagree")
    else:
        require(condition=changed > 0 and delta > 0 and isinstance(bbox, list) and len(bbox) == 4
                and all(type(value) is int for value in bbox)
                and 0 <= bbox[0] < bbox[2] <= width and 0 <= bbox[1] < bbox[3] <= height,
                message="changed pixel metrics disagree")
    return equal, delta
