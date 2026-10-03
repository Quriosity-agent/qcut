"""Strict contracts for observed FsNew snapshots and their neural record windows."""
from __future__ import annotations

import math


def integer(*, value, minimum=0, maximum=2**63 - 1):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError("bounded typed geometry integer required")
    return value


def numbers(*, value, length, maximum=32768):
    if (not isinstance(value, list) or len(value) != length or
            any(type(item) not in (int, float) or abs(item) > maximum or not math.isfinite(item) for item in value)):
        raise ValueError("bounded finite geometry array required")


def matrix(*, value, columns, optional=False):
    if optional and value is None:
        return
    if not isinstance(value, list) or len(value) != 2 or not isinstance(value[0], list):
        raise ValueError("two-row geometry matrix required")
    count = len(value[0])
    if count not in columns:
        raise ValueError("unsupported geometry matrix columns")
    for row in value:
        numbers(value=row, length=count)


def size_pair(*, value, zero=False):
    if not isinstance(value, list) or len(value) != 2:
        raise ValueError("typed geometry size pair required")
    for item in value:
        integer(value=item, minimum=0 if zero else 1, maximum=4096)


def validate_snapshot(*, row):
    if not isinstance(row, dict) or "error" in row:
        raise ValueError("geometry observer rejected native state")
    integer(value=row.get("index"), maximum=63)
    integer(value=row.get("rc"), maximum=0)
    integer(value=row.get("handle"), minimum=4096)
    integer(value=row.get("bytenn_sequence"), minimum=1, maximum=4096)
    if row.get("api") != "FsNew_DoPredict":
        raise ValueError("only observed 106-point FsNew API supported")
    request = row.get("request")
    if not isinstance(request, list) or len(request) != 5 or any(type(item) is not int for item in request):
        raise ValueError("typed geometry request required")
    format_, width, height, stride, rotation = request
    if format_ != 0 or rotation != 0 or stride != width * 4:
        raise ValueError("only observed packed RGBA unrotated request supported")
    size_pair(value=[width, height])
    predictors = row.get("predictors")
    if not isinstance(predictors, list) or len(predictors) != 2:
        raise ValueError("two initialized Stage1 predictors required")
    for predictor, side in zip(predictors, (120, 160), strict=True):
        if not isinstance(predictor, dict):
            raise ValueError("geometry predictor object required")
        for key in ("predictor", "provider", "network"):
            integer(value=predictor.get(key), minimum=4096)
        size_pair(value=predictor.get("size"))
        if predictor["size"] != [side, side]:
            raise ValueError("unverified geometry predictor sizes")
    for key in ("predictor", "provider", "network"):
        if len({item[key] for item in predictors}) != 2:
            raise ValueError("aliased geometry predictors")
    tables = row.get("tables")
    if not isinstance(tables, dict):
        raise ValueError("initialized geometry decode tables required")
    for key in ("base", "tracking"):
        numbers(value=tables.get(key), length=212, maximum=256)
        if any(value <= 0 for value in tables[key]):
            raise ValueError("uninitialized geometry mean face")
    order = tables.get("order")
    if (not isinstance(order, list) or len(order) != 106 or any(type(item) is not int for item in order) or
            sorted(order) != list(range(106))):
        raise ValueError("geometry order must be a typed permutation")
    faces = row.get("faces")
    if not isinstance(faces, list) or len(faces) > 10:
        raise ValueError("bounded geometry face pool required")
    slots, objects = set(), set()
    active_ids = set()
    for face in faces:
        if not isinstance(face, dict):
            raise ValueError("geometry face object required")
        slot = integer(value=face.get("slot"), maximum=9)
        address = integer(value=face.get("alignment"), minimum=4096)
        if type(face.get("active")) is not bool:
            raise ValueError("typed geometry active bit required")
        for key in ("id", "tracking_id"):
            integer(value=face.get(key), minimum=0 if face["active"] else -1, maximum=2**31 - 1)
        if face["active"]:
            if face["id"] in active_ids:
                raise ValueError("duplicate active geometry face ID")
            active_ids.add(face["id"])
        if slot in slots or address in objects:
            raise ValueError("duplicate geometry face slot or owner")
        slots.add(slot)
        objects.add(address)
        for key in ("stage1", "mapped", "tracked"):
            matrix(value=face.get(key), columns=(106, 280))
        for key in ("forward", "inverse", "detection_forward", "detection_inverse"):
            matrix(value=face.get(key), columns=(3,))
        for key in ("cached_forward", "cached_inverse"):
            if key not in face:
                raise ValueError("geometry cached matrix field required")
            matrix(value=face.get(key), columns=(3,), optional=True)
        for key in ("frame_size", "tracking_size"):
            size_pair(value=face.get(key), zero=True)
        if face["active"] and (face["frame_size"] != [height, width] or len(face["stage1"][0]) != 106):
            raise ValueError("active geometry dimensions or Stage1 columns mismatch")
        size_pair(value=face.get("base_size"))
        if face["base_size"] != [120, 120]:
            raise ValueError("unsupported base geometry profile")
        numbers(value=[face.get("tracking_scale")], length=1, maximum=1)


