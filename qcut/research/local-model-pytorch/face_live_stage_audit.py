"""CPU-only post-predict diagnostics, after the separate core inference audit.

Receipts must bind to the actual worker result; stage differences are diagnostic,
not receipt failures. Comparison order is not execution order or causal evidence.
No native library, model, pixels, private assets or output files are opened here.
"""
from __future__ import annotations

import hashlib
import math

import numpy as np

from face_alignment_replay import valid_hash
from face_host_geometry_replay import normalized


STAGES = ("decoded_120", "mapped_120", "smoothed", "normalized")
FILTER_ARRAYS = ("current_xy", "previous_xy", "delta_x", "delta_y")
FILTER_FIELDS = (*FILTER_ARRAYS, "first", "alpha", "scale")
NATIVE_FACE_FIELDS = (
    "id", "slot", "alignment", "stage1", "mapped", "tracked", "forward", "inverse",
    "cached_forward", "cached_inverse", "detection_forward", "detection_inverse",
    "base_size", "tracking_size", "tracking_scale", "frame_size", "published", "filters",
)
SOURCE = "dependency-fed-research-inference"


def require(*, condition, message):
    if not condition:
        raise ValueError(message)


def fields(*, value, required, optional=()):
    require(condition=type(value) is dict and set(required) <= value.keys() <= set(required) | set(optional),
            message="exact stage diagnostic fields required")


def integer(*, value, minimum=0, maximum=2**53 - 1):
    require(condition=type(value) is int and minimum <= value <= maximum,
            message="bounded typed diagnostic integer required")


def number(*, value, minimum=-32768, maximum=32768):
    require(condition=type(value) in (int, float) and minimum <= value <= maximum and math.isfinite(value),
            message="finite bounded diagnostic number required")
    return np.float32(value)


def array(*, value, shape, minimum=-32768, maximum=32768):
    require(condition=type(value) is list and len(value) == shape[0],
            message=f"diagnostic array shape must be {shape}")
    if len(shape) == 2:
        rows = [array(value=row, shape=shape[1:], minimum=minimum, maximum=maximum) for row in value]
        return np.asarray(rows, dtype=np.float32).reshape(shape)
    return np.asarray([number(value=item, minimum=minimum, maximum=maximum) for item in value], np.float32)


def native_points(*, value):
    require(condition=type(value) is list and len(value) == 2 and type(value[0]) is list and
            len(value[0]) in (106, 280), message="native 2x106 or 2x280 point rows required")
    return array(value=value, shape=(2, len(value[0])))[:, :106].T.copy()


def metric(*, candidate, native):
    shape_equal = candidate.shape == native.shape
    result = dict(equal=False, shape_equal=shape_equal, candidate_shape=list(candidate.shape),
                  native_shape=list(native.shape), compared_values=0, mismatched_values=None,
                  max_abs_error=None, rms_error=None, first_mismatch=None)
    if not shape_equal:
        return result
    # Numeric equality erases signed zero; absolute errors alone cannot detect it.
    mismatch = candidate.view(np.uint32) != native.view(np.uint32)
    error = candidate.astype(np.float64) - native.astype(np.float64)
    count = int(np.count_nonzero(mismatch))
    result.update(equal=count == 0, compared_values=int(candidate.size), mismatched_values=count,
                  max_abs_error=float(np.max(np.abs(error), initial=0)),
                  rms_error=float(np.sqrt(np.mean(error * error))) if error.size else 0.0,
                  first_mismatch=np.argwhere(mismatch)[0].tolist() if count else None)
    return result


def filter_state(*, value, count, native, width, height):
    extras = ("count", "escale", "width", "height") if native else ()
    fields(value=value, required=(*FILTER_FIELDS, *extras))
    require(condition=type(value["first"]) is bool, message="typed filter first flag required")
    result = {key: number(value=value[key], minimum=0, maximum=maximum)
              for key, maximum in (("alpha", 1), ("scale", 2**20))}
    result["first"] = value["first"]
    for key in FILTER_ARRAYS:
        length = count * (2 if key.endswith("_xy") else 1)
        allowed = (length,) if key == "current_xy" and not native else (0, length)
        require(condition=type(value[key]) is list and len(value[key]) in allowed,
                message=f"bounded {count}-point filter {key} required")
        limit = 65536 if key.startswith("delta_") and not native else 32768
        result[key] = array(value=value[key], shape=(len(value[key]),), minimum=-limit, maximum=limit)
    require(condition=result["delta_x"].shape == result["delta_y"].shape,
            message="matched filter delta dimensions required")
    if native:
        integer(value=value["count"], minimum=count, maximum=count)
        number(value=value["escale"], minimum=0)
        integer(value=value["width"], minimum=1, maximum=4096)
        integer(value=value["height"], minimum=1, maximum=4096)
        require(condition=[value["width"], value["height"]] == [height, width],
                message="native filter dimensions must match swapped algorithm dimensions")
    return result


def filters(*, values, native, width, height):
    require(condition=type(values) is list and len(values) == 2, message="33/73 filter inventory required")
    return [filter_state(value=value, count=count, native=native, width=width, height=height)
            for value, count in zip(values, (33, 73), strict=True)]


def native_face(*, value, width, height):
    fields(value=value, required=NATIVE_FACE_FIELDS)
    integer(value=value["id"], maximum=2**31 - 1)
    integer(value=value["alignment"], minimum=4096)
    integer(value=value["slot"], maximum=9)
    for key in ("base_size", "tracking_size", "frame_size"):
        require(condition=type(value[key]) is list and len(value[key]) == 2,
                message="native geometry dimensions required")
        unused_tracking = key == "tracking_size" and value[key] == [0, 0]
        for side in value[key]:
            integer(value=side, minimum=0 if unused_tracking else 1, maximum=4096)
    require(condition=value["frame_size"] == [height, width], message="native face frame dimensions mismatch")
    number(value=value["tracking_scale"], minimum=0)
    for key in ("forward", "inverse", "cached_forward", "cached_inverse", "detection_forward", "detection_inverse"):
        if value[key] is not None:
            array(value=value[key], shape=(2, 3))
    if value["mapped"] is not None:
        native_points(value=value["mapped"])
    published = value["published"]
    fields(value=published, required=("record", "count", "storage_points", "capacity_points", "points_xy"))
    integer(value=published["record"], minimum=4096)
    integer(value=published["count"], minimum=106, maximum=106)
    integer(value=published["storage_points"], minimum=106, maximum=280)
    require(condition=published["storage_points"] in (106, 280), message="native published storage unsupported")
    integer(value=published["capacity_points"], minimum=published["storage_points"], maximum=512)
    points = array(value=published["points_xy"], shape=(212,)).reshape(106, 2)
    stages = dict(decoded_120=native_points(value=value["stage1"]),
                  mapped_120=native_points(value=value["tracked"]), smoothed=points,
                  normalized=normalized(points=points, request=[0, width, height, width * 4, 0]))
    return stages, filters(values=value["filters"], native=True, width=width, height=height)


def route(*, native, candidate, result):
    runtime = native["runtime_state"]
    expected = dict(config_cache_mode=0, optimized_output_bit=False, cache_counter=0, cache_skip_bit=True)
    fields(value=runtime, required=(*expected, "base_output_mode_bit"))
    require(condition=type(runtime["base_output_mode_bit"]) is bool, message="typed native output mode required")
    for key, value in expected.items():
        require(condition=type(runtime[key]) is type(value) and runtime[key] == value,
                message="only ordinary uncached primary106 context is supported")
    expected_route = "ordinary-extra-primary106" if runtime["base_output_mode_bit"] else "ordinary-base-primary106"
    smoothing = result.get("primary_smoothing")
    require(condition=type(smoothing) is dict and candidate["route"] == smoothing.get("route") == expected_route,
            message="native/candidate/worker route context mismatch")