def validate_sequence(*, records):
    if not isinstance(records, list) or not 1 <= len(records) <= 64:
        raise ValueError("bounded nonempty geometry sequence required")
    for row in records:
        validate_snapshot(row=row)
    records = sorted(records, key=lambda row: row["index"])
    if [row["index"] for row in records] != list(range(len(records))):
        raise ValueError("geometry sequence has gaps or duplicate indices")
    first = records[0]
    for previous, row in zip(records, records[1:]):
        if (row["bytenn_sequence"] <= previous["bytenn_sequence"] or
                any(row[key] != first[key] for key in ("handle", "predictors", "tables", "request"))):
            raise ValueError("geometry owner, tables or neural window changed")
    return records


def associate_inferences(*, records, networks, metadata):
    records = validate_sequence(records=records)
    if not isinstance(networks, dict) or not isinstance(metadata, list) or not 1 <= len(metadata) <= 4096:
        raise ValueError("bounded neural inventory and metadata required")
    indices = set()
    for item in metadata:
        if not isinstance(item, dict) or not isinstance(item.get("kind"), str) or not isinstance(item.get("fields"), dict):
            raise ValueError("typed neural metadata required")
        index = integer(value=item.get("index"), maximum=4095)
        if index in indices:
            raise ValueError("duplicate neural capture index")
        indices.add(index)
        if item["kind"] != "espresso-inference":
            continue
        fields = item["fields"]
        identity, inference = fields.get("self"), fields.get("inference")
        network = networks.get(identity) if isinstance(identity, str) else None
        if (not isinstance(network, dict) or not isinstance(inference, str) or not inference.isdecimal() or
                not 0 <= int(inference) <= 128 or fields.get("rc") != "0"):
            raise ValueError("verified successful neural inference required")
        completed = network.get("successful_inferences")
        if (not isinstance(completed, list) or any(type(value) is not int for value in completed) or
                int(inference) not in completed):
            raise ValueError("geometry inference has no completed network result")
    associations, lower = [], 0
    for row in records:
        upper = row["bytenn_sequence"]
        selected = []
        for predictor in row["predictors"]:
            identity = str(predictor["network"])
            if identity not in networks:
                raise ValueError("geometry predictor has no captured espresso graph")
            inferences = [item for item in metadata if item["kind"] == "espresso-inference" and
                          lower <= item["index"] < upper and item["fields"].get("self") == identity]
            for item in inferences:
                if item["fields"].get("rc") != "0":
                    raise ValueError("failed inference in geometry window")
                selected.append(dict(size=predictor["size"][0], network=identity,
                                     inference=int(item["fields"]["inference"]), record_index=item["index"]))
        if len([item for item in selected if item["size"] == 120]) != 1:
            raise ValueError("one actual 120 inference per observed prediction required")
        associations.append(dict(prediction=row["index"], neural_window=[lower, upper], inferences=selected))
        lower = upper
    return associations