def association(*, native, candidate, worker, index, token, source_key, pid, owner, version):
    fields(value=native, required=("schema", "pid", "prediction", "timestamp_us", "owner", "token_sha256",
        "width", "height", "algorithm_rgba_sha256", "runtime_state", "faces", "observation",
        "native_points_sent_to_worker", "product_parity_verified"))
    fields(value=candidate, required=("schema", "pid", "token_sha256", "prediction", "timestamp_us", "source_key",
        "algorithm_rgba_sha256", "backend_version", "width", "height", "face_id", "alignment", "route",
        "native_final_point_input_used", "product_parity_verified", "stages"), optional=("source",))
    require(condition=native["schema"] == "face-live-native-stages-v1" and
            candidate["schema"] == "face-live-candidate-stages-v1", message="unsupported stage diagnostic schema")
    require(condition=type(worker) is dict and worker.get("ok") is True and worker.get("token") == token,
            message="successful worker receipt for this token required")
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    for row in (native, candidate, worker):
        integer(value=row.get("prediction"), minimum=index, maximum=index)
        integer(value=row.get("timestamp_us"), maximum=0)
        integer(value=row.get("pid"), minimum=1, maximum=2**31 - 1)
        require(condition=row["pid"] == pid, message="native/candidate/worker PID mismatch")
    for row in (native, candidate):
        require(condition=row["token_sha256"] == token_hash, message="stage session token hash mismatch")
        require(condition=row["product_parity_verified"] is False, message="stage product parity claim forbidden")
    require(condition=native["observation"] == "post-native-predict-before-worker" and
            native["native_points_sent_to_worker"] is False and candidate["native_final_point_input_used"] is False,
            message="post-native-predict-before-worker observation without native point input required")
    integer(value=native["owner"], minimum=4096)
    require(condition=native["owner"] == owner, message="native owner changed")
    result = worker.get("result")
    require(condition=type(result) is dict and result.get("schema") == "face-live-candidate-result-v1" and
            result.get("source") == SOURCE, message="actual candidate worker result required")
    for key in ("prediction", "frame_number"):
        integer(value=result.get(key), minimum=index, maximum=index)
    integer(value=result.get("timestamp_us"), maximum=0)
    for key in ("native_final_point_input_used", "captured_tensor_input_used", "native_analysis_bypassed",
                "product_parity_verified", "candidate_parity_verified", "arbitrary_frame_backend_connected"):
        require(condition=result.get(key) is False, message=f"worker provenance claim forbidden: {key}")
    require(condition=candidate["source_key"] == result.get("source_key") == source_key and
            candidate.get("source", SOURCE) == SOURCE, message="candidate/worker source key mismatch")
    current_version = result.get("backend_version")
    require(condition=type(current_version) is str and current_version.startswith("dependency-core-v1:") and
            valid_hash(value=current_version.split(":", 1)[1]) and candidate["backend_version"] == current_version and
            (version is None or current_version == version), message="candidate/worker backend version mismatch")
    digest = result.get("algorithm_rgba_sha256")
    require(condition=valid_hash(value=digest) and native["algorithm_rgba_sha256"] ==
            candidate["algorithm_rgba_sha256"] == digest, message="algorithm RGBA hash mismatch")
    for key in ("width", "height"):
        for row, name in ((native, key), (candidate, key), (result, f"algorithm_{key}")):
            integer(value=row.get(name), minimum=1, maximum=4096)
        require(condition=native[key] == candidate[key] == result[f"algorithm_{key}"],
                message="native/candidate/worker algorithm dimensions mismatch")
    require(condition=native["width"] * native["height"] * 4 <= 16 * 1024**2,
            message="algorithm RGBA exceeds 16 MiB")
    for faces in (native["faces"], result.get("faces")):
        require(condition=type(faces) is list and len(faces) == 1 and type(faces[0]) is dict,
                message="exactly one native and actual worker face required")
    actual_face, observed_face = result["faces"][0], native["faces"][0]
    fields(value=actual_face, required=("id", "points"))
    integer(value=actual_face["id"], maximum=2**31 - 1)
    integer(value=candidate["face_id"], maximum=2**31 - 1)
    integer(value=candidate["alignment"], minimum=4096)
    require(condition=observed_face.get("id") == candidate["face_id"] == actual_face["id"] and
            observed_face.get("alignment") == candidate["alignment"], message="face ID/alignment association mismatch")
    route(native=native, candidate=candidate, result=result)
    return result


def prediction(*, native, candidate, result):
    width, height = native["width"], native["height"]
    reference, native_filters = native_face(value=native["faces"][0], width=width, height=height)
    stages = candidate["stages"]
    fields(value=stages, required=("seed_160", *STAGES, "filters"))
    heads = result.get("heads")
    require(condition=type(heads) is dict and set(heads) in ({"120"}, {"120", "160"}) and
            (stages["seed_160"] is not None) == ("160" in heads), message="seed stage/worker inference inventory mismatch")
    if stages["seed_160"] is not None:
        array(value=stages["seed_160"], shape=(106, 2))
    candidate_points = {key: array(value=stages[key], shape=(106, 2),
        minimum=0 if key == "normalized" else -32768, maximum=1 if key == "normalized" else 32768) for key in STAGES}
    worker_points = array(value=result["faces"][0]["points"], shape=(106, 2), minimum=0, maximum=1)
    worker_binding = metric(candidate=candidate_points["normalized"], native=worker_points)
    require(condition=worker_binding["equal"], message="normalized candidate differs from actual worker points (float32 bits)")
    comparisons = {key: metric(candidate=candidate_points[key], native=reference[key]) for key in STAGES}
    candidate_filters = filters(values=stages["filters"], native=False, width=width, height=height)
    filter_reports = []
    for index, (actual, expected) in enumerate(zip(candidate_filters, native_filters, strict=True)):
        report = {key: metric(candidate=actual[key], native=expected[key]) for key in FILTER_ARRAYS}
        for key in ("alpha", "scale"):
            report[key] = metric(candidate=np.array([actual[key]], np.float32), native=np.array([expected[key]], np.float32))
        report["first"] = dict(equal=actual["first"] is expected["first"],
                               candidate=actual["first"], native=expected["first"])
        filter_reports.append(report)
        comparisons.update({f"filters.{index}.{key}": report[key] for key in FILTER_FIELDS})
    first = next((key for key, value in comparisons.items() if not value["equal"]), None)
    return dict(prediction=native["prediction"], stages={key: comparisons[key] for key in STAGES},
                filters=filter_reports, worker_normalized_points_verified=True,
                seed_160=dict(candidate_available=stages["seed_160"] is not None,
                    native_counterpart_available=False, verified=False,
                    reason="No native pre-tracking seed snapshot; post-predict mapped data is not a seed counterpart."),
                first_available_mismatch=first, all_available_comparisons_equal=first is None)


def audit(*, native, candidate, worker, token, source_key):
    """Return JSON diagnostics or raise ValueError on malformed/unbound receipts.

    Main inference validation remains a prerequisite, not duplicated here.
    Worker faces expose ID/points only: alignment binds native to candidate.
    """
    require(condition=type(token) is str and 16 <= len(token) <= 128 and "\0" not in token,
            message="bounded session token required")
    require(condition=type(source_key) is str and 1 <= len(source_key) <= 512 and "\0" not in source_key,
            message="bounded source key required")
    for rows in (native, candidate, worker):
        require(condition=type(rows) is list and len(rows) == 2 and all(type(row) is dict for row in rows),
                message="exact cold prediction lists [0, 1] required")
    pid, owner, version = worker[0].get("pid"), native[0].get("owner"), None
    reports = []
    for index in range(2):
        result = association(native=native[index], candidate=candidate[index], worker=worker[index], index=index,
                             token=token, source_key=source_key, pid=pid, owner=owner, version=version)
        reports.append(prediction(native=native[index], candidate=candidate[index], result=result))
        version = result["backend_version"]
    first = next((dict(prediction=row["prediction"], comparison=row["first_available_mismatch"])
                  for row in reports if row["first_available_mismatch"] is not None), None)
    return dict(schema="face-live-stage-audit-v1", passed=True, receipt_validation_passed=True,
                diagnostic_only=True, scope="cold-predictions-0-1-at-time-0", comparison_domain="float32-bits",
                tolerance=0, native_pid=pid, backend_version=version, predictions=reports,
                comparison_order=[*STAGES, *(f"filters.{index}.{key}" for index in range(2) for key in FILTER_FIELDS)],
                all_available_comparisons_equal=first is None, first_available_mismatch=first,
                first_mismatch_is_causal=False, seed_160_native_counterpart_available=False,
                seed_160_verified=False, pipeline_parity_verified=False, product_parity_verified=False)
